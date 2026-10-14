// tools/recover-mini-react.mjs — 从已生成的 window-bundle.js 里还原 client/mini-react.js
//
// 背景：一次用 PowerShell Set-Content 回写源文件把 UTF-8 打成了乱码（PowerShell 5.1 的
// 默认编码不是 UTF-8）。window-bundle.js 是那次写入**之前**由 sync-client-css 生成的，
// 里面内联着一份完整的、未损坏的迷你渲染层，因此可以从它还原。
//
// 用法：<node> tools/recover-mini-react.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'client', 'window-bundle.js')
const TARGET = join(ROOT, 'client', 'mini-react.js')

const bundle = readFileSync(BUNDLE, 'utf8')
const START = '/* dsh-ppt-canvas — 迷你渲染层'
const start = bundle.indexOf(START)
if (start === -1) throw new Error('mini-react source not found in window-bundle.js')

const END = '})(typeof window !== \'undefined\' ? window : globalThis)'
const end = bundle.indexOf(END, start)
if (end === -1) throw new Error('mini-react tail not found in window-bundle.js')
let body = bundle.slice(start, end + END.length)

// bundle 里每行都多缩进了 2 个空格（内联时统一缩进），这里还原。
body = body.split('\n').map(line => (line.startsWith('  ') ? line.slice(2) : line)).join('\n')
body = `${body}\n`

if (!body.includes('迷你渲染层：hook 只能在组件渲染期间调用')) {
  throw new Error('recovered text still does not decode correctly — aborting')
}
if (!body.includes('function createRoot')) {
  throw new Error('recovered text is missing createRoot — aborting')
}

writeFileSync(TARGET, body, 'utf8')
console.log(`recover-mini-react: wrote ${TARGET} (${body.length} bytes)`)
