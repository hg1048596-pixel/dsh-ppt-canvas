// tools/make-multipage-fixture.mjs — 生成一个「每页内容不同」的多页 fixture
//
// 为什么需要：验证逐页渲染必须能**区分页面**。现有 demo.pptx 三页内容不同，
// 但页面顺序在包里固定；要证明「第 N 页被正确提升」，需要一个页号写在页内的文件
// （每页有自己的大字编号），这样渲染结果一眼可辨。
//
// 做法：直接改 demo.pptx 每页的文本内容，把页号写进去，其余结构原样保留。
//
// 用法：<node> tools/make-multipage-fixture.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const source = join(ROOT, 'tests', 'fixtures', 'demo.pptx')
const target = join(ROOT, 'tests', 'fixtures', 'pages.pptx')

const { loadPackage } = await import(`file:///${join(ROOT, 'host', 'pptx-read.js').replace(/\\/g, '/')}`)
const { writeZip } = await import(`file:///${join(ROOT, 'host', 'zip.js').replace(/\\/g, '/')}`)

const pkg = loadPackage(new Uint8Array(readFileSync(source)))
const slideNames = [...pkg.entries.keys()]
  .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))

console.log(`源：${source}`)
console.log(`页数：${slideNames.length}`)

const order = [...pkg.entries.keys()]
const out = new Map()
for (const [name, bytes] of pkg.entries) out.set(name, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))

for (const [index, name] of slideNames.entries()) {
  const page = index + 1
  let xml = out.get(name).toString('utf8')
  // 把该页第一个 <a:t>…</a:t> 的文本换成一个独一无二的标记，便于一眼确认渲染的是哪一页。
  const marker = `PAGE-${page}-MARKER`
  const replaced = xml.replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${marker}</a:t>`)
  if (replaced === xml) {
    console.warn(`  第 ${page} 页没有可替换的文本节点，跳过标记`)
  } else {
    xml = replaced
    console.log(`  第 ${page} 页 -> ${marker}`)
  }
  out.set(name, Buffer.from(xml, 'utf8'))
}

const buffer = writeZip(order.map(name => ({ name, data: out.get(name) })))
writeFileSync(target, buffer)
console.log(`已写出 ${target}（${buffer.length} bytes）`)
