// tools/debug-append.mjs — 复现「keyed 列表尾部追加导致重复」并逐步打印 DOM
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client/mini-react.js', import.meta.url), 'utf8')

function createStyle() {
  const store = new Map()
  return new Proxy({
    setProperty(n, v) { store.set(n, v) },
    removeProperty(n) { store.delete(n) },
    getPropertyValue(n) { return store.get(n) ?? '' },
    get length() { return store.size },
  }, { set() { return true }, get(t, k) { return k in t ? t[k] : (store.get(String(k)) ?? '') } })
}
class T { constructor(v) { this.nodeType = 3; this.nodeValue = String(v); this.parentNode = null } remove() { if (this.parentNode) this.parentNode.removeChild(this) } }
class E {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = new Map()
    this.style = createStyle()
    this.listeners = new Map()
    this.textContent = ''
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c }
  insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentNode = this; if (i === -1) this.children.push(c); else this.children.splice(i, 0, c); return c }
  removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  setAttribute(n, v) { this.attributes.set(n, String(v)) }
  getAttribute(n) { return this.attributes.get(n) ?? null }
  removeAttribute(n) { this.attributes.delete(n) }
  addEventListener() {} removeEventListener() {}
  get nextSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] ?? null }
  get text() { return this.children.length === 0 ? this.textContent : this.children.map(c => (c.nodeType === 3 ? c.nodeValue : c.text)).join('') }
}

const document = { createElement: (t) => new E(t), createTextNode: (v) => new T(v) }
const win = { document, console }
new Function('window', 'globalThis', source)(win, win)
const mini = win.__DSH_PPT_MINI_REACT__
const h = mini.createElement
const outline = (n) => (n.nodeType === 3 ? `#${n.nodeValue}` : (n.children.length === 0 ? n.tagName.toLowerCase() : `${n.tagName.toLowerCase()}(${n.children.map(outline).join(',')})`))

const container = document.createElement('div')
const root = mini.createRoot(container)
const item = (id) => h('li', { key: id }, String(id))

root.render(h('ul', null, item(1), item(2)))
console.log('1) after first render :', outline(container))
const ul = container.children[0]
console.log('   ul children:', ul.children.length, ul.children.map(c => c.getAttribute('class') ?? c.text).join('|'))

root.render(h('ul', null, item(1), item(2), item(3)))
console.log('2) after append      :', outline(container))
console.log('   ul children:', ul.children.length, 'identities:', ul.children.map(c => c.text).join('|'))
console.log('   duplicates?', ul.children.length !== new Set(ul.children).size)
