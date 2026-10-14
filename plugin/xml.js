// dsh-ppt-canvas — 极简 XML 层
//
// OOXML 的形状是一堆**片段**（p:sp / p:pic / a:rPr …），命名空间前缀在根元素上
// 已经绑定，所以我们只需要一个保前缀、保顺序、能删能插的 DOM，
// 不需要命名空间解析，也不需要（更不允许）改写前缀。
//
// 不用正则做「结构化编辑」的原因：文本里的 `<` 会被转义成 &lt;，正则拆标签在
// 含中文/实体/注释的文档上会出现难以定位的错拆。这里的实现是状态机扫描，
// 对每个字符只判定一次，遇到未知结构直接原样保留。

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** 文本节点。 */
class TextNode {
  constructor(text) {
    this.text = text
    this.parent = null
  }
}

/** 元素节点：name 是带前缀的原始 qname；children 是 Element | TextNode。 */
class Element {
  constructor(name, attrs = {}) {
    this.name = name
    this.attrs = attrs
    this.children = []
    this.parent = null
  }
}

export function createElement(name, attrs = {}) {
  return new Element(name, { ...attrs })
}

export function isElement(node) {
  return node instanceof Element
}

export function isText(node) {
  return node instanceof TextNode
}

/** 转义文本内容（不含引号：文本节点里引号不需要转义）。 */
export function escapeText(value) {
  return String(value).replace(/[&<>]/g, ch => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))
}

/** 转义属性值（& < > " 都要转，统一用双引号包围）。 */
export function escapeAttr(value) {
  return String(value).replace(/[&<>"]/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    return '&quot;'
  })
}

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code)) return whole
      try { return String.fromCodePoint(code) } catch { return whole }
    }
    const mapped = ENTITIES[body]
    return mapped === undefined ? whole : mapped
  })
}

/**
 * 解析 XML 文本为一个根元素。
 * 保序、保前缀、保注释以外的全部内容（注释与 XML 声明会被丢弃 —— 它们对
 * 编辑语义没有影响，PowerPoint 也不依赖它们）。
 * @param {string} text
 * @returns {Element}
 */
export function parseXml(text) {
  if (typeof text !== 'string' || text === '') throw new Error('parseXml: empty document')
  let i = 0
  const n = text.length
  let root = null
  const stack = []

  const append = (node) => {
    if (stack.length === 0) {
      if (isElement(node) && root === null) root = node
      return
    }
    const parent = stack[stack.length - 1]
    node.parent = parent
    parent.children.push(node)
  }

  while (i < n) {
    const lt = text.indexOf('<', i)
    if (lt === -1) {
      const tail = text.slice(i)
      if (tail !== '') append(new TextNode(decodeEntities(tail)))
      break
    }
    if (lt > i) append(new TextNode(decodeEntities(text.slice(i, lt))))
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      const body = end === -1 ? text.slice(lt + 9) : text.slice(lt + 9, end)
      append(new TextNode(body))
      i = end === -1 ? n : end + 3
      continue
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt)
      i = end === -1 ? n : end + 1
      continue
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt)
      if (end === -1) break
      stack.pop()
      i = end + 1
      continue
    }
    // 起始标签：找结束的 '>'，属性值里的 '>' 由引号保护。
    let cursor = lt + 1
    let quote = null
    while (cursor < n) {
      const ch = text[cursor]
      if (quote === null && (ch === '"' || ch === "'")) quote = ch
      else if (quote !== null && ch === quote) quote = null
      else if (quote === null && ch === '>') break
      cursor++
    }
    if (cursor >= n) break
    const inner = text.slice(lt + 1, cursor)
    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const nameEnd = (() => {
      let k = 0
      while (k < body.length && !/\s/.test(body[k])) k++
      return k
    })()
    const name = body.slice(0, nameEnd)
    if (name === '') { i = cursor + 1; continue }
    const attrs = {}
    const attrRe = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g
    let match
    const attrSource = body.slice(nameEnd)
    while ((match = attrRe.exec(attrSource)) !== null) {
      const key = match[1]
      const raw = match[3] !== undefined ? match[3] : match[4]
      attrs[key] = decodeEntities(raw ?? '')
    }
    const element = new Element(name, attrs)
    append(element)
    if (!selfClosing) stack.push(element)
    i = cursor + 1
  }

  if (root === null) throw new Error('parseXml: no root element found')
  return root
}

/** 序列化回字符串。属性顺序按插入顺序保持稳定。 */
export function serializeXml(element) {
  const parts = []
  writeNode(element, parts)
  return parts.join('')
}

function writeNode(node, parts) {
  if (isText(node)) {
    // 只转义必要的三个字符：保持其它内容（含已解码实体）原样。
    parts.push(escapeText(node.text))
    return
  }
  parts.push('<', node.name)
  for (const key of Object.keys(node.attrs)) {
    const value = node.attrs[key]
    if (value === undefined || value === null) continue
    parts.push(' ', key, '="', escapeAttr(value), '"')
  }
  if (node.children.length === 0) {
    parts.push('/>')
    return
  }
  parts.push('>')
  for (const child of node.children) writeNode(child, parts)
  parts.push('</', node.name, '>')
}

/** 深度优先找出所有 qname 完全匹配的元素（不含自身）。 */
export function findAll(element, name, out = []) {
  for (const child of element.children) {
    if (!isElement(child)) continue
    if (child.name === name) out.push(child)
    findAll(child, name, out)
  }
  return out
}

/** 第一个匹配的元素（含自身）。 */
export function findFirst(element, name) {
  if (element.name === name) return element
  for (const child of element.children) {
    if (!isElement(child)) continue
    const found = findFirst(child, name)
    if (found !== undefined) return found
  }
  return undefined
}

/** 直接子元素，可按 qname 过滤。 */
export function childrenOf(element, name) {
  const out = []
  for (const child of element.children) {
    if (!isElement(child)) continue
    if (name === undefined || child.name === name) out.push(child)
  }
  return out
}

/** 直接子元素里第一个匹配项。 */
export function childOf(element, name) {
  for (const child of element.children) {
    if (isElement(child) && child.name === name) return child
  }
  return undefined
}

/** 递归拼接文本（跳过属性）。 */
export function textOf(element) {
  let out = ''
  for (const child of element.children) {
    out += isText(child) ? child.text : textOf(child)
  }
  return out
}

export function setAttr(element, name, value) {
  if (value === undefined || value === null) delete element.attrs[name]
  else element.attrs[name] = String(value)
}

/** 读属性；元素不存在时返回 undefined（调用方免去每次判空）。 */
export function getAttr(element, name) {
  if (element === undefined || element === null) return undefined
  return element.attrs[name]
}

/** 移除子节点（同时切断 parent 引用）。 */
export function removeChild(parent, child) {
  const at = parent.children.indexOf(child)
  if (at === -1) return false
  parent.children.splice(at, 1)
  child.parent = null
  return true
}

/** 追加子节点到末尾。 */
export function appendChild(parent, child) {
  if (child.parent !== null) removeChild(child.parent, child)
  child.parent = parent
  parent.children.push(child)
  return child
}

/** 插到参考节点之前（参考节点不在 parent 下时退化为追加）。 */
export function insertBefore(parent, child, reference) {
  const at = parent.children.indexOf(reference)
  if (child.parent !== null) removeChild(child.parent, child)
  child.parent = parent
  if (at === -1) parent.children.push(child)
  else parent.children.splice(at, 0, child)
  return child
}

/** 设置元素的唯一文本子节点（清掉原有子节点）。 */
export function setText(element, value) {
  for (const child of element.children) child.parent = null
  element.children = []
  const node = new TextNode(String(value))
  node.parent = element
  element.children.push(node)
  return element
}

/** 深拷贝（含 attrs / children）。 */
export function cloneElement(element) {
  const copy = new Element(element.name, { ...element.attrs })
  for (const child of element.children) {
    const cloned = isText(child) ? new TextNode(child.text) : cloneElement(child)
    cloned.parent = copy
    copy.children.push(cloned)
  }
  return copy
}

/**
 * 删除 element 下所有直接名为 name 的子元素。
 * @returns {number} 删除数量
 */
export function removeChildren(element, name) {
  let removed = 0
  for (let index = element.children.length - 1; index >= 0; index--) {
    const child = element.children[index]
    if (isElement(child) && child.name === name) {
      child.parent = null
      element.children.splice(index, 1)
      removed++
    }
  }
  return removed
}

export { Element, TextNode }
