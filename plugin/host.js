// dsh-ppt-canvas — Host 入口
//
// 这个文件是**规范入口**，会被 tools/sync-plugin.mjs 原样复制成 plugin/host.js。
// 因此它有两条硬约束，改动前先看清楚：
//   1. 所有相对导入都必须是 `./xxx.js`（同级），不能出现 `../`：
//      装好后 DSH 只保证 plugin/ 这一层是被加载的包目录，跨目录引用依赖
//      「加载器允许跳到包外」这个未承诺的行为。
//   2. 只 import node: 内建模块，不 import 任何 @deepseek-ai/* 包：
//      本插件以 link 方式安装在 profile 的 node_modules 下，解析不到宿主包。

import { DeckStore } from './deck-store.js'
import { registerRoutes, handleRequest } from './api.js'
import { registerTools } from './tools.js'
import { startStandaloneApi } from './standalone-server.js'

export const name = 'dsh-ppt-canvas'
/**
 * 刻意**不声明任何 inject**。
 *
 * inject 让 Cordis 把插件挂起、等到依赖服务出现才启动；一旦依赖名对不上或服务在
 * 这个组合里没激活，条目就会永远停在「不激活」状态 —— 表现正是本项目踩过的坑：
 * 条目在配置树里存在、packageDir 也对，但 apply() 从没跑过（既没有路由也没有工具，
 * 且宿主不打任何日志）。本插件需要的服务全部走 ctx.get() + 显式判空。
 */
export const inject = []

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const store = new DeckStore()
  const logger = ctx.get('logger') ?? console
  const tag = '[dsh-ppt-canvas]'
  logger.info?.(`${tag} apply() entered; probing host services…`)

  /** 事件订阅者（诊断用；客户端靠轮询 + 工具返回同步）。 */
  const bus = {
    listeners: new Set(),
    emit(event) {
      for (const fn of this.listeners) {
        try { fn(event) } catch (error) { logger.debug?.(error) }
      }
    },
    subscribe(fn) {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }

  // 服务全部可选取用（inject 为空，所以这里必须自己判空）。
  const webServer = ctx.get('webServer')
  const connection = ctx.get('connection')
  logger.info?.(`${tag} services: webServer=${webServer === undefined ? 'no' : 'yes'}`
    + ` connection=${connection === undefined ? 'no' : 'yes'}`
    + ` tools=${ctx.get('tools') === undefined ? 'no' : 'yes'}`)

  // 独立 loopback 服务：**不依赖宿主路由表**，端口固定（占用则顺延）。
  // 这是本插件的主通道 —— 宿主路由是否注册成功都不影响它，客户端也优先走它。
  // 它的监听地址会写进日志，也是「apply() 到底跑了没有」的最直接证据。
  const standalone = startStandaloneApi({
    handle: (req, res) => handleRequest(req, res, store, bus, logger),
    logger,
  })
  ctx.effect(
    () => () => { void standalone.then(server => server?.close()) },
    'ppt-canvas: standalone api lifetime',
  )
  standalone.then((server) => {
    if (server !== null) logger.info?.(`${tag} standalone channel ready: ${server.url}/api/selftest`)
    else logger.warn?.(`${tag} standalone channel is unavailable: only the host route remains`)
  }, (error) => {
    logger.warn?.(`${tag} standalone api failed to start: ${error?.message ?? error}`)
  })

  // 宿主路由作为**附加**通道注册（有就多一条路，没有也不影响主通道）。
  ctx.effect(
    () => registerRoutes({ webServer, connection }, store, bus, logger),
    'ppt-canvas: /dsh-ppt routes',
  )

  // 工具注册：每一步的结果都记进 health，并通过 GET /dsh-ppt/api/requests 暴露出来。
  // 为什么需要它：工具有没有真的进宿主注册表，从外部**看不出来** ——
  // `Tool.listTools` 只返回「当前 Agent 可见」的工具，dev 工具链也未必递归进插件。
  // 与其猜，不如让插件自己把装配结果报出来。
  const tools = ctx.get('tools')
  const health = {
    name,
    inject,
    services: {
      webServer: webServer !== undefined,
      connection: connection !== undefined,
      tools: tools !== undefined,
    },
    toolRegistration: 'pending',
    registeredTools: [],
    toolError: null,
  }

  if (tools === undefined) {
    health.toolRegistration = 'service-missing'
    logger.warn?.(`${tag} tools service is unavailable: the AI cannot apply canvas edits`)
  } else {
    // 逐个注册：某一个工具注册失败（重名、schema 不合法）不该把其余三个一起丢掉，
    // 也要能说清是哪一个失败。之前整批注册，结果 health 只报一句 'failed'。
    const names = []
    const disposers = []
    const definitions = []
    try {
      registerTools({
        register(definition) {
          definitions.push(definition)
          return () => {}
        },
      }, store, bus, logger)
    } catch (error) {
      health.toolError = `构建工具定义失败：${error instanceof Error ? error.message : String(error)}`
    }

    for (const definition of definitions) {
      try {
        disposers.push(tools.register(definition))
        names.push(definition.name)
      } catch (error) {
        const message = `${definition.name}: ${error instanceof Error ? error.message : String(error)}`
        health.toolError = health.toolError === null ? message : `${health.toolError}；${message}`
        logger.warn?.(`${tag} tool ${message}`)
      }
    }

    health.registeredTools = names
    health.toolRegistration = names.length === 0
      ? 'failed'
      : (names.length === definitions.length ? 'ok' : 'partial')
    ctx.effect(() => () => { for (const dispose of disposers) { try { dispose() } catch { /* 忽略 */ } } }, 'ppt-canvas: model tools')
    logger.info?.(`${tag} registered ${names.length}/${definitions.length} tools`)
  }

  // 让诊断端点能看到 health（api.js 从 bus 上读，避免多传一个参数）。
  bus.health = health

  logger.info?.(`${tag} mounted: api at /dsh-ppt`)
}

export { DeckStore }
