// tools/probe-textstyle.mjs — 打印一个文本框渲染出的**真实 style 值**
//
// 用途：「文字错位」这种反馈无法靠读代码定位（谁都在按自己的理解写对）。
// 这里直接把渲染函数产出的 style 打出来，与 OOXML 的期望值逐项对照。
//
// 用法：<node> tools/probe-textstyle.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

// 从 plugin/client.js 里取出内联的 createPptApp —— 那是真正在浏览器里跑的代码。
const bundle = readFileSync(join(ROOT, 'plugin', 'client.js'), 'utf8')
const start = bundle.indexOf('function createPptApp(')
if (start === -1) throw new Error('createPptApp not found in plugin/client.js')
// 尾部括号配对，取出完整函数体
let depth = 0
let end = -1
for (let index = bundle.indexOf('{', start); index < bundle.length; index += 1) {
  const ch = bundle[index]
  if (ch === '{') depth += 1
  else if (ch === '}') { depth -= 1; if (depth === 0) { end = index + 1; break } }
}
const source = bundle.slice(start, end)

// 伪 React：只要能产出一棵可检视的树就够
const fakeReact = {
  createElement: (type, props, ...children) => ({
    $$typeof: 'element',
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  }),
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
}

const factory = new Function('React', 'window', 'document', 'options', `
  const h = React.createElement
  ${source}
  return createPptApp({ React, document, window, ...options })
`)

const noop = () => {}
const doc = { createElement: () => ({ style: {}, appendChild: noop, addEventListener: noop, removeEventListener: noop }), head: { appendChild: noop }, body: { appendChild: noop } }
const win = { addEventListener: noop, removeEventListener: noop, localStorage: { getItem: () => null, setItem: noop }, fetch: noop }

const app = factory(fakeReact, win, doc, { styles: '', promptTo: null, apiBase: '/dsh-ppt/api' })

// 造一个与 fixture 里那个正文框等价的 shape
const shape = {
  id: 's1:4',
  kind: 'text',
  name: 'TextBox 3',
  z: 2,
  geometry: { x: 58, y: 168, w: 595, h: 250, rotation: 0, flipH: false, flipV: false },
  style: { fill: { type: 'none', color: null }, line: null, opacity: 1, cornerRadius: 0, prst: 'rect' },
  text: {
    plain: '本季度三条主线：\n1. 协同优化',
    align: 'left',
    anchor: 'top',
    color: '#333333',
    fontSize: 21.33,
    bold: false,
    italic: false,
    fontFamily: 'Microsoft YaHei',
    insets: { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 },
    autofit: 'shape',
    paragraphs: [
      {
        level: 0,
        align: 'left',
        lnSpc: 1.25,
        lnSpcIsPx: false,
        spaceBefore: null,
        spaceAfter: null,
        indent: null,
        runs: [{ text: '本季度三条主线：', color: '#333333', fontSize: 21.33, bold: false, italic: false, underline: false, fontFamily: 'Microsoft YaHei' }],
      },
      {
        level: 0,
        align: 'left',
        lnSpc: 1.25,
        lnSpcIsPx: false,
        spaceBefore: null,
        spaceAfter: null,
        indent: null,
        runs: [{ text: '1. 协同优化', color: '#333333', fontSize: 21.33, bold: false, italic: false, underline: false, fontFamily: 'Microsoft YaHei' }],
      },
    ],
  },
  image: null,
  table: null,
  children: null,
  placeholder: null,
}

console.log('=== 渲染出的树 ===')
const tree = JSON.stringify(
  app.__forTests.renderShape(shape, { selected: false, hovered: false, highlighted: false, interactive: false }),
  null,
  2,
)
console.log(tree.length > 3000 ? `${tree.slice(0, 3000)}…` : tree)

console.log('')
console.log('=== 对照期望（来自 OOXML）===')
console.log('  行距 lnSpc=1.25      → 每个段落 div 的 lineHeight 应为 1.25')
console.log('  内边距 insets        → 外层 div 的 padding 应为 4.8px 9.6px 4.8px 9.6px')
console.log('  anchor=t             → 外层 justifyContent 应为 flex-start')
console.log('  字号 21.33           → 外层 fontSize 应为 21.33px')
