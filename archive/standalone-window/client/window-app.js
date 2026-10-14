/* dsh-ppt-canvas — 独立窗口入口
 *
 * 由 /dsh-ppt/window 页面用 <script> 加载（不是 DSH 的 __ModuleLoader__ 模块），
 * 因此这里不用 require：React 由同页的 client/mini-react.js 提供（挂到 window 上），
 * 界面逻辑由同页的 client/app.js 提供（createPptApp）。
 *
 * 独立窗口与对话面板共用同一份界面逻辑，差别只有：
 *  - 没有会话 → 指令栏禁用并提示「请在对话面板里发」；
 *  - 标题栏换成真正的窗口按钮（置顶 / 最小化 / 最大化 / 关闭），由 Electron 主进程提供；
 *  - 整个视口就是这块画布。
 */

;(function boot() {
  const root = document.getElementById('dsh-ppt-window-root')
  if (root === null) {
    console.error('[dsh-ppt-canvas] 缺少 #dsh-ppt-window-root 容器')
    return
  }

  const mini = window.__DSH_PPT_MINI_REACT__
  if (mini === undefined || mini === null) {
    root.textContent = 'dsh-ppt-canvas: 渲染层没有加载成功（client/mini-react.js）'
    return
  }
  if (typeof createPptApp !== 'function') {
    root.textContent = 'dsh-ppt-canvas: 共享界面层没有加载成功（client/app.js）'
    return
  }

  // 把迷你渲染层包成 React / ReactDOM 两副面孔，client/app.js 无需知道宿主是谁。
  const React = {
    createElement: mini.createElement,
    Fragment: mini.Fragment,
    useState: mini.useState,
    useEffect: mini.useEffect,
    useRef: mini.useRef,
    useMemo: mini.useMemo,
    useCallback: mini.useCallback,
    version: mini.version,
  }
  const ReactDOM = {
    createRoot: (container) => {
      const root = mini.createRoot(container)
      return { render: (element) => root.render(element), unmount: () => root.unmount() }
    },
  }

  // Electron 主进程通过 preload 暴露这组能力；普通浏览器里没有，此时不显示窗口按钮。
  const bridge = typeof window.dshPptWindow !== 'undefined' && window.dshPptWindow !== null
    ? window.dshPptWindow
    : null
  const windowControls = bridge === null ? null : {
    minimize: () => bridge.action('minimize'),
    maximize: () => bridge.action('maximize'),
    close: () => bridge.action('close'),
    alwaysOnTop: () => bridge.action('always-on-top'),
  }

  const app = createPptApp({
    React,
    ReactDOM,
    document,
    window,
    apiBase: typeof window.__DSH_PPT_API_BASE__ === 'string' ? window.__DSH_PPT_API_BASE__ : '/dsh-ppt/api',
    mode: 'window',
    storageKey: 'dsh_ppt_canvas_window_v1',
    styleTagId: 'dsh-ppt-canvas-window-style',
    styles: typeof window.__DSH_PPT_STYLES__ === 'string' ? window.__DSH_PPT_STYLES__ : '',
    binding: null,
    prompt: null,
    pickPath: null,
    timeout: (fn, ms) => {
      const handle = setTimeout(fn, ms)
      return () => clearTimeout(handle)
    },
    windowControls,
  })

  const installed = app.install({ root })

  // 窗口标题跟随文档：任务栏上能看出自己在编辑哪一份。
  installed.store.subscribe(() => {
    const deck = installed.store.get().deck
    const base = 'PPT 协同编辑画布'
    const next = deck === null || deck === undefined
      ? base
      : `${String(deck.file).split(/[/\\]/).pop()} · ${base}`
    if (document.title !== next) document.title = next
  })

  // 有 preload 桥时同步一次窗口按钮状态（最大化/置顶）。
  if (bridge !== null && typeof bridge.state === 'function') {
    Promise.resolve(bridge.state()).then((state) => {
      if (state !== null && typeof state === 'object') {
        installed.store.set({ maximized: state.maximized === true, alwaysOnTop: state.alwaysOnTop === true })
      }
    }).catch(() => { /* 状态读不到不影响使用 */ })
  }
})()
