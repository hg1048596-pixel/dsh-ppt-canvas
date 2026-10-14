// tools/asar-grep.mjs — 读取 Electron app.asar（不经 electron）并按正则搜索文件内容
//
// 用途：确认桌面版宿主到底怎么组合 profile 的 bundles / 插件行。
// asar 头是 pickle 编码的目录 JSON，条目载荷多为 store（未压缩），少数 deflate。
//
// 用法：<node> tools/asar-grep.mjs <asar> <regex> [--max <n>] [--ext .js,.mjs,.cjs,.json]

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MODULES = 'D:\\deepseek harness desktop official\\resources\\app.asar.unpacked\\dsh\\node_modules'
const requireFromDsh = createRequire(join(MODULES, 'noop.js'))
const fflate = requireFromDsh('fflate')

const [asarPath, pattern, ...rest] = process.argv.slice(2)
if (asarPath === undefined || pattern === undefined) {
  console.error('usage: node tools/asar-grep.mjs <app.asar> <regex> [--max n] [--ext .js]')
  process.exit(2)
}
const maxIndex = rest.indexOf('--max')
const max = maxIndex === -1 ? 40 : Number(rest[maxIndex + 1])
const extIndex = rest.indexOf('--ext')
const exts = extIndex === -1 ? ['.js', '.mjs', '.cjs', '.json', '.yml', '.yaml'] : rest[extIndex + 1].split(',')
const regex = new RegExp(pattern, 'g')

const buffer = readFileSync(asarPath)
const headerSize = buffer.readUInt32LE(4)
const headerJsonSize = buffer.readUInt32LE(12)
const jsonText = buffer.toString('utf8', 16, 16 + headerJsonSize)
const header = JSON.parse(jsonText.slice(0, jsonText.lastIndexOf('}') + 1))
const dataOffset = 8 + headerSize

const entries = []
const walk = (node, prefix) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (entry.files !== undefined) walk(entry, path)
    else if (entry.size !== undefined) entries.push({ path, size: entry.size, offset: Number(entry.offset) })
  }
}
walk(header, '')

let hits = 0
for (const entry of entries) {
  if (!exts.some(ext => entry.path.endsWith(ext))) continue
  if (entry.size > 3_000_000 || entry.size === 0) continue
  const start = dataOffset + entry.offset
  const raw = buffer.subarray(start, start + entry.size)
  let text
  try {
    text = raw.toString('utf8')
    if (text.includes('\u0000')) throw new Error('binary')
  } catch {
    try { text = Buffer.from(fflate.inflateSync(new Uint8Array(raw))).toString('utf8') } catch { continue }
  }
  regex.lastIndex = 0
  if (!regex.test(text)) continue
  hits++
  const lines = text.split('\n')
  console.log(`\n=== ${entry.path} (${entry.size} bytes) ===`)
  lines.forEach((line, index) => {
    regex.lastIndex = 0
    if (regex.test(line)) console.log(`  ${index + 1}: ${line.trim().slice(0, 220)}`)
  })
  if (hits >= max) { console.log(`\n(stopped after ${max} files)`); break }
}
console.log(`\nscanned ${entries.length} entries, ${hits} file(s) matched /${pattern}/`)
