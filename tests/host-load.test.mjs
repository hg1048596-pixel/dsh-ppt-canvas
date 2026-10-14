// tests/host-load.test.mjs — 从 profile 的安装位置加载 Host 插件
//
// 覆盖另外两个套件看不到的一环：**安装后的模块解析**。
// 开发树里能 import 的相对路径，在 plugin/ 自包含目录里不一定对；
// 这里用真实的 ESM 导入（走 profile/node_modules 的 junction）验证：
//   1. 包入口（plugin/host.js → ../host/index.js）可以解析；
//   2. 引擎的相对导入在 plugin/ 下也成立（逐个导入 plugin/*.js）；
//   3. apply(ctx) 在最小 ctx 上装配出 HTTP 路由与 4 个模型工具；
//   4. 模型工具能被调用（工具定义形状必须被 DSH 的 tools.register 接受）。

import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const PLUGIN = join(ROOT, 'plugin')

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

const importFile = (path) => import(pathToFileURL(path).href)

await step('plugin/: 每个引擎模块都能在自包含目录里被导入', async () => {
  const modules = ['zip.js', 'xml.js', 'pptx-read.js', 'pptx-write.js', 'history.js', 'demo.js', 'deck-store.js', 'tools.js', 'api.js', 'selftest.js', 'standalone-server.js', 'host.js']
  for (const name of modules) {
    const path = join(PLUGIN, name)
    assert(existsSync(path), `plugin/${name} is missing (run tools/sync-plugin.mjs)`)
    await importFile(path)
  }
  // plugin/index.js 绝不能存在：Node 解析目录包时优先命中它，宿主就会加载另一个
  // （很容易过期的）副本 —— 本项目曾因此把一个停在最早版本的入口跑了很久。
  assert(
    !existsSync(join(PLUGIN, 'index.js')),
    'plugin/index.js must not exist: it shadows plugin/host.js in Node directory resolution',
  )
})

await step('plugin/: 内部导入只允许同级 ./ 与 node: 内建（保证自包含）', () => {
  const files = ['host.js', 'api.js', 'deck-store.js', 'tools.js', 'pptx-read.js', 'pptx-write.js', 'history.js', 'selftest.js', 'demo.js']
  for (const name of files) {
    const source = readFileSync(join(PLUGIN, name), 'utf8')
    const imports = [...source.matchAll(/^\s*import\s+[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(match => match[1])
    for (const specifier of imports) {
      const ok = specifier.startsWith('./') || specifier.startsWith('node:')
      assert(ok, `plugin/${name} imports "${specifier}" — the shipped package must stay self-contained (only ./ and node:)`)
    }
  }
})

await step('plugin/host.js: 是 host/index.js 的逐字节副本（同步未漂移）', () => {
  const source = readFileSync(join(HERE, '..', 'host', 'index.js'))
  const shipped = readFileSync(join(PLUGIN, 'host.js'))
  assertEqual(Buffer.compare(source, shipped), 0, 'plugin/host.js must be a copy of host/index.js')
})

await step('apply(ctx): 挂载时打印可诊断的日志（服务探测 + 路由前缀）', async () => {
  const mod = await importFile(join(PLUGIN, 'host.js'))
  const infos = []
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register() { return () => {} } }
      if (name === 'tools') return { register() { return () => {} } }
      if (name === 'logger') return { warn() {}, info: (msg) => infos.push(String(msg)), debug() {}, error() {} }
      return undefined
    },
    effect(fn) { const cleanup = fn(); return () => { if (typeof cleanup === 'function') cleanup() } },
  }
  mod.apply(ctx)
  assert(infos.length >= 2, `apply must log its mount decisions (got ${infos.length} lines)`)
  assert(infos[0].includes('[dsh-ppt-canvas]'), 'the log line carries the plugin tag')
  assert(infos[0].includes('apply() entered'), 'the first line proves apply() ran')
  assert(infos.some(line => line.includes('services:')), 'the service probe is logged')
  assert(infos.some(line => line.includes('/dsh-ppt')), 'the route prefix is named')
})

await step('plugin/host.js: 导出 { name, inject, apply }，且 inject 为空（不冒「不启动」的风险）', async () => {
  const mod = await importFile(join(PLUGIN, 'host.js'))
  assertEqual(mod.name, 'dsh-ppt-canvas')
  assert(Array.isArray(mod.inject), 'inject must be an array')
  assertEqual(
    mod.inject.length,
    0,
    'inject must stay empty: a hard dependency that is not satisfied leaves the loader entry permanently inactive, '
    + 'with no error and no log — every service is fetched with ctx.get() + a null check instead',
  )
  assertEqual(typeof mod.apply, 'function')
})

await step('apply(ctx): 装配 HTTP 路由 + 4 个模型工具（webServer/tools 缺失时优雅降级）', async () => {
  const mod = await importFile(join(PLUGIN, 'host.js'))
  const routes = []
  const tools = []
  const warnings = []
  const effects = []
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register(route) { routes.push(route); return () => {} } }
      if (name === 'tools') return { register(definition) { tools.push(definition); return () => {} } }
      if (name === 'logger') return { warn: (msg) => warnings.push(String(msg)), debug() {}, error() {} }
      return undefined
    },
    effect(fn, label) { const cleanup = fn(); effects.push({ label, cleanup }); return () => { if (typeof cleanup === 'function') cleanup() } },
    get logger() { return this.get('logger') },
  }
  mod.apply(ctx)
  assertEqual(routes.length, 1, 'exactly one HTTP route registered')
  assertEqual(routes[0].path, '/dsh-ppt')
  assertEqual(routes[0].kind, 'prefix')
  const names = tools.map(definition => definition.name).sort()
  assertEqual(
    names.join(','),
    'ppt_canvas_apply,ppt_canvas_context,ppt_canvas_history,ppt_canvas_open',
    'the four canvas tools must register (the window tool was removed with the standalone window)',
  )
  for (const definition of tools) {
    assertEqual(typeof definition.description, 'string', `${definition.name} needs a description`)
    assert(definition.parameters !== null && typeof definition.parameters === 'object', `${definition.name} needs parameters`)
    assertEqual(typeof definition.output?.render, 'function', `${definition.name} needs output.render`)
    assertEqual(typeof definition.execute, 'function', `${definition.name} needs execute`)
    assert(definition.output.schema !== undefined, `${definition.name} needs an output schema`)
  }
})

await step('apply(ctx): 没有 webServer 时只告警不抛（画布不可用但 DSH 正常启动）', async () => {
  const mod = await importFile(join(PLUGIN, 'host.js'))
  const warnings = []
  const ctx = {
    get(name) {
      if (name === 'logger') return { warn: (msg) => warnings.push(String(msg)), debug() {}, error() {} }
      return undefined
    },
    effect(fn) { const cleanup = fn(); return () => { if (typeof cleanup === 'function') cleanup() } },
  }
  mod.apply(ctx)
  assert(warnings.length >= 1, 'a warning is logged')
  assert(warnings.some(text => text.includes('webServer')), 'the warning names webServer')
})

await step('tools: ppt_canvas_open 可执行（用 fixture 目录）', async () => {
  const mod = await importFile(join(PLUGIN, 'host.js'))
  const tools = new Map()
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register() { return () => {} } }
      if (name === 'tools') return { register(definition) { tools.set(definition.name, definition); return () => {} } }
      if (name === 'logger') return { warn() {}, debug() {}, error() {} }
      return undefined
    },
    effect(fn) { const cleanup = fn(); return () => { if (typeof cleanup === 'function') cleanup() } },
  }
  mod.apply(ctx)
  const open = tools.get('ppt_canvas_open')
  const result = await open.execute({ path: join(ROOT, 'tests', 'fixtures', 'demo.pptx') })
  assertEqual(result.slideCount, 3)
  assertEqual(result.shapes.length, 3)
  assert(typeof result.file === 'string' && result.file.length > 0, 'file path reported')
  const context = tools.get('ppt_canvas_context')
  let caught = null
  try { context.execute({ requestId: 'nope' }) } catch (error) { caught = error }
  assert(caught !== null, 'unknown requestId must fail')
  assertEqual(caught.code, 'notFound')
})

await step('api: /api/requests 诊断端点列出到达插件的请求', async () => {
  const { registerRoutes } = await importFile(join(PLUGIN, 'api.js'))
  const { DeckStore } = await importFile(join(PLUGIN, 'deck-store.js'))
  const { createServer } = await import('node:http')
  const routes = []
  registerRoutes(
    { webServer: { register(route) { routes.push(route); return () => {} } } },
    new DeckStore(),
    { emit() {}, subscribe: () => () => {} },
    { info() {}, warn() {}, debug() {}, error() {} },
    undefined,
  )
  const server = createServer(async (req, res) => {
    const matched = routes.find(route => req.url.startsWith(route.path))
    if (matched === undefined) { res.writeHead(404).end(); return }
    await matched.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-ppt`
  try {
    // 先打一条会被记下的请求，再读诊断端点
    await fetch(`${base}/api/window`)
    const response = await fetch(`${base}/api/requests`)
    assertEqual(response.status, 200)
    const payload = await response.json()
    assertEqual(payload.value.handlerMounted, true, 'the diagnostic proves the handler is mounted')
    assertEqual(payload.value.routePrefix, '/dsh-ppt')
    assert(payload.value.count >= 1, `requests must be recorded (count=${payload.value.count})`)
    assertEqual(payload.value.requests[0].method, 'GET')
    assert(payload.value.requests[0].path.includes('/dsh-ppt/'), 'the logged path is the real one')
  } finally {
    // Node 的 fetch 保持 keep-alive；只 close() 会让进程一直挂到对端超时。
    server.closeAllConnections?.()
    server.close()
  }
})

await step('profile: 安装位置可通过 node_modules 解析到本插件', async () => {
  const profilesRoot = join(homedir(), '.dsh', 'profiles')
  const installed = ['desktop', 'web']
    .map(name => join(profilesRoot, name, 'node_modules', 'dsh-ppt-canvas'))
    .filter(path => existsSync(path))
  if (installed.length === 0) {
    console.log('      (未安装到任何 profile，跳过——运行 tools/install-profile.mjs 后此项生效)')
    return
  }
  for (const path of installed) {
    const mod = await import(pathToFileURL(join(path, 'plugin', 'host.js')).href)
    assertEqual(typeof mod.apply, 'function', `${path} resolves to a loadable plugin`)
  }
})

console.log('')
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack?.split('\n').slice(0, 3).join(' | ')}`)
}
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
