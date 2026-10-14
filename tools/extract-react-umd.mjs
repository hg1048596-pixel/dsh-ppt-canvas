// tools/extract-react-umd.mjs
//
// 独立窗口页面需要一个不依赖 DSH 模块表的 React。DSH 前端把 React 预先打进
// app.asar 里（没有单独的 npm 包），所以这里直接从 app.asar 中把那份 React 运行时
// 取出来，落到 plugin/assets/react.umd.js 供 Host 路由服务给窗口页面。
//
// 为什么要 UMD 形态：独立窗口是自己 loadURL 的普通页面，没有 __ModuleLoader__，
// 也没有构建步骤；UMD 会把 React 挂到 window 上，正好被 window-bundle.js 使用。
//
// 用法：<node> tools/extract-react-umd.mjs [asar 路径]

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(ROOT, 'plugin', 'assets', 'react.umd.js')

const DEFAULT_ASAR = 'D:\\deepseek harness desktop official\\resources\\app.asar'
const asarPath = process.argv[2] ?? DEFAULT_ASAR

if (!existsSync(asarPath)) {
  console.error(`extract-react-umd: app.asar not found at ${asarPath}`)
  console.error('  用法：node tools/extract-react-umd.mjs [path\\to\\app.asar]')
  process.exit(1)
}

// asar 头：8 字节 pickle 头 + JSON 目录。用 DSH 自带的 fflate 解压（asar 条目多为 store）。
const unpackedModules = 'D:\\deepseek harness desktop official\\resources\\app.asar.unpacked\\dsh\\node_modules'
const requireFromDsh = createRequire(join(unpackedModules, 'noop.js'))
let fflate = null
try {
  fflate = requireFromDsh('fflate')
} catch (error) {
  console.error(`extract-react-umd: cannot load fflate from the DSH runtime: ${error.message}`)
  process.exit(1)
}

/** 解析 asar 头，返回 { header, dataOffset }。 */
function readAsarHeader(buffer) {
  const size = buffer.readUInt32LE(4)
  const headerJsonSize = buffer.readUInt32LE(12)
  void size
  const jsonStart = 16
  const json = buffer.toString('utf8', jsonStart, jsonStart + headerJsonSize)
  // 头部 JSON 末尾有 NUL 填充；截到最后一个 '}'
  const end = json.lastIndexOf('}')
  const header = JSON.parse(json.slice(0, end + 1))
  const dataOffset = 8 + size
  return { header, dataOffset }
}

/** 遍历 asar 目录树，产出 { path, size, offset }。 */
function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (entry.files !== undefined) walk(entry, path, out)
    else if (entry.size !== undefined) out.push({ path, size: entry.size, offset: Number(entry.offset) })
  }
  return out
}

const buffer = readFileSync(asarPath)
const { header, dataOffset } = readAsarHeader(buffer)
const entries = walk(header, '', []).filter(entry => entry.path.endsWith('.js'))
console.log(`extract-react-umd: ${entries.length} js entries in app.asar`)

/** 读一个条目的字节。 */
function readEntry(entry) {
  const start = dataOffset + entry.offset
  const raw = buffer.subarray(start, start + entry.size)
  // asar 条目可能是 zlib 压缩的（有独立压缩头时 size 字段不同），这里按原始字节返回。
  return raw
}

// React UMD 的指纹：生产版 UMD 会挂 window.React 并带这些标记。
const MARKERS = [
  'react.element',
  'SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  'ReactCurrentDispatcher',
]

const candidates = []
for (const entry of entries) {
  if (entry.size < 4000 || entry.size > 400000) continue
  let text
  try {
    text = readEntry(entry).toString('utf8')
  } catch {
    continue
  }
  const score = MARKERS.filter(marker => text.includes(marker)).length
  if (score >= 2 && /(window\.React|global\.React|exports\.React|React\s*=)/.test(text)) {
    candidates.push({ entry, score, text })
  }
}

if (candidates.length === 0) {
  console.error('extract-react-umd: no React-like bundle found in app.asar')
  console.error('  独立窗口需要它；把任意 React 18/19 UMD 构建放到 plugin/assets/react.umd.js 也可以。')
  process.exit(1)
}

candidates.sort((a, b) => b.score - a.score || a.entry.size - b.entry.size)
const picked = candidates[0]
console.log(`extract-react-umd: picked ${picked.entry.path} (${picked.entry.size} bytes, score ${picked.score})`)

mkdirSync(dirname(TARGET), { recursive: true })
writeFileSync(TARGET, `${[
  '/* React UMD 运行时（从 DSH 的 app.asar 中提取，供独立窗口页面使用）。',
  ` * 来源：${picked.entry.path}`,
  ' * 重新提取：node tools/extract-react-umd.mjs',
  ' */',
].join('\n')}\n${picked.text}`)
console.log(`extract-react-umd: wrote ${TARGET}`)
