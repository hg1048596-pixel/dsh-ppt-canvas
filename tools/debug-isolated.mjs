// tools/debug-isolated.mjs — 逐条运行 mini-react 测试，定位「前一条测试污染后一条」
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const testSource = readFileSync(join(HERE, '..', 'tests', 'mini-react.test.mjs'), 'utf8')

// 把测试文件里的 DOM 替身与装配段抽出来（到第一个 step( 之前），然后只跑指定的一条 step。
const setupEnd = testSource.indexOf("step('mini: 装载后")
const setup = testSource.slice(testSource.indexOf('// ------------------------------------------------------------------ DOM 替身'), setupEnd)
const harness = setup + '\nconst mini = sandboxWindow.__DSH_PPT_MINI_REACT__\nconst h = mini.createElement\nexport { mini, h, document }\n'
const module = await import(`data:text/javascript,${encodeURIComponent(harness)}`)
const { mini, h, document } = module

const outline = (node) => {
  if (node.nodeType === 3) return `#${node.nodeValue}`
  const kids = node.children.map(outline).join(',')
  return kids === '' ? node.tagName.toLowerCase() : `${node.tagName.toLowerCase()}(${kids})`
}

// 只跑「列表增删」这一条，前面没有任何其它测试。
const container = document.createElement('div')
const root = mini.createRoot(container)
const item = (id) => h('li', { key: id }, String(id))
root.render(h('ul', null, item(1), item(2)))
const ul = container.children[0]
console.log('isolated: after first  =', outline(container))
root.render(h('ul', null, item(1), item(2), item(3)))
console.log('isolated: after append =', outline(container))
