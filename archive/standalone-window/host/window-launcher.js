// dsh-ppt-canvas — 独立窗口启动器
//
// 让「PPT 协同编辑画布」脱离 DSH 主窗口，成为一个可以自由拖动、缩放的桌面窗口：
// 本模块找到 Electron 运行时、spawn host/window.cjs、把窗口位置/尺寸变化写回配置，
// 并在宿主进程退出时把窗口一起收掉。
//
// 设计要点：
//  - **纯 Electron 运行时即可**，不需要桌面版宿主：任何能被 spawn 的 electron 二进制都行。
//  - **零下载**：优先复用本机已有的 Electron（环境变量覆盖 → 同 profile 里其它桌面窗插件
//    自带的 vendor 运行时 → npm 全局安装 → profile/开发树的 node_modules）。
//    找不到就直接告诉用户怎么补，不偷偷联网下载几百 MB。
//  - **位置持久化**：窗口移动/缩放时子进程往 stdout 写一行 JSON，这里节流后写回状态文件。

import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 子进程可执行文件路径（含扩展名），按平台/架构拼。 */
export function electronBinaryIn(root, platform = process.platform, arch = process.arch) {
  if (root === null || root === undefined) return null
  if (platform === 'darwin') {
    const macRoot = join(root, 'Electron.app', 'Contents', 'MacOS', 'Electron')
    return existsSync(macRoot) ? macRoot : null
  }
  const name = platform === 'win32' ? 'electron.exe' : 'electron'
  const direct = join(root, name)
  if (existsSync(direct)) return direct
  // vendor 形态：<root>/electron-<platform>-<arch>/electron[.exe]
  const nested = join(root, `electron-${platform}-${arch}`, name)
  return existsSync(nested) ? nested : null
}

/** 运行时目录是否完整（只有 exe 没有 resources/ 的残缺目录必须跳过）。 */
function isUsableRoot(root, platform = process.platform) {
  if (root === null || root === undefined || !existsSync(root)) return false
  const binary = electronBinaryIn(root, platform)
  if (binary === null) return false
  const dir = dirname(binary)
  if (platform === 'darwin') return existsSync(join(root, 'Electron.app', 'Contents', 'Resources'))
  return existsSync(join(dir, 'resources'))
}

/** profile 根目录：~/.dsh/profiles/<name>（用 DSH_PROFILE 环境变量，默认 desktop）。 */
function profileRoot() {
  const name = process.env.DSH_PROFILE && process.env.DSH_PROFILE !== '' ? process.env.DSH_PROFILE : 'desktop'
  return join(homedir(), '.dsh', 'profiles', name)
}

/** npm 全局 prefix（找不到返回 null）。 */
function npmGlobalPrefix() {
  try {
    const out = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return out === '' ? null : out
  } catch {
    return null
  }
}

/**
 * 收集候选 Electron 二进制（按优先级）。
 * @returns {Array<{path: string, from: string}>}
 */
export function electronCandidates(env = process.env) {
  const candidates = []
  const push = (path, from) => {
    if (path === null || path === undefined) return
    if (!existsSync(path)) return
    if (candidates.some(candidate => candidate.path.toLowerCase() === path.toLowerCase())) return
    candidates.push({ path, from })
  }

  // 1) 显式覆盖
  push(env.DSH_PPT_ELECTRON, 'DSH_PPT_ELECTRON')

  // 2) 同 profile 下其它桌面窗插件自带的运行时（本机常见位置），避免重复下载
  const profileModules = join(profileRoot(), 'node_modules')
  const petVendor = join(profileModules, 'dsh-pet-remielle', 'vendor')
  if (existsSync(petVendor)) {
    push(electronBinaryIn(petVendor), 'dsh-pet-remielle/vendor')
  }

  // 3) 我们自己 profile 里的 electron 安装
  push(electronBinaryIn(join(profileModules, 'electron', 'dist')), 'profile electron')

  // 4) npm 全局
  const prefix = npmGlobalPrefix()
  if (prefix !== null) push(electronBinaryIn(join(prefix, 'node_modules', 'electron', 'dist')), 'npm global')

  // 5) 开发树 / 当前工作目录
  for (const base of [
    join(HERE, '..', 'node_modules', 'electron', 'dist'),
    join(process.cwd(), 'node_modules', 'electron', 'dist'),
    join(process.cwd(), 'desktop', 'node_modules', 'electron', 'dist'),
  ]) {
    push(electronBinaryIn(base), 'cwd node_modules')
  }

  return candidates
}

/** 首个可用运行时，或 null。 */
export function resolveElectron(env = process.env) {
  for (const candidate of electronCandidates(env)) {
    if (isUsableRoot(dirname(candidate.path))) return candidate
  }
  return null
}

/**
 * 找到「本运行时配套的 electron 包装包」的 CommonJS 入口绝对路径。
 *
 * 官方 npm 包装包 `node_modules/electron/index.js` 会 `module.exports = require('electron')`，
 * 而 Electron 的加载器把那个模块名拦截成内建 API —— 所以**按路径加载它**就能拿到 API，
 * 且不会像自建垫片那样递归。
 *
 * 解析锚点按「离这个二进制最近」排序：先是同一 node_modules 树，再是插件自身所在包。
 *
 * @param {{path: string}} backend - 已解析出的运行时
 * @returns {string|null} 找不到就返回 null（调用方退回 `require('electron')`）
 */
export function electronModuleFor(backend) {
  if (backend === null || backend === undefined || typeof backend.path !== 'string') return null
  const binaryDir = dirname(backend.path)
  const anchors = [
    join(binaryDir, '..', 'package.json'),          // <root>/electron-<plat>-<arch>/../package.json
    join(binaryDir, '..', '..', 'package.json'),    // <root>/../package.json
    join(HERE, '..', 'package.json'),               // 本插件包
    join(profileRoot(), 'package.json'),            // profile
    join(process.cwd(), 'package.json'),
  ]
  for (const anchor of anchors) {
    if (!existsSync(anchor)) continue
    try {
      // 用属主包的解析路径找 node_modules/electron（存在不等于能用，故再查 index.js）
      const require = createRequire(anchor)
      for (const searchPath of require.resolve.paths('electron') ?? []) {
        const entry = join(searchPath, 'electron', 'index.js')
        if (existsSync(entry)) return entry
      }
    } catch { /* 换下一个锚点 */ }
  }
  return null
}

/**
 * 状态目录：优先 profile 下的 `.dsh-ppt-canvas`，建不出来就退回系统临时目录。
 *
 * 这里刻意**不做任何会抛的事**：插件挂载时会读一次窗口状态，若因为目录不可写就抛，
 * 整个插件的 apply 都会失败 —— 一个「记住窗口位置」的小功能不该有这个权力。
 * 返回 null 表示没地方存，调用方按「没有历史状态」处理。
 */
let cachedStateDir
function stateDir() {
  if (cachedStateDir !== undefined) return cachedStateDir
  const candidates = [
    join(profileRoot(), '.dsh-ppt-canvas'),
    join(tmpdir(), 'dsh-ppt-canvas-state'),
  ]
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true })
      cachedStateDir = dir
      return dir
    } catch { /* 试下一个候选 */ }
  }
  cachedStateDir = null
  return null
}

function statePath() {
  const dir = stateDir()
  return dir === null ? null : join(dir, 'window.json')
}

/** 读持久化状态；读不到就是空状态（不抛）。 */
export function readWindowState() {
  const path = statePath()
  if (path === null) return {}
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 合并写回状态；写不进去只影响「记住位置」，不影响窗口功能（不抛）。 */
export function writeWindowState(patch) {
  const next = { ...readWindowState(), ...patch }
  const path = statePath()
  if (path === null) return next
  try {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  } catch { /* 忽略 */ }
  return next
}

/**
 * 一个被 spawn 出来的独立窗口。
 */
export class CanvasWindow {
  /**
   * @param {object} options
   * @param {string} options.url        窗口要加载的页面（本插件的 /dsh-ppt/window）
   * @param {object} [options.rendererHeader] DSH Desktop 渲染进程准入头 {name, value}
   * @param {object} [options.logger]
   */
  constructor(options) {
    this.url = options.url
    this.rendererHeader = options.rendererHeader ?? null
    this.logger = options.logger ?? console
    this.backend = options.backend === undefined ? resolveElectron() : options.backend
    this.child = undefined
    this.state = readWindowState()
    this.onExit = options.onExit
    this.onBounds = options.onBounds
  }

  get running() {
    return this.child !== undefined && this.child.exitCode === null && !this.child.killed
  }

  /**
   * 上一次启动的结局；窗口「spawn 成功」不等于「窗口真的出现了」。
   * UI 用它在窗口秒退时说出真正原因（而不是让用户以为按钮没反应）。
   */
  failureSummary() {
    const last = this.lastStart
    if (last === null || last === undefined) return null
    if (last.exited === null) return null
    if (last.lifetimeMs !== undefined && last.lifetimeMs > 8000) return null
    const hint = /MODULE_NOT_FOUND.*electron|Cannot find module 'electron'/i.test(last.stderr)
      ? '这个 Electron 运行时缺少 npm 包装包（只有裸二进制），因此主脚本里的 require(\'electron\') 解析不到。'
        + '请在 profile 里安装官方包（pnpm add -D electron），或用 DSH_PPT_ELECTRON 指向一个完整的 Electron 安装。'
      : null
    return {
      exit: last.exited,
      lifetimeMs: last.lifetimeMs ?? null,
      stderr: last.stderr.slice(-600),
      hint,
    }
  }

  /** 运行时不可用时的可读原因 + 修复建议。 */
  unavailableReason() {
    return [
      '找不到可用的 Electron 运行时，独立窗口无法打开。',
      '任选一种方式补齐后再试：',
      '  1) 把已有 electron.exe 的完整目录路径设进环境变量 DSH_PPT_ELECTRON，然后重启 DSH；',
      '  2) npm install -g electron；',
      `  3) 在 ${profileRoot()} 下执行 pnpm add -D electron。`,
      '（插件不会自行联网下载运行时；面板内的画布不受影响。）',
    ].join('\n')
  }

  /** 启动窗口；已在运行则直接返回。 */
  start() {
    if (this.running) return { ok: true, pid: this.child.pid, reused: true }
    if (this.backend === null || this.backend === undefined) {
      return { ok: false, reason: 'no-electron', message: this.unavailableReason() }
    }

    const userData = join(stateDir(), 'electron-user-data')
    mkdirSync(userData, { recursive: true })

    // 让 window.cjs 能拿到 Electron 内建 API：不要让它去解析模块名 'electron'
    // （裸二进制运行时没有那个包装包，会 MODULE_NOT_FOUND 并以 0x80000003 退出）。
    // 这里解析出「本运行时自己的包装包」，把绝对路径交给脚本按路径加载。
    const electronModulePath = electronModuleFor(this.backend)

    // 必须先剔除 ELECTRON_RUN_AS_NODE，再拼其它变量 —— 不能写成 `{...process.env, X: '0'}`：
    // Electron 只在**这个键完全不存在**时才是真正的 Electron 模式。本机实测：
    // 继承 '1'、设成 ''、设成 '0' 三种情况进程都会退化成纯 Node（require('electron')
    // 拿不到内建 API，窗口 79ms 内以 0x80000003/1 退出），只有把键删掉才真的开出窗口。
    const env = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') continue
      env[key] = value
    }
    Object.assign(env, {
      DSH_PPT_WINDOW_URL: this.url,
      DSH_PPT_PARENT_PID: String(process.pid),
      DSH_PPT_USER_DATA: userData,
      ...(electronModulePath === null ? {} : { DSH_PPT_ELECTRON_MODULE: electronModulePath }),
      ...(Number.isFinite(this.state.x) && Number.isFinite(this.state.y)
        ? { DSH_PPT_WINDOW_X: String(this.state.x), DSH_PPT_WINDOW_Y: String(this.state.y) }
        : {}),
      ...(this.rendererHeader !== null
        ? {
            DSH_PPT_RENDERER_HEADER_NAME: this.rendererHeader.name,
            DSH_PPT_RENDERER_HEADER_VALUE: this.rendererHeader.value,
          }
        : {}),
    })

    // 先用管道 spawn，拿得到子进程的输出；失败时降级见下。

    // 先用管道 spawn，这样能拿到子进程的输出用于诊断。
    let child
    let piped = true
    const spawnAttempt = (stdio) => spawn(this.backend.path, [join(HERE, 'window.cjs')], {
      cwd: dirname(this.backend.path),
      stdio,
      windowsHide: false,
      env,
    })
    try {
      child = spawnAttempt(['ignore', 'pipe', 'pipe'])
    } catch (error) {
      // 受限沙箱里「管道式 stdio」会被拒绝（EPERM），这不是运行时缺失。
      // 窗口本身不需要管道也能跑，只是拿不到它上报的位置 —— 于是降级重试一次：
      // 先保住「能开窗」，位置改成由窗口自己落盘、下次启动时读取。
      if (error?.code === 'EPERM') {
        try {
          child = spawnAttempt('ignore')
          piped = false
        } catch (retryError) {
          return { ok: false, reason: 'spawn-failed', message: `${retryError.message}（管道与忽略模式都被拒绝）` }
        }
      } else {
        return { ok: false, reason: 'spawn-failed', message: `${error.message}` }
      }
    }
    this.piped = piped
    this.child = child

    // 子进程 stdout 用 NDJSON 上报窗口 bounds；stderr 原样转日志。
    let buffered = ''
    child.stdout?.on('data', (chunk) => {
      buffered += String(chunk)
      let at
      while ((at = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, at).trim()
        buffered = buffered.slice(at + 1)
        if (line === '') continue
        try {
          const event = JSON.parse(line)
          if (event !== null && event.type === 'bounds') {
            this.state = writeWindowState({
              x: Math.round(Number(event.x) || 0),
              y: Math.round(Number(event.y) || 0),
              width: Math.round(Number(event.width) || 0),
              height: Math.round(Number(event.height) || 0),
            })
            this.onBounds?.(this.state)
          }
        } catch {
          this.logger.debug?.(`ppt-canvas window stdout: ${line}`)
        }
      }
    })
    // 收集子进程 stderr：窗口起不来的真正原因几乎都在这里（例如主脚本
    // `require('electron')` 失败），必须能让 UI 看到，而不是只留在日志里。
    let stderrTail = ''
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text === '') return
      stderrTail = `${stderrTail}\n${text}`.slice(-1200)
      this.logger.warn?.(`ppt-canvas window: ${text}`)
    })
    this.lastStart = { ok: true, at: Date.now(), pid: child.pid ?? null, exited: null, stderr: '' }
    const startRecord = this.lastStart
    child.once('error', (error) => {
      this.logger.error?.(`ppt-canvas window failed to start: ${error.message}`)
      startRecord.exited = 'spawn-error'
      startRecord.stderr = error.message
      this.child = undefined
      this.onExit?.(this)
    })
    child.once('exit', (code) => {
      const superseded = this.child !== undefined && this.child !== child
      if (!superseded) this.child = undefined
      const lifetimeMs = Date.now() - startRecord.at
      startRecord.exited = code === null ? 'signal' : code
      startRecord.stderr = stderrTail.trim()
      startRecord.lifetimeMs = lifetimeMs
      this.logger.info?.(`ppt-canvas window exited (code=${code === null ? 'signal' : code})`
        + (stderrTail.trim() === '' ? '' : ` :: ${stderrTail.trim().split('\n').slice(-3).join(' | ')}`))
      if (!superseded) this.onExit?.(this)
    })
    return { ok: true, pid: child.pid, backend: this.backend.from, reused: false }
  }

  /** 关闭窗口。 */
  stop(reason = 'stopped') {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return Promise.resolve()
    return new Promise((resolvePromise) => {
      const fallback = setTimeout(resolvePromise, 5000)
      if (typeof fallback.unref === 'function') fallback.unref()
      child.once('exit', () => {
        clearTimeout(fallback)
        resolvePromise()
      })
      try {
        child.kill()
      } catch (error) {
        this.logger.warn?.(`ppt-canvas window kill failed (${reason}): ${error.message}`)
      }
    })
  }

  /** 诊断信息（不含子进程句柄）。 */
  status() {
    return {
      running: this.running,
      pid: this.running ? this.child.pid : null,
      available: this.backend !== null && this.backend !== undefined,
      backend: this.backend === null || this.backend === undefined ? null : this.backend.from,
      bounds: this.state,
      // 上一次启动的结局。窗口「启动成功」和「真的活下来」是两回事：
      // 主脚本可能在 require('electron') 就崩掉（被 vendor 的裸运行时常见），
      // 此时 spawn 是成功的，但窗口从来没出现过。UI 必须能说出真正的原因。
      lastStart: this.lastStart,
    }
  }
}

export { resolve as resolvePath }
