// tools/fix-readme-commands.mjs — 修复 README 里被「去掉连字符」破坏的命令/路径
//
// 背景：早期用 PowerShell 做批量字符串替换，把文件名里的连字符吃掉了
// （`tools/sync-plugin.mjs` → `tools/sync plugin.mjs`），命令因此全部不可用。
// `tools/fix-readme.mjs` 只修了一部分模式，这里补齐并做幂等校验。
//
// 用法：<node> tools/fix-readme-commands.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const README = join(ROOT, 'README.md')
const checkOnly = process.argv.includes('--check')

/** 已知的损坏 → 正确写法（只做**精确**替换，避免误伤正常文本）。 */
const FIXES = [
  ['tools/install profile.mjs', 'tools/install-profile.mjs'],
  ['tools/sync plugin.mjs', 'tools/sync-plugin.mjs'],
  ['tools/test all.mjs', 'tools/test-all.mjs'],
  ['tools/inspect deck.mjs', 'tools/inspect-deck.mjs'],
  ['tools/build client.mjs', 'tools/build-client.mjs'],
  ['tests/host load.test.mjs', 'tests/host-load.test.mjs'],
  ['client/ppt style.js', 'client/ppt-style.js'],
  ['tools/build demo pptx.py', 'tools/build-demo-pptx.py'],
  ['tools/demo deck.json', 'tools/demo-deck.json'],
  ['demo deck.json', 'demo-deck.json'],
  // 标题 / 目录名 / loader id / 插件 URL 段
  ['# dsh ppt canvas', '# dsh-ppt-canvas'],
  ['~/.dsh/ppt canvas/', '~/.dsh/ppt-canvas/'],
  ['dsh ppt canvas/', 'dsh-ppt-canvas/'],
  ['id=ppt canvas', 'id=ppt-canvas'],
  ['plugins/dsh ppt canvas/', 'plugins/dsh-ppt-canvas/'],
  // PowerShell 里的运行时路径
  ['dsh runtimes\\dsh primary runtime', 'dsh-runtimes\\dsh-primary-runtime'],
  // curl 的参数被空格吃掉
  ['curl.exe  s  o NUL  w ', 'curl.exe -s -o NUL -w '],
  ['curl.exe  s ', 'curl.exe -s '],
]

const source = readFileSync(README, 'utf8')
let next = source
const applied = []
for (const [broken, fixed] of FIXES) {
  if (!next.includes(broken)) continue
  next = next.split(broken).join(fixed)
  applied.push(`${broken} → ${fixed}`)
}

if (applied.length === 0) {
  console.log('README 命令路径：无需修复')
  process.exit(0)
}

if (checkOnly) {
  console.log(`README 里仍有 ${applied.length} 处被破坏的命令路径：`)
  for (const item of applied) console.log(`  ${item}`)
  process.exit(1)
}

writeFileSync(README, next, 'utf8')
console.log(`已修复 ${applied.length} 处：`)
for (const item of applied) console.log(`  ${item}`)
