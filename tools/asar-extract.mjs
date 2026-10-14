// tools/asar-extract.mjs — 从 app.asar 抽取单个文件到 stdout 或磁盘
// 用法：<node> tools/asar-extract.mjs <app.asar> <inner/path> [outFile]

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MODULES = 'D:\\deepseek harness desktop official\\resources\\app.asar.unpacked\\dsh\\node_modules'
const fflate = createRequire(join(MODULES, 'noop.js'))('fflate')

const [asarPath, innerPath, outFile] = process.argv.slice(2)
if (asarPath === undefined || innerPath === undefined) {
  console.error('usage: node tools/asar-extract.mjs <app.asar> <inner/path> [outFile]')
  process.exit(2)
}

const buffer = readFileSync(asarPath)
const headerSize = buffer.readUInt32LE(4)
const headerJsonSize = buffer.readUInt32LE(12)
const jsonText = buffer.toString('utf8', 16, 16 + headerJsonSize)
const header = JSON.parse(jsonText.slice(0, jsonText.lastIndexOf('}') + 1))
const dataOffset = 8 + headerSize

const find = (node, prefix, wanted) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (path === wanted) return entry
    if (entry.files !== undefined) {
      const hit = find(entry, path, wanted)
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

const entry = find(header, '', innerPath)
if (entry === undefined) {
  console.error(`not found in asar: ${innerPath}`)
  process.exit(1)
}
const start = dataOffset + Number(entry.offset)
const raw = buffer.subarray(start, start + entry.size)
let text
try {
  text = raw.toString('utf8')
  if (text.includes('\u0000')) throw new Error('binary')
} catch {
  text = Buffer.from(fflate.inflateSync(new Uint8Array(raw))).toString('utf8')
}
if (outFile === undefined) process.stdout.write(text)
else {
  writeFileSync(outFile, text)
  console.error(`wrote ${outFile} (${text.length} chars)`)
}
