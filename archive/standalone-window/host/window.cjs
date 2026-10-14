/**
 * PPT 独立窗口 — Electron 主进程脚本
 *
 * 由 host/window-launcher.js 用 Electron 二进制 spawn 起来，加载
 * /dsh-ppt/window（本插件自己服务的独立画布页）。
 *
 * 为什么用 CommonJS：Electron 在 Windows 上对 ESM 主脚本支持不稳（启动即 exit -1），
 * .cjs 是稳的（同类桌面窗插件同样这么选）。
 *
 * 配置一律走环境变量：给 Windows 上的 Electron 传额外 CLI 参数会以 exit -1 崩溃。
 *
 * 窗口特性：
 *  - 无系统标题栏（frameless）+ 自绘工具条（-webkit-app-region: drag 拖动）
 *  - 可自由拖动 / 缩放；位置与尺寸变化上报给宿主持久化
 *  - 记住上次位置，换屏后按当前工作区 clamp 回来，不会开出屏幕外
 *  - 只允许停留在自身 origin 内，外链一律交给系统浏览器
 *  - 跟随宿主进程：宿主退出就自己退出，不留孤儿进程
 */

/**
 * 取 Electron 内建 API。
 *
 * 为什么不能直接 `require('electron')`：Electron 只在**官方包装包**被解析到时才把
 * 内建 API 交出来（靠模块名拦截）。而被 vendor 的运行时通常只有裸 electron.exe，
 * 没有 node_modules/electron —— 此时 `require('electron')` 直接 MODULE_NOT_FOUND，
 * Electron 随即异常退出（Windows 上 exit 0x80000003），窗口永远不出现。
 *
 * 两条路：
 *   1. 启动器解析到真正的包装包时，会把它的绝对路径放进 DSH_PPT_ELECTRON_MODULE，
 *      这里按路径加载 —— 不经过模块名解析，因此不会有递归问题；
 *   2. 没有该环境变量时退回 `require('electron')`（官方安装、或运行时自己提供时可用）。
 *
 * 自检：拿不到 app 就明确报错，而不是让后面以「undefined.commandLine」这种
 * 难懂的方式失败。
 */
function loadElectronApi() {
  // 先判「是不是真的以 Electron 模式在跑」。
  // 如果运行时被 ELECTRON_RUN_AS_NODE 带进了纯 Node 模式，进程里就没有内建 API，
  // require('electron') 只会给一个难懂的 MODULE_NOT_FOUND；这里把原因直接说出来。
  if (typeof process.versions.electron !== 'string') {
    throw new Error(
      'dsh-ppt-window: this process is running as plain Node, not Electron '
      + '(process.versions.electron is missing). '
      + 'ELECTRON_RUN_AS_NODE must be absent from the child environment — note that an empty '
      + 'string still counts as set; the key has to be deleted.',
    )
  }

  const explicit = process.env.DSH_PPT_ELECTRON_MODULE
  if (typeof explicit === 'string' && explicit !== '') {
    const api = require(explicit)
    if (api === null || typeof api !== 'object' || api.app === undefined) {
      throw new Error(`dsh-ppt-window: ${explicit} did not provide the Electron API`)
    }
    return api
  }
  return require('electron')
}

const { app, BrowserWindow, ipcMain, screen, session, shell } = loadElectronApi()
const path = require('node:path')
const { clampToWorkArea, centeredBounds, parsePosition } = require('./window-geometry.cjs')

process.noDeprecation = true

const url = process.env.DSH_PPT_WINDOW_URL
const parentPid = Number(process.env.DSH_PPT_PARENT_PID || 0)
const headerName = process.env.DSH_PPT_RENDERER_HEADER_NAME
const headerValue = process.env.DSH_PPT_RENDERER_HEADER_VALUE
const userDataDir = process.env.DSH_PPT_USER_DATA

if (!url) {
  console.error('dsh-ppt-window: missing DSH_PPT_WINDOW_URL')
  app.exit(1)
}

// 独立的 userData：与宿主 Electron 共享默认 profile 会争用磁盘缓存并服务陈旧响应。
if (userDataDir) {
  try { app.setPath('userData', userDataDir) } catch (error) {
    console.error(`dsh-ppt-window: cannot use ${userDataDir}: ${String(error)}`)
  }
}

const isMac = process.platform === 'darwin'
// 该运行时在部分 100% 缩放机器上把 scaleFactor 误报为非 1，导致窗口每次定位按比例
// 膨胀、拖动坐标漂移；把缩放钉在 1 让所有 bounds 换算无损（macOS 走原生逻辑点，不钉）。
if (!isMac) app.commandLine.appendSwitch('force-device-scale-factor', '1')

const DEFAULT_WIDTH = Number(process.env.DSH_PPT_WINDOW_WIDTH || 1180)
const DEFAULT_HEIGHT = Number(process.env.DSH_PPT_WINDOW_HEIGHT || 760)
const MIN_WIDTH = 720
const MIN_HEIGHT = 480

/** 读取持久化坐标（仅两个都有效时才用）。 */
function readPos() {
  return parsePosition(process.env.DSH_PPT_WINDOW_X, process.env.DSH_PPT_WINDOW_Y)
}

/** 尽力而为地释放 userData 目录的占用标记。 */
function releaseLock() {
  if (!userDataDir) return
  try { require('node:fs').rmSync(require('node:path').join(userDataDir, 'dsh-ppt-window.lock'), { force: true }) } catch { /* ignore */ }
}

let win = null
let reporting = false

app.whenReady().then(() => {
  // DSH Desktop 宿主给 WebServer 所有路由套了 desktopBrowserAccess 准入：只有带渲染进程
  // 专属头的请求被当自家渲染进程放行，其余按普通浏览器处理（未开「浏览器访问」时 403）。
  // 本窗口是独立 Electron 进程，宿主只给自家渲染进程注入，所以这里自己在 session 上补头；
  // 头名/值由宿主上下文经 env 传入，未提供时不装（普通 web 宿主没有这层准入）。
  let origin = ''
  try { origin = new URL(url).origin } catch { /* url 已在前置校验通过 */ }
  if (headerName && headerValue && origin) {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      const headers = { ...details.requestHeaders }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === headerName.toLowerCase()) delete headers[key]
      }
      try {
        if (new URL(details.url).origin === origin) headers[headerName] = headerValue
      } catch { /* 非法 URL 不注入 */ }
      callback({ requestHeaders: headers })
    })
  }

  const persisted = readPos()
  const displays = screen.getAllDisplays()
  const primaryArea = screen.getPrimaryDisplay().workArea
  // 有历史坐标就用它（换屏/改分辨率后按当前工作区收回来）；没有就居中。
  const bounds = persisted === null
    ? centeredBounds(primaryArea, DEFAULT_WIDTH, DEFAULT_HEIGHT)
    : clampToWorkArea(
        { x: persisted.x, y: persisted.y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
        displays,
        { width: MIN_WIDTH, height: MIN_HEIGHT },
      )

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#111418',
    title: 'PPT 协同编辑画布',
    autoHideMenuBar: true,
    // 无系统标题栏：内容自己提供拖动条（-webkit-app-region: drag）。
    frame: false,
    webPreferences: {
      // 独立窗口只加载本插件自己的页面，不需要 node 能力。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      // 唯一暴露给页面的能力：置顶 / 最小化 / 最大化 / 关闭。
      preload: path.join(__dirname, 'window-preload.cjs'),
    },
  })

  win.once('ready-to-show', () => win.show())

  // 站在自身 origin 内；外链一律交给系统浏览器，不在应用窗口里导航。
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      if (new URL(target).origin !== origin) shell.openExternal(target)
    } catch { /* 非法 URL 直接忽略 */ }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== origin) {
        event.preventDefault()
        shell.openExternal(target)
      }
    } catch {
      event.preventDefault()
    }
  })

  const report = () => {
    if (reporting || win === null || win.isDestroyed()) return
    reporting = true
    try {
      const [x, y] = win.getPosition()
      const [width, height] = win.getSize()
      process.stdout.write(`${JSON.stringify({ type: 'bounds', x, y, width, height })}\n`)
    } catch { /* 窗口正在销毁 */ } finally {
      reporting = false
    }
  }
  const reportSoon = (() => {
    let timer = null
    return () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(report, 400)
    }
  })()
  win.on('move', reportSoon)
  win.on('resize', reportSoon)
  win.on('closed', () => { win = null; app.quit() })

  // 渲染层通过 window.dshPptWindow 调用这些。
  ipcMain.handle('dsh-ppt:window-action', (_event, action) => {
    if (win === null || win.isDestroyed()) return false
    if (action === 'minimize') { win.minimize(); return true }
    if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return win.isMaximized()
    }
    if (action === 'close') { win.close(); return true }
    if (action === 'always-on-top') {
      const next = !win.isAlwaysOnTop()
      win.setAlwaysOnTop(next)
      return next
    }
    return false
  })
  ipcMain.handle('dsh-ppt:window-state', () => ({
    maximized: win !== null && !win.isDestroyed() ? win.isMaximized() : false,
    alwaysOnTop: win !== null && !win.isDestroyed() ? win.isAlwaysOnTop() : false,
  }))

  win.loadURL(url).catch((error) => {
    console.error(`dsh-ppt-window: cannot load ${url}: ${String(error)}`)
  })

  // 跟随宿主：宿主进程消失就退出（kill(pid,0) 的 EPERM 表示进程还在，只是没权限发信号）。
  if (parentPid > 0) {
    const timer = setInterval(() => {
      try {
        process.kill(parentPid, 0)
      } catch (error) {
        if (error && error.code !== 'EPERM') {
          clearInterval(timer)
          app.quit()
        }
      }
    }, 4000)
    if (typeof timer.unref === 'function') timer.unref()
    app.on('before-quit', () => clearInterval(timer))
  }

  app.on('before-quit', releaseLock)
  app.on('window-all-closed', () => app.quit())
})

process.on('uncaughtException', (error) => {
  console.error(`dsh-ppt-window: uncaught ${error && error.stack ? error.stack : String(error)}`)
})
