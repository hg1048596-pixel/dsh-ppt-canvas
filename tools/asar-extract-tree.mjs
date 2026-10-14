// tools/asar-extract-tree.mjs — 把 app.asar 里的 dsh/node_modules 解到本地目录
//
// 用途：让 @deepseek-ai/dsh-app-boot 能在工作区里被 import（它的依赖都在 app.asar 内，
// 沙箱不允许在 temp 里建 junction）。解出来的是宿主自带的库，仅用于诊断探针。
//
// 用法：<node> tools/asar-extract-tree.mjs <app.asar> <inner/prefix> <outDir> [--filter regex]

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MODULES = 'D:\\deepseek harness desktop official\\resources\\app.asar.unpacked\\dsh\\node_modules'
const fflate = createRequire(join(MODULES, 'noop.js'))('fflate')

const [asarPath, prefix, outDir, ...rest] = process.argv.slice(2)
if (asarPath === undefined || prefix === undefined || outDir === undefined) {
  console.error('usage: node tools/asar-extract-tree.mjs <app.asar> <inner/prefix> <outDir> [--filter regex]')
  process.exit(2)
}
const filterIndex = rest.indexOf('--filter')
const filter = filterIndex === -1 ? null : new RegExp(rest[filterIndex + 1])

const buffer = readFileSync(asarPath)
const headerSize = buffer.readUInt32LE(4)
const headerJsonSize = buffer.readUInt32LE(12)
const jsonText = buffer.toString('utf8', 16, 16 + headerJsonSize)
const header = JSON.parse(jsonText.slice(0, jsonText.lastIndexOf('}') + 1))
const dataOffset = 8 + headerSize

const entries = []
const walk = (node, current) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = current === '' ? name : `${current}/${name}`
    if (entry.files !== undefined) walk(entry, path)
    else if (entry.size !== undefined) entries.push({ path, size: entry.size, offset: Number(entry.offset) })
  }
}
walk(header, '')

const wanted = entries.filter(entry => entry.path.startsWith(prefix))
let written = 0
let skipped = 0
for (const entry of wanted) {
  const relative = entry.path.slice(prefix.length).replace(/^\/+/, '')
  if (relative === '') continue
  if (filter !== null && !filter.test(relative)) { skipped++; continue }
  if (entry.size > 8_000_000) { skipped++; continue }
  const start = dataOffset + entry.offset
  const raw = buffer.subarray(start, start + entry.size)
  let bytes
  try {
    bytes = Buffer.from(raw)
    if (bytes.includes(0) && /\.(js|mjs|cjs|json|yml|yaml)$/.test(relative)) {
      bytes = Buffer.from(fflate.inflateSync(new Uint8Array(raw)))
    }
  } catch {
    try { bytes = Buffer.from(fflate.inflateSync(new Uint8Array(raw))) } catch { skipped++; continue }
  }
  const target = join(outDir, relative)
  mkdirSync(dirname(target), { recursive: true })
  if (existsSync(target)) { skipped++; continue }
  writeFileSync(target, bytes)
  written++
}
console.log(`asar-extract-tree: ${written} file(s) written to ${outDir}, ${skipped} skipped (of ${wanted.length} under ${prefix})`)
