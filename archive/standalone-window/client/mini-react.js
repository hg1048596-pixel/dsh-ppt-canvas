/* dsh-ppt-canvas — 迷你渲染层（React 兼容子集）
 *
 * 独立窗口是插件自己 loadURL 的普通页面，没有 DSH 的模块表（拿不到 require('react')），
 * 而 React 的 UMD 构建既不在本机也没有构建步骤可以产出。所以这里实现一个**只覆盖本项目
 * 实际用到的那部分 React API** 的渲染层（createElement / useState / useEffect / useRef /
 * useMemo / useCallback / createRoot），让 client/app.js 这份界面代码在两种宿主下都跑：
 *
 *   - 对话面板：由 DSH 提供真正的 React（见 client/client.js 的 require('react')）
 *   - 独立窗口：由本文件提供替代实现
 *
 * 两种宿主的元素形状必须一致：React 元素带 $$typeof，这里的带 __vnode。
 * 因此所有「元素 → DOM」的翻译都集中在同一处（下面 PROP_APPLIERS / applyProp），
 * 不会出现两套宿主各写一遍导致行为分叉。
 *
 * 明确不支持（本项目也不需要）：类组件、context、Suspense、并发渲染、
 * key 之外的启发式 diff、合成事件的冒泡模拟。
 */

;(function (global) {
  'use strict'

  // ------------------------------------------------------------------ 元素

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

  const RESERVED = new Set(['key', 'ref', 'children', '__self', '__source'])

  /**
   * 创建虚拟节点。
   * 支持两种调用形态：createElement(type, props, ...children) 与 createElement(type, props, [children])。
   */
  function createElement(type, props, ...children) {
    const normalized = {}
    let key = null
    let ref = null
    if (props !== null && props !== undefined) {
      for (const name of Object.keys(props)) {
        if (name === 'key') { key = props[name]; continue }
        if (name === 'ref') { ref = props[name]; continue }
        if (RESERVED.has(name)) continue
        normalized[name] = props[name]
      }
    }
    // children 优先级固定：显式 children prop 排在位置参数之前（与 React 一致）。
    const collected = []
    if (props !== null && props !== undefined && props.children !== undefined) {
      pushChildren(collected, props.children)
    }
    pushChildren(collected, children)
    if (collected.length === 1) normalized.children = collected[0]
    else if (collected.length > 1) normalized.children = collected
    return { __vnode: true, type, key, ref, props: normalized }
  }

  function pushChildren(out, value) {
    if (value === null || value === undefined || value === false || value === true) return
    if (Array.isArray(value)) {
      for (const item of value) pushChildren(out, item)
      return
    }
    out.push(value)
  }

  const Fragment = { __fragment: true }

  /** 判断是不是本渲染层产出的元素。 */
  function isElement(value) {
    return value !== null && typeof value === 'object' && value.__vnode === true
  }

  // ------------------------------------------------------------------ 属性翻译

  /** 驼峰 → kebab（dataShapeId → data-shape-id）。 */
  function kebabCase(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  }

  const PROP_APPLIERS = {
    /** 布尔属性：true 写入（空串），false/null/undefined 移除。 */
    boolean(node, name, value) {
      if (value === true) node.setAttribute(name, '')
      else node.removeAttribute(name)
    },
    /** 文本型属性。 */
    attribute(node, name, value) {
      if (value === null || value === undefined || value === false) node.removeAttribute(name)
      else node.setAttribute(name, String(value))
    },
    /**
     * 内联样式对象。写值用 `style[key] = x`（CSSOM 属性名），清理只针对
     * 「上一轮由本渲染层设置过、这一轮不再需要」的键 —— 不遍历 style 自身的键：
     * 那些是浏览器归一化后的 kebab 名，读回来会误判成「需要清掉」。
     */
    style(node, _name, value, tracked) {
      const style = node.style
      const next = value ?? {}
      const previousKeys = tracked instanceof Set ? tracked : new Set()
      const nextKeys = new Set()
      for (const key of Object.keys(next)) {
        nextKeys.add(key)
        const raw = next[key]
        style[key] = raw === null || raw === undefined
          ? ''
          : (typeof raw === 'number' ? `${raw}px` : String(raw))
      }
      for (const key of previousKeys) {
        if (!nextKeys.has(key)) style[key] = ''
      }
      return nextKeys
    },
    /** 事件处理器：统一用 addEventListener 绑定到元素自身。 */
    listener(node, name, value, previous) {
      const type = name.slice(2).toLowerCase()
      if (typeof previous === 'function') node.removeEventListener(type, previous)
      if (typeof value === 'function') node.addEventListener(type, value)
    },
    property(node, name, value) {
      node[name] = value
    },
  }

  const STYLE_LISTENER = /^on[A-Z]/
  const STYLE_BOOLEAN = new Set([
    'disabled', 'checked', 'selected', 'readOnly', 'required', 'autoFocus', 'multiple',
    'hidden', 'open', 'draggable', 'spellCheck',
  ])
  const STYLE_PROPERTY = new Set(['value', 'defaultValue', 'defaultChecked', 'textContent', 'innerHTML'])

  /** 把一个 prop 落到真实 DOM 上。 */
  function applyProp(node, name, value, previous) {
    if (name === 'children' || name === 'key' || name === 'ref') return
    if (STYLE_LISTENER.test(name)) {
      PROP_APPLIERS.listener(node, name, value, previous)
      return
    }
    if (name === 'style') {
      node._styleKeys = PROP_APPLIERS.style(node, name, value, node._styleKeys)
      return
    }
    if (name === 'className' || name === 'class') {
      PROP_APPLIERS.attribute(node, 'class', value)
      return
    }
    if (name === 'htmlFor') {
      PROP_APPLIERS.attribute(node, 'for', value)
      return
    }
    if (STYLE_PROPERTY.has(name)) {
      // 表单控件的 value 用 property 才生效（attribute 只设初始值）
      if (name === 'textContent' || name === 'innerHTML') {
        node[name] = value === null || value === undefined ? '' : String(value)
      } else if (name === 'defaultValue' || name === 'defaultChecked') {
        const target = name === 'defaultValue' ? 'value' : 'checked'
        if (previous === undefined) node[target] = value ?? ''
      } else {
        node[name] = value ?? ''
      }
      return
    }
    if (STYLE_BOOLEAN.has(name)) {
      PROP_APPLIERS.boolean(node, kebabCase(name), value)
      node[name] = value === true
      return
    }
    if (name.startsWith('data-') || name.startsWith('aria-')) {
      PROP_APPLIERS.attribute(node, name, value)
      return
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // 事件以外的对象 prop 交给 property（例如自定义字段）
      PROP_APPLIERS.property(node, name, value)
      return
    }
    PROP_APPLIERS.attribute(node, kebabCase(name), value)
  }

  function removeProp(node, name, previous) {
    if (STYLE_LISTENER.test(name)) {
      if (typeof previous === 'function') node.removeEventListener(name.slice(2).toLowerCase(), previous)
      return
    }
    if (name === 'style') {
      node.removeAttribute('style')
      return
    }
    if (name === 'className' || name === 'class') {
      node.removeAttribute('class')
      return
    }
    if (STYLE_PROPERTY.has(name)) {
      if (name === 'textContent' || name === 'innerHTML') node[name] = ''
      return
    }
    node.removeAttribute(kebabCase(name))
  }

  function applyProps(node, next, previous) {
    const prev = previous ?? {}
    for (const name of Object.keys(prev)) {
      if (name === 'children') continue
      if (!hasOwn(next, name)) removeProp(node, name, prev[name])
    }
    for (const name of Object.keys(next)) {
      if (name === 'children') continue
      const value = next[name]
      // style 每次都要过一遍：它的「上一轮键集」记在节点上（node._styleKeys）。
      if (name === 'style') {
        node._styleKeys = PROP_APPLIERS.style(node, name, value, node._styleKeys)
        continue
      }
      if (prev[name] === value) continue
      applyProp(node, name, value, prev[name])
    }
  }

  // ------------------------------------------------------------------ 运行时

  /** 当前正在渲染的组件实例（hook 调用靠它找到自己的槽位）。 */
  let current = null
  let rootInstance = null
  /** 待提交的 effect 队列（渲染阶段只入队，提交后统一执行）。 */
  const pendingEffects = []
  let flushScheduled = false

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    const run = () => {
      flushScheduled = false
      const queue = pendingEffects.splice(0, pendingEffects.length)
      for (const effect of queue) {
        if (effect.cancelled === true) continue
        effect.run()
      }
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(run)
    else Promise.resolve().then(run)
  }

  function ensureHooks(instance) {
    if (instance.hooks === null) instance.hooks = []
    if (instance.hookCursor === undefined) instance.hookCursor = 0
    return instance.hooks
  }

  /**
   * 取一个 hook 槽位。用哨兵区分「第一次调用」与「上次的值就是 undefined」，
   * 否则 deps 为 undefined 的 useMemo 每次都会重算。
   */
  const HOOK_EMPTY = Symbol('hook-empty')

  function nextHook(initial) {
    if (current === null) {
      throw new Error('迷你渲染层：hook 只能在组件渲染期间调用')
    }
    const hooks = ensureHooks(current)
    const index = current.hookCursor++
    if (hooks[index] === undefined) hooks[index] = { value: HOOK_EMPTY, deps: undefined }
    return { slot: hooks[index], index }
  }

  /** React 的依赖比较语义：没给 deps 或任一项变了就算变。 */
  function depsChanged(previousDeps, deps) {
    if (deps === undefined || previousDeps === undefined) return true
    if (deps.length !== previousDeps.length) return true
    for (let index = 0; index < deps.length; index++) {
      if (!Object.is(deps[index], previousDeps[index])) return true
    }
    return false
  }

  function useState(initial) {
    const { slot } = nextHook(HOOK_EMPTY)
    const instance = current
    if (slot.value === HOOK_EMPTY) {
      slot.value = typeof initial === 'function' ? initial() : initial
    }
    if (slot.setState === undefined) {
      slot.setState = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        rerender(instance)
      }
    }
    return [slot.value, slot.setState]
  }

  function useEffect(effect, deps) {
    const { slot } = nextHook(HOOK_EMPTY)
    if (!depsChanged(slot.deps, deps)) return
    slot.deps = deps === undefined ? undefined : [...deps]
    // 先跑上一轮的清理，再把新的入队（顺序与 React 一致）。
    if (typeof slot.cleanup === 'function') {
      const cleanup = slot.cleanup
      slot.cleanup = undefined
      pendingEffects.push({ run: () => { cleanup() }, cancelled: false })
    }
    const token = { cancelled: false }
    slot.token = token
    pendingEffects.push({
      run: () => {
        if (token.cancelled) return
        const result = effect()
        if (typeof result === 'function') slot.cleanup = result
      },
      cancelled: false,
      token,
    })
    scheduleFlush()
  }

  function useRef(initial) {
    const { slot } = nextHook(HOOK_EMPTY)
    if (slot.value === HOOK_EMPTY) slot.value = { current: initial }
    return slot.value
  }

  function useMemo(factory, deps) {
    const { slot } = nextHook(HOOK_EMPTY)
    if (slot.value === HOOK_EMPTY || depsChanged(slot.deps, deps)) {
      slot.value = factory()
      slot.deps = deps === undefined ? undefined : [...deps]
    }
    return slot.value
  }

  function useCallback(callback, deps) {
    return useMemo(() => callback, deps)
  }

  // ------------------------------------------------------------------ 协调

  const TEXT_MARK = Symbol('text')

  function isTextVNode(value) {
    return typeof value === 'string' || typeof value === 'number'
  }

  function createTextNode(value) {
    return { kind: 'text', value: String(value), dom: null }
  }

  /**
   * 渲染一个 vnode 到父节点。
   * @returns {{kind: string, dom: Node|null, instance?: object}}
   */
  function mount(vnode, parentDom, before) {
    if (vnode === null || vnode === undefined || vnode === false || vnode === true) {
      return { kind: 'empty', dom: null }
    }
    if (isTextVNode(vnode)) {
      const node = { kind: 'text', value: String(vnode), dom: null }
      node.dom = global.document.createTextNode(node.value)
      parentDom.insertBefore(node.dom, before ?? null)
      return node
    }
    if (Array.isArray(vnode)) {
      // 裸数组：包一层，按有序子节点处理
      const node = { kind: 'array', items: [], dom: null, parent: parentDom }
      for (const item of vnode) node.items.push(mount(item, parentDom, before))
      return node
    }
    if (!isElement(vnode)) {
      // 不支持的对象（例如别的库的元素）：忽略而不是崩掉整个界面
      return { kind: 'empty', dom: null }
    }
    if (vnode.type === Fragment) {
      const node = { kind: 'fragment', items: [], dom: null }
      const children = toArray(vnode.props.children)
      for (const child of children) node.items.push(mount(child, parentDom, before))
      return node
    }
    if (typeof vnode.type === 'function') {
      const instance = {
        kind: 'component',
        type: vnode.type,
        props: vnode.props,
        hooks: [],
        hookCursor: 0,
        child: null,
        dom: null,
        parentDom,
        before,
      }
      return renderComponent(instance)
    }
    // 宿主元素
    const dom = global.document.createElement(String(vnode.type))
    applyProps(dom, vnode.props, {})
    const node = { kind: 'host', vnode, dom, children: [] }
    parentDom.insertBefore(dom, before ?? null)
    node.children = mountChildren(toArray(vnode.props.children), dom, null)
    if (typeof vnode.ref === 'function') vnode.ref(dom)
    else if (vnode.ref !== null && vnode.ref !== undefined && typeof vnode.ref === 'object') vnode.ref.current = dom
    return node
  }

  /**
   * 调用组件的渲染函数，并把结果挂载/更新到 DOM 上。
   * @returns {object} 组件实例（child 已是最新）
   */
  function renderComponent(instance) {
    instance.hookCursor = 0
    const saved = current
    current = instance
    let rendered
    try {
      rendered = instance.type(instance.props)
    } catch (error) {
      // 一个组件炸了不该拖垮整棵树：报错并留空位。
      reportError(error)
      rendered = null
    } finally {
      current = saved
    }
    instance.child = patch(instance.child ?? null, rendered, instance.parentDom, instance.before ?? null)
    instance.dom = instance.child === null ? null : instance.child.dom
    return instance
  }

  /** 重渲染一个组件实例（hook 的 setState 走这里），只动它自己的子树。 */
  function rerender(instance) {
    if (instance === null || instance === undefined) return
    const parentDom = instance.parentDom ?? (rootInstance === null ? null : rootInstance.container)
    if (parentDom === null || parentDom === undefined) return
    instance.parentDom = parentDom
    renderComponent(instance)
    scheduleFlush()
  }

  function mountChildren(children, parentDom, before) {
    const out = []
    for (const child of children) out.push(mount(child, parentDom, before))
    return out
  }

  function toArray(value) {
    if (value === null || value === undefined || value === false || value === true) return []
    if (Array.isArray(value)) {
      const out = []
      for (const item of value) out.push(...toArray(item))
      return out
    }
    return [value]
  }

  /**
   * 协调一组子节点。
   *
   * 规则：
   *  - 新列表里带 key 的项只能与「同 key」的旧项复用；找不到就新建。
   *    绝不能按位置去 patch 一个旧项 —— 那会把列表第 2 项当成第 1 项来改，
   *    结果是「旧节点没删干净 + 顺序错乱」。
   *  - 新列表里没 key 的项才按位置与旧项比对（普通数组渲染的自然语义）。
   */
  function reconcileChildren(oldChildren, vnodes, parentDom) {
    const keyed = new Map()
    for (const child of oldChildren) {
      const key = childKey(child)
      if (key !== null && key !== undefined) keyed.set(String(key), child)
    }
    const used = new Set()
    const next = []
    let cursor = 0
    for (const vnode of vnodes) {
      const key = isElement(vnode) ? vnode.key : null
      let previous = null
      if (key !== null && key !== undefined) {
        if (keyed.has(String(key))) {
          previous = keyed.get(String(key))
          used.add(previous)
        }
      } else {
        // 找下一个「没 key、也还没被用掉」的旧项
        while (cursor < oldChildren.length && used.has(oldChildren[cursor])) cursor++
        const candidate = cursor < oldChildren.length ? oldChildren[cursor] : null
        const candidateKey = candidate === null ? null : childKey(candidate)
        if (candidate !== null && (candidateKey === null || candidateKey === undefined)) {
          previous = candidate
          used.add(candidate)
          cursor++
        }
      }
      next.push(patch(previous, vnode, parentDom, null))
    }
    // 移除没被复用的旧节点
    for (const child of oldChildren) {
      if (used.has(child)) continue
      if (next.includes(child)) continue
      unmount(child)
    }
    // 重排：按新顺序把每个子树的 DOM 依次放到锚点之前。
    // （keyed 复用只保证节点不重建，位置仍然要显式搬。）
    let anchor = null
    for (let index = next.length - 1; index >= 0; index--) {
      const nodes = hostNodesOf(next[index])
      for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
        placeNode(parentDom, nodes[nodeIndex], anchor)
      }
      if (nodes.length > 0) anchor = nodes[0]
    }
    return next
  }

  /** 一个渲染节点在 DOM 里的连续节点序列。 */
  function hostNodesOf(node) {
    if (node === null || node === undefined) return []
    if (node.kind === 'component') return hostNodesOf(node.child)
    if (node.kind === 'fragment' || node.kind === 'array') {
      const out = []
      for (const item of node.items) out.push(...hostNodesOf(item))
      return out
    }
    if ((node.kind === 'host' || node.kind === 'text') && node.dom !== null && node.dom !== undefined) return [node.dom]
    return []
  }

  /** 把节点放到 reference 之前（reference 为空则追加到末尾）；已在位则不动。 */
  function placeNode(parentDom, node, reference) {
    if (node === null || node === undefined) return
    if (reference === node) return
    if (reference === null || reference === undefined) {
      const children = parentDom.children
      if (node.parentNode === parentDom && children[children.length - 1] === node) return
      parentDom.appendChild(node)
      return
    }
    if (node.parentNode === parentDom && node.nextSibling === reference) return
    parentDom.insertBefore(node, reference)
  }

  /** 旧节点的 key（宿主元素取 vnode.key；其它节点没有 key）。 */
  function childKey(child) {
    if (child === null || child === undefined) return null
    if (child.kind === 'host') return child.vnode.key
    return child.key ?? null
  }

  function unmount(node) {
    if (node === null || node === undefined) return
    if (node.kind === 'root') {
      unmount(node.child)
      return
    }
    if (node.kind === 'component') {
      // 组件的清理函数要跑
      for (const hook of node.hooks ?? []) {
        if (typeof hook.cleanup === 'function') {
          try { hook.cleanup() } catch (error) { reportError(error) }
          hook.cleanup = undefined
        }
      }
      unmount(node.child)
      return
    }
    if (node.kind === 'fragment' || node.kind === 'array') {
      for (const item of node.items) unmount(item)
      return
    }
    if (node.kind === 'host') {
      for (const child of node.children) unmount(child)
      if (node.dom !== null && node.dom !== undefined && typeof node.dom.remove === 'function') node.dom.remove()
      return
    }
    if (node.kind === 'text' && node.dom !== null && node.dom !== undefined && typeof node.dom.remove === 'function') {
      node.dom.remove()
    }
  }

  function reportError(error) {
    // 渲染期错误不该让整窗白屏：打日志并继续。
    if (global.console !== undefined) global.console.error('[dsh-ppt-canvas] render error:', error)
  }

  /** 把一个 vnode patch 到已有节点（previous 为 null 时挂载）。 */
  function patch(previous, vnode, parentDom, before) {
    if (previous === null || previous === undefined) return mount(vnode, parentDom, before)

    if (vnode === null || vnode === undefined || vnode === false || vnode === true) {
      unmount(previous)
      return { kind: 'empty', dom: null }
    }
    if (isTextVNode(vnode)) {
      if (previous.kind === 'text') {
        const next = String(vnode)
        if (previous.value !== next) {
          previous.value = next
          previous.dom.nodeValue = next
        }
        return previous
      }
      unmount(previous)
      return mount(vnode, parentDom, before)
    }
    if (Array.isArray(vnode)) {
      if (previous.kind === 'array') {
        previous.items = reconcileChildren(previous.items, toArray(vnode), parentDom)
        return previous
      }
      unmount(previous)
      return mount(vnode, parentDom, before)
    }
    if (!isElement(vnode)) return previous

    // 组件
    if (typeof vnode.type === 'function') {
      if (previous.kind === 'component' && previous.type === vnode.type) {
        previous.props = vnode.props
        previous.parentDom = parentDom
        previous.before = before
        return renderComponent(previous)
      }
      unmount(previous)
      return mount(vnode, parentDom, before)
    }

    // Fragment
    if (vnode.type === Fragment) {
      if (previous.kind === 'fragment') {
        previous.items = reconcileChildren(previous.items, toArray(vnode.props.children), parentDom)
        return previous
      }
      unmount(previous)
      return mount(vnode, parentDom, before)
    }

    // 宿主元素：类型不同就整体替换
    if (previous.kind !== 'host' || previous.vnode.type !== vnode.type) {
      const fresh = mount(vnode, parentDom, before)
      unmount(previous)
      return fresh
    }
    applyProps(previous.dom, vnode.props, previous.vnode.props)
    if (previous.vnode.ref !== vnode.ref) {
      if (typeof previous.vnode.ref === 'function') previous.vnode.ref(null)
      if (typeof vnode.ref === 'function') vnode.ref(previous.dom)
    }
    previous.children = reconcileChildren(previous.children, toArray(vnode.props.children), previous.dom)
    previous.vnode = vnode
    return previous
  }

  function renderTree(root) {
    const saved = current
    current = null
    try {
      root.child = patch(root.child, createElement(root.type, root.props), root.container, null)
    } catch (error) {
      reportError(error)
    } finally {
      current = saved
    }
    scheduleFlush()
  }

  /**
   * 挂载一棵界面树。
   * @param {Element} container 容器
   * @returns {{render: Function, unmount: Function}}
   */
  function createRoot(container) {
    let root = null
    rootInstance = null
    return {
      render(vnode) {
        if (root === null) {
          // 首次 render：用一个「容器型」根节点承载，patch 会把 vnode 挂进 container。
          // 这样函数组件与宿主元素走的是同一条路径，不需要特判根类型。
          root = { kind: 'root', type: null, props: {}, hooks: [], hookCursor: 0, child: null, dom: null, container }
          rootInstance = root
        }
        root.child = patch(root.child, vnode, container, null)
        scheduleFlush()
      },
      unmount() {
        if (root !== null) unmount(root)
        root = null
        rootInstance = null
        while (container.children.length > 0) container.removeChild(container.children[0])
      },
    }
  }

  global.__DSH_PPT_MINI_REACT__ = {
    createElement,
    Fragment,
    isElement,
    useState,
    useEffect,
    useRef,
    useMemo,
    useCallback,
    createRoot,
    version: 'mini-1',
  }
})(typeof window !== 'undefined' ? window : globalThis)
