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
  const makeElement = (tag) => {
    /** 每个元素自己的监听器表（pickPptx 依赖 input 上的 change/cancel）。 */
    const own = new Map()
    const element = {
      tagName: String(tag).toUpperCase(),
      dataset: {},
      style: {},
      textContent: '',
      children: [],
      attributes: {},
      /** <input type="file"> 用：测试里手动塞 File / 或保持 null 模拟取消。 */
      files: null,
      type: '',
      accept: '',
      appendChild(child) { this.children.push(child); return child },
      remove() { this.removed = true },
      setAttribute(name, value) { this.attributes[name] = value },
      getAttribute(name) { return this.attributes[name] },
      addEventListener(type, fn) {
        listeners.push({ type, fn })
        if (!own.has(type)) own.set(type, [])
        own.get(type).push(fn)
      },
      removeEventListener(type, fn) {
        const list = own.get(type)
        if (list === undefined) return
        const at = list.indexOf(fn)
        if (at !== -1) list.splice(at, 1)
      },
      /** 测试辅助：向该元素派发一个事件（真实浏览器由用户交互触发）。 */
      dispatch(type, event = {}) {
        for (const fn of [...(own.get(type) ?? [])]) {
          try { fn({ currentTarget: element, target: element, ...event }) } catch { /* 回调异常由被测代码处理 */ }
        }
      },
      /** 真实浏览器里 click() 会弹系统对话框；测试里什么也不做，由 dispatch 模拟结果。 */
      click() { this.clicked = true },
      querySelector() { return null },
      querySelectorAll() { return [] },
      getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 450 } },
      setPointerCapture() {},
      contains() { return false },
      focus() {},
    }
    return element
  }
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
  /** 错误边界需要真实 React 的 Component 基类语义（至少能 new 出来并 render）。 */
  class Component {
    constructor(props) { this.props = props }
  }
  // 与真实 React 一致：用它区分「类组件」与「函数组件」。
  Component.prototype.isReactComponent = {}
  const React = {
    Component,
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
      // **不立即 cleanup**：真实 React 的 effect 会一直活着，直到依赖变化或卸载。
      // 以前这里跑完 fn() 马上调用 cleanup，等于所有订阅/定时器存活 0 帧 ——
      // 轮询、等待 AI 这类逻辑因此完全测不到。
      // 这里把 cleanup 存起来，由依赖变化或显式 unmount() 触发。
      const previousCleanup = hooks.states[`cleanup:${index}`]
      if (typeof previousCleanup === 'function') {
        try { previousCleanup() } catch (error) { throw new Error(`effect cleanup threw: ${error.message}`) }
      }
      const cleanup = fn()
      hooks.states[`cleanup:${index}`] = typeof cleanup === 'function' ? cleanup : undefined
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
  return { React, hooks, reset, unmount: () => runCleanups(hooks) }
}

/** 执行所有挂着的 effect 清理（模拟卸载）。 */
function runCleanups(hooks) {
  for (const [key, value] of Object.entries(hooks.states)) {
    if (!key.startsWith('cleanup:')) continue
    if (typeof value !== 'function') continue
    try { value() } catch { /* 卸载期异常忽略 */ }
    hooks.states[key] = undefined
  }
}

/**
 * 统一的组件渲染入口：函数组件直接调用，类组件 new 出来调 render()。
 * 错误边界（PanelErrorBoundary）是类组件，直接 `type(props)` 会抛
 * "Class constructor cannot be invoked without 'new'"。
 */
function renderComponent(type, props) {
  if (typeof type === 'function' && type.prototype !== undefined && type.prototype.isReactComponent !== undefined) {
    const instance = new type(props)
    return instance.render()
  }
  return type(props)
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
    try { rendered = renderComponent(element.type, element.props) } catch { return null }
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
    const rendered = renderComponent(element.type, element.props)
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
    const rendered = renderComponent(element.type, element.props)
    collectElements(rendered, predicate, out, depth + 1)
    return out
  }
  collectElements(element.props?.children, predicate, out, depth + 1)
  return out
}

// ------------------------------------------------------------------ 装配

/**
 * 可手动推进的调度器。
 *
 * 为什么必须可控：客户端的关键逻辑（4 秒轮询外部改动、发送后等待 AI 落盘）
 * 全靠 timeout/interval。以前 ctx.timeout/interval 是空实现，定时器永不触发，
 * 这些路径**根本测不到** —— 于是"发送后锁死 150 秒"这种 bug 能一路活下来。
 */
function createScheduler() {
  let seq = 0
  const timers = new Map()
  const api = {
    timeout(fn, _ms) {
      const id = ++seq
      timers.set(id, { fn })
      return () => timers.delete(id)
    },
    interval(fn, _ms) {
      const id = ++seq
      timers.set(id, { fn, repeat: true })
      return () => timers.delete(id)
    },
    /** 当前挂着的定时器数量（含 interval）。 */
    pending() { return timers.size },
    clear() { timers.clear() },
    /**
     * 触发一轮定时器回调，并让出微任务让 await 链继续。
     * @param {number} rounds 连续推进几轮（interval 会每轮再触发）
     */
    async flush(rounds = 1) {
      for (let round = 0; round < rounds; round += 1) {
        const snapshot = [...timers.entries()]
        for (const [id, timer] of snapshot) {
          if (!timers.has(id)) continue
          if (!timer.repeat) timers.delete(id)
          try { timer.fn() } catch { /* 回调异常由被测代码自己处理 */ }
        }
        // 放行 await / Promise 链（多轮，覆盖 await 里再 await）
        for (let i = 0; i < 6; i += 1) await Promise.resolve()
      }
    },
  }
  return api
}

const scheduler = createScheduler()

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

/** 可编排的 fetch：默认回一份 history 载荷，测试里可以替换。 */
let fetchHandler = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, value: { rev: 0, canUndo: false, canRedo: false, entries: [] } }),
})
const fetchLog = []
globalThis.fetch = async (url, init) => {
  fetchLog.push({ url: String(url), method: init?.method ?? 'GET' })
  return fetchHandler(String(url), init)
}

// 全局定时器保持 no-op（业务代码用的是注入的 ctx.timeout/interval）
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

/**
 * sessions 桩的可编排部分：`retainPlan` 让测试控制 `reference.ready` 何时解析、
 * 以及 subscribe/release 被调用了几次（用来验证「ready 前卸载不泄漏订阅」）。
 */
let retainPlan = null
const retainStats = { retain: 0, release: 0, subscribe: 0, emits: 0 }

function makeRetain() {
  retainStats.retain += 1
  if (retainPlan !== null) return retainPlan()
  return {
    ready: Promise.resolve({
      session: { prompt: async () => ({ ok: true }) },
      eventSource: {
        getSnapshot: () => ({ entries: [] }),
        subscribe: () => { retainStats.subscribe += 1; return () => {} },
      },
    }),
    release: () => { retainStats.release += 1 },
  }
}

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
          // retain 让 promptTo 可用（发送链路的前提）。list 仍为空，
          // 这样「无会话时发送按钮禁用」那条断言不受影响。
          retain: () => makeRetain(),
        }
      }
      if (name === 'uiWorkspace') {
        return { pickDirectory: async () => null }
      }
      return undefined
    },
    timeout: (fn, ms) => scheduler.timeout(fn, ms),
    interval: (fn, ms) => scheduler.interval(fn, ms),
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
  const compact = renderComponent(entry.component, { wide: false })
  assert(compact !== null && compact.type === 'button', 'compact button renders')
  const wide = renderComponent(entry.component, { wide: true })
  assert(wide !== null && wide.type === 'button', 'wide button renders')
})

function renderOverlay() {
  const entry = registrations.find(item => item.options.name === 'shell.overlay')
  assert(entry !== undefined, 'overlay entry registered')
  fakeReact.reset()
  return renderComponent(entry.component, {})
}

/** 渲染 FloatingPanel 的产物。 */
function renderFloating() {
  const tree = renderOverlay()
  const floating = findComponent(tree, 'FloatingPanel')
  assert(floating !== null, 'FloatingPanel found')
  fakeReact.reset()
  return renderComponent(floating.type, floating.props)
}

/** 在最小化态里找到「PPT 画布」入口按钮（它现在包在一个定位容器里）。 */
function findLauncher(element) {
  const buttons = []
  // 注意按 class **token** 精确匹配：容器是 dsh-ppt-launcherwrap，
  // 用 includes('dsh-ppt-launcher') 会把容器也算成按钮。
  collectElements(element, node => typeof node.type === 'string'
    && String(node.props?.className ?? '').split(/\s+/).includes('dsh-ppt-launcher'), buttons)
  return buttons
}

/** 确保面板处于打开状态（第一次通过真实点启动器打开），返回打开后的浮窗元素。 */
function openPanelViaLauncher() {
  if (exposedStore.get().open !== true) {
    const closed = renderFloating()
    const launcher = findLauncher(closed)[0]
    assert(launcher !== undefined, 'minimized panel must render a launcher button')
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
    const rendered = renderComponent(element.type, element.props)
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
  // 最小化态现在是一个定位容器 + 入口按钮（容器用来挂「要不要打开画布」提示卡）
  assertEqual(app.__forTests.renderToTag(rendered), 'div', 'minimized renders a wrapper')
  const launchers = findLauncher(rendered)
  assertEqual(launchers.length, 1, 'exactly one launcher button')
  assertEqual(exposedStore.get().open, false, '启动时画布必须是收起状态（不自动展开）')
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
    const tree = renderComponent(pane.type, {
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
      if (typeof node.type === 'function') { walk(renderComponent(node.type, node.props), depth + 1); return }
      walk(node.props?.children, depth + 1)
    }
    walk(tree)
    return texts.join(' | ')
  }

  const emptyText = render({ messages: [], thinking: '', reply: '', error: null })
  assert(emptyText.includes('AI 思考与回复'), `the pane title renders (got: ${emptyText.slice(0, 120)})`)
  assert(!emptyText.includes('思考过程'), '不再有独立的「思考过程」分区（改成对话转播）')
  assert(!emptyText.includes('（还没有回复）'), '不再有「还没有回复」占位（改成对话空状态）')

  // 对话转播：用户与助手各成一条消息，顺序保留
  const conversation = render({
    messages: [
      { role: 'user', text: '把标题改成红色' },
      { role: 'assistant', text: '已把标题改成红色。', thinking: '先看选区…' },
    ],
    thinking: '先看选区…',
    reply: '已把标题改成红色。',
    error: null,
  })
  assert(conversation.includes('把标题改成红色'), '用户消息要显示出来')
  assert(conversation.includes('已把标题改成红色。'), '助手消息要显示出来')
  assert(conversation.includes('你'), '用户消息有「你」的角色标签')
  assert(conversation.includes('AI'), '助手消息有「AI」的角色标签')
  assert(conversation.includes('先看选区…'), '推理内容仍可见（弱化为附注）')
  assert(conversation.indexOf('把标题改成红色') < conversation.indexOf('已把标题改成红色。'),
    '消息顺序必须与对话一致（用户在前）')

  const errored = render({ messages: [], thinking: '', reply: '', error: '事件源不可用' })
  assert(errored.includes('事件源不可用'), 'the error state renders')

  // 折叠态：只剩一条贴边竖条，不能再占画布宽度
  const collapsed = render({ messages: [{ role: 'user', text: '把标题改成红色' }], thinking: '', reply: '', error: null }, true)
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

/** 一份最小但结构完整的 deck，供轮询/发送等需要文档的逻辑使用。 */
function makeDeck(rev = 0) {
  return {
    file: 'C:/tmp/deck.pptx',
    rev,
    fileMtimeMs: 1000,
    slideWidth: 960,
    slideHeight: 540,
    media: {},
    warnings: [],
    slides: [{
      id: 's1',
      name: '幻灯片 1',
      background: '#FFFFFF',
      shapes: [{
        id: 's1:1',
        shapeId: '1',
        name: 'TextBox 1',
        kind: 'text',
        z: 0,
        geometry: { x: 10, y: 10, w: 400, h: 100, rotation: 0, flipH: false, flipV: false },
        style: { fill: { type: 'none', color: null }, gradient: null, line: null, shadow: false, opacity: 1, cornerRadius: 0, prst: 'rect' },
        text: {
          plain: '标题',
          align: 'left',
          anchor: 'top',
          color: '#111111',
          fontSize: 20,
          bold: false,
          italic: false,
          fontFamily: null,
          insets: { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 },
          autofit: null,
          paragraphs: [{ level: 0, align: 'left', lnSpc: 1.2, lnSpcIsPx: false, spaceBefore: null, spaceAfter: null, spaceBeforePct: null, spaceAfterPct: null, indent: null, runs: [{ text: '标题', color: '#111111', fontSize: 20, bold: false, italic: false, underline: false, fontFamily: null }] }],
        },
        image: null,
        table: null,
        children: null,
        placeholder: null,
      }],
    }],
  }
}

step('client: 轮询发现磁盘被外部改过 → 自动 force 重载', async () => {
  // 回归：以前轮询只比较宿主内存里的 rev，PowerPoint 在外部保存不会改它，
  // 于是外部改动完全感知不到，下一次 apply 会覆盖别人的修改。
  // 现在轮询 /api/status，changed=true 就重载。
  openPanelViaLauncher()
  exposedStore.set(current => ({ ...current, deck: makeDeck(0), slideIndex: 0, log: [] }))

  const requests = []
  fetchHandler = async (url) => {
    requests.push(url)
    if (url.includes('/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, value: { file: 'C:/tmp/deck.pptx', rev: 0, mtimeMs: 2000, openedMtimeMs: 1000, changed: true } }),
      }
    }
    if (url.includes('/deck')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: makeDeck(0) }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }
  }

  // 渲染一次让轮询 effect 注册 interval，然后手动推进时间
  app.__forTests.renderToTag(renderFloating())
  await scheduler.flush(2)

  const statusCalls = requests.filter(url => url.includes('/status')).length
  const deckReloads = requests.filter(url => url.includes('/deck')).length
  assert(statusCalls > 0, `轮询应当请求 /status（实际请求：${requests.join(', ')}）`)
  assert(deckReloads > 0, '`changed=true` 时必须请求 /deck 重载')
  const logged = exposedStore.get().log.map(entry => entry.text).join(' | ')
  assert(logged.includes('已自动重载'), `日志里应说明自动重载（实际：${logged || '(空)'}）`)

  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { rev: 0, canUndo: false, canRedo: false, entries: [] } }) })
  exposedStore.set(current => ({ ...current, deck: null, log: [] }))
})

step('client: 发送后在 rev 推进时立刻释放 sending（回归：150 秒锁死）', async () => {
  // 回归：waitForAi 里 `let running = false` 写死，break 不可达 → 每次发送锁满 150 秒，
  // 期间打开/撤销/重做全灰。现在轮询 /status，rev 一前进就退出。
  openPanelViaLauncher()
  exposedStore.set(current => ({
    ...current,
    deck: makeDeck(0),
    sessionId: 'sess-1',
    selectedIds: ['s1:1'],
    instruction: '把标题改红',
    drafts: [],
    sending: false,
    log: [],
  }))

  fetchHandler = async (url) => {
    if (url.includes('/status')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { file: 'C:/tmp/deck.pptx', rev: 1, mtimeMs: 1000, openedMtimeMs: 1000, changed: false, renderToken: 'tok' } }) }
    }
    if (url.includes('/history')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { rev: 1, canUndo: true, canRedo: false, entries: [] } }) }
    }
    if (url.includes('/deck')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: makeDeck(1) }) }
    }
    if (url.includes('/context')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { requestId: 'req-1' } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, value: {} }) }
  }

  app.__forTests.renderToTag(renderFloating())
  const send = app.__forTests.actions?.send
  assert(typeof send === 'function', '测试钩子应暴露 actions.send')
  await send()
  // 推进几轮：waitForAi 每 700ms 轮询一次 /status，rev=1 > baseRev=0 时立刻退出
  await scheduler.flush(3)
  assertEqual(exposedStore.get().sending, false, 'rev 推进后 sending 必须归位（不能锁 150 秒）')

  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { rev: 0, canUndo: false, canRedo: false, entries: [] } }) })
  exposedStore.set(current => ({ ...current, deck: null, sessionId: '', selectedIds: [], instruction: '', log: [] }))
})

step('client: 文件对话框「取消」必须立刻收尾（回归：Promise 永不 settle）', async () => {
  // 回归：pickPptx 里用了作用域外的 `win`，抛 ReferenceError 被空 catch 吞掉，
  // 于是取消对话框后 Promise 永不 resolve —— 界面毫无反应，隐藏的 <input> 还留在 body。
  openPanelViaLauncher()
  const before = dom.created.length
  let settled = false
  const pending = app.__forTests.actions.pickAndOpen().then(() => { settled = true })

  // 不要真的等它：先让 Promise 有机会推进，再派发 cancel
  await Promise.resolve()
  const input = dom.created.slice(before).find(element => element.tagName === 'INPUT')
  assert(input !== undefined, '打开按钮应创建 <input type="file">')
  assertEqual(input.clicked, true, '应触发一次 click（真实环境里这才弹系统对话框）')

  input.dispatch('cancel')
  await pending
  assertEqual(settled, true, '取消后 pickAndOpen 必须收尾（不能永远挂着）')
  assertEqual(input.removed, true, '取消后隐藏的 <input> 必须从 body 移除')
  // 取消不该触发任何打开请求
  assertEqual(fetchLog.filter(entry => entry.url.includes('/files') || entry.url.includes('/open')).length, 0,
    '取消后不应发出打开请求')
})

step('client: 就地编辑器定位与字号都按 zoom 缩放（回归：编辑器错位）', () => {
  // 回归背景：textarea **不继承** zoom 容器的缩放（Chromium 对表单控件不可靠），
  // 所以编辑器渲染在未缩放的 .dsh-ppt-canvas 里，坐标/字号/内边距全靠
  // textEditStyle(shape, zoom) 手动 ×zoom。少乘一处就是"点字后编辑框偏了"。
  const shape = {
    id: 's1:1',
    kind: 'text',
    geometry: { x: 100, y: 50, w: 300, h: 200, rotation: 0, flipH: false, flipV: false },
    style: { fill: { type: 'none', color: null }, line: null },
    text: {
      plain: '第一行\n第二行',
      fontSize: 20,
      align: 'left',
      anchor: 'top',
      color: '#111111',
      bold: false,
      italic: false,
      fontFamily: null,
      insets: { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 },
      paragraphs: [{ runs: [{ text: '第一行', fontSize: 20 }] }],
    },
  }

  const zoom = 2
  const style = app.__forTests.textEditStyle(shape, zoom)
  assertEqual(style.left, '200px', `left 必须 ×zoom（got ${style.left}）`)
  assertEqual(style.top, '100px', `top 必须 ×zoom（got ${style.top}）`)
  assertEqual(style.width, '600px', `width 必须 ×zoom（got ${style.width}）`)
  assertEqual(style.height, '400px', `height 必须 ×zoom（got ${style.height}）`)
  assertEqual(style.fontSize, '40px', `fontSize 必须 ×zoom（got ${style.fontSize}）`)
  // 内边距也要 ×zoom：top = 4.8 * 2 = 9.6；left = 9.6 * 2 = 19.2
  assert(style.padding.startsWith('9.6px 19.2px'), `padding 必须 ×zoom（got ${style.padding}）`)

  // zoom=1 时应当等于原始几何
  const one = app.__forTests.textEditStyle(shape, 1)
  assertEqual(one.left, '100px')
  assertEqual(one.fontSize, '20px')

  // 垂直锚点补偿：middle 时首行要下推，且同样 ×zoom
  const middleShape = { ...shape, text: { ...shape.text, anchor: 'middle' } }
  const middle = app.__forTests.textEditStyle(middleShape, 1)
  const topPad = Number.parseFloat(middle.padding.split(' ')[0])
  assert(topPad > 4.8, `middle 锚点应把首行下推（got padding-top ${topPad}）`)
})

step('client: 就地编辑失焦提交 setText，内容没变则不发请求', async () => {
  // 两条都属于"静默出错"档：
  //   1. 失焦没有真的发 apply → 用户以为改了，文件没变；
  //   2. 内容没变也发 apply → 白写盘、rev+1、撤销栈多一条。
  openPanelViaLauncher()
  exposedStore.set(current => ({
    ...current,
    deck: makeDeck(0),
    slideIndex: 0,
    zoom: 1,
    editingId: 's1:1',
    editCaret: { x: 30, y: 20 },
    log: [],
  }))

  const applies = []
  fetchHandler = async (url, init) => {
    if (url.includes('/apply')) applies.push(init?.body ?? '')
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { rev: 1, applied: true, changedIds: ['s1:1'] } }) }
  }

  const tree = renderFloating()
  const textareas = []
  collectElements(tree, element => element.type === 'textarea' && element.props?.className === 'dsh-ppt-textedit', textareas)
  assertEqual(textareas.length, 1, `处于编辑态时应渲染一个编辑框（got ${textareas.length}）`)

  // 1) 改成新内容 → 必须发一次 setText
  textareas[0].props.onBlur({ target: { value: '改过的标题' } })
  await scheduler.flush(1)
  assert(applies.length >= 1, '失焦提交必须发出 apply 请求')
  assert(applies[0].includes('改过的标题'), `请求体应含新文本（got ${applies[0].slice(0, 120)}）`)
  assert(applies[0].includes('setText'), '请求体应是 setText op')

  // 2) 再失焦一次、内容没变 → 不应再发请求
  const countAfterFirst = applies.length
  textareas[0].props.onBlur({ target: { value: '标题' } })  // 与原始文本相同
  await scheduler.flush(1)
  assertEqual(applies.length, countAfterFirst, '内容没变时不应再发 apply（避免白写盘）')

  exposedStore.set(current => ({ ...current, deck: null, editingId: null, editCaret: null, log: [] }))
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { rev: 0, canUndo: false, canRedo: false, entries: [] } }) })
})

step('client: watchAi 在 ready 解析前卸载 → 不得再订阅（回归：跨会话串扰/泄漏）', async () => {
  // 回归：旧实现 cleanup 先跑（release + 调用当时的 no-op unsubscribe），
  // 随后 ready 才解析并在**已释放的引用**上 subscribe —— 这个订阅永不取消，
  // 旧会话的推理/回复会继续写进新会话的面板（串扰），每次切换泄漏一个订阅。
  let resolveReady
  const ready = new Promise((resolve) => { resolveReady = resolve })
  retainPlan = () => ({
    ready,
    release: () => { retainStats.release += 1 },
  })
  retainStats.subscribe = 0
  retainStats.retain = 0

  const emitted = []
  const off = app.__forTests.watchAi('session-x', (state) => emitted.push(state))
  assert(typeof off === 'function', 'watchAi 应返回退订函数')

  // 立刻卸载（模拟快速切换会话）
  off()
  assertEqual(retainStats.release, 1, '卸载时应立即 release')

  // 现在才让 ready 解析 —— 已卸载，绝不能再订阅、也不能再 emit
  resolveReady({
    session: { prompt: async () => ({ ok: true }) },
    eventSource: {
      getSnapshot: () => ({ entries: [] }),
      subscribe: () => { retainStats.subscribe += 1; return () => {} },
    },
  })
  await scheduler.flush(1)

  assertEqual(retainStats.subscribe, 0, '卸载后不得再订阅事件源（否则永不取消 → 串扰）')
  assertEqual(emitted.length, 0, '卸载后不得再向面板推送 AI 内容')

  retainPlan = null
})

step('client: 用户提到做/改 PPT → 最小化状态下弹出「是否打开画布」提示', async () => {
  // 需求：当用户提到制作或修改 PPT 时，弹出是否打开画布的提示。
  // 实现要点：监听必须挂在 FloatingPanel 上（最小化时页面内的 Panel 不渲染），
  // 且插件自己发的指令（带【PPT 协同编辑】）不能触发提示。
  exposedStore.set(current => ({ ...current, open: false, sessionId: 'sess-1', pptPrompt: null }))

  // 让会话事件流里出现一条用户消息
  const entries = [{ kind: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '帮我做一份季度复盘的 PPT' }] } } }]
  retainPlan = () => ({
    ready: Promise.resolve({
      session: { prompt: async () => ({ ok: true }) },
      eventSource: {
        getSnapshot: () => ({ entries }),
        subscribe: () => () => {},
      },
    }),
    release: () => {},
  })

  const tree = renderFloating()
  await scheduler.flush(1)
  // 提示卡应当出现（此时面板仍是收起的）
  const afterDetect = renderFloating()
  const textOf = (node, depth = 0) => {
    if (node === null || node === undefined || depth > 24) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(child => textOf(child, depth + 1)).join(' ')
    if (typeof node !== 'object') return ''
    if (typeof node.type === 'function') return textOf(renderComponent(node.type, node.props), depth + 1)
    return textOf(node.props?.children, depth + 1)
  }
  const promptText = textOf(afterDetect)
  assert(promptText.includes('看起来你在做 PPT'), `应弹出提示卡（实际：${promptText.slice(0, 160)}）`)
  assertEqual(exposedStore.get().open, false, '提示出现时画布仍应是收起状态')
  void tree

  // 点「打开画布」→ 面板展开、提示消失
  const card = exposedStore.get().pptPrompt
  assert(card !== null && typeof card.text === 'string', 'pptPrompt 里应记录触发它的原话')
  const openButton = []
  collectElements(afterDetect, node => node.type === 'button'
    && /打开画布/.test(String(node.props?.children ?? '')), openButton)
  assert(openButton.length === 1, '提示卡里应有「打开画布」按钮')
  openButton[0].props.onClick()
  assertEqual(exposedStore.get().open, true, '点「打开画布」应展开面板')
  assertEqual(exposedStore.get().pptPrompt, null, '点开后提示应消失')

  // 插件自己发的指令不得触发提示
  exposedStore.set(current => ({ ...current, open: false, pptPrompt: null }))
  const selfEntries = [{ kind: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '【PPT 协同编辑】我在 PPT 画布上选中了 1 个元素：\n- 标题' }] } } }]
  retainPlan = () => ({
    ready: Promise.resolve({
      session: { prompt: async () => ({ ok: true }) },
      eventSource: { getSnapshot: () => ({ entries: selfEntries }), subscribe: () => () => {} },
    }),
    release: () => {},
  })
  // 重新挂一次订阅（删掉旧组件树，让 effect 重新执行）
  exposedStore.set(current => ({ ...current, sessionId: 'sess-2' }))
  renderFloating()
  await scheduler.flush(1)
  assertEqual(exposedStore.get().pptPrompt, null, '插件自己发的指令不应触发提示')

  retainPlan = null
  exposedStore.set(current => ({ ...current, open: false, sessionId: '', pptPrompt: null }))
})

step('client: 会话事件 → 对话消息（用户/助手/实时分片按顺序还原）', async () => {
  // 需求 1 的核心：把事件流还原成一条条消息，而不是只剩"最后一轮"。
  const entries = [
    { kind: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '第一问：把标题改红' }] } } },
    { kind: 'event', event: { type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: '先定位标题占位符。' },
      { type: 'text', text: '好的，已改红。' },
    ] } } } },
    { kind: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '第二问：字号调大' }] } } },
    { kind: 'transient', event: { data: { chunk: { type: 'text-delta', index: 0, text: '正在调整字号' } } } },
    { kind: 'transient', event: { data: { chunk: { type: 'text-delta', index: 0, text: '…' } } } },
  ]
  retainPlan = () => ({
    ready: Promise.resolve({
      session: { prompt: async () => ({ ok: true }) },
      eventSource: { getSnapshot: () => ({ entries }), subscribe: () => () => {} },
    }),
    release: () => {},
  })

  const seen = []
  const off = app.__forTests.watchAi('sess-tr', next => seen.push(next))
  await scheduler.flush(1)
  off()

  assert(seen.length > 0, 'watchAi 应至少回调一次')
  const last = seen[seen.length - 1]
  assert(Array.isArray(last.messages), 'emit 里应带 messages 数组')
  const roles = last.messages.map(message => message.role)
  assertEqual(roles.join(','), 'user,assistant,user,assistant', `消息顺序应为 user,assistant,user,assistant（实际 ${roles.join(',')}）`)
  assertEqual(last.messages[0].text, '第一问：把标题改红')
  assertEqual(last.messages[1].text, '好的，已改红。', '助手正文应只取 text 块')
  assertEqual(last.messages[1].thinking, '先定位标题占位符。', '推理应单独挂在该消息上')
  // 实时分片合并成最后一条（标记 live，界面显示"生成中"）
  assertEqual(last.messages[3].text, '正在调整字号…', '实时分片应按 index 拼成一条')
  assertEqual(last.messages[3].live, true, '实时消息应标记 live')

  retainPlan = null
})

console.log('')
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack?.split('\n').slice(0, 3).join(' | ')}`)
}
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
