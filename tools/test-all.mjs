// tools/test-all.mjs — 跑全部测试套件并汇总
//
// 用法：<node> tools/test-all.mjs [--allow-skip]
//
// 关于「跳过」：某些套件（render 的端到端 3 条）依赖本机安装 LibreOffice。
// 以前它们跳过时仍以 0 退出，汇总器显示 OK —— 等于**假绿**：环境缺依赖时
// 整个套件从不执行，却看起来全过。
//
// 为什么用**退出码**而不是扫输出：本机的 sandbox 禁止子进程管道式 stdio
// （spawn 时 pipe 会 EPERM），所以拿不到子进程的 stdout。约定：
//   退出码 0 = 全过；2 = 有测试被跳过（缺依赖）；其它 = 失败。
// 默认把 2 当作不绿；确实要在没装 LibreOffice 的机器上跑，显式加 --allow-skip。

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const allowSkip = process.argv.includes('--allow-skip')

/** 套件用这个退出码表示「有测试被跳过」。 */
const SKIP_EXIT_CODE = 2

const SUITES = [
  { name: 'engine', args: [join(ROOT, 'tests', 'engine.test.mjs')] },
  { name: 'concurrency', args: [join(ROOT, 'tests', 'concurrency.test.mjs')] },
  { name: 'api', args: [join(ROOT, 'tests', 'api.test.mjs')] },
  { name: 'client', args: [join(ROOT, 'tests', 'client-harness.mjs')] },
  { name: 'css', args: [join(ROOT, 'tests', 'css.test.mjs')] },
  { name: 'no-window', args: [join(ROOT, 'tests', 'no-window.test.mjs')] },
  { name: 'host-load', args: [join(ROOT, 'tests', 'host-load.test.mjs')] },
  { name: 'render', args: [join(ROOT, 'tests', 'render.test.mjs')] },
  { name: 'sync', args: [join(ROOT, 'tools', 'sync-plugin.mjs'), '--check'] },
]

const results = []
for (const suite of SUITES) {
  console.log(`\n========== ${suite.name} ==========`)
  // stdio 用 inherit：沙箱不允许管道式 stdio（会 EPERM）。
  const result = spawnSync(process.execPath, suite.args, { stdio: 'inherit', cwd: ROOT })
  results.push({ name: suite.name, status: result.status ?? 1 })
}

console.log('\n========== summary ==========')
let hardFailure = 0
let skippedCount = 0
for (const result of results) {
  if (result.status === SKIP_EXIT_CODE) {
    console.log(`SKIP ${result.name}  ← 有测试被跳过（缺依赖），不能算全绿`)
    skippedCount += 1
  } else if (result.status !== 0) {
    console.log(`FAIL ${result.name}`)
    hardFailure += 1
  } else {
    console.log(`OK   ${result.name}`)
  }
}

if (skippedCount > 0) {
  console.log('')
  console.log(`有 ${skippedCount} 个套件含被跳过的测试（通常是缺 LibreOffice）。`)
  console.log('要在这种环境里接受它，请显式加 --allow-skip。')
}

const bad = hardFailure + (allowSkip ? 0 : skippedCount)
process.exit(bad === 0 ? 0 : 1)
