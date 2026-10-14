/* dsh-ppt-canvas — Client half（DSH 对话面板入口）
 *
 * 把共享界面层（client/app.js）包成 DSH 客户端插件：
 *  - 侧边栏底部注册「▦ PPT 画布」按钮；
 *  - shell.overlay 注册浮层面板（标题栏可拖动 / 右下角可缩放 / 位置记忆）；
 *  - 注入宿主能力：ctx.sessions 绑定当前会话、session.prompt 发指令、
 *    uiWorkspace.pickDirectory 走原生文件选择、ctx.timeout / ctx.interval 做定时。
 *
 * 本文件与 client/app.js、client/ppt-style.js 一起由 tools/sync-client-css.mjs 内联成
 * plugin/client.js —— 那是 DSH 唯一服务的客户端文件。
 *
 * ⚠️ 修改警告：__ModuleLoader__.load 的 factory 只注入 require，不注入 module/exports。
 *    factory 的【返回值】就是模块导出 —— 直接 return { inject, apply }，
 *    任何地方都不要引用 module / exports / module.exports，
 *    否则启动时整屏 "Failed to load plugins"。
 */

window.__ModuleLoader__?.load({ id: 'dsh-ppt-canvas', factory: (require) => {
  const React = require('react')

  // timer：ctx.timeout / ctx.interval（随插件卸载清理）
  // sessions：列出现有会话，取最新那个作为指令的目标
  // sessionController：投递指令（Remote('prompt')）
  // sessions：列出现有会话（取被打开的那个）并 retain 出 binding，用 session.prompt 发指令
  const inject = ['slots', 'timer', 'sessions']

  /* __DSH_PPT_STYLES_START__ */
  const __STYLES__ = ''
  /* __DSH_PPT_STYLES_END__ */

  /* __DSH_PPT_APP_START__ */
  function createPptApp() { throw new Error('client/app.js was not inlined — run tools/sync-client-css.mjs') }
  /* __DSH_PPT_APP_END__ */

  const PANEL_GEOM_KEY = 'dsh_ppt_canvas_geom'

  /** 面板几何（位置/尺寸）持久化在 localStorage：刷新后还在原处。 */
  function loadGeometry() {
    try {
      const raw = localStorage.getItem(PANEL_GEOM_KEY)
      const parsed = raw === null ? null : JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return null
      if (parsed.x !== null && parsed.x !== undefined && !Number.isFinite(parsed.x)) return null
      return parsed
    } catch (error) {
      return null
    }
  }

  function saveGeometry(geometry) {
    try { localStorage.setItem(PANEL_GEOM_KEY, JSON.stringify(geometry)) } catch (error) { /* 忽略 */ }
  }

  function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    /**
     * 会话连接 —— **显式连接，不猜「当前会话」**。
     *
     *   1. 面板记住一个已连接的会话 id（首次发送时若为空就自动选一个）；
     *   2. 标题栏的会话按钮显示当前连的是哪个，点它可以在已有会话之间切换；
     *   3. 发送时用 `sessions.retain(id)` 取 binding，调 `binding.session.prompt(...)`。
     *
     * 会话列表与身份来源（都是**实测**出来的，不是从服务目录推的）：
     *
     *   - `ctx.get('uiWorkspace')` 在本机**不存在**（实测返回 undefined），
     *     所以一切依赖它的建会话路径都不可用 —— 代码里不再指望它。
     *   - 客户端 `sessions` 服务的真实实例上有 `list`（ObservableSnapshot 存储，
     *     形状 `{ ids, byId, phase, projectionsBySession }`），这是可靠的会话来源。
     *   - `sessions.create()` 存在但**不返回带 id 的会话**（实测），`fork` 也不返回 id。
     *     因此「新建会话」在本机没有可用入口 —— 面板改为**让用户在已有会话里选**，
     *     并且那个列表里就包含他自己正在用的会话。
     *
     * 发送契约（用 cordis_inspect_query 的 client/Service.listService 核对）：
     *
     *   sessions.retain(id, { source }) -> SessionReference
     *     reference.ready               -> Promise<SessionBinding>
     *     reference.release()           -> 释放引用（引用计数，必须还）
     *   binding.session（= ISession）
     *     .prompt(content, mode, signal?, requestId?) -> Promise<RemoteResult<{ok,value}>>
     */
    const promptSessions = ctx.get('sessions')
    let diag = promptSessions === undefined
      ? 'sessions 服务不存在'
      : (typeof promptSessions.retain === 'function' ? 'sessions.retain 可用' : 'sessions 服务没有 retain()')

    /**
     * 读会话列表快照。`list` 是 ObservableSnapshot：有 `getSnapshot()` 就直接用，
     * 否则把实例本身当作快照（两种形态都兼容）。
     * @returns {{ ids: string[], byId: object } | null}
     */
    const sessionListSnapshot = () => {
      const store = promptSessions?.list
      if (store === undefined || store === null) return null
      let snapshot = store
      if (typeof store.getSnapshot === 'function') {
        try { snapshot = store.getSnapshot() } catch { return null }
      }
      if (snapshot === null || typeof snapshot !== 'object') return null
      const byId = snapshot.byId ?? {}
      const ids = Array.isArray(snapshot.ids) ? snapshot.ids.slice() : Object.keys(byId)
      return { ids, byId, phase: snapshot.phase }
    }

    /** 当前可选的会话 id 列表（最新在后）。 */
    const listSessionIds = () => {
      const snapshot = sessionListSnapshot()
      if (snapshot === null) return []
      const fromStore = snapshot.ids.map(id => snapshot.byId?.[id]?.id ?? id)
      return [...new Set(fromStore)].filter(id => typeof id === 'string' && id !== '')
    }

    /** 诊断文本（面板上会显示）。 */
    const sessionDiagnostics = () => diag

    /**
     * AI 的思考过程与回复 —— 从会话事件流里读。
     *
     * 数据形状（实测自 `dsh-api-session-controller` 的客户端实现）：
     *
     *   reference.binding.eventSource        -> ObservableSnapshot
     *     .getSnapshot()                     -> { entries, hasMore, revision, change }
     *       entries[i] = { type: 'event'|'transient', event }
     *         'event' 条目：event.type === 'assistant/message'
     *                       event.data.message.content = [{ type:'reasoning'|'text', text }]
     *         'transient' 条目：event.data.chunk = { type:'reasoning'|'text', … }
     *                       text 分片是 text-delta（增量），reasoning 是整块 text。
     *
     * 订阅要在 retain 出来的 binding 上做；会话还没连接时没有可订阅的源，
     * 所以这里对外只暴露「最近一次读到的内容」，由面板按节拍读取。
     */
    const aiState = { thinking: '', reply: '', error: null, sessionId: '' }

    /** 从一份事件窗口里抽出「最近一轮」的 reasoning 与正文。 */
    const extractAi = (window) => {
      const entries = Array.isArray(window?.entries) ? window.entries : []
      let durable = null
      let liveThinking = ''
      const liveText = new Map()
      for (const entry of entries) {
        const event = entry?.event
        if (event === null || event === undefined) continue
        if (event.type === 'assistant/message') {
          const content = event.data?.message?.content ?? event.data?.content
          if (Array.isArray(content)) durable = content
          continue
        }
        // 实时分片（当前这一轮还在跑）
        const chunk = event.data?.chunk
        if (chunk === null || chunk === undefined) continue
        if (chunk.type === 'reasoning' && typeof chunk.text === 'string') {
          liveThinking = chunk.text
        } else if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          const index = typeof chunk.index === 'number' ? chunk.index : 0
          liveText.set(index, (liveText.get(index) ?? '') + chunk.text)
        }
      }

      let thinking = ''
      let reply = ''
      for (const block of durable ?? []) {
        if (block?.type === 'reasoning' && typeof block.text === 'string') thinking += block.text
        else if (block?.type === 'text' && typeof block.text === 'string') reply += block.text
      }
      if (reply === '' && liveText.size > 0) {
        reply = [...liveText.entries()].sort((a, b) => a[0] - b[0]).map(pair => pair[1]).join('')
      }
      if (thinking === '') thinking = liveThinking
      return { thinking, reply }
    }

    /**
     * 订阅当前已连接会话的事件流。返回取消订阅的函数（拿不到会话就返回 no-op）。
     * @param {string} sessionId
     * @param {(state: {thinking: string, reply: string, error: string|null}) => void} emit
     */
    const watchAi = (sessionId, emit) => {
      if (promptSessions === undefined || typeof promptSessions.retain !== 'function') return () => {}
      if (typeof sessionId !== 'string' || sessionId === '') return () => {}
      let reference
      let unsubscribe = () => {}
      try {
        reference = promptSessions.retain(sessionId, { source: 'controllerOperation' })
        reference.ready.then((binding) => {
          const source = binding?.eventSource
          if (source === undefined || typeof source.subscribe !== 'function') {
            emit({ thinking: '', reply: '', error: '会话没有事件源（eventSource）' })
            return
          }
          const publish = () => {
            try {
              const extracted = extractAi(source.getSnapshot())
              emit({ ...extracted, error: null })
            } catch (error) {
              emit({ thinking: '', reply: '', error: error instanceof Error ? error.message : String(error) })
            }
          }
          publish()
          unsubscribe = source.subscribe(publish)
        }, (error) => {
          emit({ thinking: '', reply: '', error: `取会话失败：${error instanceof Error ? error.message : String(error)}` })
        })
      } catch (error) {
        emit({ thinking: '', reply: '', error: error instanceof Error ? error.message : String(error) })
      }
      return () => {
        try { unsubscribe() } catch { /* 忽略 */ }
        try { reference?.release() } catch { /* 忽略 */ }
      }
    }

    /** 面板按节拍读取的接口。 */
    const aiSnapshot = () => ({ ...aiState })

    /**
     * prompt：给定会话 id 就投递。连不上或投递失败都返回结构化错误。
     * @param {string} text
     * @param {string} sessionId
     */
    const promptTo = promptSessions === undefined || typeof promptSessions.retain !== 'function'
      ? null
      : async (text, sessionId) => {
          if (typeof sessionId !== 'string' || sessionId === '') {
            return { ok: false, error: { code: 'no-session', message: '还没有连接会话' } }
          }
          let reference
          try {
            reference = promptSessions.retain(sessionId, { source: 'controllerOperation' })
            const binding = await reference.ready
            const requestId = `ppt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            // 'queue'：当前有回合在跑时排队，不打断它。
            const result = await binding.session.prompt([{ type: 'text', text }], 'queue', undefined, requestId)
            if (result !== null && typeof result === 'object' && result.ok === true) {
              diag = `已投递到 ${sessionId}`
              return { ok: true }
            }
            const failure = result?.error ?? {}
            diag = `投递被拒：${failure.code ?? 'unknown'} ${failure.message ?? ''}`
            return { ok: false, error: { code: failure.code ?? 'rejected', message: failure.message ?? '会话没有接受这条指令' } }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            diag = `投递失败：${message}`
            return { ok: false, error: { code: 'prompt-failed', message } }
          } finally {
            try { reference?.release() } catch { /* 释放失败不影响本次结果 */ }
          }
        }

    /**
     * 建会话：**按方法逐个试探**，不假设某个服务一定有哪些方法。
     *
     * 起因：服务目录（Service.listService）里 `uiWorkspace.startSession` 是文档化的方法，
     * 但实际运行时这个服务上没有它 —— 目录描述的是能力契约，不等于这个组合里真的注入了。
     * 所以这里不写死一条路，而是把几种候选依序试一遍，并把「实际可用的方法名」写进错误，
     * 让下一次能直接照实现改。
     *
     * @returns {Promise<{ ok: boolean, sessionId?: string, error?: { code: string, message: string } }>}
     */
    /**
     * 新建会话。
     *
     * **本机没有可用的建会话入口**（实测）：`uiWorkspace` 服务不存在，
     * `sessions.create()` / `sessions.fork()` 都不返回带 id 的会话。
     * 所以这里不再假装能建，而是**从真实会话列表里挑一个连上** —— 列表里就包含
     * 用户自己正在用的会话（`sessions.list` 是实测存在且可用的来源）。
     *
     * @returns {Promise<{ ok: boolean, sessionId?: string, error?: { code: string, message: string } }>}
     */
    const selectSession = () => {
      const ids = listSessionIds()
      if (ids.length === 0) {
        const keys = promptSessions === undefined ? "服务缺失" : Object.keys(promptSessions).join(",")
        const message = `宿主没有返回任何会话（sessions 上的键：[${keys}]）。`
          + "请先在左侧打开或新建一个对话，然后点标题栏的会话按钮选择它。"
        diag = message
        return { ok: false, error: { code: "no-session", message } }
      }
      const picked = ids[ids.length - 1]
      diag = `已连接会话 ${picked}（共 ${ids.length} 个）`
      return { ok: true, sessionId: picked }
    }

    /**
     * 把会话归入工作区，让它在左侧列表里和普通对话一样出现。
     *
     * 用 `workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId?)`
     * —— 契约说明是「Move a Session within one Workspace account」，
     * `beforeSessionId` 省略即追加到末尾。工作区 id 由面板从 `useWorkspaces`
     * 快照里拿到（`workspaceId` → 逐个回退到服务试探）。
     *
     * 这是**尽力而为**：宿主不认这个会话（或没有工作区）时只记诊断，不报错 ——
     * 会话本身在 `sessions.list` 里，连接与发送都不受影响。
     *
     * @param {string} sessionId
     * @param {string} [workspaceId]
     * @returns {Promise<{ ok: boolean, message?: string }>}
     */
    const attachToWorkspace = async (sessionId, workspaceId) => {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { ok: false, message: '没有会话 id' }
      }
      const workspaces = ctx.get('workspaces')
      if (workspaces === undefined || typeof workspaces.insertSessionBefore !== 'function') {
        diag = '宿主的 workspaces 服务不可用，无法把会话归入工作区'
        return { ok: false, message: diag }
      }
      let target = typeof workspaceId === 'string' && workspaceId !== '' ? workspaceId : undefined
      if (target === undefined) {
        for (const method of ['list', 'views', 'all']) {
          if (typeof workspaces[method] !== 'function') continue
          try {
            const list = await workspaces[method]()
            const first = Array.isArray(list) ? list[0] : undefined
            target = first?.workspaceId ?? first?.id
            if (target !== undefined) break
          } catch { /* 换下一个 */ }
        }
      }
      if (target === undefined) {
        diag = '拿不到工作区 id，无法把会话归入工作区'
        return { ok: false, message: diag }
      }
      try {
        await workspaces.insertSessionBefore(target, sessionId)
        diag = `已把会话 ${sessionId} 归入工作区 ${target}`
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        diag = `归入工作区失败：${message}`
        return { ok: false, message }
      }
    }

    /**
     * 走原生文件选择（返回绝对路径）。
     * 注意 `uiWorkspace` 在本机不存在（实测），所以这里必须容错：拿不到就返回 null，
     * 面板会自动退回「手动输入路径」的对话框。
     */
    const pickPath = async () => {
      const picker = ctx.get('uiWorkspace')
      if (picker === undefined || typeof picker.pickDirectory !== 'function') return null
      try {
        const picked = await picker.pickDirectory()
        return typeof picked === 'string' && picked !== '' ? picked : null
      } catch {
        return null
      }
    }

    /**
     * 用**系统原生的「打开文件」对话框**选一份 .pptx。
     *
     * 这是普通应用里那种打开方式：隐藏的 `<input type="file">` 加 `.click()`
     * 触发浏览器/Electron 的原生文件对话框 —— DSH 自己的输入框就是这么做的
     * （`filePicker.open()` 的实现就是 `fileInputRef.current?.click()`）。
     *
     * 拿到 `File` 之后有两条路：
     *   1. Electron 会给 `file.path`（真实绝对路径）—— 直接用，省一次传输；
     *   2. 标准 DOM 没有路径 —— 读成 base64 交给 Host，由 Host 落到托管目录再打开
     *      （插件是按路径读写文件的）。
     *
     * @returns {Promise<{ name?: string, path?: string, content?: string } | null>} 取消时为 null
     */
    const pickPptx = () => new Promise((resolve, reject) => {
      let input
      try {
        input = document.createElement('input')
      } catch (error) {
        reject(new Error(`无法创建文件输入元素：${error instanceof Error ? error.message : String(error)}`))
        return
      }
      input.type = 'file'
      input.accept = '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'
      input.style.display = 'none'
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        try { input.remove() } catch { /* 已经被移除 */ }
        resolve(value)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (file === undefined || file === null) { finish(null); return }
        if (typeof file.path === 'string' && file.path !== '') {
          finish({ path: file.path, name: file.name })
          return
        }
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('读取所选文件失败'))
        reader.onload = () => {
          const url = String(reader.result ?? '')
          const comma = url.indexOf(',')
          finish({ name: file.name, content: comma === -1 ? '' : url.slice(comma + 1) })
        }
        reader.readAsDataURL(file)
      })
      // 取消时浏览器不发 change：窗口重新聚焦后再等一小会儿收尾，避免 Promise 永远挂着。
      const onFocus = () => {
        setTimeout(() => { if (!settled) finish(null) }, 800)
        try { win.removeEventListener('focus', onFocus) } catch { /* 忽略 */ }
      }
      try { win.addEventListener('focus', onFocus) } catch { /* 容器可能不支持 */ }
      document.body.appendChild(input)
      input.click()
    })

    /**
     * 目录浏览。**这是选 .pptx 的唯一可行入口**：宿主没有选文件的对话框
     * （`pickDirectory` 按设计只给目录，桌面端 Electron 也只注册了 openDirectory），
     * 所以面板自己列目录、只把 .pptx 作为可打开项。
     * 省略 path 即宿主主目录。
     * @param {string} [path]
     */
    const listDirectory = async (path) => {
      const browser = ctx.get('uiWorkspace')
      if (browser === undefined || typeof browser.listDirectory !== 'function') return null
      const listing = await browser.listDirectory(path)
      return listing ?? null
    }

    const app = createPptApp({
      React,
      document,
      window,
      apiBase: '/dsh-ppt/api',
      mode: 'panel',
      storageKey: 'dsh_ppt_canvas_v1',
      styleTagId: 'dsh-ppt-canvas-style',
      styles: __STYLES__,
      promptTo,
      selectSession,
      listSessionIds,
      attachToWorkspace,
      watchAi,
      aiSnapshot,
      sessionDiagnostics,
      pickPath,
      pickPptx,
      listDirectory,
      timeout: (fn, ms) => ctx.timeout(fn, ms),
      interval: (fn, ms) => ctx.interval(fn, ms),
    })

    const installed = app.install()

    /**
     * 面板外壳。
     *
     * 会话列表**直接问服务要**（`sessions.list` 实测存在且可用）。此前依赖
     * `shell.overlay` 的 `useSessions` hook —— 本机那条路拿不到数据（hook 能调、
     * 但快照为空），而服务面是确定可用的。
     */
    const FloatingPanel = (props) => {
      let sessionIds = []
      try {
        sessionIds = listSessionIds()
      } catch { sessionIds = [] }
      return React.createElement(app.FloatingPanel, {
        sessionIds,
        store: installed.store,
        openPanel: installed.openPanel,
        geometry: {
          load: loadGeometry,
          save: saveGeometry,
          initial: { width: 1180, height: 760 },
        },
        titleBar: {
          draggable: true,
        },
      })
    }

    // 侧边栏底部：打开画布的入口按钮
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'ppt-canvas', order: 62, label: 'PPT 画布' },
      (props) => React.createElement('button', {
        className: 'dsh-ppt-footbtn',
        title: '打开 PPT 协同编辑画布',
        onClick: () => installed.openPanel(),
      }, props !== null && props !== undefined && props.wide === true ? '▦ PPT 画布' : '▦'),
    ))

    // 全屏浮层：画布主体（点击穿透由 CSS 控制）
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'ppt-canvas-panel', order: 90, label: 'PPT 协同编辑画布' },
      // slot 会把 ownerProps/standardProps（含 useSessions 等 hook）作为参数传进来，
      // 必须原样透传给面板外壳，否则拿不到当前会话。
      (props) => React.createElement(FloatingPanel, props ?? {}),
    ))

    // 诊断/测试入口（不参与正常渲染路径）
    return { app, store: installed.store }
  }

  return { inject, apply }
} })
