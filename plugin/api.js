// dsh-ppt-canvas — Host HTTP API
//
// 客户端（Web GUI 里的 client 半端）通过同源 fetch 调用这里。
// 路由挂在 /dsh-ppt 前缀下，与 DSH 自己的 /api 完全隔离：
//  - 只监听 loopback（DSH webServer 默认 127.0.0.1），且我们额外校验 Host 头；
//  - 只读写用户显式打开的那个 .pptx 与插件自己的临时目录；
//  - 不做任何目录遍历，媒体只按 deck 注册过的 mediaId 取。

import { randomUUID } from 'node:crypto'

import { DeckError } from './deck-store.js'

const PREFIX = '/dsh-ppt'
// 请求体上限：原生文件对话框（<input type="file">）选中的 .pptx 以 base64 传进来
// （体积 +33%），80MB 的文稿约 107MB，所以这里给到 128MB。
const MAX_BODY_BYTES = 128 * 1024 * 1024

/**
 * 最近请求的环形缓冲（诊断用，见 GET /dsh-ppt/api/requests）。
 *
 * 为什么需要它：DSH Desktop 的准入层会在请求到达插件之前拒掉一部分请求。
 * 从外部探测时**所有**路径都返回「空 body 404」（连一个不存在的路径也一样），
 * 所以「客户端报 405」这件事无法从外面判断到底是哪一层返回的。
 * 把实际到达 handle() 的请求记下来，就能一眼看出请求有没有走到插件这一层。
 */
const REQUEST_LOG = []
const REQUEST_LOG_LIMIT = 40

/**
 * 渲染接口的会话令牌。
 *
 * GET + 重副作用（spawn LibreOffice）不能只靠 Origin 白名单：`<img>` 不发 Origin。
 * 令牌放在 /api/status 的响应里 —— 那个响应受 CORS 保护，只有白名单来源能读，
 * 跨站页面拿不到令牌，也就没法构造 render URL。
 */
const renderToken = (() => {
  try {
    return randomUUID().replace(/-/g, '')
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
})()

/**
 * render 串行化：同时只允许一个 LibreOffice 进程。
 *
 * 不加限制的话，快速切页 / 多标签页会把 soffice 起一堆，互相抢同一个 profile
 * （实测会卡住或产出空文件），并且很容易拖满 CPU。
 */
let renderQueue = Promise.resolve()

/**
 * 允许的来源：本应用自己的渲染进程，以及任意 loopback 页面。
 *
 * 为什么必须**主动拒绝**而不是只省掉 CORS 响应头：省掉响应头只能阻止攻击者
 * **读到**响应，副作用（比如 apply 真的改了文件）照样发生。实测这条路径可达：
 * 恶意页面用 `content-type: text/plain` 发「简单请求」不触发预检，Host 头是
 * 127.0.0.1（通过 isLoopbackRequest），于是 POST 会直接执行。
 */
const ORIGIN_PATTERN = /^(dsh-app:\/\/|https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$)/

function isAllowedOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') return true // 非浏览器调用（curl/测试/工具）
  return ORIGIN_PATTERN.test(origin)
}

/**
 * POST 必须声明 JSON content-type。
 *
 * 这条是 CSRF 的第二道闸：带 `application/json` 的跨源请求**一定**触发预检，
 * 而我们的预检只对允许的来源回 CORS 头，浏览器就会在正式请求前中止它。
 * 因此「要求 JSON」等价于「强制所有浏览器请求先过预检」。
 */
function hasJsonContentType(req) {
  const value = req.headers['content-type']
  return typeof value === 'string' && /^application\/json\b/i.test(value)
}

function recordRequest(req, url, route) {
  REQUEST_LOG.push({
    at: new Date().toISOString(),
    method: req.method ?? '?',
    path: url.pathname,
    route,
    host: req.headers.host ?? null,
    origin: req.headers.origin ?? null,
    secFetchSite: req.headers['sec-fetch-site'] ?? null,
    ua: String(req.headers['user-agent'] ?? '').slice(0, 48),
  })
  if (REQUEST_LOG.length > REQUEST_LOG_LIMIT) {
    REQUEST_LOG.splice(0, REQUEST_LOG.length - REQUEST_LOG_LIMIT)
  }
}

/**
 * 注册全部路由；返回一次性 disposer。
 *
 * 两条通路，按可用性择一（都注册同一个 `{kind,path,handler}` 形状）：
 *   1. **`connection` 服务**（推荐）：DSH 自己的宿主 API 就走它，插件用它是官方姿势，
 *      而且它有 `requestRejection()` 这套 Host/Origin + 浏览器鉴权判定 —— 裸注册
 *      webServer 会绕过它，在 DSH Desktop 那种层层设卡的宿主里容易被前置准入层拦掉。
 *   2. **`webServer` 直接注册**（回退）：纯 web 宿主、或 connection 不可用时用。
 *
 * @param {object} carriers - `{ connection?, webServer? }`
 */
export function registerRoutes(carriers, store, bus, logger) {
  const route = {
    kind: 'prefix',
    path: PREFIX,
    // 必须接住 Promise：宿主路由只调用 handler，不会 await 它。
    // 少了这个 catch，handleRequest 内部再抛错就会变成未处理 rejection
    // 并静默丢掉请求（standalone-server 那层有 catch，宿主路由没有）。
    handler: (req, res) => {
      Promise.resolve(handleRequest(req, res, store, bus, logger)).catch((error) => {
        logger?.warn?.('[dsh-ppt-canvas] handler failed:', error)
        try {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: { code: 'internal', message: 'internal error' } }))
          } else {
            res.end()
          }
        } catch { /* 连接可能已断开 */ }
      })
    },
  }

  // 通路 1：connection 的 fetch 路由注册表
  const connection = carriers?.connection
  if (connection !== undefined && connection !== null && typeof connection.fetch?.register === 'function') {
    try {
      const dispose = connection.fetch.register(route)
      logger?.info?.(`[dsh-ppt-canvas] routes registered through the connection service at ${PREFIX}`)
      return () => { dispose() }
    } catch (error) {
      logger?.warn?.(`[dsh-ppt-canvas] connection.fetch.register failed (${error.message}); falling back to webServer`)
    }
  }

  // 通路 2：直接注册（回退）
  const webServer = carriers?.webServer
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
    logger?.warn?.('[dsh-ppt-canvas] neither connection.fetch.register nor webServer.register is available')
    return () => {}
  }
  const dispose = webServer.register(route)
  logger?.info?.(`[dsh-ppt-canvas] routes registered on webServer at ${PREFIX}`)
  return () => { dispose() }
}

/**
 * 请求总入口（导出以便独立 loopback 服务复用同一份逻辑）。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleRequest(req, res, store, bus, logger) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const route = url.pathname.slice(PREFIX.length)
  recordRequest(req, url, route)

  // 独立 loopback 通道会被跨源调用，带 content-type: application/json 的 POST 会先发
  // OPTIONS 预检。两种来源都要放行：
  //   - `dsh-app://app` —— DSH Desktop 的渲染进程（**实测就是它**）；
  //   - http://127.0.0.1[:port] / localhost / [::1] —— 普通 web 宿主下的同机页面。
  // 仍然只放行本应用与 loopback 来源，与下面的 isLoopbackRequest 约束一致。
  const origin = req.headers.origin
  if (typeof origin === 'string'
    && (/^dsh-app:\/\//.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin))) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'origin')
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-max-age', '600')
    res.end()
    return
  }
  try {
    if (!isLoopbackRequest(req)) {
      send(res, 403, { ok: false, error: { code: 'badRequest', message: 'loopback requests only' } })
      return
    }
    // CSRF 第一道闸：来源不在白名单就直接拒（不能只靠「不回 CORS 头」，
    // 那只能挡读取，挡不住副作用）。
    if (!isAllowedOrigin(origin)) {
      send(res, 403, {
        ok: false,
        error: { code: 'forbiddenOrigin', message: `origin not allowed: ${origin}` },
      })
      return
    }

    if (route.startsWith('/media/')) {
      await serveMedia(req, res, store, route.slice('/media/'.length))
      return
    }
    if (!route.startsWith('/api/')) {
      send(res, 404, { ok: false, error: { code: 'notFound', message: `unknown route ${url.pathname}` } })
      return
    }
    const name = route.slice('/api/'.length)
    if (req.method === 'GET') {
      await handleGet(name, url, res, store, bus, logger)
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: { code: 'badRequest', message: 'POST required' } })
      return
    }
    // CSRF 第二道闸：强制 JSON content-type，令所有浏览器跨源请求必须先过预检。
    if (!hasJsonContentType(req)) {
      send(res, 415, {
        ok: false,
        error: { code: 'badRequest', message: 'POST requires content-type: application/json' },
      })
      return
    }
    const body = await readJsonBody(req)
    const value = await handlePost(name, body, store, bus)
    send(res, 200, { ok: true, value })
  } catch (error) {
    const failure = toFailure(error)
    if (failure.status >= 500) logger.warn?.(error)
    send(res, failure.status, { ok: false, error: failure.error })
  }
}

async function handleGet(name, url, res, store, bus, logger) {
  switch (name) {
    case 'status':
      // 轻量状态：客户端轮询「外部程序是否改过文件」用（只 stat，不解析包）。
      // 同时下发 render 令牌 —— 这个响应受 CORS 保护（只有白名单来源能读），
      // 所以跨站页面拿不到它，也就构造不出 render URL。
      send(res, 200, { ok: true, value: { ...store.status(), renderToken } })
      return
    case 'deck':
      send(res, 200, { ok: true, value: store.view() })
      return
    case 'history':
      send(res, 200, { ok: true, value: { rev: store.requireCurrent().rev, ...store.historyStatus() } })
      return
    case 'context': {
      const requestId = url.searchParams.get('requestId') ?? ''
      send(res, 200, { ok: true, value: store.getContext(requestId) })
      return
    }
    case 'selftest': {
      const { runSelfTest } = await import('./selftest.js')
      send(res, 200, { ok: true, value: runSelfTest(store) })
      return
    }
    case 'requests':
      // 诊断：列出最近到达插件的请求 + 组装结果（工具注册到底成没成）。
      send(res, 200, {
        ok: true,
        value: {
          handlerMounted: true,
          routePrefix: PREFIX,
          health: bus?.health ?? null,
          count: REQUEST_LOG.length,
          requests: REQUEST_LOG.slice().reverse(),
        },
      })
      return
    case 'render': {
      // 精确渲染：用 LibreOffice 把某一页渲染成 PNG（见 host/render.js）。
      // 画布用它替代 DOM 近似重画，观感与真实文件一致。
      //
      // **为什么需要令牌**：这是 GET 且有重副作用（每次 spawn 一个 LibreOffice）。
      // 跨站页面用 `<img src="http://127.0.0.1:19488/dsh-ppt/api/render?page=1">`
      // 就能触发它 —— `<img>` 不带 Origin，所以 Origin 白名单管不到，
      // 反复请求即可把用户机器拖垮。令牌只能通过**可读响应**（/api/status，受 CORS
      // 保护）拿到，跨站页面读不到，于是这条路被堵住。
      const token = url.searchParams.get('t') ?? ''
      if (token !== renderToken) {
        send(res, 403, {
          ok: false,
          error: { code: 'forbiddenOrigin', message: 'render requires the session token (see GET /api/status)' },
        })
        return
      }
      const page = Number(url.searchParams.get('page') ?? 1)
      const width = Math.min(4096, Math.max(320, Number(url.searchParams.get('w') ?? 1600) || 1600))
      if (!Number.isInteger(page) || page < 1) {
        send(res, 400, { ok: false, error: { code: 'badRequest', message: 'page must be an integer >= 1' } })
        return
      }
      const open = store.requireCurrent()
      const { loadPackage } = await import('./pptx-read.js')
      const { renderSlidePng } = await import('./render.js')
      const pkg = store.packageOf(open)
      if (!Number.isInteger(page) || page > pkg.slideParts.length) {
        send(res, 404, {
          ok: false,
          error: { code: 'notFound', message: `page ${page} is out of range (1..${pkg.slideParts.length})` },
        })
        return
      }
      // 串行化：排队执行，避免多个 soffice 抢同一个 profile。
      const task = renderQueue.then(() => renderSlidePng({
        file: open.filePath,
        entries: pkg.entries,
        page,
        width,
        // 页号必须按 sldIdLst 的顺序映射到部件名：用户重排过幻灯片后
        // 文件名与显示页序不一致，按 slide${page}.xml 取会渲染错页。
        slideParts: pkg.slideParts,
        logger,
      }))
      renderQueue = task.then(() => undefined, () => undefined)
      const result = await task
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(result.buffer.length),
        // 缓存键含源文件 mtime，所以可以让浏览器放心缓存一小段时间。
        'cache-control': 'private, max-age=30',
      })
      res.end(result.buffer)
      return
    }
    default:
      send(res, 404, { ok: false, error: { code: 'notFound', message: `unknown api ${name}` } })
  }
}

async function handlePost(name, body, store, bus) {
  switch (name) {
    case 'open': {
      if (body.path === undefined && body.createDemo === true) {
        return store.openDemo(typeof body.dir === 'string' ? body.dir : undefined)
      }
      const deck = await store.open(body.path, { force: body.force === true })
      bus.emit({ type: 'deck-opened', file: deck.file, rev: deck.rev })
      return deck
    }
    case 'demo': {
      const deck = await store.openDemo(typeof body.dir === 'string' ? body.dir : undefined)
      bus.emit({ type: 'deck-opened', file: deck.file, rev: deck.rev })
      return deck
    }
    case 'files': {
      // 原生文件对话框选中的文稿：内容是 base64，写到托管目录再按路径打开。
      // 这是标准 DOM 下唯一可行的「打开文件」方式（File 不带本地路径）。
      const entry = Array.isArray(body.files) ? body.files[0] : undefined
      if (entry === undefined || typeof entry.content !== 'string' || entry.content === '') {
        throw new DeckError('badRequest', 'files[0].content (base64) is required')
      }
      const name = typeof entry.name === 'string' ? entry.name : 'picked.pptx'
      if (!/\.pptx$/i.test(name)) {
        throw new DeckError('badRequest', `only .pptx is supported (got ${name})`)
      }
      const bytes = Buffer.from(entry.content, 'base64')
      if (bytes.length === 0) throw new DeckError('badRequest', 'decoded file is empty')
      const deck = await store.openBytes(bytes, name)
      bus.emit({ type: 'deck-opened', file: deck.file, rev: deck.rev, picked: true })
      return deck
    }
    case 'deck': {
      const deck = body.force === true ? await store.reload() : store.view()
      return deck
    }
    case 'context': {
      const context = store.putContext(body)
      bus.emit({ type: 'context', requestId: context.requestId, count: (body.selectedIds ?? []).length })
      return { requestId: context.requestId, context }
    }
    case 'apply': {
      const result = await store.apply(body.patch, {
        dryRun: body.dryRun === true,
        source: typeof body.source === 'string' ? body.source : 'user',
        requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      })
      if (result.dryRun !== true) {
        bus.emit({ type: 'applied', rev: result.rev, summary: result.summary, changedIds: result.changedIds })
      }
      return result
    }
    case 'undo':
      return store.undo(body.steps)
    case 'redo':
      return store.redo(body.steps)
    case 'close': {
      // 走 store.close()：它还会释放历史快照（每步两份完整 pptx）与内存缓存。
      // 以前只把 current 置空，磁盘快照和 buffer 全都留着。
      return store.close()
    }
    default:
      throw new DeckError('notFound', `unknown api ${name}`)
  }
}

// ------------------------------------------------------------------ 媒体

async function serveMedia(req, res, store, rest) {
  const slash = rest.indexOf('/')
  if (slash <= 0) {
    send(res, 400, { ok: false, error: { code: 'badRequest', message: 'media route needs <deckKey>/<mediaId>' } })
    return
  }
  const deckKey = decodeURIComponent(rest.slice(0, slash))
  const filePart = decodeURIComponent(rest.slice(slash + 1))
  const mediaId = filePart.includes('.') ? filePart.slice(0, filePart.lastIndexOf('.')) : filePart
  const open = store.byKey(deckKey)
  if (open === undefined) {
    send(res, 404, { ok: false, error: { code: 'notFound', message: `unknown deck ${deckKey}` } })
    return
  }
  const media = open.deck.media?.[mediaId]
  if (media === undefined) {
    send(res, 404, { ok: false, error: { code: 'notFound', message: `unknown media ${mediaId}` } })
    return
  }
  // 用 store 的包缓存：媒体请求一页可能有十几张图，每次重新解压整个包
  // （实测 8.9MB 文稿约 10ms/次、解压 9.3MB）既慢又费内存。
  const pkg = store.packageOf(open)
  const entry = pkg.media.get(mediaId)
  if (entry === undefined) {
    send(res, 404, { ok: false, error: { code: 'notFound', message: `media ${mediaId} has no payload` } })
    return
  }
  const bytes = pkg.entries.get(entry.zipPath)
  if (bytes === undefined) {
    send(res, 404, { ok: false, error: { code: 'notFound', message: `media payload missing in package` } })
    return
  }
  res.writeHead(200, {
    'content-type': entry.mime ?? 'application/octet-stream',
    'content-length': String(bytes.length),
    'cache-control': 'private, max-age=60',
  })
  res.end(Buffer.from(bytes))
}

// ------------------------------------------------------------------ 工具

function isLoopbackRequest(req) {
  // Host 头校验挡的是 DNS rebinding（攻击者把域名解析到 127.0.0.1）。
  // 但如果宿主 webServer 绑到了 0.0.0.0，局域网里可以直接连过来、伪造
  // `Host: 127.0.0.1` 绕过它 —— 所以还要看**真实来源地址**。
  const remote = req.socket?.remoteAddress ?? ''
  const fromLoopback = remote === '' // 某些测试桩没有 socket，放行由 Host 校验兜底
    || remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1'
    || remote.startsWith('127.')
  if (!fromLoopback) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new DeckError('badRequest', `request body exceeds ${MAX_BODY_BYTES} bytes`)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new DeckError('badRequest', 'request body must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof DeckError) throw error
    throw new DeckError('badRequest', `invalid JSON body: ${error.message}`)
  }
}

const STATUS_BY_CODE = {
  badRequest: 400,
  validationFailed: 422,
  notFound: 404,
  noDeck: 409,
  nothingToUndo: 409,
  nothingToRedo: 409,
  staleRev: 409,
  // 文件被外部程序改过：写入已中止，客户端应提示「重新加载后再试」
  staleFile: 409,
  // 排队期间文档被 /api/open 切走：本次写入已放弃（不能落到另一份文件上）
  staleDeck: 409,
  // 来源不在白名单（CSRF 防护）
  forbiddenOrigin: 403,
  ioFailed: 500,
}

function toFailure(error) {
  if (error instanceof DeckError || (error && typeof error.code === 'string' && STATUS_BY_CODE[error.code] !== undefined)) {
    const status = STATUS_BY_CODE[error.code] ?? 500
    return {
      status,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    }
  }
  return {
    status: 500,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
  }
}

/** 统一的响应出口：对象 → JSON，Buffer/Uint8Array → 原样字节。 */
function send(res, status, payload, headers = {}) {
  const isBytes = Buffer.isBuffer(payload) || payload instanceof Uint8Array
  const body = isBytes ? Buffer.from(payload) : Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    ...(isBytes ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    'content-length': String(body.length),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(body)
}

export { PREFIX, readJsonBody, isLoopbackRequest }
