// tools/probe-xml.mjs — 打印某个形状在 OOXML 里的原始 XML
//
// 用途：确认「模型里缺的字段」是**文件里没有**还是**读取时丢了**。
// 这决定了修的是 reader 还是 renderer —— 猜错的代价是白改一轮。
//
// 用法：<node> tools/probe-xml.mjs <deck.pptx> [匹配文本] [slideN]

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const { loadPackage } = await import(`file:///${join(ROOT, 'host', 'pptx-read.js').replace(/\\/g, '/')}`)
const { parseXml, serializeXml, findAll, textOf } = await import(`file:///${join(ROOT, 'host', 'xml.js').replace(/\\/g, '/')}`)

const file = process.argv[2] ?? join(ROOT, 'tests', 'fixtures', 'demo.pptx')
const needle = process.argv[3] ?? '本季度'
const slideNumber = Number(process.argv[4] ?? 1)

// loadPackage 只接受字节，所以先把 zip 里的 slide XML 取出来自己解析。
const bytes = readFileSync(file)
const pkg = loadPackage(new Uint8Array(bytes))

const zipPath = `ppt/slides/slide${slideNumber}.xml`
const raw = pkg.entries.get(zipPath)
if (raw === undefined) {
  console.error(`not found in package: ${zipPath}`)
  console.error(`available: ${[...pkg.entries.keys()].filter(k => k.startsWith('ppt/slides/')).join(', ')}`)
  process.exit(1)
}
const xml = Buffer.from(raw).toString('utf8')
const tree = parseXml(xml)

let shown = 0
for (const sp of [...findAll(tree, 'p:sp')]) {
  const text = findAll(sp, 'a:t').map(node => textOf(node)).join('')
  if (needle !== '' && !text.includes(needle)) continue
  const txBody = findAll(sp, 'p:txBody')[0]
  if (txBody === undefined) continue
  shown += 1
  console.log(`\n=== ${zipPath} 第 ${shown} 个命中（文本含 "${needle}"）===`)
  console.log(serializeXml(txBody))
}

if (shown === 0) {
  console.log(`没有形状的文本包含 ${JSON.stringify(needle)}`)
  console.log(`（本页形状数：${[...findAll(tree, 'p:sp')].length}）`)
}
