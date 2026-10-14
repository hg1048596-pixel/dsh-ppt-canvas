// tools/probe-promote.mjs — 验证「把第 N 页提升为第 1 页」是否安全
//
// 背景：LibreOffice 的 `--convert-to png` 只导出第 1 页，且 PageRange 过滤器选项
// 被忽略（实测：两次导出哈希完全相同）。所以逐页渲染只能靠「改写包，让目标页成为
// 第 1 页」。这里验证改写后渲染出来的确实是目标页。
//
// 用法：<node> tools/probe-promote.mjs <deck.pptx> <pageNumber> <out.pptx>

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const { loadPackage } = await import(`file:///${join(ROOT, 'host', 'pptx-read.js').replace(/\\/g, '/')}`)
const { readZip, writeZip } = await import(`file:///${join(ROOT, 'host', 'zip.js').replace(/\\/g, '/')}`)

const file = process.argv[2]
const page = Number(process.argv[3] ?? 1)
const out = process.argv[4] ?? join(ROOT, 'debug', 'promoted.pptx')

const pkg = loadPackage(new Uint8Array(readFileSync(file)))
const raw = (name) => {
  const entry = pkg.entries.get(name)
  return entry === undefined ? undefined : Buffer.from(entry)
}

const slideCount = [...pkg.entries.keys()].filter(key => /^ppt\/slides\/slide\d+\.xml$/.test(key)).length
if (!Number.isFinite(page) || page < 1 || page > slideCount) {
  console.error(`页号 ${page} 超出范围（1..${slideCount}）`)
  process.exit(1)
}

const from = `ppt/slides/slide${page}.xml`
const fromRels = `ppt/slides/_rels/slide${page}.xml.rels`
const to = 'ppt/slides/slide1.xml'
const toRels = 'ppt/slides/_rels/slide1.xml.rels'

console.log(`源文件 ${file}  共 ${slideCount} 页  目标第 ${page} 页`)
console.log(`把 ${from} 的内容换到 ${to}`)

const slideXml = raw(from)
if (slideXml === undefined) {
  console.error(`包内没有 ${from}`)
  process.exit(1)
}

// 重新打包：只替换这两项，其余原样保留。
// 只改内容不改文件名，所以 presentation.xml 的 sldIdLst、Content_Types 都不用动。
const entries = new Map()
for (const [name, bytes] of pkg.entries) entries.set(name, Buffer.from(bytes))
entries.set(to, slideXml)

const rels = raw(fromRels)
if (rels !== undefined) {
  entries.set(toRels, rels)
  console.log(`同时把 ${fromRels} 换到 ${toRels}（媒体/版式引用要靠它）`)
} else {
  console.log('目标页没有 .rels，删除旧的以避免悬空引用')
  entries.delete(toRels)
}

// readZip 需要顺序表；这里直接沿用原包的顺序，替换/追加后写出
const order = [...pkg.entries.keys()]
if (!order.includes(toRels) && entries.has(toRels)) order.push(toRels)

const buffer = writeZip(order.map(name => ({ name, data: entries.get(name) })))
writeFileSync(out, buffer)
console.log(`已写出 ${out}（${buffer.length} bytes）`)
