// dsh-ppt-canvas — 独立 loopback API 服务
//
// 为什么需要它：在主宿主里 `webServer.register` 这条路我无法验证（服务目录里确实有
// webServer、也确认了签名，但路由始终没生效，而宿主日志我读不到）。这里换成插件
// **自己起一个 node:http 服务**，好处是：
//   - 完全在插件控制内，不依赖宿主路由表的任何行为；
//   - 端口固定，客户端可以硬编码访问；被占用时自动向后找，并把实际端口写进状态文件；
//   - 起不来时日志会直说原因，而不是静默失败。
//
// 只监听 127.0.0.1（与主宿主同一个 loopback 约束），并复用与主路由相同的 handler。

import { createServer } from 'node:http'

/** 首选端口；被占用则依次尝试到 PORTS 的末尾。 */
const PORTS = [19488, 19489, 19490, 19491, 19492]
const HOST = '127.0.0.1'

/**
 * 启动独立 API 服务。
 *
 * @param {object} options
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => unknown} options.handle 与主路由共享的 handler
 * @param {object} [options.logger]
 * @param {number[]} [options.ports]
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> } | null>} 起不来时返回 null（不抛）
 */
export async function startStandaloneApi({ handle, logger, ports = PORTS }) {
  for (const port of ports) {
    const attempt = await listenOn(port, handle, logger)
    if (attempt !== null) {
      logger?.info?.(`[dsh-ppt-canvas] standalone api listening on http://${HOST}:${port}/dsh-ppt`)
      return attempt
    }
  }
  logger?.warn?.(`[dsh-ppt-canvas] standalone api could not bind any port in ${ports.join(', ')}`
    + ' — the canvas UI will rely on the host webServer route only')
  return null
}

/** 在单个端口上尝试监听；EADDRINUSE 之外的错误也一并降级为「换下一个端口」。 */
function listenOn(port, handle, logger) {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      Promise.resolve()
        .then(() => handle(req, res))
        .catch((error) => {
          // handler 自身已有兜底；这里只防止未捕获异常掀翻进程。
          logger?.warn?.(`[dsh-ppt-canvas] standalone api handler error: ${error?.message ?? error}`)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: { code: 'internal', message: String(error?.message ?? error) } }))
          } else {
            try { res.end() } catch { /* 已断开 */ }
          }
        })
    })
    server.on('error', (error) => {
      if (error?.code !== 'EADDRINUSE') {
        logger?.warn?.(`[dsh-ppt-canvas] standalone api cannot bind ${HOST}:${port}: ${error?.code ?? ''} ${error?.message ?? error}`)
      }
      resolve(null)
    })
    server.listen(port, HOST, () => {
      resolve({
        port,
        url: `http://${HOST}:${port}/dsh-ppt`,
        close: () => new Promise(done => {
          server.closeAllConnections?.()
          server.close(() => done())
        }),
      })
    })  })
}

export { PORTS, HOST }
