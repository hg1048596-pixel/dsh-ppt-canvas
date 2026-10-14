// tests/window.test.mjs — 独立窗口的启动与几何
//
// 覆盖三件事：
//   1. host/window-geometry.cjs 的窗口摆放数学（换屏/改分辨率后不能跑出屏幕外）；
//   2. host/window-launcher.js 的 Electron 运行时发现链（含错误信息可读性）；
//   3. host/api.js 的 /dsh-ppt/window 路由与 window 动作（用真实 http server）。
//
// Electron 进程本身不在这里拉起来（那需要图形环境），但「找得到运行时 / 摆得对位置 /
// 路由能把页面和 bundle 发出去」这三段是窗口能不能开起来的全部前置条件。

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerRoutes } from '../host/api.js'
import { DeckStore } from '../host/deck-store.js'
import { CanvasWindow, electronBinaryIn, electronCandidates, resolveElectron } from '../host/window-launcher.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const require = createRequire(import.meta.url)
const geometry = require('../host/window-geometry.cjs')

let passed = 0
let failed = 0
const failures = []

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

// ---------------------------------------------------------------- 几何

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1080 }
const LEFT = { x: -1920, y: 0, width: 1920, height: 1080 }

await step('geometry: 没有历史坐标时居中', () => {
  const bounds = geometry.centeredBounds(PRIMARY, 1180, 760)
  assertEqual(bounds.width, 1180)
  assertEqual(bounds.height, 760)
  assertEqual(bounds.x, Math.round((1920 - 1180) / 2))
  assert(bounds.y > 0 && bounds.y + bounds.height <= 1080, 'fits vertically')
})

await step('geometry: 历史坐标在屏幕内时保持不变', () => {
  const bounds = geometry.clampToWorkArea({ x: 300, y: 200, width: 1180, height: 760 }, [{ workArea: PRIMARY }], { width: 720, height: 480 })
  assertEqual(JSON.stringify(bounds), JSON.stringify({ x: 300, y: 200, width: 1180, height: 760 }))
})

await step('geometry: 窗口跑到屏幕外时被拉回可见区域', () => {
  const beyond = geometry.clampToWorkArea({ x: 5000, y: 5000, width: 1180, height: 760 }, [{ workArea: PRIMARY }], { width: 720, height: 480 })
  assert(beyond.x + beyond.width <= PRIMARY.width, 'right edge is inside the work area')
  assert(beyond.y + beyond.height <= PRIMARY.height, 'bottom edge is inside the work area')
  const negative = geometry.clampToWorkArea({ x: -4000, y: -4000, width: 1180, height: 760 }, [{ workArea: PRIMARY }], { width: 720, height: 480 })
  assert(negative.x >= PRIMARY.x, 'left edge is inside the work area')
  assert(negative.y >= PRIMARY.y, 'top edge is inside the work area')
})

await step('geometry: 副屏坐标落在副屏内', () => {
  const bounds = geometry.clampToWorkArea({ x: -1500, y: 100, width: 1180, height: 760 }, [{ workArea: PRIMARY }, { workArea: LEFT }], { width: 720, height: 480 })
  assertEqual(bounds.x, -1500, 'kept on the secondary display')
  assertEqual(bounds.y, 100)
})

await step('geometry: 尺寸小于最小值时被抬高，大于工作区时被压缩', () => {
  const tiny = geometry.clampToWorkArea({ x: 10, y: 10, width: 200, height: 100 }, [{ workArea: PRIMARY }], { width: 720, height: 480 })
  assertEqual(tiny.width, 720)
  assertEqual(tiny.height, 480)
  const huge = geometry.clampToWorkArea({ x: 0, y: 0, width: 5000, height: 5000 }, [{ workArea: PRIMARY }], { width: 720, height: 480 })
  assertEqual(huge.width, PRIMARY.width)
  assertEqual(huge.height, PRIMARY.height)
})

await step('geometry: parsePosition 只接受两个都有效的坐标', () => {
  assertEqual(geometry.parsePosition('100', '200').x, 100)
  assertEqual(geometry.parsePosition(100.4, 200.6).y, 201)
  assertEqual(geometry.parsePosition(undefined, 200), null)
  assertEqual(geometry.parsePosition(100, null), null)
  assertEqual(geometry.parsePosition('abc', 10), null)
  assertEqual(geometry.parsePosition('', ''), null)
})

// ---------------------------------------------------------------- 启动器

await step('launcher: electronBinaryIn 能识别 win32 / darwin / linux 布局', () => {
  // 只在真实存在的路径上断言（避免造目录污染工作区）
  assertEqual(electronBinaryIn(null), null)
  assertEqual(electronBinaryIn('/definitely/not/here'), null)
  const fixture = join(ROOT, 'tests', 'fixtures')
  assertEqual(electronBinaryIn(fixture, 'win32'), null, 'no electron.exe in the fixture dir')
})

await step('launcher: 候选链是去重且按优先级的', () => {
  const candidates = electronCandidates({ DSH_PPT_ELECTRON: process.execPath })
  assertEqual(candidates[0].from, 'DSH_PPT_ELECTRON', 'explicit override is first')
  const paths = candidates.map(candidate => candidate.path.toLowerCase())
  assertEqual(new Set(paths).size, paths.length, 'no duplicate candidates')
})

await step('launcher: 无法启动时给出可读的修复建议（不抛异常）', () => {
  const window = new CanvasWindow({ url: 'http://127.0.0.1:1/dsh-ppt/window', backend: null, logger: { info() {}, warn() {}, error() {}, debug() {} } })
  const started = window.start()
  assertEqual(started.ok, false)
  assertEqual(started.reason, 'no-electron')
  assert(started.message.includes('DSH_PPT_ELECTRON'), 'the message names the env override')
  assert(started.message.includes('npm install -g electron'), 'the message names the npm route')
  assertEqual(window.running, false)
  assertEqual(window.status().available, false)
})

await step('launcher: 本机缺少 Electron 时不谎报可用（真机探测）', () => {
  const resolved = resolveElectron()
  if (resolved === null) {
    console.log('      (本机没有可 spawn 的 Electron 运行时；独立窗口会给出修复建议，画布面板不受影响)')
    return
  }
  assert(existsSync(resolved.path), `resolved binary exists: ${resolved.from}`)
  const window = new CanvasWindow({ url: 'http://127.0.0.1:1/dsh-ppt/window', backend: resolved, logger: { info() {}, warn() {}, error() {}, debug() {} } })
  assertEqual(window.status().available, true)
  // 不真的 start()：测试环境不拉起图形进程。
})

// ---------------------------------------------------------------- HTTP 路由

const store = new DeckStore()
const routes = []
const fakeWebServer = { register(route) { routes.push(route); return () => {} } }
const windowStub = {
  url: '',
  status: () => ({ running: false, available: false, backend: null, bounds: {} }),
  start: () => ({ ok: false, reason: 'no-electron', message: 'stub' }),
  stop: async () => {},
  unavailableReason: () => 'stub: 没有 Electron 运行时',
}
registerRoutes(
  { webServer: fakeWebServer },
  store,
  { emit() {}, subscribe: () => () => {} },
  { info() {}, warn() {}, debug() {}, error() {} },
  windowStub,
)

const server = createServer(async (req, res) => {
  const matched = routes.find(route => req.url.startsWith(route.path))
  if (matched === undefined) { res.writeHead(404).end(); return }
  await matched.handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-ppt`

async function api(path, body) {
  const response = await fetch(`${base}/${path}`, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  return { status: response.status, payload, text }
}

await step('route: /dsh-ppt/window 返回独立窗口页面', async () => {
  const response = await fetch(`${base}/window`)
  assertEqual(response.status, 200)
  assertEqual(response.headers.get('content-type'), 'text/html; charset=utf-8')
  const html = await response.text()
  assert(html.includes('dsh-ppt-window-root'), 'the page has the mount container')
  assert(html.includes('/dsh-ppt/window-bundle.js'), 'the page loads the window bundle')
  assert(html.includes('<title>PPT 协同编辑画布</title>'), 'the page has a title')
})

await step('route: /dsh-ppt/window-bundle.js 返回 bundle（含迷你渲染层与界面层）', async () => {
  const response = await fetch(`${base}/window-bundle.js`)
  assertEqual(response.status, 200)
  assert(response.headers.get('content-type').startsWith('text/javascript'), 'served as JavaScript')
  const body = await response.text()
  assert(body.includes('__DSH_PPT_MINI_REACT__'), 'mini react runtime is inside')
  assert(body.includes('function createPptApp('), 'shared app is inside')
  assert(body.includes("mode: 'window'"), 'window mode is set')
  assert(body.length > 50000, `bundle looks complete (${body.length} bytes)`)
})

await step('route: window 动作在缺少运行时时返回 opened=false 与修复建议', async () => {
  const { payload } = await api('api/window', { action: 'open' })
  assertEqual(payload.ok, true)
  assertEqual(payload.value.opened, false)
  assertEqual(payload.value.available, false)
  assert(payload.value.message.includes('Electron'), 'the message explains the missing runtime')
})

await step('route: window status 动作可用', async () => {
  const { payload } = await api('api/window', { action: 'status' })
  assertEqual(payload.ok, true)
  assertEqual(payload.value.running, false)
})

await step('route: 未知 window 动作是 badRequest', async () => {
  const { status, payload } = await api('api/window', { action: 'nope' })
  assertEqual(status, 400)
  assertEqual(payload.error.code, 'badRequest')
})

await step('route: 独立窗口页面也要过 loopback 校验', async () => {
  const { Socket } = await import('node:net')
  const socket = new Socket()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.connect(server.address().port, '127.0.0.1', resolve)
  })
  socket.write('GET /dsh-ppt/window HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n')
  const chunks = []
  for await (const chunk of socket) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  assert(raw.startsWith('HTTP/1.1 403'), `expected 403, got: ${raw.split('\r\n')[0]}`)
})

// ---------------------------------------------------------------- 打包一致性

await step('bundle: plugin/assets/window-bundle.js 与 client/window-bundle.js 一致', () => {
  const source = join(ROOT, 'client', 'window-bundle.js')
  const packaged = join(ROOT, 'plugin', 'assets', 'window-bundle.js')
  if (!existsSync(packaged)) {
    console.log('      (plugin/assets/window-bundle.js 尚未生成 —— 运行 tools/sync-plugin.mjs)')
    return
  }
  assertEqual(
    Buffer.compare(readFileSync(source), readFileSync(packaged)),
    0,
    'the packaged window bundle must match the generated one',
  )
})

await step('bundle: Electron 主脚本与 preload 随包分发', () => {
  for (const name of ['window.cjs', 'window-preload.cjs', 'window-geometry.cjs']) {
    assert(existsSync(join(ROOT, 'plugin', name)), `plugin/${name} must ship with the package`)
    assert(existsSync(join(ROOT, 'host', name)), `host/${name} must exist in the source tree`)
  }
  const preload = readFileSync(join(ROOT, 'plugin', 'window-preload.cjs'), 'utf8')
  assert(preload.includes('contextBridge'), 'preload exposes a minimal bridge')
  assert(preload.includes('dshPptWindow'), 'preload exposes the documented global')
  const main = readFileSync(join(ROOT, 'plugin', 'window.cjs'), 'utf8')
  assert(main.includes('window-preload.cjs'), 'main script references the preload')
  assert(main.includes('DSH_PPT_RENDERER_HEADER_NAME'), 'main script supports the DSH Desktop admission header')
})

server.close()

console.log('')
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack?.split('\n').slice(0, 3).join(' | ')}`)
}
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
