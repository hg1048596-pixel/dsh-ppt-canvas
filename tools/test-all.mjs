// tools/test-all.mjs — 依次跑全部测试套件，汇总退出码
//
// 用法：<node> tools/test-all.mjs
//   1) tests/engine.test.mjs        引擎（zip/xml/pptx 读、补丁、撤销）
//   2) tests/api.test.mjs           HTTP API（真实 http server + 全链路）
//   3) tests/client-harness.mjs     客户端 bundle 冒烟（DOM/React 替身）
//   4) tests/no-window.test.mjs     独立窗口已移除的回归（防止半截复活）
//   5) tests/host-load.test.mjs     插件入口在真实宿主形状下的装配
//   6) tools/sync-plugin.mjs --check 分发目录是否与源同步

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SUITES = [
  { name: 'engine', args: [join(ROOT, 'tests', 'engine.test.mjs')] },
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
  const result = spawnSync(process.execPath, suite.args, { stdio: 'inherit', cwd: ROOT })
  results.push({ name: suite.name, status: result.status ?? 1 })
}

console.log('\n========== summary ==========')
for (const result of results) {
  console.log(`${result.status === 0 ? 'OK  ' : 'FAIL'} ${result.name}`)
}
const failed = results.filter(result => result.status !== 0)
process.exit(failed.length === 0 ? 0 : 1)
