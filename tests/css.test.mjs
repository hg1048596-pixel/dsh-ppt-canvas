// tests/css.test.mjs — CSS 模板的结构校验
//
// 为什么需要：CSS 是普通字符串，语法错误**不会**让 JS 报错，只会让浏览器静默丢弃
// 整条规则。曾经真实发生过一次：插入样式时把选择器切断了，产出
//   `.dsh-ppt-el.kind-text>/* ---- */`
// 这种无法解析的行，`.dsh-ppt-el.kind-text` 整条规则失效，而且没有任何报错。
//
// 用法：<node> tests/css.test.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, '..', 'client', 'ppt-style.js'), 'utf8')

let passed = 0
let failed = 0
const failures = []

function check(name, body) {
  try {
    body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL ${name}: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

/** 取出 `const CSS = \`...\`` 里的字面量内容。 */
function extractCss(text) {
  const marker = 'const CSS = `'
  const start = text.indexOf(marker)
  assert(start !== -1, 'ppt-style.js 里找不到 `const CSS = ` 模板')
  const from = start + marker.length
  const end = text.indexOf('`', from)
  assert(end !== -1, 'CSS 模板没有结束反引号')
  return text.slice(from, end)
}

const css = extractCss(source)

check('css: 大括号配对', () => {
  let depth = 0
  for (const ch of css) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    assert(depth >= 0, '出现了多余的 }')
  }
  assert(depth === 0, `大括号不平衡（差值 ${depth}）`)
})

check('css: 规则头没有被注释或连接符截断', () => {
  const lines = css.split('\n')
  const bad = []
  lines.forEach((line, index) => {
    const text = line.trim()
    if (text === '' || !text.includes('{')) return
    const selector = text.slice(0, text.indexOf('{'))
    // 选择器里不该有注释起始，也不该以连接符结尾（说明被切断了）
    if (selector.includes('/*') || selector.includes('*/')) bad.push(`L${index + 1} 选择器含注释: ${text.slice(0, 90)}`)
    if (/[>,+~]\s*$/.test(selector)) bad.push(`L${index + 1} 选择器以连接符结尾: ${text.slice(0, 90)}`)
    if (selector.trim() === '') bad.push(`L${index + 1} 选择器为空: ${text.slice(0, 90)}`)
  })
  assert(bad.length === 0, `\n    ${bad.join('\n    ')}`)
})

check('css: 关键规则都还在（防止插入样式时误删）', () => {
  const required = [
    '.dsh-ppt-el{',
    '.dsh-ppt-el.kind-text{',
    '.dsh-ppt-slide{',
    '.dsh-ppt-rendered{',
    '.dsh-ppt-el.is-overlay',
    '.dsh-ppt-aipane',
  ]
  const missing = required.filter(rule => !css.includes(rule))
  assert(missing.length === 0, `缺少规则：${missing.join(', ')}`)
})

check('css: 注释成对（未闭合的 /* 会吞掉后面所有规则）', () => {
  // 真正要防的是「注释没闭合」：一个漏掉的 */ 会把后续所有规则都变成注释，
  // 浏览器静默丢弃，JS/构建/其它测试都不会报错。
  let open = -1
  for (let index = 0; index < css.length; index += 1) {
    if (css.startsWith('/*', index)) { open = index; index += 1; continue }
    if (css.startsWith('*/', index)) { open = -1; index += 1 }
  }
  assert(open === -1, `存在未闭合的注释，起于第 ${css.slice(0, open).split('\n').length} 行`)
})

console.log('')
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
process.exit(0)
