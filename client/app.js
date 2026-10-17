/* dsh-ppt-canvas — 界面层（PPT 协同编辑画布面板）
 *
 * 这个文件里没有任何 DSH 专有 API：所有宿主能力都从 options 注入，因此同一份逻辑
 * 既能作为「对话里的浮层面板」运行（plugin/client.js 包一层 DSH 插件外壳），
 * 也能作为「独立桌面窗口」运行（host/window-*.js 用 Electron 打开 /dsh-ppt/window，
 * 页面里直接用 <script> 加载本文件）。
 *
 * 构造时注入：
 *   React           React 运行时
 *   document/window 浏览器全局
 *   apiBase         Host HTTP API 前缀（默认 '/dsh-ppt/api'）
 *   binding         { sessionId } | null   —— 有会话时面板可以发指令给 AI
 *   prompt(text)    可选：把指令发给 AI（窗口模式下没有，指令栏会禁用并提示）
 *   interval/timeout 宿主定时器（DSH 用 ctx.interval/ctx.timeout 以便随插件卸载清理）
 *   pickPath()      可选：原生文件选择，返回绝对路径
 *   styles          注入的 CSS 文本
 *   storageKey      localStorage 键（面板与窗口各自独立）
 */

/**
 * 用户是不是在说「做 / 改 PPT」。
 *
 * 只在明确提到演示文稿时提示一次，避免把随口聊到的 slide/deck 都算上。
 */
const LOOKS_LIKE_PPT_REQUEST = /\bpptx?\b|powerpoint|演示文稿|幻灯片|投影片|\bslides?\b|\bdeck\b|presentation/i

/** 插件自己发出的指令带这个前缀 —— 那不是用户意图，别拿它来提示。 */
const SELF_PPT_INSTRUCTION = /【PPT 协同编辑】/

/**
 * @param {object} options 见文件头
 * @returns {{React: object, Component: Function, createStore: Function, initialState: Function,
 *            install: Function, savePrefs: Function, extractDroppedPath: Function}}
 */
function createPptApp(options) {
  const React = options.React
  const doc = options.document ?? globalThis.document
  const win = options.window ?? globalThis.window
  const h = React.createElement
  const API = options.apiBase ?? '/dsh-ppt/api'
  // 只支持面板模式（独立窗口模式已随功能移除）
  const STORAGE_KEY = options.storageKey ?? 'dsh_ppt_canvas_v1'
  const STYLE_TAG_ID = options.styleTagId ?? 'dsh-ppt-canvas-style'
  // 会话：`promptTo(text, sessionId)` 由 client.js 提供（内部走 sessions.retain +
  // binding.session.prompt），`sessionId` 由 client.js 在渲染时用 slot 的 hook 解析后传入。
  const promptTo = typeof options.promptTo === 'function' ? options.promptTo : null
  const sessionDiagnostics = typeof options.sessionDiagnostics === 'function' ? options.sessionDiagnostics : null
  // 连接会话：没有可用的建会话入口（实测），所以是「从真实列表里选一个」。
  const selectSession = typeof options.selectSession === 'function' ? options.selectSession : null
  const listSessionIds = typeof options.listSessionIds === 'function' ? options.listSessionIds : null
  // 把连接的会话归入工作区，让它在左侧列表里和普通对话一样出现。
  const attachToWorkspace = typeof options.attachToWorkspace === 'function' ? options.attachToWorkspace : null
  // 对话转播：订阅已连接会话的事件流，把消息按普通对话形式显示（client.js 里实现）。
  const watchAi = typeof options.watchAi === 'function' ? options.watchAi : null
  const aiSnapshot = typeof options.aiSnapshot === 'function' ? options.aiSnapshot : null
  /** 已连接的会话 id（面板状态，存 localStorage 持久化）。 */
  const sessionIdRef = { current: undefined }

  async function ensureInWorkspace(sessionId) {
    if (attachToWorkspace === null) return
    const workspaceId = typeof sessionIdRef.workspaceId === 'string' ? sessionIdRef.workspaceId : undefined
    try {
      await attachToWorkspace(sessionId, workspaceId)
    } catch { /* 归入失败只影响列表显示 */ }
  }

  /**
   * 新建会话并连接。
   *
   * 优先用宿主返回的 id；宿主只说「已请求新建」而不给 id 时，轮询 slot 的会话列表
   * 找出新出现的那个（返回的 id 才是最可靠的路）。
   *
   * @param {(id: string) => void} onConnected 连上后回调（用来同步 store / 持久化）
   * @returns {Promise<{ ok: boolean, sessionId?: string, message?: string }>}
   */
  async function connectNewSession() {
    if (selectSession === null) return { ok: false, message: '宿主没有提供会话来源。' }
    // selectSession() 是同步的：宿主只会在「真实会话列表」里挑一个返回 id，
    // 不会「先说要新建、稍后才给 id」。所以不需要轮询等新 id（那段是死代码，已删）。
    const created = selectSession()
    if (created === null || created.ok !== true) {
      return { ok: false, message: created?.error?.message ?? '未知原因' }
    }
    const picked = typeof created.sessionId === 'string' ? created.sessionId : ''
    if (picked === '') {
      return { ok: false, message: '宿主没有返回会话 id' }
    }
    sessionIdRef.current = picked
    return { ok: true, sessionId: picked }
  }
  const pickPath = typeof options.pickPath === 'function' ? options.pickPath : null
  // 系统原生的「打开文件」对话框（`<input type="file">`）。普通应用那种打开方式。
  const pickPptx = typeof options.pickPptx === 'function' ? options.pickPptx : null
  // 目录浏览：宿主**没有**选文件的对话框（pickDirectory 只给目录），
  // 所以面板自己列目录、只把 .pptx 作为可打开项。
  const listDirectory = typeof options.listDirectory === 'function' ? options.listDirectory : null
  
  const timeout = typeof options.timeout === 'function'
    ? options.timeout
    : (fn, ms) => { const handle = setTimeout(fn, ms); return () => clearTimeout(handle) }

  // ------------------------------------------------------------------ 工具

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
  const px = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0)

  function loadPrefs() {
    try {
      const raw = win.localStorage.getItem(STORAGE_KEY)
      if (raw === null) return {}
      const parsed = JSON.parse(raw)
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  const prefs = loadPrefs()

  function savePrefs(patch) {
    Object.assign(prefs, patch)
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch (error) { /* 隐私模式忽略 */ }
  }

  /**
   * Host API 的两条通道。
   *
   * 1. `API`（同源 `/dsh-ppt/api`）：正常情况下的路。
   * 2. `STANDALONE`（插件自己起的 loopback 服务）：宿主路由表没生效时的兜底。
   *    插件在 19488 起服务（被占用则向后顺延），并在挂载日志里打印实际地址。
   * 首次失败后记住可用的那条，避免每次请求都白试一遍。
   */
  const STANDALONE = options.standaloneBase ?? 'http://127.0.0.1:19488/dsh-ppt/api'
  let channelChoice = prefs.channel === 'standalone' ? 'standalone' : 'host'
  const channels = () => (channelChoice === 'standalone' ? [STANDALONE, API] : [API, STANDALONE])

  function apiError(code, message, details) {
    const error = new Error(message)
    error.code = code
    error.details = details
    return error
  }

  /** 单条通道的一次请求；非 JSON 响应、网络错误、`ok:false` 都抛 ApiError。 */
  async function callOnce(base, path, body) {
    const init = body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    const url = `${base}/${path}`
    let response
    try {
      response = await win.fetch(url, init)
    } catch (error) {
      throw apiError('network', `无法连接 Host（${url}：${error.message}）`)
    }
    // 先读文本再解析：失败时要把真实响应体写进错误里。
    // 只报「HTTP 405」等于什么都没说 —— 分不清是插件的 JSON 错误、DSH 的鉴权层，
    // 还是 SPA 兜底页。带上 content-type 与前 200 个字符就能一眼定位。
    let text = ''
    try { text = await response.text() } catch (error) { text = `<无法读取响应体：${error.message}>` }
    const contentType = response.headers?.get?.('content-type') ?? '(none)'
    let payload = null
    if (text !== '') {
      try { payload = JSON.parse(text) } catch (error) { payload = null }
    }
    if (payload === null || typeof payload !== 'object') {
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text)
      const hint = looksLikeHtml
        ? '（这是 DSH 前端的页面，说明请求没走到插件路由）'
        : (text === '' ? '（响应体为空）' : '')
      throw apiError(
        'badResponse',
        `${init.method} ${url} → HTTP ${response.status} ${hint}`
        + ` · content-type=${contentType} · body=${text.slice(0, 200)}`,
      )
    }
    if (payload.ok !== true) {
      const failure = payload.error ?? {}
      throw apiError(failure.code ?? 'internal', failure.message ?? '未知错误', failure.details)
    }
    return payload.value
  }

  /** 走可用通道；换通道成功后就记住它。 */
  async function callApi(path, body) {
    const order = channels()
    let firstFailure = null
    for (const base of order) {
      try {
        const value = await callOnce(base, path, body)
        const picked = base === STANDALONE ? 'standalone' : 'host'
        if (picked !== channelChoice) { channelChoice = picked; savePrefs({ channel: picked }) }
        return value
      } catch (error) {
        if (firstFailure === null) firstFailure = error
        // 只有「没连上 / 不是插件响应」才值得换通道；插件明确返回的业务错误要原样抛出。
        if (error.code !== 'network' && error.code !== 'badResponse') throw error
      }
    }
    throw firstFailure ?? apiError('network', '没有可用的 Host 通道')
  }

  /**
   * 通道候选列表（媒体 URL 要分别拼到它们上面）。
   * 与 callApi 的择一顺序一致：先用当前选中的，再用另一条。
   */
  function channelCandidates() {
    return channelChoice === 'standalone' ? [STANDALONE, API] : [API, STANDALONE]
  }

  /**
   * 精确渲染的图片地址（走当前优先通道）。
   *
   * 与媒体图不同，这里**不**做双通道兜底：渲染是先请求、失败再退回 DOM 重画
   * （见 CanvasPane 的 onError），比换地址更直接、也更快给出可用画面。
   */
  /**
   * render 的会话令牌（由 /api/status 下发）。
   *
   * render 是 GET 且有重副作用（起 LibreOffice），跨站 `<img>` 就能触发；
   * 令牌只能通过受 CORS 保护的响应拿到，所以跨站页面拿不到。
   * 拿不到令牌时先不带 —— 服务端会 403，画布按 onError 退回内置重画。
   */
  let renderTokenValue = ''

  function renderUrl({ page, width, rev }) {
    const base = channelChoice === 'standalone' ? STANDALONE : API
    const query = `page=${page}&w=${width}&rev=${rev}${renderTokenValue === '' ? '' : `&t=${encodeURIComponent(renderTokenValue)}`}`
    return `${base}/render?${query}`
  }

  const ERROR_HINT = {
    noDeck: '还没有打开演示文稿',
    notFound: '找不到文件或对象',
    validationFailed: 'AI 给的修改方案没通过校验',
    staleRev: '文档在指令发出后被改动过，请重新发送',
    staleFile: '文件已被其他程序（如 PowerPoint）保存过，为免覆盖已中止写入；已自动重载，请重试',
    ioFailed: '文件读写失败（可能被 PowerPoint 占用）',
    nothingToUndo: '没有可撤销的步骤',
    nothingToRedo: '没有可重做的步骤',
    network: '连不上 Host 插件接口',
  }

  function describeError(error) {
    const hint = ERROR_HINT[error.code]
    return hint === undefined ? error.message : `${hint}：${error.message}`
  }

  // ---------------------------------------------------------------- 拖拽打开

  /**
   * 从 HTML5 拖放事件里取被拖入文件的绝对路径。
   *
   * 浏览器出于隐私不会把本地路径交给网页；只有 Electron 渲染进程会把路径挂在
   * File.path 上（Electron 容器里拖入本地文件就是这种情况）。所以这里两条路都试：
   *   1) File.path（Electron）
   *   2) dataTransfer 里的 file:// URI（少数环境会带）
   * 都拿不到时返回 null，由调用方给出「请手动填写路径」的提示。
   *
   * @param {DragEvent} event
   * @returns {{path: string, name: string, from: string} | null}
   */
  function extractDroppedPath(event) {
    const transfer = event?.dataTransfer
    if (transfer === null || transfer === undefined) return null

    const files = transfer.files
    let name = ''
    if (files !== null && files !== undefined && files.length > 0) {
      const file = files[0]
      name = file.name ?? ''
      // Electron 的 File 对象带绝对路径（标准浏览器里是 undefined）。
      if (typeof file.path === 'string' && file.path !== '') {
        return { path: file.path, name, from: 'file.path' }
      }
    }

    const looksLikePath = (value) => {
      if (typeof value !== 'string' || value === '') return null
      const text = value.trim().split(/\r?\n/)[0].trim()
      if (text === '') return null
      if (/^file:\/\//i.test(text)) {
        try {
          const url = new URL(text)
          // Windows 下 pathname 是 /D:/dir/file.pptx，去掉前导斜杠。
          let path = decodeURIComponent(url.pathname)
          if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1)
          return path
        } catch {
          return null
        }
      }
      // Windows 绝对路径（拖拽时很多环境会以 text/plain 给出）
      if (/^[a-zA-Z]:[\\/]/.test(text)) return text
      // UNC 路径
      if (/^\\\\[^\\]+\\/.test(text)) return text
      return null
    }

    for (const type of ['text/uri-list', 'text/plain', 'application/x-moz-file']) {
      let raw = null
      try { raw = transfer.getData(type) } catch { raw = null }
      const path = looksLikePath(raw)
      if (path !== null) return { path, name, from: type }
    }
    return null
  }

  function looksLikePptx(path) {
    return typeof path === 'string' && /\.pptx$/i.test(path.trim())
  }

  // ------------------------------------------------------------------ 微 store

  function createStore(initial) {
    let state = initial
    const listeners = new Set()
    return {
      get: () => state,
      set(patch) {
        const next = typeof patch === 'function' ? patch(state) : patch
        let changed = false
        for (const key of Object.keys(next)) {
          if (state[key] !== next[key]) { changed = true; break }
        }
        if (!changed) return
        state = { ...state, ...next }
        for (const fn of [...listeners]) {
          try { fn() } catch (error) { /* 单个订阅者出错不影响其他 */ }
        }
      },
      subscribe(fn) {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    }
  }

  function useStore(store) {
    const [, tick] = React.useState(0)
    React.useEffect(() => store.subscribe(() => tick((n) => n + 1)), [store])
    return store.get()
  }

  function initialState() {
    return {
      // **启动时一律最小化**（只留一个入口按钮）。
      // 以前读 prefs.open，而打开文稿时会自动把它写成 true —— 于是每次启动画布都
      // 直接展开挡住界面。现在展开只能是用户主动点按钮，且不跨会话记忆。
      open: false,
      sessionId: typeof prefs.sessionId === 'string' ? prefs.sessionId : '',
      sessionMenuOpen: false,
      connectedSession: false,
      // AI 面板默认折叠（画布优先）；用户展开后记住选择。
      aiCollapsed: prefs.aiCollapsed !== false,
      // 画布画法：'fitted' = LibreOffice 精确渲染（默认）；'dom' = 内置 DOM 近似重画。
      renderMode: prefs.renderMode === 'dom' ? 'dom' : 'fitted',
      // AI 思考/回复（由 client.js 的 watchAi 推送写入）
      ai: { thinking: '', reply: '', error: null },
      deck: null,
      loading: false,
      loadingLabel: '',
      error: null,
      slideIndex: typeof prefs.slideIndex === 'number' ? prefs.slideIndex : 0,
      selectedIds: [],
      hoverId: null,
      zoom: typeof prefs.zoom === 'number' ? prefs.zoom : 1,
      marquee: null,
      // 正在就地编辑文字的形状 id（null = 没有在编辑）；editCaret = 打开编辑时的
      // 点击点（幻灯片坐标），用于把光标放到用户点的行上（原生 PPT 手感）。
      editingId: null,
      editCaret: null,
      // 已就「磁盘文件被外部改过」提示过用户一次（避免每次轮询都弹）
      externalChangeWarned: false,
      // 「看起来你在做 PPT，要打开画布吗」提示：null = 不显示。
      // 由 FloatingPanel 在**最小化状态下**监听会话消息触发，避免打断用户。
      pptPrompt: null,
      instruction: '',
      sending: false,
      pendingRequestId: null,
      drafts: [],
      log: [],
      toasts: [],
      highlights: {},
      showInspector: prefs.showInspector !== false,
      showThumbs: prefs.showThumbs !== false,
      askPath: false,
      pickerPath: '',
      listing: null,
      listingError: null,
      pathDraft: prefs.lastDir ?? '',
      dragDepth: 0,
      dropHint: null,
      history: { rev: 0, canUndo: false, canRedo: false },
      maximized: false,
      // DOM 桥接：提交后立即用 DOM 渲染显示新内容，新 PNG 加载完（onLoad）自动
      // 切回精确渲染 —— 消灭"提交后 1.3 秒看到旧图"的割裂感。
      domBridgeRev: null,
          }
  }

  // ------------------------------------------------------------------ 画布渲染

  /** 一个 Shape → 绝对定位的 DOM 元素（坐标以幻灯片 px 为单位）。 */
  /**
   * 精确渲染模式下，只画**选中/悬停/被 AI 改动**的框，不画内容。
   *
   * 为什么不能继续用 renderShape：精确渲染的 PNG 里已经包含了形状本身
   * （背景色块、表格、文字、母版元素都在里面），再叠一层 DOM 重画就会双重绘制。
   * 所以这里只保留几何，供命中测试与高亮使用。
   */
  function renderShapeOverlay(shape, shapeOptions) {
    const { selected, hovered, highlighted, onPointerDown, onDoubleClick, interactive, ghost } = shapeOptions
    const geometry = shape.geometry
    // 拖动预览：ghost 命中时给这个形状加位移（底图 PNG 松手后才更新）。
    const ghosted = ghost !== null && ghost !== undefined && ghost.ids.indexOf(shape.id) !== -1
    const offsetX = ghosted ? ghost.dx : 0
    const offsetY = ghosted ? ghost.dy : 0
    const style = {
      position: 'absolute',
      left: `${px(geometry.x + offsetX)}px`,
      top: `${px(geometry.y + offsetY)}px`,
      width: `${px(Math.max(0, geometry.w))}px`,
      height: `${px(Math.max(0, geometry.h))}px`,
      zIndex: String(shape.z + 1),
      // 不要在这里写 background：内联样式优先级高于样式表，会把
      // `.is-overlay.is-selected` / `.is-ai-changed` 的底色全部盖掉
      // （表现：选中只有边框、AI 改动的橙色高亮永远看不到）。
      // 透明底由 `.dsh-ppt-el.is-overlay{background:transparent}` 负责。
    }
    if (Number.isFinite(geometry.rotation) && geometry.rotation !== 0) {
      style.transform = `rotate(${px(geometry.rotation)}deg)`
      style.transformOrigin = 'center center'
    }
    const classes = ['dsh-ppt-el', 'is-overlay']
    if (selected) classes.push('is-selected')
    if (hovered && !selected) classes.push('is-hovered')
    if (highlighted) classes.push('is-ai-changed')
    const props = {
      key: shape.id,
      className: classes.join(' '),
      style,
      'data-shape-id': shape.id,
      title: shape.name,
    }
    if (interactive && onPointerDown !== null && onPointerDown !== undefined) {
      props.onPointerDown = (event) => onPointerDown(event, shape)
    }
    if (interactive && onDoubleClick !== null && onDoubleClick !== undefined) {
      props.onDoubleClick = (event) => onDoubleClick(event, shape)
    }
    return h('div', props)
  }

  function renderShape(shape, shapeOptions) {
    const { selected, hovered, highlighted, onPointerDown, interactive } = shapeOptions
    const geometry = shape.geometry
    const style = {
      position: 'absolute',
      left: `${px(geometry.x)}px`,
      top: `${px(geometry.y)}px`,
      width: `${px(Math.max(0, geometry.w))}px`,
      height: `${px(Math.max(0, geometry.h))}px`,
      zIndex: String(shape.z + 1),
    }
    if (Number.isFinite(geometry.rotation) && geometry.rotation !== 0) {
      style.transform = `rotate(${px(geometry.rotation)}deg)`
      style.transformOrigin = 'center center'
    }
    if (geometry.flipH || geometry.flipV) {
      const scaleX = geometry.flipH ? -1 : 1
      const scaleY = geometry.flipV ? -1 : 1
      const rotate = Number.isFinite(geometry.rotation) && geometry.rotation !== 0 ? ` rotate(${px(geometry.rotation)}deg)` : ''
      style.transform = `scale(${scaleX}, ${scaleY})${rotate}`
    }
    const radius = shape.style ? shape.style.cornerRadius : 0
    if (Number.isFinite(radius) && radius > 0) style.borderRadius = `${px(radius)}px`

    const classes = ['dsh-ppt-el', `kind-${shape.kind}`]
    if (selected) classes.push('is-selected')
    if (hovered && !selected) classes.push('is-hovered')
    if (highlighted) classes.push('is-ai-changed')

    const props = {
      key: shape.id,
      className: classes.join(' '),
      style,
      'data-shape-id': shape.id,
      title: `${shape.name}${shape.placeholder !== null && shape.placeholder !== undefined ? `（占位符 ${shape.placeholder.type ?? ''}）` : ''}`,
    }
    if (interactive && onPointerDown !== null && onPointerDown !== undefined) {
      props.onPointerDown = (event) => onPointerDown(event, shape)
    }

    return h('div', props, renderShapeBody(shape))
  }

  /**
   * 媒体 URL 的**候选列表**：把 Host 给的路径分别拼到两条通道上。
   *
   * 为什么不只拼当前通道：`channelChoice` 初值是 'host'，要等第一次 API 调用成功
   * 才会翻成 standalone —— 而图片往往在切通道之前就开始加载了。靠一个可能还没更新的
   * 标志决定图片地址，就会出现「第一批图片全裂」。所以这里给出两个候选，
   * 由 <img> 自己在 onError 时换下一个（见 renderShapeBody）。
   */
  function mediaUrlCandidates(url) {
    if (typeof url !== 'string' || url === '') return []
    if (/^(https?:|data:|blob:)/i.test(url)) return [url]
    const path = url.startsWith('/') ? url : `/${url}`
    const bases = typeof channelCandidates === 'function' ? channelCandidates() : [API, STANDALONE]
    return [...new Set(bases.map(base => {
      const origin = /^https?:\/\//i.test(base) ? base.replace(/\/dsh-ppt\/api\/?$/, '') : ''
      return `${origin}${path}`
    }))]
  }

  function renderShapeBody(shape) {
    const children = []

    if (shape.kind === 'image' && shape.image !== null && shape.image !== undefined) {
      const crop = shape.image.crop ?? { l: 0, t: 0, r: 0, b: 0 }
      const scaleX = Math.max(0.02, 1 - crop.l - crop.r)
      const scaleY = Math.max(0.02, 1 - crop.t - crop.b)
      const inner = {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${px(100 / scaleX)}%`,
        height: `${px(100 / scaleY)}%`,
        marginLeft: `${px(-100 * crop.l / scaleX)}%`,
        marginTop: `${px(-100 * crop.t / scaleY)}%`,
        objectFit: 'fill',
        userSelect: 'none',
        pointerEvents: 'none',
      }
      const candidates = mediaUrlCandidates(shape.image.url)
      if (candidates.length > 0) {
        // 自愈：先请求首个候选；失败时按 data-rest 队列前进。
        // 注意 src 必须是**单个合法 URL** —— 曾经写成 candidates.join(' ')，那是非法 URL，
        // 导致首个候选永远不被请求（缩略图/内置渲染里的图片全裂）。
        children.push(h('img', {
          key: 'img',
          src: candidates[0],
          'data-rest': candidates.slice(1).join(' '),
          style: inner,
          alt: shape.name,
          draggable: false,
          onError: (event) => {
            const node = event?.currentTarget ?? event?.target
            if (node === null || node === undefined) return
            const queue = String(node.getAttribute('data-rest') ?? '').split(' ').filter(Boolean)
            if (queue.length === 0) return
            node.setAttribute('data-rest', queue.slice(1).join(' '))
            node.src = queue[0]
          },
        }))
      }
      const fillColor = shape.style?.fill
      if (fillColor && fillColor.type === 'solid' && /^#[0-9a-fA-F]{6}$/.test(fillColor.color ?? '')) {
        children.unshift(h('div', { key: 'imfill', className: 'dsh-ppt-imfill', style: { background: fillColor.color } }))
      }
      return children
    }

    if (shape.kind === 'line') {
      const { w, h: height } = shape.geometry
      const angle = Math.atan2(height, w) * 180 / Math.PI
      const length = Math.sqrt(w * w + height * height)
      const line = shape.style?.line ?? { color: '#000000', width: 1, dash: 'solid' }
      children.push(h('div', {
        key: 'line',
        className: 'dsh-ppt-line',
        style: {
          position: 'absolute',
          left: '0',
          top: '50%',
          width: `${px(length)}px`,
          height: `${px(Math.max(1, line.width ?? 1))}px`,
          background: line.color ?? '#000000',
          transform: `rotate(${px(angle)}deg)`,
          transformOrigin: '0 50%',
        },
      }))
      return children
    }

    if (shape.kind === 'text') {
      children.push(renderText(shape))
      return children
    }

    if (shape.kind === 'table' && shape.table !== null && shape.table !== undefined) {
      children.push(renderTable(shape))
      return children
    }

    if (shape.kind === 'chart') {
      children.push(h('div', { key: 'chart', className: 'dsh-ppt-chartbadge' }, '图表'))
      return children
    }

    if (shape.kind === 'group') {
      const count = Array.isArray(shape.children) ? shape.children.length : 0
      children.push(h('div', { key: 'group', className: 'dsh-ppt-groupbadge' }, `组合 · ${count}`))
      return children
    }

    return children
  }

  function fillStyle(style) {
    const fill = style?.fill
    if (fill === null || fill === undefined) return null
    if (fill.type === 'solid' && /^#[0-9a-fA-F]{6}$/.test(fill.color ?? '')) return fill.color
    if (fill.type === 'none') return 'transparent'
    if (fill.type === 'gradient' && fill.gradient !== null && fill.gradient !== undefined) {
      const stops = (fill.gradient.stops ?? [])
        .filter(stop => /^#[0-9a-fA-F]{6}$/.test(stop.color ?? ''))
        .map(stop => `${stop.color} ${px(clamp(stop.pos ?? 0, 0, 1) * 100)}%`)
      if (stops.length >= 2) {
        const angle = Number.isFinite(fill.gradient.angle) ? fill.gradient.angle : 90
        return `linear-gradient(${px(angle)}deg, ${stops.join(', ')})`
      }
      if (stops.length === 1) return stops[0].split(' ')[0]
    }
    return null
  }

  function borderStyle(style) {
    const line = style?.line
    if (line === null || line === undefined) return null
    const width = Math.max(0.5, Number.isFinite(line.width) ? line.width : 1)
    const color = /^#[0-9a-fA-F]{6}$/.test(line.color ?? '') ? line.color : 'rgba(128,128,128,.6)'
    const dash = line.dash === 'dash' || line.dash === 'sysDash' || line.dash === 'lgDash' ? 'dashed'
      : line.dash === 'dot' || line.dash === 'sysDot' ? 'dotted'
        : 'solid'
    return `${px(width)}px ${dash} ${color}`
  }

  function alignToCss(align) {
    const value = align ?? ''
    if (value === 'ctr' || value === 'center') return 'center'
    if (value === 'r' || value === 'right') return 'right'
    if (value === 'just' || value === 'justify' || value === 'dist') return 'justify'
    return 'left'
  }

  /**
   * 整框的「主样式」：跨段落统计出现最多的字号与颜色。
   * 编辑器是单字体 textarea，无法逐段显示不同字号 —— 用主字号让它与底图
   * 的观感一致；也避免首行是空段（无字号）时整框退化成 18px 默认值
   * （2026-10-15 用户实测"打两轮字突然变小"）。
   */
  function dominantRunStyle(shape) {
    const paragraphs = shape.text?.paragraphs ?? []
    const sizes = []
    const colors = []
    for (const p of paragraphs) {
      for (const r of (p.runs ?? [])) {
        if (Number.isFinite(r.fontSize) && r.fontSize > 0) sizes.push(r.fontSize)
        if (typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color)) colors.push(r.color.toUpperCase())
      }
    }
    const dominant = (list) => {
      if (list.length === 0) return null
      const counts = new Map()
      let best = null
      let bestCount = 0
      for (const value of list) {
        const count = (counts.get(value) ?? 0) + 1
        counts.set(value, count)
        if (count > bestCount) { best = value; bestCount = count }
      }
      return best
    }
    return { fontSize: dominant(sizes), color: dominant(colors) }
  }

  /**
   * 就地文字编辑器的定位与近似样式。
   *
   * **必须手动乘 zoom**：这个元素渲染在 .dsh-ppt-canvas（未缩放）里，而不是
   * .dsh-ppt-slidewrap（zoom 容器）里 —— Chromium 对表单控件（textarea）的
   * CSS zoom 继承有版本差异（实测 2026-10-15：Chrome 下 textarea 不被 zoom
   * 缩放，编辑器按幻灯片原尺寸错位渲染，用户看到的就是「点了没反应」）。
   * 坐标 × zoom 后，编辑器与覆盖层在任何 Chromium 版本都精确重合。
   * 字体度量仍是近似值（LibreOffice 字体 Web 端未必有），提交后以底图为准。
   */
  function textEditStyle(shape, zoom) {
    const geometry = shape.geometry ?? {}
    const text = shape.text ?? {}
    const insets = text.insets ?? { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 }
    const dominant = dominantRunStyle(shape)
    const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    const fontSizeSlide = text.fontSize ?? dominant.fontSize ?? 18
    const linesCount = String(text.plain ?? '').split('\n').length
    const lineHeight = fontSizeSlide * 1.2
    // 垂直锚点补偿：middle/bottom 锚点的框，文字实际渲染在中/下部，
    // 编辑器若从顶部排会和底图错位 —— 按行数×行高把首行推到对应位置。
    const innerH = Math.max(0, geometry.h - insets.top - insets.bottom)
    const textBlock = linesCount * lineHeight
    let anchorPad = 0
    if (text.anchor === 'middle') anchorPad = Math.max(0, (innerH - textBlock) / 2)
    else if (text.anchor === 'bottom') anchorPad = Math.max(0, innerH - textBlock)
    // 编辑器底色：形状有纯色填充就用它（与底图连续）；否则半透明白盖住旧文字
    const fill = shape.style?.fill?.color
    const background = typeof fill === 'string' && /^#[0-9a-fA-F]{6}$/.test(fill) ? fill : 'rgba(255,255,255,0.92)'
    const style = {
      position: 'absolute',
      left: `${px(geometry.x * z)}px`,
      top: `${px(geometry.y * z)}px`,
      width: `${px(Math.max(0, geometry.w) * z)}px`,
      height: `${px(Math.max(0, geometry.h) * z)}px`,
      boxSizing: 'border-box',
      padding: `${px((insets.top + anchorPad) * z)}px ${px(insets.right * z)}px ${px(insets.bottom * z)}px ${px(insets.left * z)}px`,
      color: text.color ?? dominant.color ?? '#111111',
      fontSize: `${px(fontSizeSlide * z)}px`,
      fontWeight: text.bold === true ? 700 : 400,
      fontStyle: text.italic === true ? 'italic' : 'normal',
      fontFamily: text.fontFamily ?? 'inherit',
      textAlign: alignToCss(text.align),
      lineHeight: 1.2,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      background,
    }
    if (Number.isFinite(geometry.rotation) && geometry.rotation !== 0) {
      style.transform = `rotate(${px(geometry.rotation)}deg)`
      style.transformOrigin = 'center center'
    }
    return style
  }

  function renderText(shape) {
    const text = shape.text ?? {}
    const paragraphs = Array.isArray(text.paragraphs) ? text.paragraphs : []
    // 正文框内边距：PowerPoint 默认 lIns/rIns=9.6px、tIns/bIns=4.8px，
    // 读取端从 a:bodyPr 解析（可被 lIns 等属性覆盖）。缺了它文字位置会偏。
    const insets = text.insets ?? { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 }
    const anchor = text.anchor ?? 'top'
    const container = {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      // 垂直对齐用 justifyContent（把整块文字作为一个整体对齐）：
      // 之前用的是 anchorToFlex + 同样的 justifyContent，语义没错，但配合
      // 固定 lineHeight 1.25 且忽略 lnSpc/内边距，行距与文字位置都是错的。
      padding: `${px(insets.top)}px ${px(insets.right)}px ${px(insets.bottom)}px ${px(insets.left)}px`,
      boxSizing: 'border-box',
      textAlign: alignToCss(text.align),
      color: text.color ?? '#111111',
      fontSize: `${px(text.fontSize ?? 18)}px`,
      fontWeight: text.bold === true ? 700 : 400,
      fontStyle: text.italic === true ? 'italic' : 'normal',
      fontFamily: text.fontFamily ?? 'inherit',
      // 整块文字的默认行距；每段可用自己的 lnSpc 覆盖
      lineHeight: 1.2,
      overflow: 'visible',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }
    if (anchor === 'middle' || anchor === 'ctr') {
      container.justifyContent = 'center'
    } else if (anchor === 'bottom' || anchor === 'b') {
      container.justifyContent = 'flex-end'
    } else {
      container.justifyContent = 'flex-start'
    }

    if (paragraphs.length === 0) {
      return h('div', { key: 'text', className: 'dsh-ppt-text', style: container }, text.plain ?? '')
    }
    return h('div', { key: 'text', className: 'dsh-ppt-text', style: container },
      paragraphs.map((paragraph, index) => {
        const runs = Array.isArray(paragraph.runs) ? paragraph.runs : []
        const pStyle = {
          textAlign: alignToCss(paragraph.align ?? text.align),
          minHeight: '1.2em',
          // 行距：lnSpc 是倍数（如 125% → 1.25）；lnSpcIsPx 时是绝对 px，换算成倍数
          ...(paragraph.lnSpc === null || paragraph.lnSpc === undefined
            ? {}
            : (() => {
                if (paragraph.lnSpcIsPx === true) {
                  const base = paragraph.runs?.[0]?.fontSize ?? text.fontSize ?? 18
                  return { lineHeight: base > 0 ? paragraph.lnSpc / base : 1.2 }
                }
                return { lineHeight: paragraph.lnSpc }
              })()),
          // 段前/段后间距（px）
          ...(paragraph.spaceBefore === null || paragraph.spaceBefore === undefined
            ? {}
            : { marginTop: `${px(paragraph.spaceBefore)}px` }),
          ...(paragraph.spaceAfter === null || paragraph.spaceAfter === undefined
            ? {}
            : { marginBottom: `${px(paragraph.spaceAfter)}px` }),
          // 左缩进
          ...(paragraph.indent === null || paragraph.indent === undefined
            ? {}
            : { marginLeft: `${px(paragraph.indent)}px` }),
        }
        if (runs.length === 0) return h('div', { key: `p${index}`, style: pStyle }, '\u00A0')
        return h('div', { key: `p${index}`, style: pStyle }, runs.map((run, runIndex) => h('span', {
          key: `r${runIndex}`,
          style: {
            color: run.color ?? text.color ?? '#111111',
            fontSize: run.fontSize === null || run.fontSize === undefined ? undefined : `${px(run.fontSize)}px`,
            fontWeight: run.bold === true ? 700 : undefined,
            fontStyle: run.italic === true ? 'italic' : undefined,
            textDecoration: run.underline === true ? 'underline' : undefined,
            fontFamily: run.fontFamily ?? undefined,
          },
        }, run.text ?? '')))
      }),
    )
  }

  function renderTable(shape) {
    const table = shape.table
    const rows = table.rows ?? 0
    const cols = table.cols ?? 0
    if (rows <= 0 || cols <= 0) return h('div', { key: 'table', className: 'dsh-ppt-chartbadge' }, '表格')
    const cells = new Map()
    for (const cell of table.cells ?? []) cells.set(`${cell.r}:${cell.c}`, cell.text ?? '')
    const style = {
      display: 'grid',
      gridTemplateRows: `repeat(${rows}, 1fr)`,
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      width: '100%',
      height: '100%',
      fontSize: '12px',
      lineHeight: 1.3,
      overflow: 'hidden',
    }
    const children = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        children.push(h('div', {
          key: `${r}:${c}`,
          className: r === 0 ? 'dsh-ppt-cell is-head' : 'dsh-ppt-cell',
        }, cells.get(`${r}:${c}`) ?? ''))
      }
    }
    return h('div', { key: 'table', style }, children)
  }

  /** 整页：背景 + 所有元素 + 选中高亮。 */
  function SlideView(props) {
    const { slide, width, height, selection, hoverId, highlights, onPointerDown, onDoubleClick, interactive, marquee, overlayOnly, ghost } = props
    if (slide === null || slide === undefined) return null
    const background = /^#[0-9a-fA-F]{6}$/.test(slide.background ?? '') ? slide.background : '#FFFFFF'
    return h('div', {
      className: `dsh-ppt-slide${overlayOnly === true ? ' is-overlay' : ''}`,
      style: {
        width: `${px(width)}px`,
        height: `${px(height)}px`,
        // 精确渲染时底图已经画了背景，DOM 层要透明，否则会盖住 PNG。
        background: overlayOnly === true ? 'transparent' : background,
      },
    },
      (slide.shapes ?? []).map(shape => (overlayOnly === true ? renderShapeOverlay : renderShape)(shape, {
        selected: selection.indexOf(shape.id) !== -1,
        hovered: hoverId === shape.id,
        highlighted: highlights[shape.id] === true,
        onPointerDown,
        onDoubleClick,
        interactive,
        ghost,
      })),
      marquee === null || marquee === undefined ? null : h('div', {
        className: 'dsh-ppt-marquee',
        style: {
          left: `${px(marquee.x)}px`,
          top: `${px(marquee.y)}px`,
          width: `${px(marquee.w)}px`,
          height: `${px(marquee.h)}px`,
        },
      }),
    )
  }

  function intersects(rect, geometry) {
    if (geometry === null || geometry === undefined) return false
    return !(geometry.x > rect.x + rect.w
      || geometry.x + geometry.w < rect.x
      || geometry.y > rect.y + rect.h
      || geometry.y + geometry.h < rect.y)
  }

  // ------------------------------------------------------------------ 画布交互

  function CanvasPane(props) {
    const { store, state, deck, slide, actions } = props
    const hostRef = React.useRef(null)
    const wrapRef = React.useRef(null)
    const dragRef = React.useRef(null)
    const slideW = deck.slideWidth
    const slideH = deck.slideHeight
    const zoom = state.zoom
    const width = slideW * zoom
    const height = slideH * zoom
    // 拖动移动的手势预览：{ ids: [...], dx, dy }（幻灯片 px）。松手才提交 move op。
    const [ghost, setGhost] = React.useState(null)
    // 就地编辑：textarea 挂载后立刻聚焦（点出光标就打字），并把光标放到用户
    // 点击的那一行 —— 否则光标落在第 0 字符，而文本框常以空行开头，打字就会
    // 进了无样式的空段落（实测"打两轮字突然变小"的另一半根因）。
    // 注意 preventScroll + 滚动复位：Chromium 对「zoom 容器内的元素聚焦」会按
    // **未缩放坐标**做 scroll-into-view，直接把 overflow:auto 的画布容器滚出内容区
    // —— 用户看到的就是「一点组件整个画板就消失」（实测 2026-10-15）。
    const editRef = React.useRef(null)
    React.useEffect(() => {
      if (state.editingId !== null && state.editingId !== undefined && editRef.current !== null) {
        const wrap = wrapRef.current
        const top = wrap?.scrollTop ?? 0
        const left = wrap?.scrollLeft ?? 0
        editRef.current.focus({ preventScroll: true })
        if (wrap !== null && wrap !== undefined) {
          wrap.scrollTop = top
          wrap.scrollLeft = left
        }
        // 光标就近放到点击点上：在**有字的行**里选离点击 Y 最近的一行（空行不可见，
        // 按原始几何映射会把光标放进不可见的空段落），列 ≈ x / 平均字宽。
        const caret = state.editCaret
        const shape = editingShape
        if (caret !== null && caret !== undefined && shape !== null && shape.text !== null && shape.text !== undefined) {
          const geometry = shape.geometry ?? {}
          const text = shape.text ?? {}
          const insets = text.insets ?? { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 }
          const dominant = dominantRunStyle(shape)
          const fontSizeSlide = text.fontSize ?? dominant.fontSize ?? 18
          const lines = String(text.plain ?? '').split('\n')
          const lineHeight = fontSizeSlide * 1.2
          // 与 textEditStyle 相同的锚点补偿，保证光标行计算和编辑器首行对齐
          const innerH = Math.max(0, geometry.h - insets.top - insets.bottom)
          const textBlock = lines.length * lineHeight
          let anchorPad = 0
          if (text.anchor === 'middle') anchorPad = Math.max(0, (innerH - textBlock) / 2)
          else if (text.anchor === 'bottom') anchorPad = Math.max(0, innerH - textBlock)
          const contentTop = geometry.y + insets.top + anchorPad
          const contentLeft = geometry.x + insets.left
          // 行中心离点击 Y 最近的「非空行」；整框全空才落到第 0 行
          let lineIndex = 0
          let bestDistance = Number.POSITIVE_INFINITY
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '') continue
            const center = contentTop + lineHeight * (i + 0.5)
            const distance = Math.abs(center - caret.y)
            if (distance < bestDistance) { bestDistance = distance; lineIndex = i }
          }
          const charWidth = Math.max(4, fontSizeSlide * 0.55)
          const column = clamp(Math.round((caret.x - contentLeft) / charWidth), 0, lines[lineIndex]?.length ?? 0)
          let offset = 0
          for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1
          offset += column
          editRef.current.setSelectionRange(offset, offset)
        }
      }
    }, [state.editingId])
    const editingShape = state.editingId === null || state.editingId === undefined
      ? null
      : (slide.shapes ?? []).find(item => item.id === state.editingId) ?? null

    // 打开新文档时自动适配缩放：画布尺寸可能远大于面板中栏（实测 1835×1024 的文件
    // 在 ~460px 的中栏里直接溢出贴左 —— 溢出内容上 margin:0 auto 不生效）。
    // 只在换文档时跑一次；rev 变化和手动缩放都不触发。
    const fitKey = deck.file
    React.useEffect(() => {
      const wrap = wrapRef.current
      if (wrap === null) return
      const availW = wrap.clientWidth - 36 // .dsh-ppt-canvaswrap 左右 padding 18px
      const availH = wrap.clientHeight - 36
      if (availW <= 0 || availH <= 0 || slideW <= 0 || slideH <= 0) return
      const fit = Math.round(clamp(Math.min(availW / slideW, availH / slideH), 0.05, 1) * 100) / 100
      if (Math.abs(store.get().zoom - fit) > 0.005) {
        store.set({ zoom: fit })
        savePrefs({ zoom: fit })
      }
    }, [fitKey, slideW, slideH, store])

    // 精确渲染：LibreOffice 出的整页 PNG。
    // URL 带上 rev，让文档被改过之后浏览器不会拿旧图（Host 侧也按 mtime 缓存）。
    const renderMode = state.renderMode === 'dom' ? 'dom' : 'fitted'
    const [renderFailed, setRenderFailed] = React.useState(false)
    React.useEffect(() => { setRenderFailed(false) }, [slide.id, deck.rev])
    const slideNumber = deck.slides.indexOf(slide) + 1
    const rendered = renderMode === 'fitted' && typeof renderUrl === 'function'
      ? renderUrl({ page: slideNumber, width: Math.round(Math.max(960, slideW * 2)), rev: deck.rev })
      : null

    // DOM 桥接：刚提交的新 rev 还没有渲染好 PNG（LibreOffice 约 1.3s/页），
    // 期间用 DOM 渲染显示新内容（renderShape 全量画），img 隐藏但仍在后台加载，
    // onLoad 后清桥切回 PNG —— 用户看到的是"提交即生效"而不是旧图滞留。
    const bridging = state.domBridgeRev !== null
      && state.domBridgeRev === deck.rev
      && renderMode === 'fitted'
      && renderFailed !== true
    const clearBridge = React.useCallback(() => {
      if (store.get().domBridgeRev !== null) store.set({ domBridgeRev: null })
    }, [store])

    const localPoint = React.useCallback((event) => {
      const host = hostRef.current
      if (host === null) return { x: 0, y: 0 }
      const rect = host.getBoundingClientRect()
      return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }
    }, [zoom])

    const hitShape = React.useCallback((event) => {
      let node = event.target
      while (node !== null && node !== undefined) {
        if (node.dataset !== undefined && node.dataset.shapeId !== undefined && node.dataset.shapeId !== '') return node.dataset.shapeId
        node = node.parentElement
      }
      return null
    }, [])

    const onShapePointerDown = React.useCallback((event, shape) => {
      if (event.button !== 0) return
      event.stopPropagation()
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const current = store.get().selectedIds
      let next
      if (additive) {
        next = current.indexOf(shape.id) === -1
          ? current.concat([shape.id])
          : current.filter(id => id !== shape.id)
      } else if (current.indexOf(shape.id) !== -1) {
        next = current
      } else {
        next = [shape.id]
      }
      store.set({ selectedIds: next, error: null })

      // 拖动移动：手势期间只动 ghost 预览框，松手把位移作为 move op 一次提交
      // （走 apply → 撤销历史 → 底图按新 rev 重渲染）。多选时整组一起动。
      const dragIds = next.indexOf(shape.id) !== -1 ? next.slice() : [shape.id]
      const start = localPoint(event)
      const threshold = 3 / zoom // 3 屏幕像素换算成幻灯片坐标
      let dragging = false
      const onMove = (moveEvent) => {
        const point = localPoint(moveEvent)
        const dx = point.x - start.x
        const dy = point.y - start.y
        if (!dragging && Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
        dragging = true
        setGhost({ ids: dragIds, dx: Math.round(dx), dy: Math.round(dy) })
      }
      const onUp = (upEvent) => {
        win.removeEventListener('pointermove', onMove)
        win.removeEventListener('pointerup', onUp)
        const point = localPoint(upEvent)
        const dx = Math.round(point.x - start.x)
        const dy = Math.round(point.y - start.y)
        setGhost(null)
        if (!dragging) {
          // 单击（没有拖动）带文字的形状：直接进入就地编辑 —— 点出光标就打字。
          // editCaret 记下点击点，编辑器把光标放到用户点的那一行（而不是第 0 字符）。
          if (!additive && next.length === 1 && next[0] === shape.id && shape.text !== null && shape.text !== undefined) {
            store.set({ editingId: shape.id, editCaret: { x: point.x, y: point.y } })
          }
          return
        }
        if (dx === 0 && dy === 0) return
        if (actions === null || actions === undefined || typeof actions.manual !== 'function') return
        actions.manual(dragIds.map(id => ({ op: 'move', id, dx, dy })), '拖动移动')
      }
      win.addEventListener('pointermove', onMove)
      win.addEventListener('pointerup', onUp)
    }, [store, localPoint, zoom, actions])

    const onCanvasPointerDown = React.useCallback((event) => {
      if (event.button !== 0) return
      const host = hostRef.current
      if (host === null) return
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      const base = additive ? store.get().selectedIds : []
      if (!additive) store.set({ selectedIds: [] })
      const start = localPoint(event)
      dragRef.current = { start, base, moved: false }
      host.setPointerCapture?.(event.pointerId)
      const onMove = (moveEvent) => {
        const drag = dragRef.current
        if (drag === null) return
        const point = localPoint(moveEvent)
        const rect = {
          x: Math.min(drag.start.x, point.x),
          y: Math.min(drag.start.y, point.y),
          w: Math.abs(point.x - drag.start.x),
          h: Math.abs(point.y - drag.start.y),
        }
        if (!drag.moved && rect.w < 3 && rect.h < 3) return
        drag.moved = true
        store.set({ marquee: rect })
      }
      const onUp = (upEvent) => {
        const drag = dragRef.current
        dragRef.current = null
        win.removeEventListener('pointermove', onMove)
        win.removeEventListener('pointerup', onUp)
        store.set({ marquee: null })
        if (drag === null || !drag.moved) return
        const point = localPoint(upEvent)
        const rect = {
          x: Math.min(drag.start.x, point.x),
          y: Math.min(drag.start.y, point.y),
          w: Math.abs(point.x - drag.start.x),
          h: Math.abs(point.y - drag.start.y),
        }
        const hits = (slide.shapes ?? []).filter(shape => intersects(rect, shape.geometry)).map(shape => shape.id)
        const merged = drag.base.concat(hits.filter(id => drag.base.indexOf(id) === -1))
        store.set({ selectedIds: merged })
      }
      win.addEventListener('pointermove', onMove)
      win.addEventListener('pointerup', onUp)
    }, [localPoint, slide, store])

    const onWheel = React.useCallback((event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const next = clamp(store.get().zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.2, 4)
      store.set({ zoom: Math.round(next * 100) / 100 })
      savePrefs({ zoom: Math.round(next * 100) / 100 })
    }, [store])

    const onHover = React.useCallback((event) => {
      const id = hitShape(event)
      if (store.get().hoverId !== id) store.set({ hoverId: id })
    }, [hitShape, store])

    // 双击带文字的形状：进入就地编辑（单击已会进入，这里是兜底）。
    const onShapeDoubleClick = React.useCallback((event, shape) => {
      if (shape.text === null || shape.text === undefined) return
      event.stopPropagation()
      store.set({ selectedIds: [shape.id], editingId: shape.id })
    }, [store])

    return h('div', { className: 'dsh-ppt-canvaswrap', ref: wrapRef, onWheel },
      h('div', { className: 'dsh-ppt-canvasstage', style: { width: `${px(width)}px` } },
        h('div', {
          className: 'dsh-ppt-canvas',
          ref: hostRef,
          style: { width: `${px(width)}px`, height: `${px(height)}px` },
          onPointerDown: onCanvasPointerDown,
          onPointerMove: onHover,
          onPointerLeave: () => store.set({ hoverId: null }),
        },
          h('div', {
            className: 'dsh-ppt-slidewrap',
            // 用 CSS `zoom` 而不是 transform: scale()：
            // transform 只改视觉、**不改布局尺寸**，于是内层仍是未缩放的 1280×720、
            // 外层只有 640×360，内层布局盒子溢出外层，margin:auto 也就无法居中
            // —— 表现就是幻灯片「完整但贴在左上角」。zoom 会同时缩放布局尺寸。
            style: { zoom: String(zoom) },
          },
          // 精确渲染：LibreOffice 出的整页 PNG 作为底图（含母版元素）。
          // 失败或没装 LibreOffice 时 solved=false，自动退回 DOM 重画。
          // 桥接期间隐藏 img（仍在后台加载，onLoad 清桥），DOM 全量渲染顶上。
          rendered !== null && renderMode === 'fitted' && renderFailed !== true
            ? h('img', {
                className: 'dsh-ppt-rendered',
                src: rendered,
                alt: slide.name,
                draggable: false,
                onError: () => { setRenderFailed(true); clearBridge() },
                onLoad: clearBridge,
                // 注意用幻灯片原生尺寸（slideW×slideH），不要乘 zoom —— 本元素在
                // zoom 容器内，CSS zoom 会再乘一次，显式乘过就会双重缩放：
                // zoom≠1 时 PNG 缩在角落而覆盖层是正常大小，表现即「高亮框不对齐」。
                style: { width: `${px(slideW)}px`, height: `${px(slideH)}px`, display: bridging ? 'none' : 'block' },
              })
            : null,
          h(SlideView, {
            slide,
            width: slideW,
            height: slideH,
            selection: state.selectedIds,
            hoverId: state.hoverId,
            highlights: state.highlights,
            onPointerDown: onShapePointerDown,
            onDoubleClick: onShapeDoubleClick,
            ghost,
            interactive: true,
            marquee: state.marquee,
            // 底图已在且不在桥接期时，DOM 只画高亮框；桥接期 DOM 全量画新内容。
            overlayOnly: rendered !== null && renderMode === 'fitted' && renderFailed !== true && !bridging,
          })),
          // 就地文字编辑器：渲染在**未缩放的 .dsh-ppt-canvas** 里（slidewrap 之外），
          // 坐标/字号/内边距都由 textEditStyle 手动 ×zoom —— textarea 不继承 zoom
          // 容器的缩放，放进 slidewrap 会按幻灯片原尺寸渲染而覆盖层是缩放后的，
          // 除 zoom=1 外全部错位（实测 2026-10-15，Chrome）。
          // 打字期间底图 PNG 还是旧内容，提交（失焦）后 apply → rev 变化 → 底图重渲染。
          editingShape !== null && editingShape.text !== null && editingShape.text !== undefined
            ? h('textarea', {
                key: `edit-${editingShape.id}`,
                ref: editRef,
                className: 'dsh-ppt-textedit',
                defaultValue: editingShape.text.plain ?? '',
                spellCheck: false,
                onPointerDown: (event) => event.stopPropagation(),
                onDoubleClick: (event) => event.stopPropagation(),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    store.set({ editingId: null }) // 取消：不提交
                  }
                },
                onBlur: (event) => {
                  store.set({ editingId: null })
                  const value = String(event.target.value)
                  if (value === (editingShape.text.plain ?? '')) return
                  if (actions === null || actions === undefined || typeof actions.manual !== 'function') return
                  actions.manual([{
                    op: 'setText',
                    id: editingShape.id,
                    paragraphs: value.split('\n').map(line => ({ runs: [{ text: line }] })),
                  }], '编辑文字')
                },
                style: textEditStyle(editingShape, zoom),
              })
            : null,
        ),
        h('div', { className: 'dsh-ppt-canvasmeta' },
          `${deck.slides.indexOf(slide) + 1} / ${deck.slides.length} · ${Math.round(zoom * 100)}%`,
          state.selectedIds.length > 0 ? ` · 已选 ${state.selectedIds.length}` : '',
        ),
      ),
    )
  }

  // ------------------------------------------------------------------ 缩略图

  function ThumbRail(props) {
    const { store, deck, state } = props
    const thumbW = 132
    const scale = thumbW / deck.slideWidth
    return h('div', { className: 'dsh-ppt-thumbs' },
      deck.slides.map((slide, index) => h('button', {
        key: slide.id,
        className: `dsh-ppt-thumb${index === state.slideIndex ? ' is-active' : ''}`,
        title: `${slide.name}（点击左上角选择整页）`,
        onClick: () => {
          store.set({ slideIndex: index, selectedIds: [] })
          savePrefs({ slideIndex: index })
        },
      },
        h('div', { className: 'dsh-ppt-thumbhead' },
          h('span', { className: 'dsh-ppt-thumbno' }, String(index + 1)),
          h('button', {
            className: 'dsh-ppt-thumbpage',
            title: '选中整页元素',
            onClick: (event) => {
              event.stopPropagation()
              store.set({ slideIndex: index, selectedIds: slide.shapes.map(shape => shape.id) })
              savePrefs({ slideIndex: index })
            },
          }, '整页'),
        ),
        h('div', { className: 'dsh-ppt-thumbframe', style: { height: `${px(deck.slideHeight * scale)}px`, width: `${px(thumbW)}px` } },
          h('div', {
            className: 'dsh-ppt-thumbslide',
            style: { transform: `scale(${scale})`, transformOrigin: 'top left', width: `${px(deck.slideWidth)}px`, height: `${px(deck.slideHeight)}px` },
          }, h(SlideView, {
            slide,
            width: deck.slideWidth,
            height: deck.slideHeight,
            selection: index === state.slideIndex ? state.selectedIds : [],
            hoverId: null,
            highlights: index === state.slideIndex ? state.highlights : {},
            onPointerDown: null,
            interactive: false,
            marquee: null,
          })),
        ),
      )),
    )
  }

  // ------------------------------------------------------------------ 属性检查器

  function normalizeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : '#FFFFFF'
  }

  function findShape(deck, id) {
    if (deck === null) return null
    for (const slide of deck.slides) {
      for (const shape of slide.shapes) {
        if (shape.id === id) return shape
        if (Array.isArray(shape.children)) {
          for (const child of shape.children) if (child.id === id) return child
        }
      }
    }
    return null
  }

  /**
   * 数字输入框。
   *
   * 两个坑都在这里修掉：
   *  1. **key 要带上元素身份**：它非受控（defaultValue），React 复用同一个 input 时
   *     不会重放 defaultValue → 切换选中元素后仍显示上一个元素的值，失焦就把错值写回去。
   *  2. **没变化不提交**：无脑 onCommit 会让「点进点出」也发一次 apply —— 写盘、rev+1、
   *     撤销栈多一条、底图重渲染，AI 处理中还可能与 AI 抢 rev。
   *
   * @param {string|null} label
   * @param {number} value 当前真实值
   * @param {(next: number) => void} onCommit
   * @param {string} [identity] 元素身份（用于 key 与「是否变化」判断）
   */
  function numberField(label, value, onCommit, identity) {
    const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0
    return h('div', { className: 'dsh-ppt-numfield', key: label ?? 'value' },
      label === null ? null : h('span', { className: 'dsh-ppt-numlabel' }, label),
      h('input', {
        type: 'number',
        className: 'dsh-ppt-input dsh-ppt-num',
        // 身份变化时重建 input，defaultValue 才会重新生效
        key: `${identity ?? ''}:${label ?? 'value'}`,
        defaultValue: rounded,
        onBlur: (event) => {
          const parsed = Number(event.target.value)
          if (!Number.isFinite(parsed)) return
          if (Math.round(parsed * 10) / 10 === rounded) return // 没变就不写盘
          onCommit(parsed)
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') event.target.blur()
        },
      }),
    )
  }

  /**
   * 最右侧：对话转播（像普通对话一样把会话内容一条条列出来）。
   *
   * 内容来自 `client.js` 的 `watchAi`（订阅已连接会话的事件流）：`state.ai` 里是
   * `{ messages, thinking, reply, error }`。面板不自己订阅 —— 事件流要 retain 会话，
   * 那件事在注入层做，界面层只读结果。
   */
  /** 一条对话消息（用户 / 助手）。工具调用只保留一行摘要，不抢占正文。 */
  function renderChatMessage(message, index) {
    const isUser = message.role === 'user'
    const text = typeof message.text === 'string' ? message.text : ''
    const thinking = typeof message.thinking === 'string' ? message.thinking : ''
    return h('div', { key: `msg-${index}`, className: `dsh-ppt-chat-msg ${isUser ? 'is-user' : 'is-ai'}` },
      h('div', { className: 'dsh-ppt-chat-role' }, isUser ? '你' : 'AI',
        message.live === true ? h('span', { className: 'dsh-ppt-chat-live' }, '生成中') : null),
      thinking !== ''
        ? h('div', { className: 'dsh-ppt-chat-thinking', title: '推理过程' }, thinking)
        : null,
      h('div', { className: 'dsh-ppt-chat-text' }, text === '' ? '（无正文）' : text),
    )
  }

  function AiPane(props) {
    const { store, state } = props
    const ai = state.ai ?? { messages: [], thinking: '', reply: '', error: null }
    const messages = Array.isArray(ai.messages) ? ai.messages : []
    const chatRef = React.useRef(null)
    // 跟随最新消息：新消息进来就滚到底部（和普通对话一样）
    React.useEffect(() => {
      const node = chatRef.current
      if (node !== null && node !== undefined && typeof node.scrollTop === 'number') {
        node.scrollTop = node.scrollHeight
      }
    }, [messages.length, state.sending])

    // 折叠后只剩一条贴边的竖条，不占画布宽度（默认折叠，避免一上来就挤掉 PPT）。
    const collapsed = state.aiCollapsed !== false
    const toggle = () => {
      const next = !collapsed
      store.set({ aiCollapsed: next })
      savePrefs({ aiCollapsed: next })
    }
    if (collapsed) {
      return h('button', {
        className: 'dsh-ppt-aipane is-collapsed',
        title: '展开 AI 思考与回复',
        onClick: toggle,
      },
        h('span', { className: 'dsh-ppt-aipane-collapsed-label' }, 'AI 思考与回复'),
        state.sending ? h('span', { className: 'dsh-ppt-aipane-dot is-busy' }) : null,
      )
    }

    const empty = messages.length === 0
    return h('div', { className: 'dsh-ppt-aipane' },
      h('div', { className: 'dsh-ppt-aipane-head' },
        h('span', null, 'AI 思考与回复'),
        h('span', { className: 'dsh-ppt-aipane-head-right' },
          state.connectedSession === true
            ? h('span', { className: 'dsh-ppt-aipane-live' }, state.sending ? '思考中…' : '已连接')
            : h('span', { className: 'dsh-ppt-aipane-idle' }, '未连接会话'),
          h('button', {
            className: 'dsh-ppt-aipane-toggle',
            title: '折叠（把空间还给画布）',
            onClick: toggle,
          }, '»'),
        ),
      ),
      ai.error !== null && ai.error !== ''
        ? h('div', { className: 'dsh-ppt-aipane-error' }, ai.error)
        : null,
      // 像普通对话一样**转播会话内容**：一条条消息，而不是拆成"思考/回复"两块。
      h('div', { className: 'dsh-ppt-chat', ref: chatRef },
        messages.length === 0
          ? h('div', { className: 'dsh-ppt-chat-empty' },
            state.connectedSession === true
              ? '已连接会话。发送指令后，这里会按顺序显示你们的对话。'
              : '还没有连接会话。点顶部「会话」连接后，这里会显示对话内容。')
          : messages.map((message, index) => renderChatMessage(message, index)),
        state.sending === true ? h('div', { className: 'dsh-ppt-chat-typing' }, '正在输入…') : null,
      ),
      empty && !state.sending
        ? h('div', { className: 'dsh-ppt-aipane-hint' }, '这里只是把会话内容转播过来；在下方输入框给 AI 下达针对选中元素的指令。')
        : null,
    )
  }

  function Inspector(props) {
    const { store, deck, state, onManualEdit } = props
    const selected = state.selectedIds.map(id => findShape(deck, id)).filter(shape => shape !== null)
    if (selected.length === 0) {
      return h('div', { className: 'dsh-ppt-inspector' },
        h('div', { className: 'dsh-ppt-inspector-head' }, '属性'),
        h('div', { className: 'dsh-ppt-empty' }, '在画布上点选 / 框选元素，这里会显示它的位置、尺寸、样式与层级。'),
      )
    }
    const first = selected[0]
    const update = (ops, label) => onManualEdit(ops, label ?? (selected.length === 1 ? first.id : null))
    return h('div', { className: 'dsh-ppt-inspector' },
      h('div', { className: 'dsh-ppt-inspector-head' },
        '属性',
        h('span', { className: 'dsh-ppt-inspector-count' }, selected.length > 1 ? `${selected.length} 个元素` : first.kind),
      ),
      h('div', { className: 'dsh-ppt-inspector-name', title: first.name }, first.name),
      h('div', { className: 'dsh-ppt-grid2' },
        numberField('X', first.geometry.x, value => update([{ op: 'setGeometry', id: first.id, x: value }]), first.id),
        numberField('Y', first.geometry.y, value => update([{ op: 'setGeometry', id: first.id, y: value }]), first.id),
        numberField('宽', first.geometry.w, value => update([{ op: 'setGeometry', id: first.id, w: Math.max(1, value) }]), first.id),
        numberField('高', first.geometry.h, value => update([{ op: 'setGeometry', id: first.id, h: Math.max(1, value) }]), first.id),
      ),
      first.text !== null && first.text !== undefined
        ? h('div', { className: 'dsh-ppt-field' },
            h('label', null, '文本'),
            h('textarea', {
              className: 'dsh-ppt-input dsh-ppt-textarea',
              // rev 变化（AI/拖动落盘）后重挂载，让内容跟随最新文档。
              key: `text-${first.id}-${deck.rev}`,
              defaultValue: first.text.plain ?? '',
              rows: 3,
              onBlur: (event) => {
                // 没改就不提交：否则点进点出也会写盘、rev+1、多一条撤销。
                if (String(event.target.value) === (first.text.plain ?? '')) return
                update([{
                  op: 'setText',
                  id: first.id,
                  paragraphs: String(event.target.value).split('\n').map(line => ({ runs: [{ text: line }] })),
                }])
              },
            }),
          )
        : null,
      h('div', { className: 'dsh-ppt-field' },
        h('label', null, '字号 / 颜色'),
        h('div', { className: 'dsh-ppt-inline' },
          numberField(null, first.text?.fontSize ?? 18, value => update([{ op: 'setTextStyle', id: first.id, fontSize: value }]), `size:${first.id}`),
          h('input', {
            type: 'color',
            className: 'dsh-ppt-color',
            value: normalizeColor(first.text?.color ?? '#111111'),
            onChange: (event) => update([{ op: 'setTextStyle', id: first.id, color: event.target.value.toUpperCase() }], '文字颜色'),
          }),
        ),
      ),
      h('div', { className: 'dsh-ppt-field' },
        h('label', null, '对齐'),
        h('div', { className: 'dsh-ppt-btnrow' },
          ['left', 'center', 'right'].map(align => h('button', {
            key: align,
            className: `dsh-ppt-mini${alignToCss(first.text?.align) === align ? ' is-on' : ''}`,
            onClick: () => update([{ op: 'setTextStyle', id: first.id, align }], '对齐'),
          }, { left: '左', center: '中', right: '右' }[align])),
          h('button', {
            className: `dsh-ppt-mini${first.text?.bold === true ? ' is-on' : ''}`,
            onClick: () => update([{ op: 'setTextStyle', id: first.id, bold: first.text?.bold !== true }], '粗体'),
          }, 'B'),
        ),
      ),
      h('div', { className: 'dsh-ppt-field' },
        h('label', null, '填充 / 描边'),
        h('div', { className: 'dsh-ppt-inline' },
          h('input', {
            type: 'color',
            className: 'dsh-ppt-color',
            title: '填充色',
            value: normalizeColor(first.style?.fill?.color ?? '#FFFFFF'),
            onChange: (event) => update([{ op: 'setFill', id: first.id, color: event.target.value.toUpperCase() }], '填充色'),
          }),
          h('input', {
            type: 'color',
            className: 'dsh-ppt-color',
            title: '描边色',
            value: normalizeColor(first.style?.line?.color ?? '#333333'),
            onChange: (event) => update([{ op: 'setLine', id: first.id, color: event.target.value.toUpperCase() }], '描边色'),
          }),
          h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'setLine', id: first.id, color: null }], '去掉描边') }, '无边框'),
        ),
      ),
      h('div', { className: 'dsh-ppt-field' },
        h('label', null, `层级 z=${first.z}`),
        h('div', { className: 'dsh-ppt-btnrow' },
          h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'sendToBack', id: first.id }], '置底') }, '置底'),
          h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'bringToFront', id: first.id }], '置顶') }, '置顶'),
          h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'duplicate', id: first.id, dx: 16, dy: 16 }], '复制') }, '复制'),
          h('button', { className: 'dsh-ppt-mini is-danger', onClick: () => update([{ op: 'remove', id: first.id }], '删除') }, '删除'),
        ),
      ),
      selected.length > 1
        ? h('div', { className: 'dsh-ppt-field' },
            h('label', null, '批量对齐'),
            h('div', { className: 'dsh-ppt-btnrow' },
              ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map(mode => h('button', {
                key: mode,
                className: 'dsh-ppt-mini',
                onClick: () => update([{ op: 'align', ids: selected.map(shape => shape.id), mode }], `对齐 ${mode}`),
              }, { left: '左齐', hcenter: '水平中', right: '右齐', top: '顶齐', vcenter: '垂直中', bottom: '底齐' }[mode])),
              h('button', {
                className: 'dsh-ppt-mini',
                onClick: () => update([{ op: 'align', ids: selected.map(shape => shape.id), mode: 'distributeH' }], '水平等距'),
              }, '水平等距'),
            ),
          )
        : null,
      h('div', { className: 'dsh-ppt-inspector-foot' },
        h('button', { className: 'dsh-ppt-mini', onClick: () => store.set({ selectedIds: [] }) }, '取消选择'),
      ),
    )
  }

  function selectionElement(shape) {
    return {
      id: shape.id,
      name: shape.name,
      kind: shape.kind,
      z: shape.z,
      geometry: shape.geometry,
      style: shape.style,
      text: shape.text === null || shape.text === undefined ? null : {
        plain: shape.text.plain,
        fontSize: shape.text.fontSize,
        color: shape.text.color,
        bold: shape.text.bold,
        italic: shape.text.italic,
        align: shape.text.align,
        fontFamily: shape.text.fontFamily,
      },
      image: shape.image === null || shape.image === undefined ? null : { mediaId: shape.image.mediaId },
    }
  }

  // ------------------------------------------------------------------ 顶栏

  function Header(props) {
    const { store, state, deck, actions, titleBar, logOp } = props
    // 会话相关的值**必须**在这里重新推导，不能引用 Panel 里的局部变量：
    // Header 是独立组件，Panel 的局部名在它里面是未声明的自由变量 ——
    // 这正是「点会话按钮整页白屏」的原因（渲染到菜单那段时抛 ReferenceError）。
    const connectedSessionId = typeof state.sessionId === 'string' ? state.sessionId : ''
    const sessionReady = connectedSessionId !== ''
    // 可选会话列表由 Panel 传入（它才拿得到 slot 的 sessionIds）
    const availableSessions = Array.isArray(props.sessionIds) ? props.sessionIds : []
    const file = deck === null ? null : deck.file
    return h('div', {
      className: `dsh-ppt-header${titleBar !== undefined && titleBar.draggable === true ? ' is-draggable' : ''}`,
      ...(titleBar !== undefined && titleBar.draggable === true && titleBar.onPointerDown !== undefined
        ? { onPointerDown: titleBar.onPointerDown, title: '按住这里可以拖动整个面板' }
        : {}),
    },
      h('div', { className: 'dsh-ppt-title' },
        h('span', { className: 'dsh-ppt-logo' }, 'PPT'),
        h('div', { className: 'dsh-ppt-titles' },
          h('b', null, '协同编辑画布'),
          h('span', { className: 'dsh-ppt-sub', title: file ?? '' },
            deck === null
              ? '未打开演示文稿'
              : `${file.split(/[/\\]/).pop()} · rev ${deck.rev} · ${deck.slides.length} 页`),
        ),
      ),
      h('div', { className: 'dsh-ppt-tools' },
        h('button', {
          className: 'dsh-ppt-btn is-primary',
          disabled: state.sending,
          title: '打开本地 .pptx（系统文件对话框；也可以直接把文件拖进来）',
          onClick: () => { void actions.pickAndOpen() },
        }, '打开'),
        h('button', {
          className: 'dsh-ppt-btn',
          disabled: state.sending,
          title: '打开内置演示文稿',
          onClick: () => actions.openDemo(),
        }, '演示文稿'),
        h('button', {
          className: 'dsh-ppt-btn',
          disabled: state.sending || deck === null,
          title: '重新读取文件（外部改过之后用）',
          onClick: () => actions.reload(),
        }, '重载'),
        h('span', { className: 'dsh-ppt-sep' }),
        h('button', {
          className: 'dsh-ppt-btn',
          disabled: !state.history.canUndo || state.sending,
          title: '撤销（Ctrl+Z）',
          onClick: () => actions.undo(),
        }, '↶ 撤销'),
        h('button', {
          className: 'dsh-ppt-btn',
          disabled: !state.history.canRedo || state.sending,
          title: '重做（Ctrl+Shift+Z）',
          onClick: () => actions.redo(),
        }, '↷ 重做'),
        state.history.entries !== undefined && state.history.entries.length > 0
          ? h('span', { className: 'dsh-ppt-revbadge', title: '最近一次修改' }, `rev ${state.history.rev}`)
          : null,
        h('span', { className: 'dsh-ppt-sep' }),
        // 画布画法切换：精确渲染（LibreOffice）↔ 内置重画（快，但只是近似）
        h('button', {
          className: 'dsh-ppt-btn',
          title: state.renderMode === 'dom'
            ? '当前是内置重画（近似）。点这里改用 LibreOffice 精确渲染。'
            : '当前是 LibreOffice 精确渲染。点这里改用内置重画（更快，但排版是近似）。',
          onClick: () => {
            const next = state.renderMode === 'dom' ? 'fitted' : 'dom'
            store.set({ renderMode: next })
            savePrefs({ renderMode: next })
          },
        }, state.renderMode === 'dom' ? '渲染：内置' : '渲染：精确'),
        // 会话状态按钮：显示当前连的是哪个，点它切换（或新建）
        h('button', {
          className: `dsh-ppt-btn dsh-ppt-sessionbadge${sessionReady ? ' is-ok' : ''}`,
          title: sessionReady
            ? `已连接 ${connectedSessionId}；点击切换会话`
            : '还没有连接会话；首次发送会自动新建一个，也可以点这里选',
          onClick: (event) => {
            event.stopPropagation()
            store.set({ sessionMenuOpen: state.sessionMenuOpen !== true })
          },
        }, sessionReady ? `会话 ${String(connectedSessionId).slice(-6)}` : '未连接会话'),
        state.sessionMenuOpen === true
          ? h('div', { className: 'dsh-ppt-sessionmenu' },
              h('div', { className: 'dsh-ppt-sessionmenu-title' }, '连接到会话'),
              ...availableSessions.slice(-8).reverse().map(id => h('button', {
                key: id,
                className: `dsh-ppt-sessionmenu-item${id === connectedSessionId ? ' is-current' : ''}`,
                onClick: () => {
                  store.set({ sessionId: id, sessionMenuOpen: false })
                  savePrefs({ sessionId: id })
                  void ensureInWorkspace(id)
                  logOp(`已连接会话 ${id}`, 'ok')
                },
              }, id === connectedSessionId ? `✓ ${id}` : id)),
              h('button', {
                className: 'dsh-ppt-sessionmenu-item is-new',
                onClick: () => { void actions.newSession() },
              }, '↻ 连接到最近会话'),
              availableSessions.length === 0
                ? h('div', { className: 'dsh-ppt-sessionmenu-empty' },
                    '宿主没有返回会话列表。请先在左侧打开或新建一个对话，再点这里刷新。')
                : null,
            )
          : null,
        h('span', { className: 'dsh-ppt-sep' }),
        h('button', {
          className: 'dsh-ppt-btn dsh-ppt-btn-close',
          title: '最小化面板（数据保留）',
          onClick: () => store.set({ open: false }),
        }, '—'),
      ),
    )
  }

  // ------------------------------------------------------------------ 拖拽层

  /** 拖拽提示条；拖进文件时覆盖整个界面。 */
  function DropOverlay(props) {
    const { state } = props
    if (state.dragDepth <= 0) return null
    return h('div', { className: 'dsh-ppt-drop' },
      h('div', { className: 'dsh-ppt-dropcard' },
        h('b', null, '松开即可打开这份演示文稿'),
        h('span', null, state.dropHint ?? '仅支持 .pptx；打开后画布会直接读写这个文件（可撤销）'),
      ),
    )
  }

  // ------------------------------------------------------------------ 指令框

  function InstructionBar(props) {
    const { store, state, actions, sessionDiagnostics } = props
    const rows = state.selectedIds.length
    // 只要有通道就允许点：首次点击会自动新建并连接会话。
    const canSend = promptTo !== null
    // 禁用条件的实时清单：按钮灰着的时候，用户能一眼看出是哪一项没满足
    // （之前只显示一句笼统的话，导致「还是灰的」这种反馈无法定位）。
    const text = state.instruction.trim()
    const blockers = [
      promptTo === null ? '未接入 AI 通道' : null,
      rows === 0 ? '未选中元素' : null,
      text === '' ? '指令为空' : null,
      state.sending ? '正在处理上一条' : null,
    ].filter(item => item !== null)
    return h('div', { className: 'dsh-ppt-instruction' },
      h('div', { className: 'dsh-ppt-instr-head' },
        h('span', { className: 'dsh-ppt-instr-title' }, 'AI 修改指令'),
        h('span', { className: 'dsh-ppt-instr-sel' }, rows === 0 ? '未选中元素' : `已选中 ${rows} 个元素`),
        state.sending ? h('span', { className: 'dsh-ppt-instr-sending' }, 'AI 处理中…') : null,
        state.drafts.length > 0 ? h('span', { className: 'dsh-ppt-instr-draft' }, `${state.drafts.length} 条待发`) : null,
      ),
      h('div', { className: 'dsh-ppt-instr-body' },
        h('textarea', {
          className: 'dsh-ppt-instr-input',
          placeholder: 'Enter 发送给 AI，Shift+Enter 加入待发。例如：把标题改成红色并右对齐',
          value: state.instruction,
          rows: 2,
          onChange: (event) => store.set({ instruction: event.target.value }),
          onKeyDown: (event) => {
            if (event.key !== 'Enter') return
            // Enter 优先「发送给 AI」（用户的主要意图）；要攒多条时用 Shift+Enter
            // 加入待发，或点「加入待发」按钮。
            if (event.shiftKey) {
              event.preventDefault()
              actions.addDraft()
              return
            }
            event.preventDefault()
            actions.send()
          },
        }),
        h('div', { className: 'dsh-ppt-instr-actions' },
          h('button', {
            className: 'dsh-ppt-btn',
            disabled: state.instruction.trim() === '',
            title: 'Shift+Enter：加入待发列表（Enter 直接发送）',
            onClick: () => actions.addDraft(),
          }, '加入待发'),
          h('button', {
            className: 'dsh-ppt-btn is-primary',
            disabled: state.sending || rows === 0 || text === '' || promptTo === null,
            title: blockers.length === 0
              ? 'Ctrl/⌘ + Enter：发送给 AI'
              : `还不能发送：${blockers.join('、')}`,
            onClick: () => { void actions.send() },
          }, state.sending ? 'AI 处理中…' : '发送给 AI'),
        ),
      ),
      // 按钮灰着时，把差哪一项直接写出来（缺什么补什么，不用再问）。
      blockers.length > 0 && !state.sending
        ? h('div', { className: 'dsh-ppt-diag' }, `发送前提：${blockers.join(' · ')}`)
        : null,
      state.drafts.length > 0
        ? h('div', { className: 'dsh-ppt-drafts' }, state.drafts.map((draft, index) => h('span', {
            key: `${index}-${draft}`,
            className: 'dsh-ppt-chip',
            onClick: () => store.set({ instruction: draft, drafts: state.drafts.filter((_, i) => i !== index) }),
            title: '点击编辑这条指令',
          }, draft.length > 28 ? `${draft.slice(0, 28)}…` : draft)))
        : null,
      promptTo === null
        ? h('div', { className: 'dsh-ppt-warn' },
            '「把指令发给 AI」这条链路没接上。',
            h('div', { className: 'dsh-ppt-diag' },
              typeof sessionDiagnostics === 'function' ? sessionDiagnostics() : '无诊断'),
          )
        : null,
      state.history.entries !== undefined && state.history.entries.length > 0
        ? h('div', { className: 'dsh-ppt-histlist' }, state.history.entries.slice(0, 4).map((entry, index) => h('div', {
            key: `${entry.rev}-${index}`,
            className: 'dsh-ppt-histrow',
          },
            h('span', { className: 'dsh-ppt-histrev' }, `rev ${entry.rev}`),
            h('span', { className: 'dsh-ppt-histsum', title: entry.summary }, entry.summary ?? ''),
          )))
        : null,
    )
  }

  // ------------------------------------------------------------------ 路径弹窗

  /**
   * 打开演示文稿 —— **面板内的文件浏览器**。
   *
   * 为什么不用系统文件对话框：这台宿主**没有**选文件的对话框。
   * 实测：`uiWorkspace.pickDirectory()` 明确是「目录选择器」（点「打开」弹出的是
   * 选择工作区的窗口就是这个原因），`directoryPicker` 服务按设计只提供目录，
   * 桌面端 Electron 主进程里也只注册了 `dialog.showOpenDialog({properties:['openDirectory']})`。
   * 所以选文件只能在面板里自己做。
   *
   * 浏览靠 `uiWorkspace.listDirectory(path?)`：返回 `{ path, entries[{name,path}], crumbs }`。
   * 「选择文件夹」按钮仍然有用 —— 它跳到目标目录，省得一层层点。
   */
  function PathDialog(props) {
    const { store, state, onConfirm } = props
    if (!state.askPath) return null
    const listing = state.listing
    const entries = Array.isArray(listing?.entries) ? listing.entries : []
    // 目录判定：listDirectory 的条目只有 {name, path, hidden}，没有 kind 字段，
    // 所以按「名字里有 . 视为文件」这一惯例区分（目录名通常不带点）。
    const isDir = (entry) => typeof entry?.name === 'string' && !entry.name.includes('.')
    const dirEntries = entries.filter(isDir)
    const fileEntries = entries.filter(entry => !isDir(entry))
    const pptx = fileEntries.filter(entry => /\.pptx$/i.test(entry.name))
    const other = fileEntries.filter(entry => !/\.pptx$/i.test(entry.name))

    const browse = (path) => {
      store.set({ listing: null, listingError: null })
      Promise.resolve(listDirectory === null ? null : listDirectory(path))
        .then(next => {
          if (next === null) {
            store.set({ listingError: '宿主没有提供目录浏览（uiWorkspace.listDirectory）。请直接输入路径。' })
            return
          }
          store.set({ listing: next, pickerPath: next.path ?? path ?? '' })
        })
        .catch(error => store.set({ listingError: describeError(error) }))
    }

    const openEntry = (entry) => {
      store.set({ pathDraft: entry.path, askPath: false })
      onConfirm(entry.path)
    }

    return h('div', { className: 'dsh-ppt-modal-back', onClick: () => store.set({ askPath: false }) },
      h('div', { className: 'dsh-ppt-modal is-picker', onClick: (event) => event.stopPropagation() },
        h('b', null, '打开演示文稿'),
        h('div', { className: 'dsh-ppt-modal-hint' },
          '点击列表里的 .pptx 打开；双击文件夹进入。也可以直接输入绝对路径，或把文件拖到面板上。'),

        // 路径条 + 操作
        h('div', { className: 'dsh-ppt-picker-bar' },
          h('button', {
            className: 'dsh-ppt-btn',
            title: '回到宿主主目录',
            onClick: () => browse(undefined),
          }, '⌂'),
          h('button', {
            className: 'dsh-ppt-btn',
            title: '上一层',
            onClick: () => {
              const current = state.pickerPath ?? ''
              const cut = Math.max(current.lastIndexOf('\\'), current.lastIndexOf('/'))
              if (cut > 2) browse(current.slice(0, cut))
            },
          }, '↑'),
          h('button', {
            className: 'dsh-ppt-btn',
            title: '用系统的目录选择器跳到某个文件夹（宿主只提供选目录）',
            onClick: () => {
              if (pickPath === null) return
              Promise.resolve(pickPath()).then((picked) => {
                if (typeof picked === 'string' && picked !== '') browse(picked)
              })
            },
          }, '选文件夹…'),
          h('button', { className: 'dsh-ppt-btn', onClick: () => browse(state.pickerPath ?? undefined) }, '↻'),
        ),
        h('input', {
          className: 'dsh-ppt-input',
          value: state.pickerPath ?? '',
          placeholder: 'D:\\work',
          onChange: (event) => store.set({ pickerPath: event.target.value }),
          onKeyDown: (event) => { if (event.key === 'Enter') browse(store.get().pickerPath) },
        }),

        state.listingError !== null && state.listingError !== undefined
          ? h('div', { className: 'dsh-ppt-warn' }, state.listingError)
          : null,

        listing === null
          ? h('div', { className: 'dsh-ppt-empty' }, '正在读取目录…（若长时间无内容，说明宿主没有提供目录浏览）')
          : h('div', { className: 'dsh-ppt-picker-list' },
              dirEntries.map(entry => h('button', {
                key: `d-${entry.path}`,
                className: 'dsh-ppt-picker-row is-dir',
                onClick: () => browse(entry.path),
              }, '📁 ', entry.name)),
              pptx.map(entry => h('button', {
                key: `f-${entry.path}`,
                className: 'dsh-ppt-picker-row is-pptx',
                onClick: () => openEntry(entry),
              }, '📊 ', entry.name)),
              other.length > 0
                ? h('div', { className: 'dsh-ppt-picker-more' }, `（另有 ${other.length} 个非 .pptx 文件未列出）`)
                : null,
              dirEntries.length === 0 && pptx.length === 0
                ? h('div', { className: 'dsh-ppt-empty' }, '这个目录里没有子文件夹，也没有 .pptx 文件。')
                : null,
            ),

        h('div', { className: 'dsh-ppt-modal-actions' },
          h('button', { className: 'dsh-ppt-btn', onClick: () => store.set({ askPath: false }) }, '取消'),
          h('button', { className: 'dsh-ppt-btn is-primary', onClick: () => onConfirm() }, '打开输入的路径'),
        ),
      ),
    )
  }

  function Toasts(props) {
    const { store, state } = props
    if (state.toasts.length === 0) return null
    return h('div', { className: 'dsh-ppt-toasts' }, state.toasts.map(toast => h('div', {
      key: toast.id,
      className: `dsh-ppt-toast is-${toast.kind}`,
    },
      h('div', { className: 'dsh-ppt-toast-body' },
        h('b', null, toast.title),
        toast.detail === undefined ? null : h('span', null, toast.detail),
      ),
      toast.action === undefined ? null : h('button', {
        className: 'dsh-ppt-btn is-primary',
        onClick: () => { toast.action.run(); store.set({ toasts: store.get().toasts.filter(item => item.id !== toast.id) }) },
      }, toast.action.label),
      h('button', {
        className: 'dsh-ppt-toast-x',
        onClick: () => store.set({ toasts: store.get().toasts.filter(item => item.id !== toast.id) }),
      }, '×'),
    )))
  }

  // ------------------------------------------------------------------ 拖动浮窗

  /**
   * 浮层面板外壳：把 Panel 包进一个可以用标题栏自由拖动的窗口。
   * （浏览器没有原生窗口拖动，所以用 pointer 事件 + 绝对定位自己实现；
   *   只处理面板内部的拖动，不改窗口位置。）
   */
  /**
   * 渲染层兜底：渲染抛错时 React 会把**整棵树**卸载，用户看到的就是
   * 「整个面板/画板无声消失」。有这个边界，错误会被拦下来摆在台面上。
   * （真实事故：就地编辑上线后点击组件面板整个消失，仅真实浏览器可复现。）
   */
  class PanelErrorBoundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { error: null }
    }
    static getDerivedStateFromError(error) {
      return { error }
    }
    componentDidCatch(error, info) {
      // 完整堆栈进 console，便于 devtools 排查；UI 上只显示一句话。
      console.error?.('[dsh-ppt-canvas] render error:', error, info?.componentStack ?? '')
    }
    render() {
      if (this.state.error === null) return this.props.children
      const message = String(this.state.error?.message ?? this.state.error)
      return h('div', {
        style: {
          position: 'absolute', inset: 0, padding: '18px', zIndex: 60, overflow: 'auto',
          background: 'var(--dsw-alias-bg-layer-1,#fff)', color: '#d93025', fontSize: 12,
        },
      },
        h('b', null, '画布插件渲染出错（错误边界拦住了，面板没有消失）'),
        h('div', {
          style: {
            marginTop: 8, fontFamily: 'ui-monospace,Consolas,monospace',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'inherit',
          },
        }, message),
        h('div', { style: { marginTop: 10, color: 'var(--dsw-alias-label-secondary,#888)' } },
          '把这个报错截给开发者；点「重试」通常能直接恢复。'),
        h('div', { style: { marginTop: 10 } },
          h('button', { className: 'dsh-ppt-btn', onClick: () => this.setState({ error: null }) }, '重试'),
          h('button', { className: 'dsh-ppt-btn', style: { marginLeft: 8 }, onClick: () => win.location.reload() }, '刷新页面'),
        ),
      )
    }
  }

  /**
   * 「看起来你在做 PPT」提示卡（只在画布最小化时出现）。
   *
   * 触发条件见 FloatingPanel 里的 watchAi 订阅：用户在当前会话里提到
   * PPT / 演示文稿 / 幻灯片等，且画布没打开。两条出路：打开画布，或「不用了」。
   * 关掉后同一条消息不会再提示（由 seenPromptRef + store 里清空 pptPrompt 保证）。
   */
  function PptPromptCard(props) {
    const { store, state, onOpen } = props
    const prompt = state.pptPrompt
    if (prompt === null || prompt === undefined) return null
    return h('div', { className: 'dsh-ppt-pptprompt' },
      h('div', { className: 'dsh-ppt-pptprompt-title' }, '看起来你在做 PPT'),
      h('div', { className: 'dsh-ppt-pptprompt-quote' }, String(prompt.text ?? '').slice(0, 80)),
      h('div', { className: 'dsh-ppt-pptprompt-actions' },
        h('button', {
          className: 'is-primary',
          onClick: () => {
            store.set({ pptPrompt: null })
            onOpen()
          },
        }, '打开画布'),
        h('button', {
          onClick: () => store.set({ pptPrompt: null }),
        }, '不用了'),
      ),
    )
  }

  function FloatingPanel(props) {
    const { store, openPanel, titleBar, geometry, sessionIds, workspaceId, logOp } = props
    const state = useStore(store)
    const geo = geometry ?? { load: () => null, save: () => {}, initial: { width: 1180, height: 760 } }

    // 「用户提到制作/修改 PPT」→ 提示是否打开画布。
    // 必须在 FloatingPanel 里做：页面内的 Panel 只在展开时才渲染，
    // 最小化状态下没人监听会话，就永远等不到这条提示。
    const seenPromptRef = React.useRef('')
    React.useEffect(() => {
      if (state.open === true) return undefined        // 已经打开，不必提示
      if (typeof watchAi !== 'function') return undefined
      let sessionId = typeof state.sessionId === 'string' ? state.sessionId : ''
      if (sessionId === '') {
        try {
          const ids = typeof listSessionIds === 'function' ? listSessionIds() : []
          if (Array.isArray(ids) && ids.length > 0) sessionId = ids[ids.length - 1]
        } catch { /* 拿不到会话就不提示 */ }
      }
      if (sessionId === '') return undefined
      const off = watchAi(sessionId, next => {
        const messages = Array.isArray(next?.messages) ? next.messages : []
        const lastUser = [...messages].reverse().find(message => message?.role === 'user')
        if (lastUser === undefined) return
        const text = String(lastUser.text ?? '').trim()
        if (text === '' || seenPromptRef.current === text) return
        // 插件自己发的指令（带【PPT 协同编辑】前缀）不算用户意图
        if (LOOKS_LIKE_PPT_REQUEST.test(text) === false) return
        if (SELF_PPT_INSTRUCTION.test(text)) return
        seenPromptRef.current = text
        store.set({ pptPrompt: { text: text.slice(0, 240) } })
      })
      return off
    }, [state.open, state.sessionId, store])

    const [box, setBox] = React.useState(() => {
      const saved = geo.load()
      return {
        x: saved !== null && Number.isFinite(saved.x) ? saved.x : null,
        y: saved !== null && Number.isFinite(saved.y) ? saved.y : null,
        width: saved?.width ?? geo.initial.width,
        height: saved?.height ?? geo.initial.height,
        dragging: false,
      }
    })
    const dragRef = React.useRef(null)
    const boxRef = React.useRef(box)
    boxRef.current = box

    const clampBox = React.useCallback((next) => {
      const maxX = Math.max(0, win.innerWidth - 160)
      const maxY = Math.max(0, win.innerHeight - 60)
      return {
        ...next,
        x: next.x === null ? null : clamp(next.x, -next.width + 160, maxX),
        y: next.y === null ? null : clamp(next.y, 0, maxY),
        width: clamp(next.width, 620, Math.max(620, win.innerWidth - 24)),
        height: clamp(next.height, 380, Math.max(380, win.innerHeight - 24)),
      }
    }, [])

    const persist = React.useCallback((next) => {
      geo.save({ x: next.x, y: next.y, width: next.width, height: next.height })
    }, [geo])

    /** 标题栏拖动（不含按钮区域）。 */
    const onTitlePointerDown = React.useCallback((event) => {
      if (event.button !== 0) return
      const target = event.target
      if (target !== null && target !== undefined && typeof target.closest === 'function' && target.closest('button') !== null) return
      const host = event.currentTarget.parentElement
      if (host === null || host === undefined) return
      const rect = host.getBoundingClientRect()
      dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
      setBox(current => ({ ...current, dragging: true }))
    }, [])

    /** 右下角缩放。 */
    const onResizePointerDown = React.useCallback((event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const start = { x: event.clientX, y: event.clientY, w: boxRef.current.width, h: boxRef.current.height }
      const onMove = (moveEvent) => {
        setBox(current => clampBox({
          ...current,
          width: start.w + (moveEvent.clientX - start.x),
          height: start.h + (moveEvent.clientY - start.y),
        }))
      }
      const onUp = () => {
        win.removeEventListener('pointermove', onMove)
        win.removeEventListener('pointerup', onUp)
        setBox(current => { persist(current); return current })
      }
      win.addEventListener('pointermove', onMove)
      win.addEventListener('pointerup', onUp)
    }, [clampBox, persist])

    React.useEffect(() => {
      if (!box.dragging) return undefined
      const onMove = (event) => {
        const drag = dragRef.current
        if (drag === null) return
        setBox(current => clampBox({
          ...current,
          x: event.clientX - drag.offsetX,
          y: event.clientY - drag.offsetY,
        }))
      }
      const onUp = () => {
        dragRef.current = null
        setBox(current => {
          const next = { ...current, dragging: false }
          persist(next)
          return next
        })
      }
      win.addEventListener('pointermove', onMove)
      win.addEventListener('pointerup', onUp)
      return () => {
        win.removeEventListener('pointermove', onMove)
        win.removeEventListener('pointerup', onUp)
      }
    }, [box.dragging, clampBox, persist])

    React.useEffect(() => {
      const onResize = () => setBox(current => clampBox(current))
      win.addEventListener('resize', onResize)
      return () => win.removeEventListener('resize', onResize)
    }, [clampBox])

    if (!state.open) {
      // 最小化状态：入口按钮 +（必要时）「要不要打开画布」提示卡
      return h('div', { className: 'dsh-ppt-launcherwrap' },
        h(PptPromptCard, { store, state, onOpen: () => openPanel() }),
        h('button', {
          className: 'dsh-ppt-launcher',
          title: '打开 PPT 协同编辑画布',
          onClick: () => openPanel(),
        }, 'PPT 画布'),
      )
    }

    const style = {
      left: box.x === null ? undefined : `${px(box.x)}px`,
      top: box.y === null ? undefined : `${px(box.y)}px`,
      width: `${px(box.width)}px`,
      height: `${px(box.height)}px`,
      right: box.x === null ? '20px' : undefined,
      bottom: box.y === null ? '20px' : undefined,
    }

    return h('div', { className: `dsh-ppt-float${box.dragging ? ' is-dragging' : ''}`, style },
      h(PanelErrorBoundary, null,
        h(Panel, {
          store,
          // sessionIds / workspaceId 由 client.js 传入；漏传会让会话菜单恒为空。
          sessionIds,
          workspaceId,
          logOp,
          titleBar: titleBar === undefined
            ? { draggable: true, onPointerDown: onTitlePointerDown, onClose: () => store.set({ open: false }) }
            : { ...titleBar, draggable: true, onPointerDown: onTitlePointerDown },
        }),
      ),
      h('div', {
        className: 'dsh-ppt-resize is-se',
        title: '拖动改变大小',
        onPointerDown: onResizePointerDown,
      }),
    )
  }

  // ------------------------------------------------------------------ 主界面

  function Panel(props) {
    const { store, titleBar } = props
    const state = useStore(store)
    const deck = state.deck
    const slide = deck === null ? null : (deck.slides[state.slideIndex] ?? deck.slides[0] ?? null)
    // 已连接的会话：状态里持久化（首次发送时若为空就新建一个）。
    // 同步进 ref：actions.send() 不在渲染作用域里，只能通过 ref 读。
    const connectedSessionId = typeof state.sessionId === 'string' ? state.sessionId : ''
    sessionIdRef.current = connectedSessionId
    const sessionReady = connectedSessionId !== ''
    const availableSessions = Array.isArray(props.sessionIds) ? props.sessionIds : []
    sessionIdRef.latest = availableSessions
    sessionIdRef.workspaceId = typeof props.workspaceId === 'string' ? props.workspaceId : sessionIdRef.workspaceId

    // 已连接会话的布尔位交给 AI 面板显示状态（state 里存 id，这里派生一下）。
    if (state.connectedSession !== sessionReady) store.set({ connectedSession: sessionReady })

    /**
     * 订阅 AI 事件流。会话变化时重订阅；卸载时退订（watchAi 返回的退订函数会
     * 释放 retain 出来的引用）。
     */
    React.useEffect(() => {
      if (watchAi === null || connectedSessionId === '') return undefined
      const off = watchAi(connectedSessionId, (next) => {
        store.set({ ai: { thinking: next.thinking ?? '', reply: next.reply ?? '', error: next.error ?? null } })
      })
      return () => { if (typeof off === 'function') off() }
    }, [connectedSessionId, store])

    /**
     * 让连接的会话出现在左侧工作区列表里（和普通对话一样）。
     * 放在 effect 里而不是各个连接入口里：这样「从 localStorage 恢复的会话」
     * 「菜单里选的会话」「首次发送自动连的会话」三条路都会归入工作区。
     */
    const attachedRef = React.useRef('')
    React.useEffect(() => {
      if (connectedSessionId === '' || attachedRef.current === connectedSessionId) return
      attachedRef.current = connectedSessionId
      void ensureInWorkspace(connectedSessionId)
    }, [connectedSessionId])

    /**
     * 打开对话框时读一次目录。宿主没有选文件的对话框，所以这里是唯一的
     * 「浏览并选 .pptx」入口；`listDirectory()` 省略参数即宿主主目录。
     */
    const startedListingRef = React.useRef(false)
    React.useEffect(() => {
      if (state.askPath !== true) {
        startedListingRef.current = false
        return
      }
      if (startedListingRef.current) return
      startedListingRef.current = true
      if (listDirectory === null) {
        store.set({ listingError: '宿主没有提供目录浏览（uiWorkspace.listDirectory）。请直接输入路径。' })
        return
      }
      Promise.resolve(listDirectory(undefined))
        .then(listing => store.set({ listing, pickerPath: listing?.path ?? '' }))
        .catch(error => store.set({ listingError: describeError(error) }))
    }, [state.askPath, store])

    const toast = React.useCallback((title, toastOptions = {}) => {
      const id = `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`
      const entry = { id, title, detail: toastOptions.detail, kind: toastOptions.kind ?? 'info', action: toastOptions.action }
      store.set(current => ({ toasts: current.toasts.concat([entry]).slice(-4) }))
      timeout(() => {
        store.set(current => ({ toasts: current.toasts.filter(item => item.id !== id) }))
      }, toastOptions.duration ?? 6000)
    }, [store])

    const logOp = React.useCallback((text, kind) => {
      store.set(current => ({
        log: [{ id: `l${Date.now()}${Math.random().toString(36).slice(2, 5)}`, text, kind, at: Date.now() }]
          .concat(current.log).slice(0, 60),
      }))
    }, [store])

    const refreshHistory = React.useCallback(async () => {
      try {
        const status = await callApi('history')
        store.set({ history: status })
      } catch (error) { /* 没有打开文档时忽略 */ }
    }, [store])

    const adoptDeck = React.useCallback((next) => {
      store.set(current => {
        const ids = new Set(next.slides.flatMap(item => item.shapes.map(shape => shape.id)))
        return {
          deck: next,
          selectedIds: current.selectedIds.filter(id => ids.has(id)),
          slideIndex: clamp(current.slideIndex, 0, Math.max(0, next.slides.length - 1)),
          error: null,
          // 桥接到新 rev：PNG 在后台渲染，加载完 onLoad 自动切回
          domBridgeRev: next.rev,
        }
      })
    }, [store])

    const highlightChanged = React.useCallback((ids) => {
      if (!Array.isArray(ids) || ids.length === 0) return
      const patch = {}
      for (const id of ids) patch[id] = true
      store.set(current => ({ highlights: { ...current.highlights, ...patch } }))
      timeout(() => {
        store.set(current => {
          const next = { ...current.highlights }
          for (const id of ids) delete next[id]
          return highlightsEqual(next, current.highlights) ? {} : { highlights: next }
        })
      }, 3200)
    }, [store])

    const actionsRef = React.useRef({})
    /** 等待令牌：用户点「停止等待」时自增，正在跑的 waitForAi 会自行退出。 */
    const aiWaitTokenRef = React.useRef(0)

    const adoptAiResult = React.useCallback((next) => {
      // 自己算差异：AI 走宿主工具写文件，客户端拿不到 apply 的 changedIds。
      const before = store.get().deck
      const changed = diffShapeIds(before, next)
      adoptDeck(next)
      if (changed.length > 0) highlightChanged(changed)
      return changed
    }, [adoptDeck, highlightChanged, store])

    /**
     * 等待 AI 把改动落盘。
     *
     * 判据只有一个：**rev 有没有推进**（AI 是否调了 ppt_canvas_apply）。
     * 曾经这里想用「会话 running 信号」，但拿不到，写成 `let running = false` 之后
     * 那个 `break` 永远不可达 —— 于是每次发送都把 UI 锁满 150 秒（按钮全灰）。
     * 现在改成轮询轻量的 /api/status，rev 一推进就立刻结束。
     */
    const waitForAi = React.useCallback(async (requestId, baseRev) => {
      const deadline = Date.now() + 120000
      const waitToken = ++aiWaitTokenRef.current
      let advanced = false
      while (Date.now() < deadline) {
        await new Promise(resolve => { timeout(resolve, 700) })
        if (aiWaitTokenRef.current !== waitToken) return // 被取消（用户点了停止）
        let probe
        try {
          probe = await callApi('status')
          store.set({ aiWait: { baseRev, currentRev: probe.rev, at: Date.now() } })
        } catch { continue }
        if (probe.rev > baseRev) { advanced = true; break }
      }
      try {
        const status = await callApi('history')
        store.set({ history: status })
        if (advanced || status.rev > baseRev) {
          const next = await callApi('deck', {})
          adoptAiResult(next)
          logOp(`AI 已应用修改：rev ${baseRev} → ${status.rev}`, 'ok')
          toast('AI 已应用修改', { kind: 'ok', detail: `文档已更新到 rev ${status.rev}。` })
        } else {
          logOp('AI 未产生文档改动', 'warn')
          toast('AI 没有返回修改方案', {
            kind: 'warn',
            detail: '可能它只回了文字、或没有调用 ppt_canvas_apply。可重试，或用右侧属性面板手动改。',
            action: { label: '重试', run: () => { void actionsRef.current.send() } },
          })
        }
      } catch (error) {
        toast('刷新失败', { kind: 'error', detail: describeError(error) })
      } finally {
        if (aiWaitTokenRef.current === waitToken) store.set({ sending: false, pendingRequestId: null })
      }
    }, [adoptAiResult, logOp, store, toast])

    const actions = React.useMemo(() => ({
      async openDemo() {
        store.set({ loading: true, loadingLabel: '准备内置演示文稿…', error: null })
        try {
          const next = await callApi('demo', {})
          adoptDeck(next)
          // 不自动展开面板：以前这里写 savePrefs({ open: true })，于是每次打开文稿
          // 画布都会自己弹出来挡住界面。现在只有用户点「PPT 画布」才会展开。
          logOp(`打开内置演示文稿（${next.slides.length} 页）`, 'ok')
        } catch (error) {
          store.set({ error: describeError(error) })
          toast('打开失败', { kind: 'error', detail: describeError(error) })
        } finally {
          store.set({ loading: false, loadingLabel: '' })
          await refreshHistory()
        }
      },
      async openPath(path) {
        if (!looksLikePptx(path)) {
          toast('这不是 .pptx 文件', { kind: 'warn', detail: `收到的是：${String(path).slice(0, 120)}` })
          return
        }
        store.set({ loading: true, loadingLabel: '解析 .pptx…', error: null })
        try {
          const next = await callApi('open', { path })
          adoptDeck(next)
          // 打开文档不自动展开画布（见 openDemo 的说明）
          savePrefs({ lastDir: path })
          logOp(`打开 ${next.file}（${next.slides.length} 页）`, 'ok')
        } catch (error) {
          store.set({ error: describeError(error) })
          toast('打开失败', { kind: 'error', detail: describeError(error) })
        } finally {
          store.set({ loading: false, loadingLabel: '' })
          await refreshHistory()
        }
      },

      /**
       * 把「原生对话框选中的内容」交给 Host 打开：Host 落到托管目录后再按路径打开
       * （插件是按路径读写文件的，而标准 DOM 拿不到 File 的本地路径）。
       */
      async openBytes(name, content) {
        store.set({ loading: true, loadingLabel: '读取所选文件…', error: null })
        try {
          const next = await callApi('files', { files: [{ name, content }] })
          adoptDeck(next)
          // 打开文档不自动展开画布（见 openDemo 的说明）
          logOp(`打开 ${next.file}（${next.slides.length} 页）`, 'ok')
        } catch (error) {
          store.set({ error: describeError(error) })
          toast('打开失败', { kind: 'error', detail: describeError(error) })
        } finally {
          store.set({ loading: false, loadingLabel: '' })
          await refreshHistory()
        }
      },

      /**
       * 普通应用的「打开文件」：先弹系统原生对话框；容器不支持时退回面板内浏览器。
       * @returns {Promise<void>}
       */
      async pickAndOpen() {
        if (pickPptx === null) {
          store.set({ askPath: true })
          return
        }
        let picked
        try {
          picked = await pickPptx()
        } catch (error) {
          toast('无法打开文件对话框', { kind: 'warn', detail: describeError(error) })
          store.set({ askPath: true })
          return
        }
        if (picked === null || picked === undefined) return // 用户取消
        if (typeof picked.path === 'string' && picked.path !== '') {
          await actionsRef.current.openPath(picked.path)
          return
        }
        if (typeof picked.content === 'string' && picked.content !== '') {
          await actionsRef.current.openBytes(picked.name, picked.content)
          return
        }
        store.set({ askPath: true })
      },
      async reload() {
        store.set({ loading: true, loadingLabel: '重新读取文件…' })
        try {
          const next = await callApi('deck', { force: true })
          adoptDeck(next)
          logOp('已重新读取文件', 'ok')
        } catch (error) {
          toast('重载失败', { kind: 'error', detail: describeError(error) })
        } finally {
          store.set({ loading: false, loadingLabel: '' })
          await refreshHistory()
        }
      },
      async undo() {
        try {
          const next = await callApi('undo', { steps: 1 })
          adoptDeck(next)
          logOp('撤销一步', 'ok')
        } catch (error) {
          toast('撤销失败', { kind: 'error', detail: describeError(error) })
        } finally {
          await refreshHistory()
        }
      },
      async redo() {
        try {
          const next = await callApi('redo', { steps: 1 })
          adoptDeck(next)
          logOp('重做一步', 'ok')
        } catch (error) {
          toast('重做失败', { kind: 'error', detail: describeError(error) })
        } finally {
          await refreshHistory()
        }
      },
      async manual(ops, label) {
        if (ops.length === 0) return
        const targetId = ops[0]?.id
        try {
          const result = await callApi('apply', {
            patch: { summary: label ?? '手动调整', ops },
            source: 'user',
          })
          adoptDeck(result.deck)
          highlightChanged(result.changedIds ?? (targetId === undefined ? [] : [targetId]))
          logOp(`手动调整：${label ?? ops.map(op => op.op).join('、')}`, 'user')
        } catch (error) {
          toast('调整失败', { kind: 'error', detail: describeError(error) })
        } finally {
          await refreshHistory()
        }
      },
      addDraft() {
        const text = store.get().instruction.trim()
        if (text === '') return
        store.set(current => ({ drafts: current.drafts.concat([text]), instruction: '' }))
      },
      /** 连接到一个会话（标题栏会话菜单里的「连接到最近会话」）。 */
      async newSession() {
        store.set({ sessionMenuOpen: false })
        if (selectSession === null) {
          toast('无法连接会话', { kind: 'warn', detail: '宿主没有提供会话来源。' })
          return
        }
        const result = await connectNewSession()
        if (result.ok !== true) {
          toast('连接会话失败', { kind: 'error', detail: result.message })
          return
        }
        // **必须写进 store**：Panel 每次渲染都会用 state.sessionId 覆盖 sessionIdRef.current，
        // 只改 ref 不写 store 的话，下一帧就被重置回 ''，界面永远显示「未连接」。
        store.set({ sessionId: result.sessionId })
        savePrefs({ sessionId: result.sessionId })
        logOp(`已连接会话 ${result.sessionId}`, 'ok')
      },

      async send() {
        if (promptTo === null) {
          toast('这里不能发指令', { kind: 'warn', detail: '请在对话面板的「PPT 画布」里发送。' })
          return
        }
        const snapshot = store.get()
        const text = [snapshot.instruction.trim()].concat(snapshot.drafts).filter(item => item !== '').join('；')
        if (text === '') return
        if (snapshot.selectedIds.length === 0) {
          toast('请先选择元素', { kind: 'warn', detail: '点击、Shift 多选或框选画布上的元素。' })
          return
        }
        let sessionId = typeof sessionIdRef.current === 'string' ? sessionIdRef.current : ''
        // 首次发送且还没连接：自动新建一个会话并连上（用户不需要先去别处点新建）。
        if (sessionId === '') {
          toast('正在连接会话…', { detail: '首次发送会自动连接到一个可用会话。' })
          const created = await connectNewSession()
          if (created.ok !== true) {
            toast('连接会话失败', { kind: 'error', detail: created.message })
            return
          }
          sessionId = created.sessionId
          store.set({ sessionId })
          savePrefs({ sessionId })
          await ensureInWorkspace(sessionId)
          logOp(`已连接会话 ${sessionId}`, 'ok')
        }
        const currentDeck = snapshot.deck
        const slideIndex = snapshot.slideIndex
        const elements = snapshot.selectedIds
          .map(id => findShape(currentDeck, id))
          .filter(shape => shape !== null)
          .map(selectionElement)
        if (elements.length === 0) {
          toast('选中的元素已不存在', { kind: 'warn', detail: '文档可能已被改动，请重新选择。' })
          return
        }
        const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const payload = {
          requestId,
          deckRev: currentDeck.rev,
          instruction: text,
          selectionMode: elements.length > 1 ? 'multi' : 'single',
          slideIndex,
          selectedIds: elements.map(element => element.id),
          elements,
          locale: 'zh-CN',
          createdAt: Date.now(),
        }
        store.set({ sending: true, error: null })
        try {
          await callApi('context', payload)
        } catch (error) {
          store.set({ sending: false, error: describeError(error) })
          toast('提交选区失败', { kind: 'error', detail: describeError(error) })
          return
        }
        const message = [
          '【PPT 协同编辑】我在 PPT 画布上选中了 ' + elements.length + ' 个元素：',
          elements.map(element => `- ${element.name}（${element.id}，${element.kind}）`).join('\n'),
          '',
          '我的修改要求：' + text,
          '',
          '请先调用 ppt_canvas_context（requestId=' + requestId + '）取回这些元素的完整属性（位置、尺寸、样式、层级、文本），',
          '再据此生成最小必要的 ops，调用 ppt_canvas_apply（requestId=' + requestId + '）应用；',
          '如果方案不确定，先用 dryRun: true 试算。修改会在画布上实时呈现给用户。',
        ].join('\n')
        const result = await promptTo(message, sessionId)
        if (result === undefined || result.ok !== true) {
          const detail = result?.error === undefined ? '未知错误' : `${result.error.code}: ${result.error.message}`
          store.set({ sending: false })
          toast('指令没有发送成功', { kind: 'error', detail })
          return
        }
        store.set({ drafts: [], instruction: '', sending: true })
        logOp(`已发送指令给 AI：${text}`, 'ai')
        toast('已发送给 AI', { detail: 'AI 正在生成修改方案，完成后画布会自动刷新。' })
        await waitForAi(requestId, currentDeck.rev)
      },
    }), [adoptDeck, logOp, refreshHistory, store, toast, waitForAi])

    React.useEffect(() => { actionsRef.current = actions }, [actions])

    // 会话 id 变化（含会话自愈自动改连）时持久化，重启后不再拿到失效的旧 id。
    React.useEffect(() => {
      if (state.sessionId !== '') savePrefs({ sessionId: state.sessionId })
    }, [state.sessionId])

    // 快捷键：Ctrl+Z / Ctrl+Shift+Z
    React.useEffect(() => {
      const onKey = (event) => {
        if (!store.get().open) return
        const tag = event.target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          if (event.shiftKey) actions.redo()
          else actions.undo()
        }
        if (event.key === 'Escape' && prefs.open === true) store.set({ selectedIds: [], askPath: false })
      }
      win.addEventListener('keydown', onKey)
      return () => win.removeEventListener('keydown', onKey)
    }, [actions, store])

    // 首次打开：恢复上次的文件（面板模式还要恢复「上次是打开状态」）。
    const booted = React.useRef(false)
    React.useEffect(() => {
      if (booted.current) return
      booted.current = true
      if (prefs.open !== true) return
      if (typeof prefs.lastDir === 'string' && prefs.lastDir !== '') actions.openPath(prefs.lastDir)
      else actions.openDemo()
    }, [actions])

    React.useEffect(() => { void refreshHistory() }, [refreshHistory])

    // 外部改动检测：分两种来源，处理方式不同。
    //
    //  1. **磁盘被外部程序改过**（PowerPoint 保存过）—— 必须重载，否则下一次写入
    //     会基于旧 buffer 覆盖掉别人的修改（宿主侧 apply 现在会以 staleFile 拒绝，
    //     但更早发现更好）。判据是 mtime，不是 rev：外部保存不会动宿主的 rev。
    //  2. **rev 变了**（另一处面板 / AI 工具调过了）—— 直接取内存视图刷新即可。
    React.useEffect(() => {
      let stopped = false
      const tick = async () => {
        if (stopped) return
        const snapshot = store.get()
        if (snapshot.deck === null || snapshot.sending) return
        try {
          const status = await callApi('status')
          if (stopped) return
          // 顺便收下 render 令牌（首个轮询通常就能拿到；画布首帧可能还没带上，
          // 那一帧会 403 然后退回内置重画，下一帧自动恢复精确渲染）。
          if (typeof status.renderToken === 'string' && status.renderToken !== '') {
            renderTokenValue = status.renderToken
          }

          if (status.changed === true) {
            // 就地编辑中不抢画面：只提示一次，等编辑结束再处理。
            if (snapshot.editingId !== null && snapshot.editingId !== undefined) {
              if (snapshot.externalChangeWarned !== true) {
                store.set({ externalChangeWarned: true })
                toast('文件已被其他程序修改', {
                  kind: 'warn',
                  detail: '完成当前编辑后会自动重载。注意：若同时还在 PowerPoint 里改，双方可能互相覆盖。',
                })
              }
              return
            }
            const next = await callApi('deck', { force: true })
            if (!stopped) {
              adoptDeck(next)
              store.set({ externalChangeWarned: false })
              logOp('检测到外部改动（文件被其他程序保存过），已自动重载', 'ok')
            }
            return
          }

          if (status.rev !== snapshot.deck.rev) {
            const next = await callApi('deck', {})
            if (!stopped) {
              adoptDeck(next)
              logOp(`检测到外部改动，已刷新到 rev ${next.rev}`, 'ok')
            }
          }
        } catch (error) { /* 静默：轮询失败不该打扰用户 */ }
      }
      const dispose = options.interval === undefined
        ? (() => { const handle = setInterval(tick, 4000); return () => clearInterval(handle) })()
        : options.interval(tick, 4000)
      return () => { stopped = true; dispose() }
    }, [adoptDeck, logOp, store, toast])

    // 拖拽打开：整块面板/窗口都是投放目标。
    const onDragEnter = React.useCallback((event) => {
      event.preventDefault()
      const path = extractDroppedPath(event)
      const hint = path === null
        ? '浏览器不会把本地路径交给网页 —— 请用「打开」按钮选择文件'
        : (looksLikePptx(path.path) ? null : `只支持 .pptx（收到 ${path.name || path.path}）`)
      store.set({ dragDepth: store.get().dragDepth + 1, dropHint: hint })
    }, [store])

    const onDragOver = React.useCallback((event) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }, [])

    const onDragLeave = React.useCallback((event) => {
      event.preventDefault()
      const depth = Math.max(0, store.get().dragDepth - 1)
      store.set({ dragDepth: depth, dropHint: depth === 0 ? null : store.get().dropHint })
    }, [store])

    const onDrop = React.useCallback((event) => {
      event.preventDefault()
      const dropped = extractDroppedPath(event)
      store.set({ dragDepth: 0, dropHint: null })
      if (dropped === null) {
        toast('拿不到文件路径', {
          kind: 'warn',
          detail: '浏览器出于隐私不提供本地路径。已为你打开文件浏览器，请在里面选 .pptx。',
        })
        store.set({ askPath: true })
        return
      }
      if (!looksLikePptx(dropped.path)) {
        toast('只支持 .pptx', { kind: 'warn', detail: `收到的是 ${dropped.name || dropped.path}` })
        return
      }
      logOp(`拖入文件：${dropped.path}（来自 ${dropped.from}）`, 'user')
      void actions.openPath(dropped.path)
    }, [actions, logOp, store, toast])

    const dropProps = {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    }

    if (!state.open) {
      return h('div', { className: 'dsh-ppt-launcherwrap', ...dropProps },
        h(PptPromptCard, { store, state, onOpen: () => store.set({ open: true, pptPrompt: null }) }),
        h('button', {
          className: 'dsh-ppt-launcher',
          title: '打开 PPT 协同编辑画布',
          onClick: () => store.set({ open: true, pptPrompt: null }),
        }, 'PPT 画布'),
      )
    }

    const shellClass = 'dsh-ppt-panel'
    return h('div', { className: shellClass, ...dropProps },
      h(Header, {
        store, state, deck, actions, titleBar,
        sessionIds: availableSessions,
        // Header 里点会话条目会写日志；logOp 定义在 Panel 内，必须显式传下去
        // （历史上就是漏传导致点击即 ReferenceError）。
        logOp,
      }),
      // 失败原因必须可见：state.error 以前只写不读，用户只能看到 6 秒 toast，
      // 之后就无法知道刚才为什么失败（项目硬性要求：不允许静默）。
      state.error !== null && state.error !== undefined && state.error !== ''
        ? h('div', { className: 'dsh-ppt-errorbar', role: 'alert' },
            h('span', { className: 'dsh-ppt-errorbar-text' }, state.error),
            h('button', {
              className: 'dsh-ppt-errorbar-x',
              title: '关闭',
              onClick: () => store.set({ error: null }),
            }, '×'),
          )
        : null,
      h('div', { className: 'dsh-ppt-body' },
        state.showThumbs && deck !== null ? h(ThumbRail, { store, deck, state }) : null,
        h('div', { className: 'dsh-ppt-center' },
          deck === null
            ? h('div', { className: 'dsh-ppt-welcome' },
                h('b', null, '把 .pptx 拖进来，或点下面的按钮'),
                h('p', null, '打开后：点选 / Shift 多选 / 框选画布上的元素，选中状态实时高亮。'),
                h('p', null, '输入自然语言修改要求交给 AI，修改方案会直接落到文件并刷新画布。'),
                h('div', { className: 'dsh-ppt-btnrow' },
                  h('button', { className: 'dsh-ppt-btn is-primary', onClick: () => actions.openDemo() }, '打开内置演示文稿'),
                  h('button', {
                    className: 'dsh-ppt-btn',
                    onClick: () => { void actions.pickAndOpen() },
                  }, '打开本地 .pptx'),
                ),
              )
            : h(CanvasPane, { store, state, deck, slide, actions }),
          state.loading
            ? h('div', { className: 'dsh-ppt-loading' }, h('span', { className: 'dsh-ppt-spinner' }), state.loadingLabel)
            : null,
        ),
        state.showInspector && deck !== null
          ? h(Inspector, { store, deck, state, onManualEdit: (ops, label) => actions.manual(ops, label) })
          : null,
        h(AiPane, { store, state }),
      ),
      h(InstructionBar, { store, state, actions, sessionReady, sessionDiagnostics }),
      state.log.length > 0
        ? h('div', { className: 'dsh-ppt-log' }, state.log.slice(0, 6).map(entry => h('div', {
            key: entry.id,
            className: `dsh-ppt-logrow is-${entry.kind}`,
          }, entry.text)))
        : null,
      h(PathDialog, {
        store,
        state,
        // 传入明确的路径（点列表项）或留空（用输入框里的路径）。
        // 注意：输入框绑的是 `pickerPath`，不是 `pathDraft`（后者只有点列表项时才写）。
        // 以前这里读 pathDraft，导致手动输入路径后打开的是上一次的值，空值时还静默无反应。
        onConfirm: (explicitPath) => {
          const typed = typeof explicitPath === 'string' && explicitPath !== ''
            ? explicitPath
            : String(store.get().pickerPath ?? '').trim()
          if (typed === '') {
            store.set({ error: '请先输入或选择一个 .pptx 路径' })
            return
          }
          store.set({ askPath: false })
          void actions.openPath(typed)
        },
      }),
      h(DropOverlay, { state }),
      h(Toasts, { store, state }),
    )
  }

  /** 两个高亮集合是否等价（避免无意义的重渲染）。 */
  /**
   * 找出两份 Deck 之间**真正变化**的元素 id。
   *
   * 为什么在客户端算：AI 是通过宿主工具直接写文件的，客户端拿不到 apply 返回的
   * `changedIds`（那条数据只存在于工具调用里）。以前把 changedIds 存在 ref 里等
   * 别人填，结果永远为空 —— 于是「AI 已应用修改，改动元素已高亮」这句就成了谎话。
   * 自己 diff 还有个好处：外部程序改动、撤销重做也能正确高亮。
   *
   * @param {object|null} before
   * @param {object|null} after
   * @returns {string[]}
   */
  function diffShapeIds(before, after) {
    if (before === null || before === undefined || after === null || after === undefined) return []
    const index = (deck) => {
      const map = new Map()
      for (const slide of deck.slides ?? []) {
        for (const shape of slide.shapes ?? []) {
          map.set(shape.id, shape)
        }
      }
      return map
    }
    const oldShapes = index(before)
    const newShapes = index(after)
    const changed = []
    for (const [id, next] of newShapes) {
      const prev = oldShapes.get(id)
      if (prev === undefined) { changed.push(id); continue }
      if ((prev.text?.plain ?? '') !== (next.text?.plain ?? '')) { changed.push(id); continue }
      const pg = prev.geometry ?? {}
      const ng = next.geometry ?? {}
      if (pg.x !== ng.x || pg.y !== ng.y || pg.w !== ng.w || pg.h !== ng.h || pg.rotation !== ng.rotation) { changed.push(id); continue }
      if ((prev.style?.fill?.color ?? null) !== (next.style?.fill?.color ?? null)) { changed.push(id); continue }
      if ((prev.style?.line?.color ?? null) !== (next.style?.line?.color ?? null)) { changed.push(id); continue }
      const rowKey = (shape) => JSON.stringify(shape.table?.cells ?? null)
      if (rowKey(prev) !== rowKey(next)) { changed.push(id); continue }
      const zPrev = prev.z
      const zNext = next.z
      if (zPrev !== zNext) changed.push(id)
    }
    return changed
  }

  function highlightsEqual(a, b) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) if (b[key] !== a[key]) return false
    return true
  }

  /** 注入样式表（幂等）。 */
  function installStyles() {
    if (options.styles === undefined || options.styles === '') return
    if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
    const tag = doc.createElement('style')
    tag.dataset.plugin = 'dsh-ppt-canvas'
    tag.dataset.pluginCss = STYLE_TAG_ID
    tag.textContent = options.styles
    doc.head.appendChild(tag)
  }

  /**
   * 挂载。返回 { store, openPanel, component, dispose }。
   * @param {object} [mountOptions]
   */
  // store 在 install() 里创建，client.js 取用。
  let store = null

  function install(mountOptions = {}) {
    installStyles()
    const created = createStore(initialState())
    // client.js 拿这个 store 实例给 FloatingPanel，
    // 侧边栏按钮也用它开面板，两者状态必须是一份。
    store = created

    // 全局错误可见化：未捕获的异常进面板日志（以前是「无声消失」，用户只看到画板没了）。
    const pushGlobalError = (text) => {
      try {
        created.set(current => ({
          log: [{ id: `e${Date.now()}${Math.random().toString(36).slice(2, 5)}`, text, kind: 'warn', at: Date.now() }]
            .concat(current.log).slice(0, 60),
        }))
      } catch { /* store 不可用时只留 console */ }
      console.error?.('[dsh-ppt-canvas]', text)
    }
    const onWinError = (event) => {
      const detail = event?.error?.stack ?? event?.message ?? String(event)
      pushGlobalError(`页面异常：${String(detail).slice(0, 300)}`)
    }
    const onRejection = (event) => {
      const reason = event?.reason
      pushGlobalError(`未处理的 Promise 异常：${String(reason?.stack ?? reason).slice(0, 300)}`)
    }
    win.addEventListener('error', onWinError)
    win.addEventListener('unhandledrejection', onRejection)

    const openPanel = () => {
      created.set({ open: true })
      // 不再把 open 写进 prefs：初始状态固定为最小化（见 initialState 的说明），
      // 写进去只会变成没人读的死配置。
    }

    if (mountOptions.root !== undefined && mountOptions.root !== null) {
          const root = mountOptions.root
      const ReactDOM = mountOptions.ReactDOM
      const element = h(PanelErrorBoundary, null, h(Panel, { store: created }))
      if (ReactDOM !== undefined && ReactDOM !== null && typeof ReactDOM.createRoot === 'function') {
        const reactRoot = ReactDOM.createRoot(root)
        reactRoot.render(element)
        return { store: created, openPanel, dispose: () => reactRoot.unmount() }
      }
      root.appendChild(element)
      return { store: created, openPanel, dispose: () => { root.innerHTML = '' } }
    }

    return { store: created, openPanel, component: h(PanelErrorBoundary, null, h(Panel, { store: created })), dispose: () => {} }
  }

  return {
    React,
    Panel,
    FloatingPanel,
    /** 状态容器（client.js 在 install 后取用）。 */
    store,
    createStore,
    initialState,
    install,
    savePrefs,
    extractDroppedPath,
    looksLikePptx,
    callApi,
    describeError,
    /**
     * 测试与诊断入口：真实的宿主是 React / 迷你渲染层，这里只暴露「不建 DOM 也能
     * 观察界面」的少量能力，避免测试去猜内部结构。
     */
    __forTests: {
      /** 渲染单个形状（用来核对 style 值，例如行距与内边距）。 */
      renderShape,
      /** 媒体 URL 的候选列表（核对图片地址拼得对不对）。 */
      mediaUrlCandidates,
      /**
       * 就地编辑器的定位/字号计算（**所有值都乘了 zoom**）。
       * 这是"编辑器错位"一类回归的核心公式，单独暴露出来才能精确断言。
       */
      textEditStyle,
      /**
       * 订阅 AI 事件流的实现（由 client.js 注入）。
       * 暴露出来才能测「ready 解析前就卸载 → 不得再订阅」这条泄漏回归。
       */
      watchAi,
      /**
       * 面板动作（send / newSession / openPath …）。
       * 测试用：发送后在 rev 推进时是否释放 sending，只能靠真实调用 send() 验证。
       */
      get actions() { return actionsRef.current },
      /** 展开元素直到宿主标签（例如 'button' / 'div'）。 */
      renderToTag(element, depth = 0) {
        if (element === null || element === undefined || depth > 16) return null
        if (typeof element === 'string') return element
        if (typeof element !== 'object' || element.$$typeof !== 'element') return null
        if (typeof element.type === 'function') {
          let rendered = null
          try { rendered = element.type(element.props) } catch (error) { return null }
          return this.renderToTag(rendered, depth + 1)
        }
        return element.type
      },
      openPanel() { if (store !== null) store.set({ open: true }) },
      closePanel() { if (store !== null) store.set({ open: false }) },
      getStore() { return store },
    },
  }
}
