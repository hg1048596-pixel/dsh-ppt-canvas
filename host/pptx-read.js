// dsh-ppt-canvas — PPTX 读取层
//
// 把 .pptx 的 OOXML 解析成 docs/CONTRACT.md §1/§2 的 Deck 文档模型，
// 供客户端画布渲染与模型读取选中元素属性使用。
//
// 关键约定：
//  - 全部几何量转成 px（96 DPI）：EMU / 9525；角度 @rot 是 1/60000 度。
//  - z = p:spTree 子元素顺序（第一个可选子元素 = z 0，最底），与 PowerPoint 一致。
//  - 不认识的属性一律不解析，但绝不丢弃（写入层在原树上改，见 pptx-write.js）。

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { readZip, readZipEntries } from './zip.js'
import {
  parseXml, findAll, findFirst, childrenOf, childOf, textOf, getAttr, isElement, isText, Element,
} from './xml.js'

const EMU_PER_PX = 9525
const PT_TO_PX = 96 / 72

const SHAPE_TYPE = {
  AUTO_SHAPE: 1,
  CHART: 3,
  FREEFORM: 5,
  GROUP: 6,
  LINE: 9,
  PICTURE: 13,
  PLACEHOLDER: 14,
  MEDIA: 16,
  TEXT_BOX: 17,
  TABLE: 19,
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * EMU → px（96 DPI）。
 * 四舍五入到整数：EMU 是整数域，px 若保留小数，px→EMU→px 会来回漂移
 * （57.6 → 548640 → 57.6 之外还会出现 58 这种误差），最终让「AI 把标题移到
 * x=60」这类指令落不到整数像素上。整数 px 让往返完全无损。
 */
export function emuToPx(emu) {
  const value = Number(emu)
  if (!Number.isFinite(value)) return 0
  return Math.round(value / EMU_PER_PX)
}

/** px → EMU 整数。 */
export function pxToEmu(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * EMU_PER_PX)
}

/** 稳定 12 位十六进制 deckKey（媒体路由用）。 */
export function deckKeyOf(filePath) {
  const canonical = resolve(filePath).replace(/\\/g, '/').toLowerCase()
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12)
}

/** slide1.xml → s1；slide12.xml → s12。 */
function slideTokenOf(partName) {
  const match = /slide(\d+)\.xml$/.exec(partName)
  return match === null ? partName : `s${match[1]}`
}

/** 关系文件路径：ppt/slides/slide1.xml → ppt/slides/_rels/slide1.xml.rels */
function relsPathOf(partName) {
  const at = partName.lastIndexOf('/')
  const dir = partName.slice(0, at)
  const base = partName.slice(at + 1)
  return `${dir}/_rels/${base}.rels`
}

/**
 * 按正则找一个包内部件。
 * `entries` 既可能是 `loadPackage` 的 Map，也可能是裸的 zip Map，这里两种都支持。
 *
 * @returns {{ name: string, bytes: Buffer }|undefined}
 */
function findPart(entries, pattern) {
  for (const [name, raw] of entries) {
    if (!pattern.test(name)) continue
    return { name, bytes: Buffer.isBuffer(raw) ? raw : Buffer.from(raw) }
  }
  return undefined
}

function parseRels(entries, partName) {
  const bytes = entries.get(relsPathOf(partName))
  const map = new Map()
  if (bytes === undefined) return map
  const root = parseXml(Buffer.from(bytes).toString('utf8'))
  for (const rel of childrenOf(root, 'Relationship')) {
    map.set(getAttr(rel, 'Id') ?? '', {
      type: getAttr(rel, 'Type') ?? '',
      target: getAttr(rel, 'Target') ?? '',
      mode: getAttr(rel, 'TargetMode') ?? 'Internal',
    })
  }
  return map
}

/** 把关系里的相对 target 规范化成包内绝对路径。 */
function resolveTarget(partName, target) {
  if (target.startsWith('/')) return target.slice(1)
  const dir = partName.slice(0, partName.lastIndexOf('/'))
  const segments = `${dir}/${target}`.split('/')
  const out = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  webp: 'image/webp', emf: 'image/emf', wmf: 'image/wmf',
}

function mimeOf(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** 读 PNG/JPEG/GIF 的像素尺寸（够用即止，不引入图像库）。 */
function imageSize(bytes) {
  try {
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue }
        const marker = bytes[i + 1]
        const length = bytes.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
        }
        i += 2 + length
      }
    }
    if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
    }
  } catch { /* 尺寸读不出来不影响使用 */ }
  return null
}

/** 读主题色表（a:clrScheme 的 srgbClr / sysClr 值）。 */
function readTheme(entries) {
  const scheme = { }
  const bytes = entries.get('ppt/theme/theme1.xml')
  if (bytes === undefined) return scheme
  let root
  try { root = parseXml(Buffer.from(bytes).toString('utf8')) } catch { return scheme }
  const clrScheme = findFirst(root, 'a:clrScheme')
  if (clrScheme === undefined) return scheme
  for (const entry of childrenOf(clrScheme)) {
    const srgb = childOf(entry, 'a:srgbClr')
    const sys = childOf(entry, 'a:sysClr')
    const value = srgb !== undefined ? getAttr(srgb, 'val') : (sys !== undefined ? getAttr(sys, 'lastClr') : undefined)
    if (value !== undefined) scheme[entry.name.replace('a:', '')] = `#${String(value).toUpperCase()}`
  }
  return scheme
}

const SCHEME_ALIAS = {
  tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2',
  dk1: 'dk1', dk2: 'dk2', lt1: 'lt1', lt2: 'lt2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3',
  accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hlink: 'hlink', folHlink: 'folHlink',
}

function normalizeHex(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null
  return `#${trimmed.toUpperCase()}`
}

/** 把 a:solidFill / a:gs / a:schemeClr 解析成 #RRGGBB。 */
function colorFromColorContainer(container, theme) {
  if (container === undefined) return null
  const srgb = childOf(container, 'a:srgbClr')
  if (srgb !== undefined) return normalizeHex(getAttr(srgb, 'val'))
  const scheme = childOf(container, 'a:schemeClr')
  if (scheme !== undefined) {
    const key = SCHEME_ALIAS[getAttr(scheme, 'val') ?? '']
    return key === undefined ? null : (theme[key] ?? null)
  }
  const sys = childOf(container, 'a:sysClr')
  if (sys !== undefined) return normalizeHex(getAttr(sys, 'lastClr'))
  const prst = childOf(container, 'a:prstClr')
  if (prst !== undefined) return PRST_COLORS[String(getAttr(prst, 'val'))] ?? null
  return null
}

const PRST_COLORS = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF',
  yellow: '#FFFF00', gray: '#808080', grey: '#808080', orange: '#FFA500', purple: '#800080',
  silver: '#C0C0C0', maroon: '#800000', navy: '#000080', teal: '#008080', lime: '#00FF00',
  aqua: '#00FFFF', fuchsia: '#FF00FF', olive: '#808000',
}

/** 解析填充。 */
function readFill(spPr, theme) {
  if (spPr === undefined) return { type: 'inherit', color: null }
  const noFill = childOf(spPr, 'a:noFill')
  if (noFill !== undefined) return { type: 'none', color: null }
  const solid = childOf(spPr, 'a:solidFill')
  if (solid !== undefined) {
    const color = colorFromColorContainer(solid, theme)
    return { type: color === null ? 'inherit' : 'solid', color }
  }
  const grad = childOf(spPr, 'a:gradFill')
  if (grad !== undefined) {
    const stops = []
    for (const gs of findAll(grad, 'a:gs')) {
      const position = Number(getAttr(gs, 'pos'))
      const color = colorFromColorContainer(gs, theme)
      stops.push({ pos: Number.isFinite(position) ? position / 100000 : 0, color: color ?? '#FFFFFF' })
    }
    const lin = findFirst(grad, 'a:lin')
    const angle = lin === undefined ? 90 : Number(getAttr(lin, 'ang')) / 60000
    const first = stops.length > 0 ? stops[0].color : null
    return {
      type: 'gradient',
      color: first,
      gradient: { angle: Number.isFinite(angle) ? Math.round(angle * 100) / 100 : 90, stops },
    }
  }
  const blip = childOf(spPr, 'a:blipFill')
  if (blip !== undefined) return { type: 'image', color: null }
  const patt = childOf(spPr, 'a:pattFill')
  if (patt !== undefined) return { type: 'solid', color: colorFromColorContainer(childOf(patt, 'a:fgClr'), theme) }
  return { type: 'inherit', color: null }
}

/** 解析描边。 */
function readLine(spPr, theme) {
  if (spPr === undefined) return null
  const ln = childOf(spPr, 'a:ln')
  if (ln === undefined) return null
  if (childOf(ln, 'a:noFill') !== undefined) return null
  const solid = childOf(ln, 'a:solidFill')
  const color = colorFromColorContainer(solid, theme)
  const widthEmu = Number(getAttr(ln, 'w'))
  const dash = childOf(ln, 'a:prstDash')
  return {
    color: color ?? '#000000',
    width: Number.isFinite(widthEmu) ? Math.max(0, Math.round(widthEmu / EMU_PER_PX)) : 1,
    dash: dash === undefined ? 'solid' : (getAttr(dash, 'val') ?? 'solid'),
  }
}

function readShadow(spPr) {
  if (spPr === undefined) return false
  const effects = childOf(spPr, 'a:effectLst')
  if (effects === undefined) return false
  return childOf(effects, 'a:outerShdw') !== undefined
}

/** 预设几何 → 圆角半径（px）与原始 preset 名。 */
function readGeometryPreset(spPr) {
  if (spPr === undefined) return { prst: null, radius: 0 }
  const cust = childOf(spPr, 'a:custGeom')
  if (cust !== undefined) return { prst: 'custom', radius: 0 }
  const prst = childOf(spPr, 'a:prstGeom')
  if (prst === undefined) return { prst: null, radius: 0 }
  const name = getAttr(prst, 'prst') ?? null
  if (name === 'ellipse' || name === 'oval') return { prst: name, radius: -1 }
  if (name === 'roundRect') {
    const avLst = childOf(prst, 'a:avLst')
    let adj = 16667
    if (avLst !== undefined) {
      for (const gd of childrenOf(avLst, 'a:gd')) {
        if (getAttr(gd, 'name') === 'adj') {
          const fmla = getAttr(gd, 'fmla') ?? ''
          const value = Number(fmla.replace(/^val\s+/, ''))
          if (Number.isFinite(value)) adj = value
        }
      }
    }
    return { prst: name, radius: adj / 100000 }
  }
  return { prst: name, radius: 0 }
}

/** 读 xfrm：@rot 是 1/60000 度。 */
function readTransform(spPr) {
  const xfrm = spPr === undefined ? undefined : childOf(spPr, 'a:xfrm')
  const off = xfrm === undefined ? undefined : childOf(xfrm, 'a:off')
  const ext = xfrm === undefined ? undefined : childOf(xfrm, 'a:ext')
  const rotation = xfrm === undefined ? 0 : Number(getAttr(xfrm, 'rot')) / 60000
  return {
    x: emuToPx(off === undefined ? 0 : getAttr(off, 'x')),
    y: emuToPx(off === undefined ? 0 : getAttr(off, 'y')),
    w: emuToPx(ext === undefined ? 0 : getAttr(ext, 'cx')),
    h: emuToPx(ext === undefined ? 0 : getAttr(ext, 'cy')),
    rotation: Number.isFinite(rotation) ? Math.round(rotation * 100) / 100 : 0,
    flipH: getAttr(xfrm, 'flipH') === '1',
    flipV: getAttr(xfrm, 'flipV') === '1',
    hasTransform: xfrm !== undefined,
  }
}

function runFontSizePx(rPr) {
  if (rPr === undefined) return null
  const raw = Number(getAttr(rPr, 'sz'))
  if (!Number.isFinite(raw) || raw <= 0) return null
  return Math.round((raw / 100) * PT_TO_PX * 100) / 100
}

function runFontFamily(rPr) {
  if (rPr === undefined) return null
  const latin = childOf(rPr, 'a:latin')
  if (latin !== undefined) return getAttr(latin, 'typeface') ?? null
  const ea = childOf(rPr, 'a:ea')
  if (ea !== undefined) return getAttr(ea, 'typeface') ?? null
  return null
}

function readRunProperties(rPr, theme) {
  if (rPr === undefined) return {}
  const solid = childOf(rPr, 'a:solidFill')
  return {
    color: colorFromColorContainer(solid, theme),
    fontSize: runFontSizePx(rPr),
    bold: getAttr(rPr, 'b') === '1',
    italic: getAttr(rPr, 'i') === '1',
    underline: getAttr(rPr, 'u') !== undefined && getAttr(rPr, 'u') !== 'none',
    fontFamily: runFontFamily(rPr),
  }
}

/** OOXML 的 bodyPr/@anchor → 契约里的语义值（top/middle/bottom）。 */
export function anchorFromOoxml(value) {
  if (value === 'ctr') return 'middle'
  if (value === 'b') return 'bottom'
  if (value === 't' || value === undefined) return 'top'
  return value
}

/** OOXML 的 algn 值 → 契约里的语义值（left/center/right/justify）。 */
export function alignFromOoxml(value) {
  if (value === 'ctr') return 'center'
  if (value === 'r') return 'right'
  if (value === 'just' || value === 'dist') return 'justify'
  if (value === 'l') return 'left'
  return value ?? null
}

/**
 * 段落行距：`a:lnSpc` 的百分比或磅值 → 倍数 / px。
 *
 * 这是**排版的关键**：PowerPoint 默认单倍行距，但正文常常是 125%/150%，
 * 丢掉它文字就会挤成一坨（画布上看起来「排版全没了」）。
 * 契约里统一成 `{ lnSpc: number, lnSpcIsPx: boolean }`，Client 用它算 line-height。
 *
 * @returns {{lnSpc: number|null, lnSpcIsPx: boolean}|null} 没写就返回 null（交给 Client 用默认值）
 */
function readLineSpacing(pPr) {
  if (pPr === undefined) return null
  const lnSpc = childOf(pPr, 'a:lnSpc')
  if (lnSpc === undefined) return null
  const pct = childOf(lnSpc, 'a:spcPct')
  if (pct !== undefined) {
    const raw = Number(getAttr(pct, 'val'))
    // val 是千分之一百分比：125000 → 1.25 倍
    if (Number.isFinite(raw) && raw > 0) return { lnSpc: raw / 100000, lnSpcIsPx: false }
  }
  const pts = childOf(lnSpc, 'a:spcPts')
  if (pts !== undefined) {
    const raw = Number(getAttr(pts, 'val'))
    // val 是百分之一磅：1200 → 12pt
    if (Number.isFinite(raw) && raw > 0) return { lnSpc: (raw / 100) * (96 / 72), lnSpcIsPx: true }
  }
  return null
}

/**
 * `a:spcBef` / `a:spcAft` 的段前段后间距。
 *
 * 两种写法都要支持，之前只处理了 `a:spcPts`（绝对磅值），把 `a:spcPct`
 * （**相对字号的百分比**，PowerPoint 里很常见）整段丢掉了 —— 而且测试把"丢"锁成了正确行为。
 *
 * @returns {{ px: number|null, pct: number|null }|null}
 *   px  = 绝对像素（spcPts 换算得到）
 *   pct = 相对字号的比例（spcPct，100000 表示 100%）
 */
function readParaSpacingFull(pPr, tag) {
  if (pPr === undefined) return null
  const node = childOf(pPr, tag)
  if (node === undefined) return null
  const pts = childOf(node, 'a:spcPts')
  if (pts !== undefined) {
    const raw = Number(getAttr(pts, 'val'))
    if (Number.isFinite(raw) && raw >= 0) return { px: (raw / 100) * (96 / 72), pct: null }
  }
  const pct = childOf(node, 'a:spcPct')
  if (pct !== undefined) {
    const raw = Number(getAttr(pct, 'val'))
    if (Number.isFinite(raw)) return { px: null, pct: raw / 100000 }
  }
  return null
}

/** 兼容旧调用：只要像素值。 */
function readParaSpacing(pPr, tag) {
  const full = readParaSpacingFull(pPr, tag)
  return full === null ? null : full.px
}

/**
 * 正文框的内边距（EMU→px）与自动缩放标志。
 * PowerPoint 的默认内边距是左右 91440 EMU（9.6px）、上下 45720 EMU（4.8px），
 * 加上它文字位置才对得上。`a:bodyPr` 的 lIns/tIns/rIns/bIns 可以覆盖。
 */
function readBodyInsets(bodyPr) {
  const EMU_PER_PX = 9525
  if (bodyPr === undefined) return { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 }
  const side = (attr, fallback) => {
    const raw = Number(getAttr(bodyPr, attr))
    return Number.isFinite(raw) ? raw / EMU_PER_PX : fallback
  }
  return {
    left: side('lIns', 9.6),
    top: side('tIns', 4.8),
    right: side('rIns', 9.6),
    bottom: side('bIns', 4.8),
  }
}

/**
 * 读母版的 `<p:txStyles>`：标题与正文的层级段落默认值。
 *
 * **这是排版正确性的关键。** 实测用户的文件：幻灯片里 48 个 run 全都自带 `sz`（字号没问题），
 * 但**行距与段前间距只在母版里定义** —— `bodyStyle/lvl1pPr` 写着 `lnSpc=90000`（0.9 倍）
 * 与 `spcBef=1000`（10pt）。此前渲染器对「本段没写 lnSpc」一律退回 1.2，
 * 于是每行比真实高 33%，逐行累积 → 文字块偏高、行间挤压、最后撞到相邻元素。
 *
 * @returns {{title: object|null, body: object|null}} 各自形如
 *   `{ lnSpc, lnSpcIsPx, spaceBefore, spaceAfter, indent, hanging, align, bullet }`，取不到就是 null
 */
function readMasterTextDefaults(masterTree) {
  if (masterTree === undefined) return { title: null, body: null }
  const styles = findAll(masterTree, 'p:txStyles')[0]
  if (styles === undefined) return { title: null, body: null }

  const levelDefaults = (styleTag) => {
    const style = childOf(styles, styleTag)
    if (style === undefined) return null
    // 只取第 1 级：这一级承载正文与标题的主要排版，其他级按需再加。
    const lvl = childOf(style, 'a:lvl1pPr')
    if (lvl === undefined) return null
    const spacing = readLineSpacing(lvl) ?? {}
    const bullet = childOf(lvl, 'a:buChar')
    const autoNum = childOf(lvl, 'a:buAutoNum')
    const buNone = childOf(lvl, 'a:buNone') !== undefined
    const marL = Number(getAttr(lvl, 'marL'))
    const indent = Number(getAttr(lvl, 'indent'))
    return {
      ...spacing,
      spaceBefore: readParaSpacing(lvl, 'a:spcBef'),
      spaceAfter: readParaSpacing(lvl, 'a:spcAft'),
      // 百分比形式的段前/段后（a:spcPct，相对字号）
      spaceBeforePct: readParaSpacingFull(lvl, 'a:spcBef')?.pct ?? null,
      spaceAfterPct: readParaSpacingFull(lvl, 'a:spcAft')?.pct ?? null,
      // marL 是整段的左边界，indent 是首行相对 marL 的偏移（负值 = 悬挂缩进）
      marL: Number.isFinite(marL) ? marL / 9525 : null,
      indent: Number.isFinite(indent) ? indent / 9525 : null,
      align: alignFromOoxml(getAttr(lvl, 'algn')),
      bullet: buNone ? null : (bullet === undefined ? (autoNum === undefined ? null : { autoNum: true }) : { char: getAttr(bullet, 'char') ?? '•' }),
    }
  }

  return { title: levelDefaults('p:titleStyle'), body: levelDefaults('p:bodyStyle') }
}

/** 在 rels 里找指向某类部件的第一个目标（已规范化成包内路径）。 */
function findRelatedPart(ownerPart, rels, typeSuffix) {
  for (const rel of rels.values()) {
    if (typeof rel?.type === 'string' && rel.type.endsWith(typeSuffix)) {
      return resolveTarget(ownerPart, rel.target)
    }
  }
  return null
}

/**
 * 收集某部件里各占位符的几何（**只填空缺的键**，先写者优先）。
 * @returns {boolean} 该部件是否存在且能解析
 */
function collectPlaceholderGeometry(entries, partName, into, warnings) {
  const bytes = entries.get(partName)
  if (bytes === undefined) return false
  let tree
  try {
    tree = parseXml(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    warnings.push(`${partName} cannot be parsed: ${error.message}`)
    return false
  }
  for (const sp of findAll(tree, 'p:sp')) {
    const nvSpPr = childOf(sp, 'p:nvSpPr')
    const nvPr = nvSpPr === undefined ? undefined : childOf(nvSpPr, 'p:nvPr')
    const ph = nvPr === undefined ? undefined : childOf(nvPr, 'p:ph')
    if (ph === undefined) continue
    const spPr = childOf(sp, 'p:spPr')
    const xfrm = spPr === undefined ? undefined : childOf(spPr, 'a:xfrm')
    if (xfrm === undefined) continue // 这一级没写几何，留给下一级（layout → master）
    const off = childOf(xfrm, 'a:off')
    const ext = childOf(xfrm, 'a:ext')
    const geometry = {
      x: emuToPx(getAttr(off, 'x')),
      y: emuToPx(getAttr(off, 'y')),
      w: emuToPx(getAttr(ext, 'cx')),
      h: emuToPx(getAttr(ext, 'cy')),
    }
    const idx = getAttr(ph, 'idx')
    const type = getAttr(ph, 'type')
    if (idx !== undefined && !into.has(`idx:${idx}`)) into.set(`idx:${idx}`, geometry)
    if (type !== undefined && !into.has(`type:${type}`)) into.set(`type:${type}`, geometry)
  }
  return true
}

/**
 * 读占位符的继承几何，顺序：**slideLayout → slideMaster**。
 *
 * 真实 PowerPoint（以及 python-pptx 生成的默认文稿）里，幻灯片上的标题/正文
 * `<p:spPr/>` 没有 `a:xfrm`；**slideLayout 里的占位符也常常没有**，
 * 真正的坐标写在 slideMaster 上（例如 `<a:off x="457200" y="274638"/>`）。
 * 只查 layout 会得到全 0 几何 —— 画布选择框、框选命中、发给 AI 的坐标全错，
 * 而且写入端 move/resize 会以 0 为基准把形状压坏。
 *
 * @returns {Map<string, {x:number,y:number,w:number,h:number}>} 键为 `idx:<n>` 或 `type:<t>`
 */
function readLayoutPlaceholders(entries, slidePart, slideRels, warnings, cache) {
  const layoutPart = findRelatedPart(slidePart, slideRels, '/slideLayout')
  if (layoutPart === null) return new Map()
  if (cache !== undefined && cache.has(layoutPart)) return cache.get(layoutPart)

  const result = new Map()
  if (collectPlaceholderGeometry(entries, layoutPart, result, warnings)) {
    const layoutRels = parseRels(entries, layoutPart)
    const masterPart = findRelatedPart(layoutPart, layoutRels, '/slideMaster')
    if (masterPart !== null) collectPlaceholderGeometry(entries, masterPart, result, warnings)
  }
  if (cache !== undefined) cache.set(layoutPart, result)
  return result
}

/** 按 idx 优先、type 兜底，从版式占位符里找继承几何。 */
function lookupLayoutGeometry(placeholder, layoutPlaceholders) {
  if (layoutPlaceholders === undefined || layoutPlaceholders === null) return null
  const idx = placeholder?.idx
  const type = placeholder?.type
  if (idx !== undefined && idx !== null && layoutPlaceholders.has(`idx:${idx}`)) {
    return layoutPlaceholders.get(`idx:${idx}`)
  }
  if (type !== undefined && type !== null && layoutPlaceholders.has(`type:${type}`)) {
    return layoutPlaceholders.get(`type:${type}`)
  }
  return null
}

/** 从 a:lstStyle 的对应层级取默认 run 属性。 */
function listStyleDefaults(txBody, level) {
  if (txBody === undefined) return undefined
  const lst = childOf(txBody, 'a:lstStyle')
  if (lst === undefined) return undefined
  const lvl = childOf(lst, `a:lvl${level + 1}pPr`)
  if (lvl === undefined) return undefined
  return childOf(lvl, 'a:defRPr')
}

/**
 * 读文本体：段落 + 运行 + 继承后的默认值。
 * @returns {{plain: string, paragraphs: object[], align: string|null, anchor: string|null, color: string|null, fontSize: number|null, bold: boolean, italic: boolean, fontFamily: string|null}}
 */
function readTextBody(txBody, theme, masterDefaults) {
  const empty = {
    plain: '', paragraphs: [], align: null, anchor: null,
    color: null, fontSize: null, bold: false, italic: false, fontFamily: null,
    insets: { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 },
    autofit: null,
  }
  if (txBody === undefined) return empty
  // 母版给的层级默认值：本段没写就沿用它（PowerPoint 的继承规则）。
  const fallback = masterDefaults ?? null
  const bodyPr = childOf(txBody, 'a:bodyPr')
  const anchor = bodyPr === undefined ? null : anchorFromOoxml(getAttr(bodyPr, 'anchor'))
  const insets = readBodyInsets(bodyPr)
  // 自动缩放：spAutoFit（随文字调整形状）/ normAutofit（缩字号适应）/ noAutofit
  // 注意 bodyPr 可能整个缺失（精简/第三方生成的 txBody 常见），
  // 直接 childOf(undefined, …) 会抛 TypeError 让整页读不出来。
  const autofit = bodyPr === undefined
    ? null
    : (childOf(bodyPr, 'a:normAutofit') !== undefined
        ? 'norm'
        : (childOf(bodyPr, 'a:spAutoFit') !== undefined ? 'shape' : (childOf(bodyPr, 'a:noAutofit') !== undefined ? 'none' : null)))
  const paragraphs = []
  const plainParts = []

  for (const p of childrenOf(txBody, 'a:p')) {
    const pPr = childOf(p, 'a:pPr')
    const level = Number(getAttr(pPr, 'lvl') ?? 0)
    const defRPr = listStyleDefaults(txBody, Number.isFinite(level) ? level : 0)
    const defProps = readRunProperties(defRPr, theme)
    const runs = []
    let paragraphText = ''
    for (const child of p.children) {
      if (!isElement(child)) continue
      if (child.name === 'a:r' || child.name === 'a:fld') {
        const rPr = childOf(child, 'a:rPr')
        const t = childOf(child, 'a:t')
        const text = t === undefined ? '' : textOf(t)
        const props = readRunProperties(rPr, theme)
        runs.push({
          text,
          color: props.color ?? defProps.color ?? null,
          fontSize: props.fontSize ?? defProps.fontSize ?? null,
          bold: props.bold === true || defProps.bold === true,
          italic: props.italic === true || defProps.italic === true,
          underline: props.underline === true || defProps.underline === true,
          fontFamily: props.fontFamily ?? defProps.fontFamily ?? null,
        })
        paragraphText += text
      } else if (child.name === 'a:br') {
        paragraphText += '\n'
      }
    }
    // 段落属性：本段没写就沿用母版的层级默认值（PowerPoint 的继承规则）。
    // 实测：用户文件的 lnSpc=0.9、spcBef=10pt 只在母版里，不承接就会行距错、文字挤。
    const ownSpacing = readLineSpacing(pPr)
    const spacing = ownSpacing ?? (fallback?.lnSpc === undefined || fallback?.lnSpc === null
      ? { lnSpc: null, lnSpcIsPx: false }
      : { lnSpc: fallback.lnSpc, lnSpcIsPx: fallback.lnSpcIsPx === true })
    const ownAlign = pPr === undefined ? null : alignFromOoxml(getAttr(pPr, 'algn'))
    const spacingBefore = readParaSpacingFull(pPr, 'a:spcBef')
    const spacingAfter = readParaSpacingFull(pPr, 'a:spcAft')
    const ownMarL = (() => {
      const raw = Number(getAttr(pPr, 'marL'))
      return Number.isFinite(raw) ? raw / 9525 : null
    })()
    paragraphs.push({
      level: Number.isFinite(level) ? level : 0,
      align: ownAlign ?? fallback?.align ?? null,
      ...spacing,
      spaceBefore: spacingBefore?.px ?? fallback?.spaceBefore ?? null,
      spaceAfter: spacingAfter?.px ?? fallback?.spaceAfter ?? null,
      // 百分比形式（a:spcPct）保留为比例：它相对**字号**，Client 按行高换算成 px。
      // 之前整个字段被丢弃，段前段后间距静默消失。
      spaceBeforePct: spacingBefore?.pct ?? fallback?.spaceBeforePct ?? null,
      spaceAfterPct: spacingAfter?.pct ?? fallback?.spaceAfterPct ?? null,
      // marL 是段落左边界；母版的 bodyStyle 通常给 marL=228600（24px）配悬挂缩进
      indent: ownMarL ?? fallback?.marL ?? null,
      runs,
    })
    plainParts.push(paragraphText)
  }

  const firstRun = paragraphs.flatMap(p => p.runs)[0]
  const firstPPr = childrenOf(txBody, 'a:p')[0] === undefined ? undefined : childOf(childrenOf(txBody, 'a:p')[0], 'a:pPr')
  const endPara = childOf(txBody, 'a:endParaRPr')
  const endProps = readRunProperties(endPara, theme)

  return {
    plain: plainParts.join('\n'),
    paragraphs,
    align: firstPPr === undefined ? null : alignFromOoxml(getAttr(firstPPr, 'algn')),
    anchor,
    insets,
    autofit,
    color: firstRun?.color ?? endProps.color ?? null,
    fontSize: firstRun?.fontSize ?? endProps.fontSize ?? null,
    bold: firstRun?.bold === true,
    italic: firstRun?.italic === true,
    fontFamily: firstRun?.fontFamily ?? endProps.fontFamily ?? null,
  }
}

/** 读表格。 */
function readTable(graphicFrame) {
  const tbl = findFirst(graphicFrame, 'a:tbl')
  if (tbl === undefined) return null
  const rows = childrenOf(tbl, 'a:tr')
  const cells = []
  let cols = 0
  rows.forEach((tr, r) => {
    const tcs = childrenOf(tr, 'a:tc')
    cols = Math.max(cols, tcs.length)
    tcs.forEach((tc, c) => {
      cells.push({ r, c, text: textOf(tc) })
    })
  })
  return { rows: rows.length, cols, cells }
}

/** 读图片的 blip 关系。 */
function readPicture(spPr, blipFill, rels, slidePart, mediaIndex) {
  const blip = blipFill === undefined ? undefined : childOf(blipFill, 'a:blip')
  const embed = blip === undefined ? undefined : (getAttr(blip, `r:embed`) ?? getAttr(blip, 'embed'))
  const link = blip === undefined ? undefined : (getAttr(blip, `r:link`) ?? getAttr(blip, 'link'))
  const relId = embed ?? link
  let target = null
  if (relId !== undefined && rels.has(relId)) {
    const rel = rels.get(relId)
    if (rel.mode !== 'External') target = resolveTarget(slidePart, rel.target)
  }
  const srcRect = blipFill === undefined ? undefined : childOf(blipFill, 'a:srcRect')
  const pct = (name) => {
    if (srcRect === undefined) return 0
    const raw = Number(getAttr(srcRect, name))
    return Number.isFinite(raw) ? raw / 100000 : 0
  }
  const crop = { l: pct('l'), t: pct('t'), r: pct('r'), b: pct('b') }
  if (target === null) return { image: { mediaId: null, url: null, crop }, target: null }
  const mediaId = mediaIndex.get(target) ?? null
  return {
    image: {
      mediaId,
      url: mediaId === null ? null : `/dsh-ppt/media/${'__DECK__'}/${mediaId}.${target.slice(target.lastIndexOf('.') + 1)}`,
      crop,
    },
    target,
  }
}

/** 判断 p:sp 属于哪种形态。 */
function classifySp(sp) {
  const nvSpPr = childOf(sp, 'p:nvSpPr')
  const nvPr = nvSpPr === undefined ? undefined : childOf(nvSpPr, 'p:nvPr')
  const ph = nvPr === undefined ? undefined : childOf(nvPr, 'p:ph')
  const spPr = childOf(sp, 'p:spPr')
  const hasCustGeom = spPr !== undefined && childOf(spPr, 'a:custGeom') !== undefined
  const hasPrstGeom = spPr !== undefined && childOf(spPr, 'a:prstGeom') !== undefined
  const txBody = childOf(sp, 'p:txBody')
  const hasText = txBody !== undefined && findAll(txBody, 'a:t').length > 0
  if (ph !== undefined) {
    return {
      kind: 'text',
      type: SHAPE_TYPE.PLACEHOLDER,
      placeholder: { idx: getAttr(ph, 'idx') ?? null, type: getAttr(ph, 'type') ?? null },
    }
  }
  if (hasCustGeom) return { kind: 'shape', type: SHAPE_TYPE.FREEFORM, placeholder: null }
  if (hasPrstGeom) {
    return hasText
      ? { kind: 'text', type: SHAPE_TYPE.TEXT_BOX, placeholder: null }
      : { kind: 'shape', type: SHAPE_TYPE.AUTO_SHAPE, placeholder: null }
  }
  return { kind: 'text', type: SHAPE_TYPE.TEXT_BOX, placeholder: null }
}

function shapeNameOf(container) {
  for (const nv of childrenOf(container)) {
    const cNvPr = childOf(nv, 'p:cNvPr')
    if (cNvPr !== undefined) {
      return { id: getAttr(cNvPr, 'id') ?? '', name: getAttr(cNvPr, 'name') ?? '' }
    }
  }
  return { id: '', name: '' }
}

function spPrOf(container) {
  // p:graphicFrame 的变换在 p:xfrm（与 p:spPr/a:xfrm 同级），其余在 p:spPr / p:grpSpPr。
  if (container.name === 'p:graphicFrame') return childOf(container, 'p:xfrm')
  return childOf(container, 'p:spPr') ?? childOf(container, 'p:grpSpPr')
}

/**
 * 统一的变换读取：p:sp 用 p:spPr/a:xfrm，graphicFrame 用 p:xfrm（直接就是 xfrm）。
 */
function transformOf(container, spPr) {
  if (container.name === 'p:graphicFrame') {
    const xfrm = spPr
    const off = xfrm === undefined ? undefined : childOf(xfrm, 'a:off')
    const ext = xfrm === undefined ? undefined : childOf(xfrm, 'a:ext')
    const rotation = xfrm === undefined ? 0 : Number(getAttr(xfrm, 'rot')) / 60000
    return {
      x: emuToPx(getAttr(off, 'x')),
      y: emuToPx(getAttr(off, 'y')),
      w: emuToPx(getAttr(ext, 'cx')),
      h: emuToPx(getAttr(ext, 'cy')),
      rotation: Number.isFinite(rotation) ? Math.round(rotation * 100) / 100 : 0,
      flipH: getAttr(xfrm, 'flipH') === '1',
      flipV: getAttr(xfrm, 'flipV') === '1',
      hasTransform: xfrm !== undefined,
    }
  }
  return readTransform(spPr)
}

/**
 * 解析一个 spTree 子元素。
 * @returns {object|null} Shape
 */
function readShape(container, context) {
  const { slideId, slidePart, rels, theme, mediaIndex, warnings } = context
  if (!isElement(container)) return null
  const name = container.name
  if (name !== 'p:sp' && name !== 'p:pic' && name !== 'p:graphicFrame'
    && name !== 'p:grpSp' && name !== 'p:cxnSp' && name !== 'p:contentPart') return null

  const identity = shapeNameOf(container)
  const spPr = spPrOf(container)
  const geometry = transformOf(container, spPr)
  // 没有 a:xfrm 是**正常**的：占位符的位置继承自 slideLayout（见下方继承逻辑）。
  // 只有既没有 xfrm、又继承不到几何时才值得警告 —— 那种形状真的是 0×0@0,0。
  const hasPlaceholder = childOf(container, 'p:nvSpPr') !== undefined
    && childOf(childOf(container, 'p:nvSpPr'), 'p:nvPr') !== undefined
    && childOf(childOf(childOf(container, 'p:nvSpPr'), 'p:nvPr'), 'p:ph') !== undefined
  if (!geometry.hasTransform && !hasPlaceholder) {
    warnings.push(`shape ${identity.id} (${identity.name}) has no a:xfrm; geometry defaults to 0`)
  }
  const preset = readGeometryPreset(spPr)
  const fill = readFill(spPr, theme)
  const line = readLine(spPr, theme)
  const base = {
    id: `${slideId}:${identity.id}`,
    shapeId: identity.id,
    name: identity.name,
    z: 0,
    geometry: {
      x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h,
      rotation: geometry.rotation, flipH: geometry.flipH, flipV: geometry.flipV,
    },
    placeholder: null,
    style: {
      fill,
      gradient: fill.gradient ?? null,
      line,
      shadow: readShadow(spPr),
      opacity: 1,
      cornerRadius: 0,
      prst: preset.prst,
    },
    text: null,
    image: null,
    table: null,
    children: null,
  }

  if (name === 'p:grpSp') {
    const children = []
    const tree = childOf(container, 'p:grpSp')
    let childIndex = 0
    for (const child of childrenOf(container)) {
      if (child.name === 'p:nvGrpSpPr' || child.name === 'p:grpSpPr') continue
      const parsed = readShape(child, context)
      if (parsed === null) continue
      parsed.z = childIndex
      childIndex++
      children.push(parsed)
    }
    void tree
    return {
      ...base,
      kind: 'group',
      type: SHAPE_TYPE.GROUP,
      children,
    }
  }

  const radiusPx = preset.radius === -1
    ? Math.min(geometry.w, geometry.h) / 2
    : (preset.radius > 0 ? Math.min(geometry.w, geometry.h) * preset.radius : 0)
  base.style.cornerRadius = Math.round(radiusPx * 100) / 100

  if (name === 'p:sp') {
    const classified = classifySp(container)
    const txBody = childOf(container, 'p:txBody')
    // 占位符没有自己的 a:xfrm 时，几何继承自 slideLayout 的同名占位符。
    // 不做这一步的话，真实 PowerPoint 文件的标题/正文全是 0×0@0,0：
    // 画布选择框看不见、框选命中不了、发给 AI 的坐标也全是 0。
    if (geometry.hasTransform !== true && classified.placeholder !== null && classified.placeholder !== undefined) {
      const inherited = lookupLayoutGeometry(classified.placeholder, context.layoutPlaceholders)
      if (inherited !== null) {
        base.geometry.x = inherited.x
        base.geometry.y = inherited.y
        base.geometry.w = inherited.w
        base.geometry.h = inherited.h
      }
    }
    // 排版默认值来自母版：标题走 titleStyle，其余走 bodyStyle。
    // 实测用户的文件里 lnSpc=0.9 与 spcBef=10pt **只在母版**，读不到就会行距错、文字挤。
    //
    // 注意：`placeholder` 是 `{ idx, type }` **对象**（见 classifySp），不是字符串。
    // 曾经写成 `(classified.placeholder ?? '').includes('title')` —— 对对象调 .includes
    // 直接抛 TypeError，导致**所有带 `<p:ph>` 占位符的正常 PPTX 都打不开**（500 ioFailed）。
    // 仓库里的 fixture 全是纯 TextBox、没有 `<p:ph>`，所以测试没拦住。
    // 大小写不敏感：占位符类型可能是 `title` / `ctrTitle` / `Title`。
    // 以前直接 includes('title')，`ctrTitle` 匹配不到 titleStyle。
    const placeholderType = String(classified.placeholder?.type ?? '').toLowerCase()
    const masterDefaults = classified.kind === 'title' || placeholderType.includes('title')
      ? context.masterText?.title
      : context.masterText?.body
    const text = readTextBody(txBody, theme, masterDefaults)
    return {
      ...base,
      kind: classified.kind,
      type: classified.type,
      placeholder: classified.placeholder,
      text: txBody === undefined ? null : text,
    }
  }

  if (name === 'p:cxnSp') {
    const txBody = childOf(container, 'p:txBody')
    return {
      ...base,
      kind: 'line',
      type: SHAPE_TYPE.LINE,
      text: txBody === undefined ? null : readTextBody(txBody, theme),
    }
  }

  if (name === 'p:pic') {
    const blipFill = childOf(container, 'p:blipFill')
    const picture = readPicture(spPr, blipFill, rels, slidePart, mediaIndex)
    return {
      ...base,
      kind: 'image',
      type: SHAPE_TYPE.PICTURE,
      image: picture.image,
    }
  }

  if (name === 'p:graphicFrame') {
    const table = readTable(container)
    if (table !== null) {
      return { ...base, kind: 'table', type: SHAPE_TYPE.TABLE, table }
    }
    const uri = findFirst(container, 'a:graphicData')
    const dataUri = uri === undefined ? '' : (getAttr(uri, 'uri') ?? '')
    if (dataUri.includes('chart')) return { ...base, kind: 'chart', type: SHAPE_TYPE.CHART }
    if (dataUri.includes('table')) {
      const fallback = readTable(container)
      return { ...base, kind: 'table', type: SHAPE_TYPE.TABLE, table: fallback }
    }
    return { ...base, kind: 'unknown', type: 0 }
  }

  return { ...base, kind: 'media', type: SHAPE_TYPE.MEDIA }
}

/**
 * 打开包：收集 slide 顺序、尺寸、媒体索引。
 * @param {Buffer} buffer
 */
export function loadPackage(buffer) {
  const entries = readZip(buffer)
  const warnings = []
  const presentationBytes = entries.get('ppt/presentation.xml')
  if (presentationBytes === undefined) throw new Error('not a presentation: ppt/presentation.xml is missing')
  const presentation = parseXml(Buffer.from(presentationBytes).toString('utf8'))
  const rels = parseRels(entries, 'ppt/presentation.xml')

  const sldSz = childOf(presentation, 'p:sldSz')
  const slideWidthEmu = sldSz === undefined ? 12192000 : Number(getAttr(sldSz, 'cx'))
  const slideHeightEmu = sldSz === undefined ? 6858000 : Number(getAttr(sldSz, 'cy'))
  if (sldSz === undefined) warnings.push('presentation.xml has no p:sldSz; assuming 16:9')

  const sldIdLst = childOf(presentation, 'p:sldIdLst')
  const slideParts = []
  if (sldIdLst !== undefined) {
    for (const sldId of childrenOf(sldIdLst, 'p:sldId')) {
      const relId = getAttr(sldId, `r:id`) ?? ''
      const rel = rels.get(relId)
      if (rel === undefined) {
        warnings.push(`slide relationship ${relId} is missing`)
        continue
      }
      slideParts.push(resolveTarget('ppt/presentation.xml', rel.target))
    }
  }
  if (slideParts.length === 0) {
    // 兜底：按**数字**排序，不能用字典序 —— `slide10.xml` 会排在 `slide2.xml` 之前，
    // 10 页以上的文稿页序会错乱。
    const slideNumber = (name) => Number((/slide(\d+)\.xml$/.exec(name) ?? [])[1] ?? 0)
    for (const key of [...entries.keys()].sort((a, b) => slideNumber(a) - slideNumber(b))) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(key)) slideParts.push(key)
    }
  }

  const media = new Map()
  for (const [partName, bytes] of entries) {
    if (!partName.startsWith('ppt/media/')) continue
    const mediaId = `image${media.size + 1}`
    const size = imageSize(Buffer.from(bytes))
    media.set(mediaId, {
      mediaId,
      zipPath: partName,
      mime: mimeOf(partName),
      width: size === null ? null : size.width,
      height: size === null ? null : size.height,
    })
  }

  const theme = readTheme(entries)
  return { entries, slideParts, theme, media, warnings, slideWidthEmu, slideHeightEmu }
}

/**
 * 读整份 Deck。
 * @param {Buffer} buffer
 * @param {string} filePath
 * @param {number} rev
 * @returns {object} Deck
 */
export function readDeck(buffer, filePath, rev = 0) {
  const pkg = loadPackage(buffer)
  const { entries, slideParts, theme, media, warnings } = pkg
  const deckKey = deckKeyOf(filePath)

  // 母版的文本排版默认值。**必须在这里解析**：实测用户的文件把 lnSpc / spcBef 只写在
  // slideMaster 的 p:txStyles 里，幻灯片本身没有 —— 不承接就会行距错、文字挤成一团。
  let masterText = { title: null, body: null }
  try {
    const masterPart = findPart(entries, /^ppt\/slideMasters\/slideMaster\d+\.xml$/)
    if (masterPart !== undefined) {
      masterText = readMasterTextDefaults(parseXml(Buffer.from(masterPart.bytes).toString('utf8')))
    }
  } catch (error) {
    warnings.push(`slide master text defaults could not be read: ${error.message}`)
  }

  const mediaIndex = new Map()
  const mediaJson = {}
  for (const [mediaId, info] of media) {
    mediaIndex.set(info.zipPath, mediaId)
    mediaJson[mediaId] = {
      url: `/dsh-ppt/media/${deckKey}/${mediaId}.${info.zipPath.slice(info.zipPath.lastIndexOf('.') + 1)}`,
      mime: info.mime,
      width: info.width,
      height: info.height,
    }
  }

  const slides = []
  // 版式占位符几何缓存：同一版式被多页共用，避免每页重复解析 layout+master。
  const layoutCache = new Map()
  slideParts.forEach((slidePart, index) => {
    const bytes = entries.get(slidePart)
    if (bytes === undefined) {
      warnings.push(`slide part ${slidePart} is missing from the package`)
      return
    }
    let root
    try {
      root = parseXml(Buffer.from(bytes).toString('utf8'))
    } catch (error) {
      warnings.push(`slide ${slidePart} cannot be parsed: ${error.message}`)
      return
    }
    const slideId = slideTokenOf(slidePart)
    // rels 解析要和 slide XML 一样容错：某个 .rels 坏了只该让这一页退化（没有媒体/版式），
    // 而不是让整份文稿打开失败。以前它写在 try 之外，一个坏 rels 就 500。
    let rels = new Map()
    try {
      rels = parseRels(entries, slidePart)
    } catch (error) {
      warnings.push(`slide ${slidePart} rels cannot be parsed: ${error.message}`)
    }
    // 占位符的几何继承：真实 PowerPoint 的标题/正文 `<p:spPr>` **没有 a:xfrm**，
    // 位置与尺寸来自 slideLayout 里同一 idx/type 的占位符。不继承的话
    // deck 里每个占位符都是 0×0@0,0 —— 画布选择框、框选命中、AI 上下文坐标全错。
    let layoutPlaceholders = new Map()
    try {
      layoutPlaceholders = readLayoutPlaceholders(entries, slidePart, rels, warnings, layoutCache)
    } catch (error) {
      warnings.push(`slide ${slidePart} placeholder inheritance failed: ${error.message}`)
    }
    const cSld = childOf(root, 'p:cSld')
    const spTree = cSld === undefined ? undefined : childOf(cSld, 'p:spTree')
    let background = '#FFFFFF'
    const bg = cSld === undefined ? undefined : childOf(cSld, 'p:bg')
    if (bg !== undefined) {
      const bgPr = childOf(bg, 'p:bgPr')
      const solid = bgPr === undefined ? undefined : childOf(bgPr, 'a:solidFill')
      const color = solid === undefined ? null : colorFromColorContainer(solid, theme)
      if (color !== null) background = color
    }
    const shapes = []
    if (spTree !== undefined) {
      let z = 0
      for (const child of childrenOf(spTree)) {
        const shape = readShape(child, { slideId, slidePart, rels, theme, mediaIndex, warnings, masterText, layoutPlaceholders })
        if (shape === null) continue
        shape.z = z
        // 媒体 URL 里的 deckKey 占位符要**递归**替换：组合里的图片是子形状，
        // 只在顶层替换会让组内图片的 URL 留下字面量 __DECK__（媒体路由必然 404）。
        rewriteMediaUrls(shape, deckKey)
        shapes.push(shape)
        z++
      }
    }
    slides.push({
      index,
      id: slideId,
      name: `幻灯片 ${index + 1}`,
      background,
      shapes,
    })
  })

  return {
    file: filePath,
    rev,
    slideWidth: emuToPx(pkg.slideWidthEmu),
    slideHeight: emuToPx(pkg.slideHeightEmu),
    openedAt: Date.now(),
    media: mediaJson,
    slides,
    warnings,
  }
}

/** 按 id 找元素（含组合子元素）。 */
/**
 * 把形状（含组合内的子形状）图片 URL 里的 `__DECK__` 换成本次 deck 的 key。
 */
function rewriteMediaUrls(shape, deckKey) {
  if (shape === null || shape === undefined) return
  if (shape.image !== null && shape.image !== undefined && typeof shape.image.url === 'string') {
    shape.image = { ...shape.image, url: shape.image.url.replace('__DECK__', deckKey) }
  }
  if (Array.isArray(shape.children)) {
    for (const child of shape.children) rewriteMediaUrls(child, deckKey)
  }
}

/**
 * 按 id 在整份 deck 里找元素，**递归**进入组合（组合可嵌套）。
 *
 * 以前只查顶层 + 一层子元素：两层组合里的形状虽然会出现在 deck 里，
 * 但任何按 id 的操作（setFill/setGeometry…）都会报 "no element with id"。
 *
 * @returns {{shape: object, slide: object, parent?: object}|undefined}
 */
export function elementById(deck, id) {
  const walk = (shape, slide, parent) => {
    if (shape.id === id) return { shape, slide, ...(parent === undefined ? {} : { parent }) }
    if (Array.isArray(shape.children)) {
      for (const child of shape.children) {
        const hit = walk(child, slide, shape)
        if (hit !== undefined) return hit
      }
    }
    return undefined
  }
  for (const slide of deck.slides ?? []) {
    for (const shape of slide.shapes ?? []) {
      const hit = walk(shape, slide, undefined)
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

export { SHAPE_TYPE, EMU_PER_PX, PT_TO_PX, slideTokenOf, relsPathOf, resolveTarget, parseRels }
export const __internal = { readShape, readTextBody, colorFromColorContainer, imageSize }
