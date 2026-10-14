// tests/api.test.mjs — Host HTTP API 端到端测试
//
// 起一个真实的 node:http 服务器，用 registerRoutes 把 /dsh-ppt 路由挂上去，
// 然后像真正的客户端那样用 fetch 走完整条链路：
//   open → deck → context → apply(dryRun) → apply → history → undo → redo → selftest → media
// 这样测的是 HTTP 层 + DeckStore + 引擎的组合，而不是单元级别的假调用。

import { createServer } from 'node:http'
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerRoutes } from '../host/api.js'
import { DeckStore } from '../host/deck-store.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'demo.pptx')

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

// ---- 装配：真实 http server + 真实路由 + 真实 store ----
const workDir = mkdtempSync(join(tmpdir(), 'dsh-ppt-api-'))
const deckPath = join(workDir, 'api-deck.pptx')
copyFileSync(FIXTURE, deckPath)

const store = new DeckStore()
const bus = { emit() {}, subscribe() { return () => {} } }
const routes = []
const fakeWebServer = { register(route) { routes.push(route); return () => {} } }
const quiet = { info() {}, warn() {}, debug() {}, error() {} }
registerRoutes({ webServer: fakeWebServer }, store, bus, quiet)
assertEqual(routes.length, 1, 'one prefix route registered')
assertEqual(routes[0].kind, 'prefix')
assertEqual(routes[0].path, '/dsh-ppt')

// connection 通路优先：有 connection.fetch.register 时不该再碰 webServer
{
  const viaConnection = []
  const viaWeb = []
  registerRoutes(
    {
      connection: { fetch: { register(route) { viaConnection.push(route); return () => {} } } },
      webServer: { register(route) { viaWeb.push(route); return () => {} } },
    },
    store,
    bus,
    quiet,
  )
  assertEqual(viaConnection.length, 1, 'connection.fetch.register is preferred when available')
  assertEqual(viaConnection[0].path, '/dsh-ppt')
  assertEqual(viaWeb.length, 0, 'webServer must not be touched when the connection path works')
  // connection 抛错时要回退到 webServer，而不是整个插件挂掉
  const fallback = []
  registerRoutes(
    {
      connection: { fetch: { register() { throw new Error('nope') } } },
      webServer: { register(route) { fallback.push(route); return () => {} } },
    },
    store,
    bus,
    quiet,
  )
  assertEqual(fallback.length, 1, 'a failing connection path falls back to webServer')
  // 两个都没有时返回一个安全的 disposer，不抛
  assertEqual(typeof registerRoutes({}, store, bus, quiet), 'function', 'no carriers still returns a disposer')
}

const server = createServer(async (req, res) => {
  const matched = routes.find(route => req.url.startsWith(route.path))
  if (matched === undefined) {
    res.writeHead(404).end()
    return
  }
  await matched.handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/dsh-ppt`

async function api(path, body) {
  const response = await fetch(`${base}/${path}`, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json()
  return { status: response.status, payload }
}

// ---- 用例 ----

await step('api: 未知路由 404', async () => {
  const { status, payload } = await api('api/nope')
  assertEqual(status, 404)
  assertEqual(payload.ok, false)
  assertEqual(payload.error.code, 'notFound')
})

await step('api: 没有打开文档时 deck 返回 noDeck', async () => {
  const { status, payload } = await api('api/deck')
  assertEqual(status, 409)
  assertEqual(payload.error.code, 'noDeck')
})

await step('api: open 参数缺失是 badRequest', async () => {
  const { status, payload } = await api('api/open', {})
  assertEqual(status, 400)
  assertEqual(payload.error.code, 'badRequest')
})

await step('api: open 不存在的文件是 notFound', async () => {
  const { status, payload } = await api('api/open', { path: join(workDir, 'nope.pptx') })
  assertEqual(status, 404)
  assertEqual(payload.error.code, 'notFound')
})

let opened = null
await step('api: open 返回 Deck', async () => {
  const { status, payload } = await api('api/open', { path: deckPath })
  assertEqual(status, 200)
  assertEqual(payload.ok, true)
  opened = payload.value
  assertEqual(opened.slides.length, 3)
  assertEqual(opened.rev, 0)
  assert(opened.slideWidth > 1000, 'slide width parsed')
})

await step('api: deck 返回当前模型（带 rev）', async () => {
  const { payload } = await api('api/deck')
  assertEqual(payload.value.rev, 0)
  assertEqual(payload.value.slides.length, 3)
})

await step('api: history 初始不可撤销', async () => {
  const { payload } = await api('api/history')
  assertEqual(payload.value.canUndo, false)
  assertEqual(payload.value.canRedo, false)
})

let requestId = null
await step('api: context 暂存选区并生成 requestId', async () => {
  const slide = opened.slides[0]
  const target = slide.shapes.find(shape => shape.text !== null && shape.text.plain !== '')
  const { payload } = await api('api/context', {
    deckRev: 0,
    instruction: '把标题改成蓝色并居中',
    selectionMode: 'single',
    slideIndex: 0,
    selectedIds: [target.id],
    elements: [{
      id: target.id,
      name: target.name,
      kind: target.kind,
      z: target.z,
      geometry: target.geometry,
      style: target.style,
      text: { plain: target.text.plain, fontSize: target.text.fontSize, color: target.text.color, align: target.text.align },
    }],
  })
  assertEqual(payload.ok, true)
  requestId = payload.value.requestId
  assert(typeof requestId === 'string' && requestId.length > 4, 'requestId returned')
  assertEqual(payload.value.context.instruction, '把标题改成蓝色并居中')
  assertEqual(payload.value.context.elements.length, 1)
  // 契约 §4 要求的属性面必须齐全
  const element = payload.value.context.elements[0]
  for (const field of ['id', 'name', 'kind', 'z', 'geometry', 'style', 'text']) {
    assert(element[field] !== undefined, `context element must carry ${field}`)
  }
})

await step('api: GET context 可取回且未消费', async () => {
  const { payload } = await api(`api/context?requestId=${encodeURIComponent(requestId)}`)
  assertEqual(payload.value.consumed, false)
  assertEqual(payload.value.context.instruction, '把标题改成蓝色并居中')
})

await step('api: apply dryRun 只校验不落盘', async () => {
  const before = readFileSync(deckPath)
  const { payload } = await api('api/apply', {
    dryRun: true,
    requestId,
    patch: { summary: '试算', ops: [{ op: 'setTextStyle', id: opened.slides[0].shapes.find(s => s.text !== null && s.text.plain !== '').id, color: '#1A73E8', align: 'center' }] },
  })
  assertEqual(payload.ok, true)
  assertEqual(payload.value.dryRun, true)
  assertEqual(payload.value.applied, false)
  assertEqual(payload.value.rev, 0)
  assert(Buffer.compare(before, readFileSync(deckPath)) === 0, 'dryRun must not write')
})

await step('api: apply 校验失败返回 422 + violations', async () => {
  const { status, payload } = await api('api/apply', {
    patch: { summary: 'bad', ops: [{ op: 'setFill', id: 's1:999999', color: '#FF0000' }] },
  })
  assertEqual(status, 422)
  assertEqual(payload.error.code, 'validationFailed')
  assert(Array.isArray(payload.error.details.violations) && payload.error.details.violations.length > 0, 'violations present')
})

let targetId = null
await step('api: apply 真实补丁 → rev 1，返回新 Deck', async () => {
  const target = store.view().slides[0].shapes.find(shape => shape.text !== null && shape.text.plain !== '')
  targetId = target.id
  const started = Date.now()
  const { payload } = await api('api/apply', {
    requestId,
    source: 'ai',
    patch: {
      summary: '标题改蓝并居中',
      ops: [
        { op: 'setTextStyle', id: target.id, color: '#1A73E8', align: 'center', bold: true },
        { op: 'setText', id: target.id, paragraphs: [{ runs: [{ text: 'AI 改过的标题' }] }] },
      ],
    },
  })
  assertEqual(payload.ok, true)
  assertEqual(payload.value.applied, true)
  assertEqual(payload.value.rev, 1)
  assertEqual(payload.value.changedIds.includes(target.id), true)
  const after = payload.value.deck.slides[0].shapes.find(shape => shape.id === target.id)
  assertEqual(after.text.plain, 'AI 改过的标题')
  assertEqual(after.text.color, '#1A73E8')
  assertEqual(after.text.align, 'center')
  const onDisk = readFileSync(deckPath)
  assert(onDisk.length > 1000, 'file written')
  console.log(`      (apply took ${Date.now() - started} ms)`)
})

await step('api: history 显示可撤销 + 条目摘要', async () => {
  const { payload } = await api('api/history')
  assertEqual(payload.value.rev, 1)
  assertEqual(payload.value.canUndo, true)
  assertEqual(payload.value.canRedo, false)
  assertEqual(payload.value.entries[0].summary, '标题改蓝并居中')
})

await step('api: staleRev 冲突（上下文基于 rev 0，当前 rev 1）', async () => {
  const { status, payload } = await api('api/apply', {
    requestId,
    patch: { summary: 'old', ops: [{ op: 'setFill', id: targetId, color: '#123456' }] },
  })
  assertEqual(status, 409)
  assertEqual(payload.error.code, 'staleRev')
  assertEqual(payload.error.details.requestedRev, 0)
  assertEqual(payload.error.details.currentRev, 1)
})

await step('api: undo 回到 rev 0 并还原文本', async () => {
  const { payload } = await api('api/undo', { steps: 1 })
  assertEqual(payload.ok, true)
  assertEqual(payload.value.rev, 0)
  const target = payload.value.slides[0].shapes.find(shape => shape.id === targetId)
  assert(target.text.plain !== 'AI 改过的标题', 'undo restored the original text')
  assertEqual(readFileSync(deckPath).length > 1000, true)
})

await step('api: redo 回到 rev 1', async () => {
  const { payload } = await api('api/redo', { steps: 1 })
  assertEqual(payload.value.rev, 1)
  const target = payload.value.slides[0].shapes.find(shape => shape.id === targetId)
  assertEqual(target.text.plain, 'AI 改过的标题')
})

await step('api: 到底后再撤销返回 nothingToUndo（409）', async () => {
  await api('api/undo', { steps: 1 })
  const { status, payload } = await api('api/undo', { steps: 1 })
  assertEqual(status, 409)
  assertEqual(payload.error.code, 'nothingToUndo')
  // 恢复到 rev 1，便于后续断言
  await api('api/redo', { steps: 1 })
})

await step('api: media 路由返回图片字节', async () => {
  const deck = store.view()
  const picture = deck.slides[1].shapes.find(shape => shape.kind === 'image')
  assert(picture !== undefined, 'demo deck has a picture')
  const response = await fetch(`${base}${picture.image.url.replace('/dsh-ppt', '')}`)
  assertEqual(response.status, 200)
  assertEqual(response.headers.get('content-type'), 'image/png')
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert(bytes.length > 1000, `image bytes look real (${bytes.length})`)
  assertEqual(bytes[0], 0x89, 'png signature')
})

await step('api: media 未知 deck 404', async () => {
  const response = await fetch(`${base}/media/deadbeef/image1.png`)
  assertEqual(response.status, 404)
})

await step('api: files 用内容打开（原生文件对话框那条路）→ 托管目录 + 可编辑', async () => {
  // 这是「普通应用的打开文件」链路：<input type="file"> 只给内容，不给路径，
  // 所以 Host 把内容落到托管目录再按路径打开。这里直接喂 base64 验证整条路。
  const content = readFileSync(FIXTURE).toString('base64')
  const { status, payload } = await api('api/files', { files: [{ name: '季度汇报.pptx', content }] })
  assertEqual(status, 200, `files open failed: ${JSON.stringify(payload)}`)
  assertEqual(payload.ok, true)
  assertEqual(payload.value.slides.length, 3, 'the picked bytes parsed as a real deck')
  assert(payload.value.file.includes('picked'), `opened from the managed dir (got ${payload.value.file})`)
  assert(payload.value.file.includes('季度汇报'), 'the original filename is preserved for display')
  // 文件确实落盘了，而且可以直接编辑（apply 一笔）
  const applied = await api('api/apply', {
    patch: {
      rev: payload.value.rev,
      summary: '来自文件对话框的一笔',
      ops: [{
        op: 'setText',
        id: payload.value.slides[0].shapes[0].id,
        paragraphs: [{ runs: [{ text: '来自文件对话框' }] }],
      }],
    },
  })
  assertEqual(applied.status, 200, `apply on a picked file failed: ${JSON.stringify(applied.payload)}`)
})

await step('api: files 拒绝非 .pptx 与空内容', async () => {
  const bad1 = await api('api/files', { files: [{ name: 'notes.txt', content: 'aGk=' }] })
  assertEqual(bad1.status, 400, 'a non-pptx name must be rejected')
  const bad2 = await api('api/files', { files: [] })
  assertEqual(bad2.status, 400, 'an empty files array must be rejected')
})

await step('api: selftest 全绿', async () => {
  const { payload } = await api('api/selftest')
  assertEqual(payload.ok, true)
  assertEqual(payload.value.ok, true, `selftest failed: ${JSON.stringify(payload.value.checks.filter(c => !c.ok))}`)
  assert(payload.value.checks.length >= 5, 'selftest reports its checks')
})

await step('api: 非 loopback Host 头被拒（DNS rebinding 防护）', async () => {
  // fetch() 不允许改写 Host 头（它是 forbidden header），所以这里直接开一条裸 TCP
  // 连接，手工发一个 Host: evil.example.com 的请求 —— 这正是 DNS rebinding 的形态。
  const { Socket } = await import('node:net')
  const socket = new Socket()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.connect(server.address().port, '127.0.0.1', resolve)
  })
  socket.write('GET /dsh-ppt/api/deck HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n')
  const chunks = []
  for await (const chunk of socket) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  assert(raw.startsWith('HTTP/1.1 403'), `expected 403, got: ${raw.split('\r\n')[0]}`)
  assert(raw.includes('loopback requests only'), 'rejection reason is reported')
})

await step('api: 大 body 与坏 JSON 都是 badRequest', async () => {
  const bad = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
  assertEqual(bad.status, 400)
  const parsed = await bad.json()
  assertEqual(parsed.error.code, 'badRequest')
})

// ---- 收尾 ----
// Node 的 fetch 保持 keep-alive；只 close() 会让进程一直挂到对端超时。
server.closeAllConnections?.()
server.close()
rmSync(workDir, { recursive: true, force: true })

console.log('')
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack?.split('\n').slice(0, 3).join(' | ')}`)
}
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
