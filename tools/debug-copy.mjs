// tools/debug-copy.mjs — 把打开的文档复制到工作区，供诊断用
//
// 为什么需要：画布上的渲染问题必须对着**真实文件**查（读它的 XML），
// 而「打开的原文件路径」在用户的机器上，我无法访问。这个脚本从插件自己的
// 状态里取出当前打开的文档并复制进来。
//
// 它会顺带打印「还没实现、且会造成排版错误的 PPT 特性」清单，逐项对着文件检查。
//
// 用法：<node> tools/debug-copy.mjs

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT_DIR = join(ROOT, 'debug')

// 插件的状态：/api/requests 的 health 不带文档；用独立通道问一下当前 deck。
const STANDALONE = process.env.DSH_PPT_API ?? 'http://127.0.0.1:19488/dsh-ppt/api'

async function json(path, body) {
  const response = await fetch(`${STANDALONE}/${path}`, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return response.json()
}

let deck
try {
  const payload = await json('deck')
  if (payload.ok !== true) {
    console.error(`插件返回错误：${JSON.stringify(payload.error)}`)
    console.error('（先打开一份演示文稿再跑这个脚本）')
    process.exit(1)
  }
  deck = payload.value
} catch (error) {
  console.error(`连不上插件：${error.message}`)
  console.error(`（独立通道 ${STANDALONE} 应该只在 DSH 运行且插件已加载时可访问）`)
  process.exit(1)
}

const source = deck.file
console.log(`当前打开的文档：${source}`)
if (!existsSync(source)) {
  console.error('这个路径在磁盘上不存在（可能已被移动/删除）')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const target = join(OUT_DIR, 'repro.pptx')
copyFileSync(source, target)
console.log(`已复制到：${target}`)
console.log('')

// ---- 逐项检查「已知未实现的特性」，这些正是排版错位的常见来源 ----
const { loadPackage } = await import(`file:///${join(ROOT, 'host', 'pptx-read.js').replace(/\\/g, '/')}`)
const pkg = loadPackage(new Uint8Array(readFileSync(target)))
const text = (name) => {
  const raw = pkg.entries.get(name)
  return raw === undefined ? null : Buffer.from(raw).toString('utf8')
}
const slides = [...pkg.entries.keys()].filter(key => /^ppt\/slides\/slide\d+\.xml$/.test(key)).sort()

const checks = [
  ['normAutofit（缩字号适应）', /<a:normAutofit/, '未实现：文字溢出时 PowerPoint 会缩小字号，这里会溢出 → 叠字/错位'],
  ['buChar / buAutoNum（项目符号）', /<a:bu(Char|AutoNum)/, '未实现：项目符号与它的悬挂缩进都丢了 → 行首对不齐'],
  ['marL / indent（缩进）', /<a:pPr[^>]*\bmarL=/, '已读入 marL，但悬挂缩进 indent 未处理'],
  ['lnSpc 绝对磅值', /<a:lnSpc><a:spcPts/, '已支持（换算成倍数）'],
  ['占位符（placeholder）继承', /<p:ph\b/, '未实现：位置/尺寸/字号可能来自版式，这里会整块错位'],
  ['主题字体（+mj-lt / +mn-lt）', /typeface="\+(mj|mn)-/, '未实现：字体会退回默认 → 字宽不同导致换行不同'],
  ['主题颜色（schemeClr）', /<a:schemeClr/, '已支持颜色，但主题色板来自 theme1.xml（需确认是否解析到）'],
  ['表格单元格竖排/内边距', /<a:tcPr[^>]*\b(anchor|marL|marT)/, '未实现：单元格内文字位置会偏'],
  ['形状旋转', /<a:xfrm[^>]*\brot="/, '已读入 rotation，但 Client 是否应用需确认'],
]

const all = slides.map(text).join('\n') + (text('ppt/slideMasters/slideMaster1.xml') ?? '') + (text('ppt/slideLayouts/slideLayout1.xml') ?? '')
console.log('=== 文件中出现的、与本插件未实现特性相关的检查 ===')
for (const [label, pattern, note] of checks) {
  const found = pattern.test(all)
  console.log(`  ${found ? '有' : '无'}  ${label}`)
  if (found) console.log(`        ${note}`)
}

console.log('')
console.log('=== 版式/母版里定义的文本默认值（继承链的关键，目前未读取）===')
for (const name of ['ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
  const xml = text(name)
  if (xml === null) { console.log(`  ${name}: 不存在`); continue }
  const lnSpc = [...xml.matchAll(/<a:lnSpc><a:spcPct val="(\d+)"/g)].map(m => Number(m[1]) / 100000)
  const spcAft = [...xml.matchAll(/<a:spcAft><a:spcPts val="(\d+)"/g)].map(m => Number(m[1]) / 100)
  const spcBef = [...xml.matchAll(/<a:spcBef><a:spcPts val="(\d+)"/g)].map(m => Number(m[1]) / 100)
  console.log(`  ${name}:`)
  console.log(`      lnSpc  : ${lnSpc.length > 0 ? [...new Set(lnSpc)].join(', ') + '（倍数）' : '未定义'}`)
  console.log(`      spcAft : ${spcAft.length > 0 ? [...new Set(spcAft)].join(', ') + '（pt）' : '未定义'}`)
  console.log(`      spcBef : ${spcBef.length > 0 ? [...new Set(spcBef)].join(', ') + '（pt）' : '未定义'}`)
}
