// tools/sync-plugin.mjs
//
// 把开发源同步到 plugin/（唯一随包分发、也是 DSH 真正加载的目录）：
//   1. host/*.js            → plugin/*.js    （引擎自包含：intra-engine import 全是 './x.js'）
//   2. tests/fixtures/demo.pptx → plugin/assets/demo.pptx （内置演示文稿）
//   3. client/client.js + client/ppt-style.js → plugin/client.js（内联 CSS）
//
// plugin/host.js 与 plugin/client.js 是手写入口，不由本脚本生成。
//
// 用法：node tools/sync-plugin.mjs [--check]
//   --check 只校验是否同步（不写文件），用于提交前/CI。

import { copyFileSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClient } from './build-client.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_DIR = join(ROOT, 'host')
const PLUGIN_DIR = join(ROOT, 'plugin')
const CHECK = process.argv.includes('--check')

const issues = []
const written = []

function syncFile(source, target) {
  const expected = readFileSync(source)
  const current = existsSync(target) ? readFileSync(target) : null
  if (current !== null && Buffer.compare(current, expected) === 0) return
  if (CHECK) {
    issues.push(`${target.replace(ROOT, '.')} is out of date (source: ${source.replace(ROOT, '.')})`)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  written.push(target.replace(ROOT, '.'))
}

mkdirSync(PLUGIN_DIR, { recursive: true })

// 1) host 引擎模块：host/index.js → plugin/host.js，其余同名复制。
//    plugin/ 必须**自包含** —— 装好后 DSH 只保证这一层被加载，而 host/index.js 里
//    的相对导入全是 './xxx.js'，所以原样复制即可。host-load 测试会校验这一点。
//
//    注意：host/index.js **只**产出 plugin/host.js，绝不能同时写成 plugin/index.js。
//    Node 解析目录包时会优先命中 index.js，那样宿主加载的就是另一个（很容易过期的）
//    副本 —— 本项目就因此把一个停在最早版本的入口跑了很久，而且没有任何报错。
const SKIP = new Set(['client.js'])
const syncedTargets = new Set()
for (const name of readdirSync(HOST_DIR)) {
  if (!name.endsWith('.js') && !name.endsWith('.cjs')) continue
  if (SKIP.has(name)) continue
  const target = name === 'index.js' ? 'host.js' : name
  syncedTargets.add(target)
  syncFile(join(HOST_DIR, name), join(PLUGIN_DIR, target))
}
// 清掉历史遗留的 plugin/index.js（旧同步逻辑的产物，会让宿主加载过期代码）
const staleIndex = join(PLUGIN_DIR, 'index.js')
if (existsSync(staleIndex)) {
  if (CHECK) issues.push('plugin/index.js must be removed: it shadows plugin/host.js in Node resolution')
  else { rmSync(staleIndex); syncedTargets.add('index.js') }
}

// 2) 内置演示文稿
const fixture = join(ROOT, 'tests', 'fixtures', 'demo.pptx')
if (existsSync(fixture)) syncFile(fixture, join(PLUGIN_DIR, 'assets', 'demo.pptx'))
else issues.push('tests/fixtures/demo.pptx is missing (run tools/build-demo-pptx.py)')

// 3) 客户端 bundle（把样式与界面层内联进 plugin/client.js）
try {
  const { changed } = buildClient({ check: CHECK })
  for (const item of changed) {
    const relative = item.target.replace(ROOT, '').replace(/\\/g, '/')
    if (CHECK) issues.push(`${relative.replace(/^\//, '.')} is out of date`)
    else written.push(`.${relative}`)
  }
} catch (error) {
  issues.push(`client bundle: ${error.message}`)
}

if (issues.length > 0) {
  console.error(`sync-plugin: ${CHECK ? 'OUT OF DATE' : 'completed with problems'}`)
  for (const issue of issues) console.error(`  - ${issue}`)
  process.exit(1)
}
console.log(CHECK
  ? 'sync-plugin: OK (in sync)'
  : `sync-plugin: synced ${written.length} file(s)${written.length === 0 ? '' : `\n${written.map(file => `  + ${file}`).join('\n')}`}`)
