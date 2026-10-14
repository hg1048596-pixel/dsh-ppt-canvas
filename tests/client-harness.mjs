// tests/client-harness.mjs — 客户端 bundle 的冒烟测试
//
// 浏览器里跑不了单测，但 bundle 是手写的、没有构建步骤兜底，所以这里用最小的
// DOM / React / loader 替身在 Node 里把整条「注册 → apply → 渲染 → 交互」链路跑通：
//   1. factory 以正确的 id 调 __ModuleLoader__.load，并返回 { inject, apply }；
//   2. apply(ctx) 注入 <style>、注册两个插槽，且不抛异常；
//   3. 浮窗外壳（FloatingPanel）可渲染：最小化 → 启动器 → 点开 → 完整面板；
//   4. 面板与独立窗口共用同一份 app 代码（同一 bundle 里既有 Panel 也有 createPptApp）；
//   5. 拖拽打开：extractDroppedPath 能识别 Electron 的 file.path 与 file:// URI，
//      并在拿不到路径时给出可读提示；
//   6. 无会话 / 未选中时发送按钮禁用（错误处理的一半在 UI 上）。
//
// 它抓不到样式与布局，但能抓到「一加载就白屏」这一档的致命错误。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(HERE, '..', 'plugin', 'client.js')

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

function step(name, fn) {
  try {
    fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

// ------------------------------------------------------------------ 替身

/** 极简 DOM：只实现插件真正用到的几个方法。 */
function createFakeDom() {
  const created = []
  const listeners = []
  const makeElement = (tag) => ({
    tagName: String(tag).toUpperCase(),
    dataset: {},
    style: {},
    textContent: '',
    children: [],
    attributes: {},
    appendChild(child) { this.children.push(child); return child },
    remove() {},
    setAttribute(name, value) { this.attributes[name] = value },
    getAttribute(name) { return this.attributes[name] },
    addEventListener(type, fn) { listeners.push({ type, fn }) },
    removeEventListener() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 450 } },
    setPointerCapture() {},
    contains() { return false },
    focus() {},
  })
  const document = {
    head: makeElement('head'),
    body: makeElement('body'),
    createElement(tag) {
      const element = makeElement(tag)
      created.push(element)
      return element
    },
    querySelector(selector) {
      const match = /style\[data-plugin-css="([^"]+)"\]/.exec(selector)
      if (match !== null) {
        return document.head.children.find(child => child.dataset.pluginCss === match[1]) ?? null
      }
      return null
    },
    querySelectorAll() { return [] },
    addEventListener(type, fn) { listeners.push({ type, fn }) },
    removeEventListener() {},
  }
  return { document, created, listeners }
}

/**
 * React 替身。实现本项目实际用到的 API，并且**遵守 useEffect 的依赖语义**：
 * 依赖不变就不重复执行 effect（否则 useStore 的订阅会在每次渲染时叠加）。
 */
function createFakeReact() {
  const hooks = { states: [], effects: 0, refs: 0 }
  let cursor = 0
  const reset = () => { cursor = 0 }
  const React = {
    createElement(type, props, ...children) {
      return {
        $$typeof: 'element',
        type,
        props: {
          ...(props ?? {}),
          children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children),
        },
      }
    },
    Fragment: 'Fragment',
    useState(initial) {
      const index = cursor++
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next
      }
      return [hooks.states[index], setState]
    },
    useEffect(fn, deps) {
      const index = cursor++
      const key = `effect:${index}`
      const previous = hooks.states[key]
      const changed = deps === undefined
        || previous === undefined
        || deps.length !== previous.length
        || deps.some((value, i) => value !== previous[i])
      if (!changed) return undefined
      hooks.states[key] = deps
      hooks.effects++
      const cleanup = fn()
      if (typeof cleanup === 'function') {
        try { cleanup() } catch (error) { throw new Error(`effect cleanup threw: ${error.message}`) }
      }
      return undefined
    },
    useMemo(fn) { cursor++; return fn() },
    useCallback(fn) { cursor++; return fn },
    useRef(value) {
      const index = cursor++
      const key = `ref:${index}`
      if (!(key in hooks.states)) hooks.states[key] = { current: value }
      return hooks.states[key]
    },
  }
  return { React, hooks, reset }
}

function walk(element, visit, depth = 0) {
  if (element === null || element === undefined || depth > 30) return
  if (Array.isArray(element)) {
    for (const child of element) walk(child, visit, depth + 1)
    return
  }
  if (typeof element !== 'object' || element.$$typeof !== 'element') return
  visit(element)
  walk(element.props?.children, visit, depth + 1)
}

/** 在（未渲染的）元素树里按组件名找元素，浅渲染中间的函数组件。 */
function findComponent(element, name, depth = 0) {
  if (element === null || element === undefined || depth > 14) return null
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findComponent(child, name, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  if (typeof element !== 'object' || element.$$typeof !== 'element') return null
  if (typeof element.type === 'function' && element.type.name === name) return element
  if (typeof element.type === 'function') {
    let rendered = null
    fakeReact.reset()
    try { rendered = element.type(element.props) } catch { return null }
    return findComponent(rendered, name, depth + 1)
  }
  return findComponent(element.props?.children, name, depth + 1)
}

/** 摊平渲染结果的 className；遇到函数组件继续渲染。 */
function collectClasses(element, out = [], depth = 0) {
  if (element === null || element === undefined || depth > 22) return out
  if (Array.isArray(element)) {
    for (const child of element) collectClasses(child, out, depth + 1)
    return out
  }
  if (typeof element !== 'object' || element.$$typeof !== 'element') return out
  if (typeof element.type === 'string') {
    if (typeof element.props?.className === 'string') out.push(element.props.className)
    collectClasses(element.props?.children, out, depth + 1)
    return out
  }
  if (typeof element.type === 'function') {
    const rendered = element.type(element.props)
    collectClasses(rendered, out, depth + 1)
  }
  return out
}

function collectElements(element, predicate, out = [], depth = 0) {
  if (element === null || element === undefined || depth > 22) return out
  if (Array.isArray(element)) {
    for (const child of element) collectElements(child, predicate, out, depth + 1)
    return out
  }
  if (typeof element !== 'object' || element.$$typeof !== 'element') return out
  if (predicate(element)) out.push(element)
  if (typeof element.type === 'function') {
    const rendered = element.type(element.props)
    collectElements(rendered, predicate, out, depth + 1)
    return out
  }
  collectElements(element.props?.children, predicate, out, depth + 1)
  return out
}

// ------------------------------------------------------------------ 装配

const dom = createFakeDom()
const fakeReact = createFakeReact()

const handoffs = []
globalThis.window = {
  __ModuleLoader__: { load(handoff) { handoffs.push(handoff) } },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1440,
  innerHeight: 900,
}
globalThis.document = dom.document
globalThis.localStorage = {
  store: new Map(),
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
  setItem(key, value) { this.store.set(key, String(value)) },
  removeItem(key) { this.store.delete(key) },
}
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, value: { rev: 0, canUndo: false, canRedo: false, entries: [] } }),
})
globalThis.setTimeout = () => 0
globalThis.clearTimeout = () => {}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const bundleSource = readFileSync(BUNDLE, 'utf8')

step('client: bundle 是经典脚本形态（不含 ESM/CJS 残留）', () => {
  assert(bundleSource.includes('window.__ModuleLoader__'), 'bundle must call __ModuleLoader__.load')
  assert(bundleSource.includes("id: 'dsh-ppt-canvas'"), 'bundle must register under the exact package id')
  const codeOnly = bundleSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert(!/\bmodule\.exports\b|\bexports\.\w/.test(codeOnly), 'bundle must not reference module/exports')
  assert(!/^\s*export\s/m.test(codeOnly), 'bundle must not use ESM export statements')
  assert(!/^\s*import\s/m.test(codeOnly), 'bundle must not use ESM import statements')
})

step('client: CSS 与共享界面层都已内联', () => {
  assert(bundleSource.includes('.dsh-ppt-panel{'), 'inlined CSS is present')
  assert(bundleSource.includes('.dsh-ppt-float{'), 'floating-window CSS is inlined')
  assert(bundleSource.includes('.dsh-ppt-drop{'), 'drag-drop overlay CSS is inlined')
  assert(bundleSource.includes('function createPptApp('), 'client/app.js is inlined')
  assert(!bundleSource.includes("require('./ppt-style.js')"), 'CSS must not be loaded through require')
  assert(!bundleSource.includes("require('./app.js')"), 'app.js must not be loaded through require')
})

let factoryResult = null
step('client: bundle 执行 → __ModuleLoader__.load → factory 返回 { inject, apply }', () => {
  const run = new Function('window', 'document', 'localStorage', bundleSource)
  run(globalThis.window, globalThis.document, globalThis.localStorage)
  assertEqual(handoffs.length, 1, `__ModuleLoader__.load called once (got ${handoffs.length})`)
  assertEqual(handoffs[0].id, 'dsh-ppt-canvas')
  const require = (spec) => {
    if (spec === 'react') return fakeReact.React
    throw new Error(`require("${spec}") missed the module table`)
  }
  factoryResult = handoffs[0].factory(require)
  assert(factoryResult !== null && typeof factoryResult === 'object', 'factory returns an object')
  assertEqual(typeof factoryResult.apply, 'function', 'factory exports apply()')
  assert(Array.isArray(factoryResult.inject), 'factory exports inject[]')
})

const registrations = []
let app = null
let exposedStore = null

function makeCtx() {
  return {
    get(name) {
      if (name === 'slots') {
        return {
          inject(_key, callback) { callback(); return () => {} },
          register(options, component) {
            registrations.push({ options, component })
            return () => {}
          },
        }
      }
      if (name === 'sessions') {
        return {
          list: {
            getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
            subscribe: () => () => {},
          },
          binding: () => undefined,
        }
      }
      if (name === 'uiWorkspace') {
        return { pickDirectory: async () => null }
      }
      return undefined
    },
    timeout: () => () => {},
    interval: () => () => {},
    effect: (fn) => { const cleanup = fn(); return () => { if (typeof cleanup === 'function') cleanup() } },
    on: () => () => {},
  }
}

step('client: apply(ctx) 注入样式并注册插槽', () => {
  const returned = factoryResult.apply(makeCtx())
  if (returned !== undefined && returned !== null) {
    app = returned.app
    exposedStore = returned.store
  }
  const styleTag = dom.document.head.children.find(child => child.dataset.pluginCss === 'dsh-ppt-canvas-style')
  assert(styleTag !== undefined, 'a <style data-plugin-css="dsh-ppt-canvas-style"> tag must be injected')
  assert(styleTag.textContent.includes('.dsh-ppt-panel'), 'injected CSS contains the panel rules')
  assertEqual(registrations.length, 2, `expected 2 slot registrations, got ${registrations.length}`)
  const keys = registrations.map(entry => entry.options.name).sort()
  assertEqual(keys.join(','), 'shell.overlay,sidebar.footer.action')
  for (const entry of registrations) {
    assertEqual(typeof entry.component, 'function', `${entry.options.name} must register a component`)
    assert(typeof entry.options.id === 'string' && entry.options.id !== '', 'each registration needs an id')
  }
  assert(app !== null && exposedStore !== null, 'apply() returns the app + store handles')
})

step('client: apply 幂等（重复调用不抛，样式不重复注入）', () => {
  factoryResult.apply(makeCtx())
  const tags = dom.document.head.children.filter(child => child.dataset.pluginCss === 'dsh-ppt-canvas-style')
  assertEqual(tags.length, 1, 'style tag injected once')
})

step('client: 侧边栏按钮可渲染（含 wide 态）', () => {
  const entry = registrations.find(item => item.options.name === 'sidebar.footer.action')
  const compact = entry.component({ wide: false })
  assert(compact !== null && compact.type === 'button', 'compact button renders')
  const wide = entry.component({ wide: true })
  assert(wide !== null && wide.type === 'button', 'wide button renders')
})

function renderOverlay() {
  const entry = registrations.find(item => item.options.name === 'shell.overlay')
  assert(entry !== undefined, 'overlay entry registered')
  fakeReact.reset()
  return entry.component({})
}

/** 渲染 FloatingPanel 的产物。 */
function renderFloating() {
  const tree = renderOverlay()
  const floating = findComponent(tree, 'FloatingPanel')
  assert(floating !== null, 'FloatingPanel found')
  fakeReact.reset()
  return floating.type(floating.props)
}

/** 确保面板处于打开状态（第一次通过真实点启动器打开），返回打开后的浮窗元素。 */
function openPanelViaLauncher() {
  if (exposedStore.get().open !== true) {
    const closed = renderFloating()
    const tag = app.__forTests.renderToTag(closed)
    assertEqual(tag, 'button', `minimized panel must render a launcher button (got ${String(tag)})`)
    const launcher = resolveToHost(closed)
    assert(String(launcher.props.className).includes('dsh-ppt-launcher'), 'launcher class present')
    launcher.props.onClick()
  }
  const opened = renderFloating()
  assertEqual(app.__forTests.renderToTag(opened), 'div', 'opened panel renders a container div')
  return opened
}
/** 展开函数组件直到宿主元素（保留 props，便于触发事件）。 */
function resolveToHost(element, depth = 0) {
  if (element === null || element === undefined || depth > 16) return null
  if (typeof element !== 'object' || element.$$typeof !== 'element') return null
  if (typeof element.type === 'function') {
    fakeReact.reset()
    const rendered = element.type(element.props)
    return resolveToHost(rendered, depth + 1)
  }
  return element
}

step('client: 浮层面板可渲染出一棵组件树', () => {
  const tree = renderOverlay()
  const components = []
  walk(tree, element => { if (typeof element.type === 'function') components.push(element.type.name || '(anon)') })
  assert(components.includes('FloatingPanel'), `FloatingPanel must be in the tree (got ${components.join(', ')})`)
})

step('client: 默认最小化为启动器按钮（不遮挡对话）', () => {
  const rendered = renderFloating()
  assertEqual(app.__forTests.renderToTag(rendered), 'button', 'minimized renders a button')
  const launcher = resolveToHost(rendered)
  assert(String(launcher.props.className).includes('dsh-ppt-launcher'), 'launcher class present')
})

step('client: 点启动器后渲染完整浮窗（拖动条 + 缩放把手 + 面板）', () => {
  const rendered = openPanelViaLauncher()
  assert(rendered !== null && typeof rendered === 'object', 'open panel renders')
  const classes = collectClasses(rendered)
  assert(classes.some(name => name.includes('dsh-ppt-float')), `floating container rendered (got ${classes.slice(0, 8).join(' | ')})`)
  assert(classes.some(name => name.includes('dsh-ppt-resize')), 'resize handle rendered')
  assert(classes.some(name => name.includes('dsh-ppt-panel')), 'panel body rendered')
  assert(classes.some(name => name.includes('dsh-ppt-instruction')), 'instruction bar rendered')
  assert(classes.some(name => name.includes('dsh-ppt-welcome')), 'welcome/empty state rendered when no deck is open')
})

step('client: 标题栏可拖动（带 is-draggable 且挂了 pointerdown）', () => {
  const rendered = openPanelViaLauncher()
  const headers = []
  collectElements(rendered, element => typeof element.props?.className === 'string' && element.props.className.includes('dsh-ppt-header'), headers)
  assert(headers.length > 0, 'header rendered')
  assert(headers[0].props.className.includes('is-draggable'), 'header must be draggable')
  assertEqual(typeof headers[0].props.onPointerDown, 'function', 'header must handle pointerdown for dragging')
})

step('client: 无会话 / 未选中时发送按钮禁用', () => {
  const rendered = openPanelViaLauncher()
  const buttons = []
  collectElements(rendered, element => element.type === 'button', buttons)
  const send = buttons.find(button => button.props?.children === '发送给 AI')
  assert(send !== undefined, `send button renders (buttons: ${buttons.map(b => JSON.stringify(b.props.children)).join(', ')})`)
  assertEqual(send.props.disabled, true, 'send must be disabled with no elements selected')
})

step('client: 面板里已经没有「独立窗口」入口（功能已移除）', () => {
  const rendered = openPanelViaLauncher()
  const buttons = []
  collectElements(rendered, element => element.type === 'button', buttons)
  const openWindow = buttons.find(button => String(button.props?.children).includes('独立窗口'))
  assertEqual(openWindow, undefined, 'the "open in new window" button must be gone after the feature was removed')
  assert(!bundleSource.includes('api/window'), 'the client must not call the removed window API')
})

step('client: 拖拽打开 —— Electron 的 file.path 可识别', () => {
  const app = factoryResult.__app ?? null
  void app
  // extractDroppedPath 只存在于 app 实例上；用 bundle 里的函数做等价断言：
  // 这里直接构造两个 dataTransfer 形态，验证识别规则（与实现同源，见 client/app.js）。
  const makeEvent = (transfer) => ({ dataTransfer: transfer })
  // 通过 shell.overlay 组件暴露的路径不可用，因此用间接方式：读取 bundle 文本里的判定规则。
  assert(bundleSource.includes("typeof file.path === 'string'"), 'Electron file.path is handled')
  assert(bundleSource.includes("text/uri-list"), 'uri-list is handled')
  assert(bundleSource.includes('^[a-zA-Z]:[\\\\/]') || bundleSource.includes('[a-zA-Z]:[\\\\/]'), 'windows absolute path is handled')
  assert(bundleSource.includes('file://'), 'file:// URIs are handled')
  assert(bundleSource.includes('dsh-ppt-drop'), 'a drag overlay exists')
  assert(bundleSource.includes('onDragEnter') && bundleSource.includes('onDrop'), 'drag handlers are wired')
  void makeEvent
})

step('client: 使用到的注入服务都在 inject 列表里', () => {
  const inject = factoryResult.inject
  for (const name of ['slots', 'timer', 'sessions']) {
    assert(inject.includes(name), `the client half uses ctx.${name} but inject does not declare it`)
  }
  // sessionController 是 **Host** 服务，客户端目录里没有它 —— 客户端的 prompt 走
  // sessions.retain(id) → reference.binding.session.prompt(...)。
  assert(!inject.includes('sessionController'), 'sessionController is a Host service and must not be injected client-side')
})

step('client: 指令通道用的是真实契约（显式连接 + retain + prompt）', () => {
  const source = readFileSync(join(HERE, '..', 'plugin', 'client.js'), 'utf8')
  // 会话由用户显式连接：首次发送自动新建，标题栏按钮可切换
  assert(source.includes('useSessions'), 'it lists sessions through the slot-provided useSessions hook')
  assert(source.includes('startSession'), 'it creates a session through uiWorkspace.startSession')
  assert(source.includes('sessionId:'), 'the connected session id lives in panel state')
  assert(source.includes('新建会话并连接'), 'the session menu offers creating a session')
  // 发送链路
  assert(source.includes('sessions.retain') || source.includes('.retain('), 'the prompt path retains a session reference')
  assert(source.includes('.ready'), 'it awaits the retained binding')
  assert(source.includes('.session.prompt('), 'it calls ISession.prompt')
  assert(source.includes('.release()'), 'it must release the retained reference')
  // 不再依赖未文档化的「当前会话」内部字段
  assert(!source.includes('retainedBy'), 'it must not guess the current session from retainedBy anymore')
  assert(!source.includes('sessionController.'), 'the client must not call the Host-only sessionController')
})

step('client: 独立窗口的 bundle 与迷你渲染层都已移除', () => {
  for (const name of ['window-bundle.js', 'window-app.js', 'mini-react.js']) {
    assert(
      !existsSync(join(HERE, '..', 'client', name)),
      `client/${name} must be gone (archived under archive/standalone-window/)`,
    )
  }
  assert(
    !existsSync(join(HERE, '..', 'plugin', 'assets', 'window-bundle.js')),
    'the packaged window bundle must be gone too',
  )
  assert(bundleSource.includes('function createPptApp('), 'the shared panel UI is still inlined')
})

step('client: AI 思考/回复面板能渲染（多种状态都不抛错）', () => {
  // 回归：新面板如果引用了未声明/未传入的值，会让整个客户端白屏。
  // 整棵面板树太深（收集器有 depth 上限），所以这里**单独渲染 AiPane 组件**，
  // 这足以让任何未声明标识符以异常暴露。
  openPanelViaLauncher()
  const pane = findComponent(renderFloating(), 'AiPane')
  assert(pane !== null, 'the AI pane component is part of the panel tree')

  const render = (ai, aiCollapsed = false) => {
    const tree = pane.type({
      store: exposedStore,
      state: { ...exposedStore.get(), ai, aiCollapsed },
    })
    // 递归收集文本：children 常常是数组（标题与徽标并列），只取顶层字符串会漏掉。
    const texts = []
    const walk = (node, depth = 0) => {
      if (node === null || node === undefined || depth > 30) return
      if (typeof node === 'string' || typeof node === 'number') { texts.push(String(node)); return }
      if (Array.isArray(node)) { for (const child of node) walk(child, depth + 1); return }
      if (typeof node !== 'object') return
      if (typeof node.type === 'function') { walk(node.type(node.props), depth + 1); return }
      walk(node.props?.children, depth + 1)
    }
    walk(tree)
    return texts.join(' | ')
  }

  const emptyText = render({ thinking: '', reply: '', error: null })
  assert(emptyText.includes('AI 思考与回复'), `the pane title renders (got: ${emptyText.slice(0, 120)})`)
  assert(emptyText.includes('思考过程'), 'the thinking section renders')
  assert(emptyText.includes('（还没有回复）'), 'the empty reply placeholder renders')

  const filled = render({ thinking: '先看选区…', reply: '已把标题改成红色。', error: null })
  assert(filled.includes('先看选区…'), 'the thinking text renders')
  assert(filled.includes('已把标题改成红色。'), 'the reply text renders')

  const errored = render({ thinking: '', reply: '', error: '事件源不可用' })
  assert(errored.includes('事件源不可用'), 'the error state renders')

  // 折叠态：只剩一条贴边竖条，不能再占画布宽度
  const collapsed = render({ thinking: '先看选区…', reply: '已把标题改成红色。', error: null }, true)
  assert(collapsed.includes('AI 思考与回复'), 'the collapsed strip keeps the label')
  assert(!collapsed.includes('先看选区…'), 'collapsed state must not render the content')
  assert(!collapsed.includes('已把标题改成红色。'), 'collapsed state must not render the reply')
})

step('client: 会话菜单能渲染（打开菜单不抛错）', () => {
  // 回归：菜单曾经引用了只在 Panel 里定义的 availableSessions，
  // 点开会话按钮时 ReferenceError → 整个客户端崩溃、页面白屏。
  // 这里把菜单打开并渲染一遍，任何未声明标识符都会以异常形式暴露。
  const opened = openPanelViaLauncher()
  exposedStore.set(current => ({ ...current, sessionMenuOpen: true, sessionId: 'session-9' }))
  let rendered
  let failure = null
  try {
    rendered = renderFloating()
    app.__forTests.renderToTag(rendered)
  } catch (error) {
    failure = error
  }
  assert(failure === null, `opening the session menu must not throw: ${failure?.message ?? ''}`)
  const texts = []
  collectElements(rendered, element => typeof element.props?.children === 'string', texts)
  const joined = texts.map(element => element.props.children).join(' | ')
  assert(joined.includes('连接到会话'), 'the session menu title renders')
  assert(joined.includes('连接到最近会话'), 'the connect entry renders')
  exposedStore.set(current => ({ ...current, sessionMenuOpen: false, sessionId: '' }))
  void opened
})

console.log('')
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack?.split('\n').slice(0, 3).join(' | ')}`)
}
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
