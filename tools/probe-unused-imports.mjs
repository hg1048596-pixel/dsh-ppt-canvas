// tools/probe-unused-imports.mjs — 找出 host/client 里**未被使用**的导入名
//
// 只做保守判断：把 import 的每个标识符在「去掉 import 行之后」的正文里数出现次数，
// 0 次即列出候选。人工确认后再删（有些是副作用导入，不能动）。
//
// 用法：<node> tools/probe-unused-imports.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const FILES = [
  'host/api.js', 'host/deck-store.js', 'host/pptx-read.js', 'host/pptx-write.js',
  'host/render.js', 'host/history.js', 'host/zip.js', 'host/xml.js', 'host/tools.js',
  'host/index.js', 'host/selftest.js', 'host/demo.js', 'host/standalone-server.js', 'host/temp-sweep.js',
  'client/app.js', 'client/client.js',
]

let suspects = 0
for (const relative of FILES) {
  const source = readFileSync(join(ROOT, relative), 'utf8')
  const lines = source.split('\n')
  const importLines = []
  const bodyLines = []
  let inImport = false
  for (const line of lines) {
    if (/^\s*import\s/.test(line)) {
      inImport = !/from\s+['"][^'"]+['"]\s*;?\s*$/.test(line)
      importLines.push(line)
      continue
    }
    if (inImport) {
      importLines.push(line)
      if (/from\s+['"][^'"]+['"]\s*;?\s*$/.test(line)) inImport = false
      continue
    }
    bodyLines.push(line)
  }
  const body = bodyLines.join('\n')
  const names = new Set()
  for (const line of importLines.join('\n').split(/[{},]/)) {
    const name = line.replace(/^\s*import\s*/, '').replace(/from\s+['"][^'"]+['"]\s*;?/, '').trim()
    if (name === '' || name === 'default' || name === 'as') continue
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
  }
  const unused = [...names].filter(name => {
    const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`)
    return !pattern.test(body)
  })
  if (unused.length > 0) {
    console.log(`${relative}: ${unused.join(', ')}`)
    suspects += unused.length
  }
}
console.log('')
console.log(suspects === 0 ? '没有发现未使用的导入' : `共 ${suspects} 个候选（需人工确认后删除）`)
