// tests/no-window.test.mjs — 独立窗口功能已移除的回归检查
//
// 背景：本项目先做过「独立窗口」（Electron 起一个可自由拖动的桌面窗口），
// 后来按要求整体移除，源文件归档在 archive/standalone-window/。
//
// 这个测试的作用是**防止半截复活**：移除时最容易留下的就是「按钮还在、路由还在、
// 工具还在，但实现没了」这种状态 —— 用户点下去只会得到一个含糊的错误。
// 所以这里逐项断言这些入口都不存在。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PLUGIN = join(ROOT, 'plugin')
const ARCHIVE = join(ROOT, 'archive', 'standalone-window')

let passed = 0
let failed = 0
const failures = []
/** apply() 注册的清理函数（含独立服务的 close），测试末尾必须跑掉。 */
let appCleanups = []

async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`  FAIL ${name}: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertMissing(path, label) {
  assert(!existsSync(path), `${label} must be gone: ${path.replace(ROOT, '.')}`)
}

console.log('no-window (独立窗口已移除)')

await step('host: 窗口相关模块都已删除', () => {
  for (const name of ['window-launcher.js', 'window.cjs', 'window-preload.cjs', 'window-geometry.cjs']) {
    assertMissing(join(ROOT, 'host', name), `host/${name}`)
    assertMissing(join(PLUGIN, name), `plugin/${name}`)
  }
  assertMissing(join(ROOT, 'client', 'window-app.js'), 'client/window-app.js')
  assertMissing(join(ROOT, 'client', 'window-bundle.js'), 'client/window-bundle.js')
  assertMissing(join(ROOT, 'client', 'mini-react.js'), 'client/mini-react.js')
  assertMissing(join(PLUGIN, 'assets', 'window-bundle.js'), 'plugin/assets/window-bundle.js')
})

await step('归档: 源文件都还在 archive/standalone-window/（可恢复）', () => {
  assert(existsSync(ARCHIVE), 'the archive directory must exist so the feature can be restored')
  for (const name of ['window-launcher.js', 'window.cjs', 'window-preload.cjs', 'window-geometry.cjs']) {
    assert(existsSync(join(ARCHIVE, 'host', name)), `archive/host/${name} is missing`)
  }
  for (const name of ['window-app.js', 'window-bundle.js', 'mini-react.js']) {
    assert(existsSync(join(ARCHIVE, 'client', name)), `archive/client/${name} is missing`)
  }
  assert(existsSync(join(ARCHIVE, 'tests', 'window.test.mjs')), 'archive/tests/window.test.mjs is missing')
})

await step('host: 没有任何窗口路由或启动器残留', () => {
  const banned = [
    'window-launcher', 'CanvasWindow', 'windowHtml', 'serveWindowAsset',
    'handleWindow', 'ppt_canvas_window', 'localPortOf', 'standaloneBase',
    '/window-bundle.js', 'DSH_PPT_WINDOW_URL', 'ELECTRON_RUN_AS_NODE',
  ]
  for (const name of ['host.js', 'api.js', 'tools.js', 'standalone-server.js']) {
    const source = readFileSync(join(PLUGIN, name), 'utf8')
    for (const needle of banned) {
      assert(!source.includes(needle), `plugin/${name} still references "${needle}"`)
    }
  }
})

await step('client: 面板里没有「独立窗口」入口', () => {
  const source = readFileSync(join(PLUGIN, 'client.js'), 'utf8')
  // 注意：注释里会提到「独立窗口已移除」，所以这里断言的是**真实入口**而不是这个词。
  for (const needle of ['openWindow', 'onOpenWindow', 'api/window', 'window-bundle', 'dshPptWindow', 'windowControls']) {
    assert(!source.includes(needle), `plugin/client.js still references "${needle}"`)
  }
  assert(!source.includes('⧉ 独立窗口'), 'the window button label must be gone')
  assert(!source.includes("callApi('window'"), 'no window API call may remain')
  // 面板本身必须完好
  assert(source.includes('function createPptApp'), 'the panel UI must still be inlined')
  assert(source.includes('sidebar.footer.action'), 'the sidebar entry must still be registered')
})

await step('host: ppt_canvas_window 工具已注销（只应剩 4 个工具）', async () => {
  const mod = await import(pathToFileURL(join(PLUGIN, 'host.js')).href)
  const tools = []
  // apply() 会启动独立 loopback 服务；把 effect 的清理函数收起来，测试末尾统一跑，
  // 否则那个监听句柄会让测试进程一直不退出（表现就是「测试跑完但挂住」）。
  const cleanups = []
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register() { return () => {} } }
      if (name === 'tools') return { register(definition) { tools.push(definition.name); return () => {} } }
      if (name === 'logger') return { info() {}, warn() {}, debug() {}, error() {} }
      return undefined
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => { if (typeof cleanup === 'function') cleanup() }
    },
  }
  mod.apply(ctx)
  appCleanups = cleanups
  const names = tools.slice().sort()
  assert(
    names.join(',') === 'ppt_canvas_apply,ppt_canvas_context,ppt_canvas_history,ppt_canvas_open',
    `expected the four canvas tools, got "${names.join(',')}"`,
  )
})

await step('host: /api/window 现在是明确的 notFound（而不是含糊的 405）', async () => {
  const { registerRoutes } = await import(pathToFileURL(join(PLUGIN, 'api.js')).href)
  const { DeckStore } = await import(pathToFileURL(join(PLUGIN, 'deck-store.js')).href)
  const { createServer } = await import('node:http')
  const routes = []
  registerRoutes(
    { webServer: { register(route) { routes.push(route); return () => {} } } },
    new DeckStore(),
    { emit() {}, subscribe: () => () => {} },
    { info() {}, warn() {}, debug() {}, error() {} },
  )
  const server = createServer(async (req, res) => {
    const matched = routes.find(route => req.url.startsWith(route.path))
    if (matched === undefined) { res.writeHead(404).end(); return }
    await matched.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-ppt`
  try {
    const response = await fetch(`${base}/api/window`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'open' }),
    })
    assert(response.status === 404, `POST /api/window should be 404, got ${response.status}`)
    const payload = await response.json()
    assert(payload.ok === false, 'the error envelope is still JSON')
    assert(payload.error.code === 'notFound', `expected notFound, got ${payload.error.code}`)
    // 窗口页面路由也必须没了
    const page = await fetch(`${base}/window`)
    assert(page.status === 404, `GET /window should be 404, got ${page.status}`)
  } finally {
    // Node 的 fetch 会保持 keep-alive 连接，只 close() 会一直等到对端超时；
    // 必须先断开现有连接，否则测试进程挂住不退。
    server.closeAllConnections?.()
    server.close()
  }
})

// ---- 收尾 ----
// 跑掉 apply() 注册的清理函数：独立 loopback 服务的监听句柄在它们里面，
// 不跑的话测试进程会一直挂着不退出（而输出看起来是「全绿」）。
for (const cleanup of appCleanups) {
  try { await cleanup() } catch { /* 清理失败不该掩盖测试结论 */ }
}

console.log('')
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
if (failed > 0) {
  console.log('')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack ?? failure.error.message}`)
}
// 显式退出：即使还有别的句柄残留，测试结论也已经确定了。
process.exit(failed > 0 ? 1 : 0)
