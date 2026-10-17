// dsh-ppt-canvas — PPTX 写入层
//
// applyPatch 是纯函数：只在内存里改，返回新字节流，不落盘（deck-store.js 负责原子写）。
// 所有编辑都作用在**解析出来的原树**上，因此不认识的属性/扩展/关系都不会丢。
//
// 关键 OOXML 细节（都踩过）：
//  - 改文本必须同时处理 a:r/a:rPr/a:t 与 a:endParaRPr：PowerPoint 在段落末尾用
//    endParaRPr 记住「接下来输入的字」的格式，只改 run 会让光标态回退到母版样式。
//  - 文本带首尾空格必须写 xml:space="preserve"，否则 PowerPoint 会吃掉空格。
//  - 字体要同时写 a:latin 与 a:ea：中文字形走 east-asian，只写 latin 中文仍用旧字体。
//  - 颜色的子元素顺序在 CT_SolidColorFillProperties 里是固定的（先色值后变换），
//    所以这里总是「清空后按顺序重写」而不是就地替换。
//  - duplicate 必须分配新的 p:cNvPr/@id：同一 slide 内 id 重复会让 PowerPoint 报错修复。

import { readZip, writeZip } from './zip.js'
import {
  parseXml, serializeXml, childrenOf, childOf, findAll, findFirst, textOf, getAttr, setAttr,
  createElement, appendChild, insertBefore, removeChild, removeChildren, cloneElement,
  setText, isElement, isText,
} from './xml.js'
import { emuToPx, pxToEmu, elementById } from './pptx-read.js'

const PT_PER_PX = 72 / 96

/** 带 code 的业务错误。 */
class PatchError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'PatchError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** 允许的 op 及其字段（未列出的字段一律报错，避免模型塞错字段却静默生效）。 */
const OP_FIELDS = {
  setText: ['op', 'id', 'paragraphs'],
  setTextStyle: ['op', 'id', 'color', 'fontSize', 'bold', 'italic', 'underline', 'align', 'fontFamily'],
  setFill: ['op', 'id', 'color'],
  setLine: ['op', 'id', 'color', 'width', 'dash'],
  setGeometry: ['op', 'id', 'x', 'y', 'w', 'h', 'rotation'],
  move: ['op', 'id', 'dx', 'dy'],
  resize: ['op', 'id', 'dw', 'dh'],
  align: ['op', 'ids', 'mode'],
  setZ: ['op', 'id', 'z'],
  bringToFront: ['op', 'id'],
  sendToBack: ['op', 'id'],
  remove: ['op', 'id'],
  duplicate: ['op', 'id', 'dx', 'dy'],
}

const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'distributeH', 'distributeV']

/**
 * 校验一个 patch。
 * @returns {{violations: object[], ops: object[]}}
 */
export function validatePatch(deck, patch) {
  const violations = []
  const ops = []
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    violations.push({ index: -1, op: null, field: 'patch', message: 'patch must be an object' })
    return { violations, ops }
  }
  if (typeof patch.summary !== 'string' || patch.summary.trim() === '') {
    violations.push({ index: -1, op: null, field: 'summary', message: 'summary is required and must be a non-empty string' })
  }
  if (!Array.isArray(patch.ops) || patch.ops.length === 0) {
    violations.push({ index: -1, op: null, field: 'ops', message: 'ops must be a non-empty array' })
    return { violations, ops }
  }

  patch.ops.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      violations.push({ index, op: null, field: 'ops', message: 'each op must be an object' })
      return
    }
    const op = raw.op
    const allowed = typeof op === 'string' ? OP_FIELDS[op] : undefined
    if (allowed === undefined) {
      violations.push({ index, op: typeof op === 'string' ? op : null, field: 'op', message: `unknown op ${JSON.stringify(op)}` })
      return
    }
    for (const key of Object.keys(raw)) {
      if (!allowed.includes(key)) {
        violations.push({ index, op, field: key, message: `field "${key}" is not accepted by op "${op}"` })
      }
    }
    const numberAt = (field, options = {}) => {
      const value = raw[field]
      if (value === undefined) {
        if (options.required === true) {
          violations.push({ index, op, field, message: `${field} is required` })
        }
        return undefined
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        violations.push({ index, op, field, message: `${field} must be a finite number` })
        return undefined
      }
      if (options.min !== undefined && value < options.min) {
        violations.push({ index, op, field, message: `${field} must be >= ${options.min} (got ${value})` })
        return undefined
      }
      return value
    }
    const colorAt = (field, options = {}) => {
      const value = raw[field]
      if (value === undefined) {
        if (options.required === true) violations.push({ index, op, field, message: `${field} is required` })
        return undefined
      }
      if (value === null) return null
      if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        violations.push({ index, op, field, message: `${field} must be "#RRGGBB" or null` })
        return undefined
      }
      return value
    }
    const idAt = () => {
      const id = raw.id
      if (typeof id !== 'string' || id === '') {
        violations.push({ index, op, field: 'id', message: 'id is required and must be a string' })
        return undefined
      }
      const found = elementById(deck, id)
      if (found === undefined) {
        violations.push({ index, op, field: 'id', message: `no element with id ${id} in the current deck` })
        return undefined
      }
      return id
    }

    switch (op) {
      case 'setText': {
        const id = idAt()
        if (!Array.isArray(raw.paragraphs) || raw.paragraphs.length === 0) {
          violations.push({ index, op, field: 'paragraphs', message: 'paragraphs must be a non-empty array' })
          break
        }
        raw.paragraphs.forEach((paragraph, pIndex) => {
          if (paragraph === null || typeof paragraph !== 'object') {
            violations.push({ index, op, field: `paragraphs[${pIndex}]`, message: 'each paragraph must be an object' })
            return
          }
          if (paragraph.runs !== undefined && !Array.isArray(paragraph.runs)) {
            violations.push({ index, op, field: `paragraphs[${pIndex}].runs`, message: 'runs must be an array' })
            return
          }
          for (const [rIndex, run] of (paragraph.runs ?? []).entries()) {
            if (run === null || typeof run !== 'object' || typeof run.text !== 'string') {
              violations.push({ index, op, field: `paragraphs[${pIndex}].runs[${rIndex}].text`, message: 'run.text must be a string' })
            }
          }
        })
        // setText 只对**本来就有文本体**的元素成立（图片/表格/线条/组合没有 a:txBody）。
        // 否则写入端会硬造一个 txBody —— 那是非法 OOXML，而且以前还会抛 TypeError 变成 500。
        if (id !== undefined) {
          const target = elementById(deck, id)
          if (target !== undefined && (target.shape.text === null || target.shape.text === undefined)) {
            violations.push({
              index,
              op,
              field: 'id',
              message: `element ${id} (${target.shape.kind}) has no text body; setText only works on text-bearing shapes`,
            })
          }
        }
        if (id !== undefined) ops.push({ index, op, id, paragraphs: raw.paragraphs })
        break
      }
      case 'setTextStyle': {
        const id = idAt()
        const color = colorAt('color')
        const fontSize = numberAt('fontSize', { min: 1 })
        const fontFamily = raw.fontFamily
        if (fontFamily !== undefined && typeof fontFamily !== 'string') {
          violations.push({ index, op, field: 'fontFamily', message: 'fontFamily must be a string' })
        }
        for (const field of ['bold', 'italic', 'underline']) {
          if (raw[field] !== undefined && typeof raw[field] !== 'boolean') {
            violations.push({ index, op, field, message: `${field} must be a boolean` })
          }
        }
        if (raw.align !== undefined && !['left', 'center', 'right', 'justify'].includes(raw.align)) {
          violations.push({ index, op, field: 'align', message: 'align must be left|center|right|justify' })
        }
        if (id !== undefined) {
          ops.push({ index, op, id, color, fontSize, fontFamily, bold: raw.bold, italic: raw.italic, underline: raw.underline, align: raw.align })
        }
        break
      }
      case 'setFill': {
        const id = idAt()
        const color = colorAt('color', { required: true })
        if (id !== undefined && color !== undefined) ops.push({ index, op, id, color })
        break
      }
      case 'setLine': {
        const id = idAt()
        const color = colorAt('color')
        const width = numberAt('width', { min: 0 })
        if (raw.dash !== undefined && !['solid', 'dash', 'dot', 'lgDash', 'sysDash', 'sysDot'].includes(raw.dash)) {
          violations.push({ index, op, field: 'dash', message: 'dash must be solid|dash|dot|lgDash|sysDash|sysDot' })
        }
        if (id !== undefined) ops.push({ index, op, id, color, width, dash: raw.dash })
        break
      }
      case 'setGeometry': {
        const id = idAt()
        const x = numberAt('x')
        const y = numberAt('y')
        const w = numberAt('w', { min: 1 })
        const h = numberAt('h', { min: 1 })
        const rotation = numberAt('rotation')
        if (x === undefined && y === undefined && w === undefined && h === undefined && rotation === undefined) {
          violations.push({ index, op, field: 'x', message: 'setGeometry needs at least one of x/y/w/h/rotation' })
        }
        if (id !== undefined) ops.push({ index, op, id, x, y, w, h, rotation })
        break
      }
      case 'move': {
        const id = idAt()
        const dx = numberAt('dx')
        const dy = numberAt('dy')
        if (dx === undefined && dy === undefined) {
          violations.push({ index, op, field: 'dx', message: 'move needs dx and/or dy' })
        }
        if (id !== undefined) ops.push({ index, op, id, dx: dx ?? 0, dy: dy ?? 0 })
        break
      }
      case 'resize': {
        const id = idAt()
        const dw = numberAt('dw')
        const dh = numberAt('dh')
        if (dw === undefined && dh === undefined) {
          violations.push({ index, op, field: 'dw', message: 'resize needs dw and/or dh' })
        }
        if (id !== undefined) ops.push({ index, op, id, dw: dw ?? 0, dh: dh ?? 0 })
        break
      }
      case 'align': {
        if (!Array.isArray(raw.ids) || raw.ids.length < 2) {
          violations.push({ index, op, field: 'ids', message: 'align needs at least 2 ids' })
          break
        }
        const resolved = []
        for (const id of raw.ids) {
          if (typeof id !== 'string' || elementById(deck, id) === undefined) {
            violations.push({ index, op, field: 'ids', message: `no element with id ${JSON.stringify(id)} in the current deck` })
          } else resolved.push(id)
        }
        if (!ALIGN_MODES.includes(raw.mode)) {
          violations.push({ index, op, field: 'mode', message: `mode must be one of ${ALIGN_MODES.join('|')}` })
        }
        if (resolved.length >= 2 && ALIGN_MODES.includes(raw.mode)) {
          ops.push({ index, op, ids: resolved, mode: raw.mode })
        }
        break
      }
      case 'setZ': {
        const id = idAt()
        const z = numberAt('z', { required: true, min: 0 })
        if (id !== undefined && z !== undefined) ops.push({ index, op, id, z: Math.trunc(z) })
        break
      }
      case 'bringToFront':
      case 'sendToBack': {
        const id = idAt()
        if (id !== undefined) ops.push({ index, op, id })
        break
      }
      case 'remove': {
        const id = idAt()
        if (id !== undefined) ops.push({ index, op, id })
        break
      }
      case 'duplicate': {
        const id = idAt()
        const dx = numberAt('dx')
        const dy = numberAt('dy')
        if (id !== undefined) ops.push({ index, op, id, dx: dx ?? 0, dy: dy ?? 0 })
        break
      }
      default:
        break
    }
  })

  return { violations, ops }
}

// ------------------------------------------------------------------ 定位

/** 找形状元素：在树的哪一层、在哪个 spTree、它的容器元素。 */
function locate(part, shapeId) {
  const spTree = findFirst(part, 'p:spTree')
  if (spTree === undefined) return undefined
  const containers = ['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:cxnSp', 'p:contentPart']
  const stack = [spTree]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const child of childrenOf(current)) {
      if (!containers.includes(child.name)) continue
      const nv = childrenOf(child).find(node => childOf(node, 'p:cNvPr') !== undefined)
      const cNvPr = nv === undefined ? undefined : childOf(nv, 'p:cNvPr')
      if (getAttr(cNvPr, 'id') === String(shapeId)) {
        return { element: child, parent: current }
      }
      stack.push(child)
    }
  }
  return undefined
}

/** 形状的 spPr（写属性用）。 */
function spPrFor(element) {
  if (element.name === 'p:graphicFrame') return childOf(element, 'p:xfrm')
  return childOf(element, 'p:spPr') ?? childOf(element, 'p:grpSpPr')
}

/** 形状的 txBody。 */
function txBodyFor(element) {
  return childOf(element, 'p:txBody')
}

/**
 * 元素的几何（px），用于相对位移与对齐。
 *
 * **真实 PowerPoint 的占位符没有 `a:xfrm`**（标题/正文的位置与尺寸继承自 slideLayout），
 * 以前这里直接 childOf(undefined) → TypeError → 任何编辑都 500。
 * 拿不到 xfrm 时返回 0 几何（不崩），位置继承关系保持不动。
 */
function geometryOf(element) {
  const spPr = spPrFor(element)
  const xfrm = element.name === 'p:graphicFrame' ? spPr : (spPr === undefined ? undefined : childOf(spPr, 'a:xfrm'))
  if (xfrm === undefined) return { x: 0, y: 0, w: 0, h: 0 }
  const off = childOf(xfrm, 'a:off')
  const ext = childOf(xfrm, 'a:ext')
  return {
    x: emuToPx(getAttr(off, 'x')),
    y: emuToPx(getAttr(off, 'y')),
    w: emuToPx(getAttr(ext, 'cx')),
    h: emuToPx(getAttr(ext, 'cy')),
  }
}

/** 确保 a:xfrm 存在并返回它。 */
function ensureTransform(element) {
  if (element.name === 'p:graphicFrame') {
    let xfrm = childOf(element, 'p:xfrm')
    if (xfrm === undefined) {
      xfrm = createElement('p:xfrm')
      appendChild(xfrm, createElement('a:off', { x: '0', y: '0' }))
      appendChild(xfrm, createElement('a:ext', { cx: '0', cy: '0' }))
      element.children.unshift(xfrm)
      xfrm.parent = element
    }
    if (childOf(xfrm, 'a:off') === undefined) appendChild(xfrm, createElement('a:off', { x: '0', y: '0' }))
    if (childOf(xfrm, 'a:ext') === undefined) appendChild(xfrm, createElement('a:ext', { cx: '0', cy: '0' }))
    return xfrm
  }
  let spPr = childOf(element, 'p:spPr')
  if (spPr === undefined) {
    spPr = createElement('p:spPr')
    const nv = childrenOf(element).find(node => childOf(node, 'p:cNvPr') !== undefined)
    const after = nv ?? childrenOf(element)[0]
    insertBefore(element, spPr, after === undefined ? undefined : element.children[element.children.indexOf(after) + 1])
  }
  let xfrm = childOf(spPr, 'a:xfrm')
  if (xfrm === undefined) {
    xfrm = createElement('a:xfrm')
    spPr.children.unshift(xfrm)
    xfrm.parent = spPr
  }
  if (childOf(xfrm, 'a:off') === undefined) appendChild(xfrm, createElement('a:off', { x: '0', y: '0' }))
  if (childOf(xfrm, 'a:ext') === undefined) appendChild(xfrm, createElement('a:ext', { cx: '0', cy: '0' }))
  return xfrm
}

function setTransform(element, geometry) {
  const xfrm = ensureTransform(element)
  const off = childOf(xfrm, 'a:off')
  const ext = childOf(xfrm, 'a:ext')
  if (geometry.x !== undefined) setAttr(off, 'x', String(pxToEmu(geometry.x)))
  if (geometry.y !== undefined) setAttr(off, 'y', String(pxToEmu(geometry.y)))
  if (geometry.w !== undefined) setAttr(ext, 'cx', String(pxToEmu(geometry.w)))
  if (geometry.h !== undefined) setAttr(ext, 'cy', String(pxToEmu(geometry.h)))
  if (geometry.rotation !== undefined) {
    if (geometry.rotation === 0) setAttr(xfrm, 'rot', null)
    else setAttr(xfrm, 'rot', String(Math.round(geometry.rotation * 60000)))
  }
}

/** 用 a:srgbClr 构造一个填充容器（返回 <a:solidFill>）。 */
function solidFillFor(color) {
  const fill = createElement('a:solidFill')
  appendChild(fill, createElement('a:srgbClr', { val: color.replace('#', '').toUpperCase() }))
  return fill
}

/**
 * 设置形状填充。color = null 时写 a:noFill。
 * 插到 a:ln 之前（CT_ShapeProperties 的元素顺序要求填充在描边前）。
 */
function setFill(element, color) {
  const spPr = spPrFor(element)
  if (spPr === undefined) return
  removeChildren(spPr, 'a:noFill')
  removeChildren(spPr, 'a:solidFill')
  removeChildren(spPr, 'a:gradFill')
  removeChildren(spPr, 'a:blipFill')
  removeChildren(spPr, 'a:pattFill')
  removeChildren(spPr, 'a:grpFill')
  const node = color === null ? createElement('a:noFill') : solidFillFor(color)
  const ln = childOf(spPr, 'a:ln')
  if (ln === undefined) appendChild(spPr, node)
  else insertBefore(spPr, node, ln)
}

/** 设置描边。color = null 时写 a:ln/a:noFill。 */
function setLine(element, color, width, dash) {
  const spPr = spPrFor(element)
  if (spPr === undefined) return
  let ln = childOf(spPr, 'a:ln')
  if (ln === undefined) {
    ln = createElement('a:ln')
    appendChild(spPr, ln)
  }
  removeChildren(ln, 'a:noFill')
  removeChildren(ln, 'a:solidFill')
  removeChildren(ln, 'a:gradFill')
  removeChildren(ln, 'a:pattFill')
  removeChildren(ln, 'a:prstDash')
  if (width !== undefined) setAttr(ln, 'w', String(pxToEmu(width)))
  if (color === null) {
    appendChild(ln, createElement('a:noFill'))
    return
  }
  if (color !== undefined) {
    ln.children.unshift(solidFillFor(color))
    ln.children[0].parent = ln
  }
  if (dash !== undefined && dash !== 'solid') appendChild(ln, createElement('a:prstDash', { val: dash }))
  else if (dash === 'solid') appendChild(ln, createElement('a:prstDash', { val: 'solid' }))
}

/** 确保 a:rPr 存在。 */
function ensureRunProps(run) {
  let rPr = childOf(run, 'a:rPr')
  if (rPr === undefined) {
    rPr = createElement('a:rPr', { lang: 'zh-CN', dirty: '0' })
    run.children.unshift(rPr)
    rPr.parent = run
  }
  return rPr
}

function applyRunStyle(rPr, style) {
  if (style.color !== undefined && style.color !== null) {
    removeChildren(rPr, 'a:solidFill')
    const fill = solidFillFor(style.color)
    const insertAt = rPr.children.findIndex(child => isElement(child) && child.name === 'a:latin')
    if (insertAt === -1) appendChild(rPr, fill)
    else insertBefore(rPr, fill, rPr.children[insertAt])
  } else if (style.color === null) {
    removeChildren(rPr, 'a:solidFill')
  }
  if (style.fontSize !== undefined && style.fontSize !== null) {
    setAttr(rPr, 'sz', String(Math.round(style.fontSize * PT_PER_PX * 100)))
  }
  if (style.bold !== undefined) setAttr(rPr, 'b', style.bold ? '1' : '0')
  if (style.italic !== undefined) setAttr(rPr, 'i', style.italic ? '1' : '0')
  if (style.underline !== undefined) setAttr(rPr, 'u', style.underline ? 'sng' : 'none')
  if (style.fontFamily !== undefined && style.fontFamily !== null) {
    removeChildren(rPr, 'a:latin')
    removeChildren(rPr, 'a:ea')
    appendChild(rPr, createElement('a:latin', { typeface: style.fontFamily }))
    // 中文字形走 east-asian 字体槽：只写 latin 时中文仍用旧字体。
    appendChild(rPr, createElement('a:ea', { typeface: style.fontFamily }))
  }
}

function applyParagraphAlign(p, align) {
  let pPr = childOf(p, 'a:pPr')
  if (pPr === undefined) {
    pPr = createElement('a:pPr')
    p.children.unshift(pPr)
    pPr.parent = p
  }
  const ooxml = align === 'center' ? 'ctr' : align === 'right' ? 'r' : align === 'justify' ? 'just' : 'l'
  setAttr(pPr, 'algn', ooxml)
}

/**
 * 用段落数组替换 txBody 的内容，逐段沿用旧段落的样式。
 *
 * 为什么是「逐段」而不是「拿第一段当全局模板」（2026-10-15 用户实测教训）：
 * 客户端的 setText 只发 {runs:[{text}]}（就地编辑 / 属性面板 / AI 都一样），
 * 段落的 pPr 与 run 的 rPr 全靠这里保住。文本框常以**空段落开头**（plain 以
 * 换行开头），空段没有带格式的 run —— 拿它当模板会把后续段的字号/颜色/对齐
 * 全部拉平成默认值，用户改一个字，整框排版和大小就丢了。
 * 新段落 i 对应旧段落 i（越界沿用最后一个旧段落），显式给出的样式仍优先生效。
 */
function setTextBody(element, paragraphs) {
  let txBody = txBodyFor(element)
  if (txBody === undefined) {
    txBody = createElement('p:txBody')
    appendChild(txBody, createElement('a:bodyPr'))
    appendChild(txBody, createElement('a:lstStyle'))
    appendChild(element, txBody)
  }
  const existing = childrenOf(txBody, 'a:p')
  const templateEnd = childOf(txBody, 'a:endParaRPr')
  for (const p of existing) removeChild(txBody, p)
  removeChildren(txBody, 'a:endParaRPr')

  // 空段/无格式段的样式兜底链（2026-10-15 用户实测"打两轮字突然变小"）：
  // 用户在空行上打字时，该段没有带格式的 run —— 若模板退化为默认值，这一行
  // 就按母版默认字号渲染，下一轮编辑器也跟着变小。兜底顺序：
  //   映射段的首 run rPr → 映射段的 endParaRPr（**必须真带格式**：有 sz 或
  //   solidFill，否则很多空段的 endParaRPr 只有 lang，会把兜底链提前掐断）
  //   → 向后找最近带样式 run 的段 → 向前找 → 都没有才用默认值。
  const styledRPrOf = (p) => {
    if (p === undefined) return undefined
    const runs = childrenOf(p)
    const r = runs.find(child => child.name === 'a:r') ?? runs.find(child => child.name === 'a:fld')
    return r === undefined ? undefined : childOf(r, 'a:rPr')
  }
  const carriesFormatting = (rPr) => {
    if (rPr === undefined) return false
    if (getAttr(rPr, 'sz') !== undefined) return true
    return childOf(rPr, 'a:solidFill') !== undefined
  }
  const resolveTemplateRPr = (mappedIndex) => {
    const source = existing.length > 0 ? existing[Math.min(mappedIndex, existing.length - 1)] : undefined
    // 无旧段落可参照（元素原本没有 p:txBody，setText 现建了一个）：
    // 没有模板样式可用，直接返回 undefined，由调用方走默认值。
    // 少了这一行，childOf(undefined, …) 会抛 "Cannot read properties of undefined"，
    // 让 setText 打在图片/表格/线条/组合上时变成 500 ioFailed。
    if (source === undefined) return undefined
    const direct = styledRPrOf(source)
    if (direct !== undefined) return direct
    const sourceEnd = childOf(source, 'a:endParaRPr')
    if (carriesFormatting(sourceEnd)) return sourceEnd
    for (let i = Math.min(mappedIndex, existing.length - 1); i < existing.length; i++) {
      const r = styledRPrOf(existing[i])
      if (r !== undefined) return r
    }
    for (let i = Math.min(mappedIndex, existing.length - 1); i >= 0; i--) {
      const r = styledRPrOf(existing[i])
      if (r !== undefined) return r
    }
    return undefined
  }

  paragraphs.forEach((paragraph, index) => {
    const source = existing.length > 0 ? existing[Math.min(index, existing.length - 1)] : undefined
    const templatePPr = source === undefined ? undefined : childOf(source, 'a:pPr')
    const p = createElement('a:p')
    const align = paragraph.align
    if (templatePPr !== undefined || align !== undefined) {
      const pPr = templatePPr === undefined ? createElement('a:pPr') : cloneElement(templatePPr)
      if (paragraph.level !== undefined) setAttr(pPr, 'lvl', String(paragraph.level))
      if (align !== undefined) setAttr(pPr, 'algn', align === 'center' ? 'ctr' : align === 'right' ? 'r' : align === 'justify' ? 'just' : 'l')
      appendChild(p, pPr)
    }

    const newRuns = paragraph.runs ?? []
    const newText = newRuns.map(run => run.text ?? '').join('')

    if (newText === '') {
      // 空行**绝不带 run**（2026-10-15 用户实测"改完字内容整体下降一行"）：
      // 哪怕是空文本 run，也会按它继承到的字号把空行撑高一行，下面的内容
      // 全被推下去。OOXML 里空行就是不带 run 的 <a:p/>。
      // 例外：这一行**原本**有带格式的文字（被用户清空）——用 endParaRPr
      // 克隆原格式保住行高，这正是 PowerPoint 存"清空的行"的方式。
      const prevStyled = styledRPrOf(source)
      if (prevStyled !== undefined) {
        const endPara = cloneElement(prevStyled)
        endPara.name = 'a:endParaRPr'
        appendChild(p, endPara)
      }
      appendChild(txBody, p)
      if (index === paragraphs.length - 1 && templateEnd !== undefined) {
        appendChild(txBody, cloneElement(templateEnd))
      }
      return
    }

    const hasExplicitRunStyle = newRuns.some(run =>
      run.color !== undefined || run.fontSize !== undefined || run.bold !== undefined
      || run.italic !== undefined || run.fontFamily !== undefined)
    const oldRuns = source === undefined ? [] : childrenOf(source).filter(child => child.name === 'a:r' || child.name === 'a:fld')

    /**
     * 逐字符样式映射（原生 PPT 语义：改字保留每个字符自己的格式）。
     * 新段落没有显式样式、旧段落有多个 run 时，把旧段落的每个字符位置
     * 映射到它所在 run 的 rPr；新文本第 i 个字符继承旧文本第
     * min(i, 旧长度-1) 个字符的格式，连续同格式的字符合并成一个 run。
     * （插入/删除造成的偏移是近似映射；此前任何一次编辑都会把整段拉平
     * 成首 run 样式，相比之下这是保真度的量级提升。）
     */
    const emitRun = (rPrTemplate, text, run) => {
      const r = createElement('a:r')
      const rPr = rPrTemplate === undefined ? createElement('a:rPr', { lang: 'zh-CN', dirty: '0' }) : cloneElement(rPrTemplate)
      if (run.bold !== undefined) setAttr(rPr, 'b', run.bold ? '1' : '0')
      if (run.italic !== undefined) setAttr(rPr, 'i', run.italic ? '1' : '0')
      appendChild(r, rPr)
      const attrs = { }
      // 首尾空格必须保留，否则 PowerPoint 会吞掉（也影响后续测量的准确性）。
      if (typeof text === 'string' && (/^\s/.test(text) || /\s$/.test(text))) {
        attrs['xml:space'] = 'preserve'
      }
      const t = createElement('a:t', attrs)
      setText(t, text ?? '')
      appendChild(r, t)
      if (run.color !== undefined && run.color !== null) applyRunStyle(rPr, { color: run.color })
      if (run.fontSize !== undefined && run.fontSize !== null) applyRunStyle(rPr, { fontSize: run.fontSize })
      if (run.fontFamily !== undefined && run.fontFamily !== null) applyRunStyle(rPr, { fontFamily: run.fontFamily })
      appendChild(p, r)
    }

    if (!hasExplicitRunStyle && oldRuns.length > 0) {
      const oldRunMeta = oldRuns.map((r) => {
        const t = childOf(r, 'a:t')
        return { rPr: childOf(r, 'a:rPr'), text: t === undefined ? '' : textOf(t) }
      })
      const oldText = oldRunMeta.map(meta => meta.text).join('')
      if (newText !== '' && oldText !== '') {
        // 前缀/后缀 diff 映射（原生 PPT 语义：被替换的区域取光标处字符的样式，
        // 未动的部分各守原样式）。此前的「字符偏移 clamp 映射」在中间插入/删除
        // 时会把后面所有字符的样式整体推移一格 —— 混排行直接乱掉（2026-10-15
        // 用户实测："改一个字，字体有有大有小，排版全乱"）。
        const oldRunIndexByChar = []
        oldRunMeta.forEach((meta, runIndex) => { for (let i = 0; i < meta.text.length; i++) oldRunIndexByChar.push(runIndex) })
        const minLen = Math.min(oldText.length, newText.length)
        let prefix = 0
        while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix += 1
        let suffix = 0
        while (suffix < minLen - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix += 1
        const replacedEnd = newText.length - suffix
        const rPrIndexFor = (i) => {
          if (i < prefix) return oldRunIndexByChar[i] ?? 0
          if (i < replacedEnd) {
            // 被替换区域：取**光标前一个字符**的样式（PowerPoint 语义：新输入
            // 沿用插入点之前的格式）；在行首插入时取第一个旧字符。
            const anchor = Math.min(prefix > 0 ? prefix - 1 : 0, oldText.length - 1)
            return oldRunIndexByChar[anchor] ?? 0
          }
          const oldTailStart = oldText.length - suffix
          return oldRunIndexByChar[oldTailStart + (i - replacedEnd)] ?? 0
        }
        let buffer = ''
        let bufferIdx = rPrIndexFor(0)
        const flush = () => {
          if (buffer === '') return
          emitRun(oldRunMeta[bufferIdx].rPr, buffer, {})
          buffer = ''
        }
        for (let i = 0; i < newText.length; i++) {
          const idx = rPrIndexFor(i)
          if (i > 0 && idx !== bufferIdx) flush()
          bufferIdx = idx
          buffer += newText[i]
        }
        flush()
      } else {
        // 新文本或旧文本为空：退回模板链
        for (const run of newRuns) emitRun(resolveTemplateRPr(index), run.text ?? '', run)
      }
    } else {
      for (const run of newRuns) emitRun(resolveTemplateRPr(index), run.text ?? '', run)
    }

    appendChild(txBody, p)
    if (index === paragraphs.length - 1 && templateEnd !== undefined) {
      appendChild(txBody, cloneElement(templateEnd))
    }
  })
}

/** 收集 txBody 里的所有 run（含 a:fld）。 */
function runsOf(txBody) {
  if (txBody === undefined) return []
  const runs = []
  for (const p of childrenOf(txBody, 'a:p')) {
    for (const child of childrenOf(p)) {
      if (child.name === 'a:r' || child.name === 'a:fld') runs.push(child)
    }
  }
  return runs
}

function paragraphsOf(txBody) {
  return txBody === undefined ? [] : childrenOf(txBody, 'a:p')
}

/** spTree 的「形状区」：跳过 p:nvGrpSpPr / p:grpSpPr 前缀与 p:extLst 尾部。 */
function shapeRange(spTree) {
  const children = spTree.children
  let start = 0
  while (start < children.length) {
    const node = children[start]
    if (!isElement(node)) { start++; continue }
    if (node.name === 'p:nvGrpSpPr' || node.name === 'p:grpSpPr') { start++; continue }
    break
  }
  let end = children.length
  while (end > start) {
    const node = children[end - 1]
    if (isElement(node) && node.name === 'p:extLst') { end--; continue }
    break
  }
  return { start, end }
}

function shapeChildren(spTree) {
  const { start, end } = shapeRange(spTree)
  return spTree.children.slice(start, end).filter(isElement)
}

/** 分配一个当前 slide 未使用过的 cNvPr id。 */
function nextShapeId(spTree) {
  let max = 1
  const stack = [spTree]
  while (stack.length > 0) {
    const node = stack.pop()
    for (const child of childrenOf(node)) {
      const cNvPr = child.name === 'p:cNvPr' ? child : undefined
      if (cNvPr !== undefined) {
        const id = Number(getAttr(cNvPr, 'id'))
        if (Number.isFinite(id)) max = Math.max(max, id)
      }
      stack.push(child)
    }
  }
  return max + 1
}

/** 估算文本高度（px），用于溢出告警：CJK 记 1.0 em，ASCII 记 0.55 em。 */
function estimateTextHeight(text, fontSizePx, widthPx) {
  if (text === '' || !Number.isFinite(fontSizePx) || fontSizePx <= 0) return 0
  const width = Math.max(12, widthPx)
  let lines = 0
  for (const paragraph of String(text).split('\n')) {
    let units = 0
    for (const ch of paragraph) units += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.55
    const lineUnits = width / fontSizePx
    lines += Math.max(1, Math.ceil(units / Math.max(1, lineUnits)))
  }
  return lines * fontSizePx * 1.35
}

/**
 * 应用一个已经通过校验的 patch。
 * @param {Buffer} buffer 原始字节
 * @param {object} deck readDeck 的产物
 * @param {string} filePath
 * @param {object} rawPatch
 * @param {{dryRun?: boolean}} options
 * @returns {{buffer: Buffer, changedIds: string[], ops: object[], warnings: object[]}}
 */
export function applyPatch(buffer, deck, filePath, rawPatch, options = {}) {
  const { violations, ops } = validatePatch(deck, rawPatch)
  if (violations.length > 0) {
    throw new PatchError('validationFailed', `patch validation failed with ${violations.length} violation(s)`, { violations })
  }

  const entries = readZip(buffer)
  const slideIdToPart = new Map()
  for (const part of [...entries.keys()]) {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(part)
    if (match !== null) slideIdToPart.set(`s${match[1]}`, part)
  }

  /** 已解析的 slide 树缓存（同一 part 只解析一次）。 */
  const parsedParts = new Map()
  const loadPart = (partName) => {
    if (parsedParts.has(partName)) return parsedParts.get(partName)
    const bytes = entries.get(partName)
    if (bytes === undefined) throw new PatchError('ioFailed', `slide part ${partName} is missing`)
    const root = parseXml(Buffer.from(bytes).toString('utf8'))
    parsedParts.set(partName, root)
    return root
  }

  const changed = new Set()
  const touchedParts = new Set()
  const warnings = []
  const results = []

  const targetOf = (id) => {
    const at = id.indexOf(':')
    const slideId = id.slice(0, at)
    const shapeId = id.slice(at + 1)
    const partName = slideIdToPart.get(slideId)
    if (partName === undefined) throw new PatchError('badRequest', `unknown slide token in id ${id}`)
    const root = loadPart(partName)
    const located = locate(root, shapeId)
    if (located === undefined) throw new PatchError('badRequest', `element ${id} is not present in ${partName}`)
    return { partName, root, ...located, slideId, shapeId }
  }

  const spTreeOf = (root) => findFirst(root, 'p:spTree')

  /** 顺序执行：同一形状的多次修改按 ops 顺序叠加。 */
  ops.forEach((op, index) => {
    switch (op.op) {
      case 'setText': {
        const target = targetOf(op.id)
        setTextBody(target.element, op.paragraphs)
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'setTextStyle': {
        const target = targetOf(op.id)
        const txBody = txBodyFor(target.element)
        const runs = runsOf(txBody)
        if (runs.length === 0) {
          // 没有 run 也要把样式记到 endParaRPr / defRPr，否则下次输入仍是旧样式。
          let endPara = txBody === undefined ? undefined : childOf(txBody, 'a:endParaRPr')
          if (txBody !== undefined && endPara === undefined) {
            endPara = createElement('a:endParaRPr')
            appendChild(txBody, endPara)
          }
          if (endPara !== undefined) applyRunStyle(endPara, op)
          if (txBody !== undefined && op.fontSize !== undefined) {
            const bodyPr = childOf(txBody, 'a:bodyPr')
            if (bodyPr !== undefined && op.fontSize !== null) setAttr(bodyPr, 'anchor', getAttr(bodyPr, 'anchor') ?? 't')
          }
        }
        for (const run of runs) applyRunStyle(ensureRunProps(run), op)
        if (op.align !== undefined) {
          for (const p of paragraphsOf(txBody)) applyParagraphAlign(p, op.align)
        }
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: runs.length === 0 ? 'no runs in the shape; style stored on endParaRPr' : null })
        break
      }
      case 'setFill': {
        const target = targetOf(op.id)
        setFill(target.element, op.color)
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'setLine': {
        const target = targetOf(op.id)
        setLine(target.element, op.color, op.width, op.dash)
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'setGeometry': {
        const target = targetOf(op.id)
        setTransform(target.element, { x: op.x, y: op.y, w: op.w, h: op.h, rotation: op.rotation })
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'move': {
        const target = targetOf(op.id)
        const geometry = geometryOf(target.element)
        setTransform(target.element, { x: geometry.x + op.dx, y: geometry.y + op.dy })
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'resize': {
        const target = targetOf(op.id)
        const geometry = geometryOf(target.element)
        setTransform(target.element, { w: Math.max(1, geometry.w + op.dw), h: Math.max(1, geometry.h + op.dh) })
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'align': {
        const targets = op.ids.map(targetOf)
        const boxes = targets.map(target => ({ target, geometry: geometryOf(target.element) }))
        const minX = Math.min(...boxes.map(box => box.geometry.x))
        const maxX = Math.max(...boxes.map(box => box.geometry.x + box.geometry.w))
        const minY = Math.min(...boxes.map(box => box.geometry.y))
        const maxY = Math.max(...boxes.map(box => box.geometry.y + box.geometry.h))
        const centerX = (minX + maxX) / 2
        const centerY = (minY + maxY) / 2
        if (op.mode === 'distributeH' || op.mode === 'distributeV') {
          const horizontal = op.mode === 'distributeH'
          const sorted = [...boxes].sort((a, b) => (horizontal ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y))
          const total = sorted.reduce((sum, box) => sum + (horizontal ? box.geometry.w : box.geometry.h), 0)
          const span = horizontal ? (maxX - minX) : (maxY - minY)
          const gap = (span - total) / Math.max(1, sorted.length - 1)
          let cursor = horizontal ? minX : minY
          for (const box of sorted) {
            if (horizontal) setTransform(box.target.element, { x: cursor })
            else setTransform(box.target.element, { y: cursor })
            cursor += (horizontal ? box.geometry.w : box.geometry.h) + gap
          }
        } else {
          for (const box of boxes) {
            if (op.mode === 'left') setTransform(box.target.element, { x: minX })
            else if (op.mode === 'right') setTransform(box.target.element, { x: maxX - box.geometry.w })
            else if (op.mode === 'hcenter') setTransform(box.target.element, { x: centerX - box.geometry.w / 2 })
            else if (op.mode === 'top') setTransform(box.target.element, { y: minY })
            else if (op.mode === 'bottom') setTransform(box.target.element, { y: maxY - box.geometry.h })
            else if (op.mode === 'vcenter') setTransform(box.target.element, { y: centerY - box.geometry.h / 2 })
          }
        }
        for (const target of targets) {
          touchedParts.add(target.partName)
          changed.add(target.id === undefined ? `${target.slideId}:${target.shapeId}` : target.id)
        }
        for (const id of op.ids) changed.add(id)
        results.push({ index, op: op.op, id: null, status: 'applied', note: `aligned ${op.ids.length} shapes (${op.mode})` })
        break
      }
      case 'setZ':
      case 'bringToFront':
      case 'sendToBack': {
        const target = targetOf(op.id)
        const spTree = spTreeOf(target.root)
        if (spTree === undefined) throw new PatchError('badRequest', 'slide has no p:spTree')
        const children = shapeChildren(spTree)
        const currentIndex = children.indexOf(target.element)
        if (currentIndex === -1) throw new PatchError('badRequest', `element ${op.id} is not a direct child of p:spTree`)
        removeChild(target.parent, target.element)
        const remaining = shapeChildren(spTree)
        let at
        if (op.op === 'bringToFront') at = remaining.length
        else if (op.op === 'sendToBack') at = 0
        else at = Math.max(0, Math.min(remaining.length, op.z))
        const reference = remaining[at]
        insertBefore(spTree, target.element, reference)
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'remove': {
        const target = targetOf(op.id)
        removeChild(target.parent, target.element)
        touchedParts.add(target.partName)
        changed.add(op.id)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: null })
        break
      }
      case 'duplicate': {
        const target = targetOf(op.id)
        const spTree = spTreeOf(target.root)
        if (spTree === undefined) throw new PatchError('badRequest', 'slide has no p:spTree')
        const copy = cloneElement(target.element)
        const cNvPr = findFirst(copy, 'p:cNvPr')
        if (cNvPr !== undefined) {
          setAttr(cNvPr, 'id', String(nextShapeId(spTree)))
          const name = getAttr(cNvPr, 'name')
          setAttr(cNvPr, 'name', name === undefined ? 'Copy' : `${name} 副本`)
        }
        const geometry = geometryOf(target.element)
        setTransform(copy, { x: geometry.x + op.dx, y: geometry.y + op.dy })
        // 插到原元素之后（即紧邻其上方的绘制层）。
        const sibling = target.parent.children[target.parent.children.indexOf(target.element) + 1]
        insertBefore(target.parent, copy, sibling)
        touchedParts.add(target.partName)
        changed.add(op.id)
        const newId = cNvPr === undefined ? null : `${target.slideId}:${getAttr(cNvPr, 'id')}`
        if (newId !== null) changed.add(newId)
        results.push({ index, op: op.op, id: op.id, status: 'applied', note: newId === null ? null : `created ${newId}` })
        break
      }
      default:
        results.push({ index, op: op.op, id: op.id ?? null, status: 'skipped', note: 'unknown op' })
    }
  })

  // 溢出/越界告警：基于**改后**的树重新计算（用当前 deck 的文本 + 新几何近似）。
  for (const id of changed) {
    const found = elementById(deck, id)
    if (found === undefined) continue
    const target = (() => {
      try { return targetOf(id) } catch { return undefined }
    })()
    if (target === undefined) continue
    const geometry = geometryOf(target.element)
    const txBody = txBodyFor(target.element)
    const plain = txBody === undefined ? '' : childrenOf(txBody, 'a:p').map(p => textOf(p)).join('\n')
    const firstRun = runsOf(txBody)[0]
    const rPr = firstRun === undefined ? undefined : childOf(firstRun, 'a:rPr')
    const sizeRaw = Number(getAttr(rPr, 'sz'))
    const fontSize = Number.isFinite(sizeRaw) && sizeRaw > 0 ? (sizeRaw / 100) * (96 / 72) : (found.shape.text?.fontSize ?? 18)
    if (plain !== '') {
      const needed = estimateTextHeight(plain, fontSize, geometry.w - 8)
      if (needed > geometry.h + 2) {
        warnings.push({ code: 'textOverflow', id, message: `文本高度约 ${Math.round(needed)}px，超过形状高度 ${Math.round(geometry.h)}px，可能需要放大形状或缩小字号` })
      }
    }
    if (geometry.x < -1 || geometry.y < -1
      || geometry.x + geometry.w > deck.slideWidth + 1
      || geometry.y + geometry.h > deck.slideHeight + 1) {
      warnings.push({ code: 'shapeOffSlide', id, message: `元素超出页面范围（${Math.round(geometry.x)},${Math.round(geometry.y)} ${Math.round(geometry.w)}×${Math.round(geometry.h)}）` })
    }
  }

  if (options.dryRun === true) {
    return { buffer, changedIds: [...changed], ops: results, warnings }
  }

  for (const partName of touchedParts) {
    entries.set(partName, Buffer.from(serializeXml(parsedParts.get(partName)), 'utf8'))
  }
  const out = writeZip([...entries.entries()].map(([name, data]) => ({ name, data: Buffer.from(data) })))
  return { buffer: out, changedIds: [...changed], ops: results, warnings }
}

export { PatchError, validatePatch as validate }
