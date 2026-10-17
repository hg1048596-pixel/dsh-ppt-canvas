// dsh-ppt-canvas — Host 侧文档存储
//
// 单一权威：磁盘上的 .pptx 是唯一事实。本模块把所有读写都收敛到一处，
// 保证「选择状态 / AI 结果 / PPT 文档」三方同步时以 Host 的 rev 为准。

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadPackage, readDeck } from './pptx-read.js'
import { applyPatch } from './pptx-write.js'
import { createHistory, deckKeyOf } from './history.js'
import { ensureDemoDeck } from './demo.js'

/** 业务错误：带稳定 code，HTTP 层与工具层直接转发。 */
export class DeckError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'DeckError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

const CONTEXT_TTL_MS = 30 * 60 * 1000
const MAX_CONTEXTS = 64

/** 一个已打开文档的运行时状态。 */
class OpenDeck {
  constructor(filePath, buffer, deck, history) {
    this.filePath = filePath
    this.deckKey = deckKeyOf(filePath)
    this.buffer = buffer
    this.deck = deck
    this.history = history
    this.mtimeMs = safeMtime(filePath)
  }

  /** Host 侧权威 rev，来自 history（撤销/重做后也保持一致）。 */
  get rev() {
    return this.history.status(this.filePath).rev
  }
}

function safeMtime(filePath) {
  try { return statSync(filePath).mtimeMs } catch { return 0 }
}

/**
 * 打开文档的中央存储：解析、缓存、补丁、撤销/重做、AI 上下文暂存。
 * 一个 Host 进程一份实例；按绝对路径为键。
 */
export class DeckStore {
  constructor() {
    /** @type {Map<string, OpenDeck>} */
    this.decks = new Map()
    this.history = createHistory()
    this.current = null
    /** @type {Map<string, {payload: object, createdAt: number, consumed: boolean}>} */
    this.contexts = new Map()
    /**
     * 写操作串行化队列。
     *
     * 为什么必须串行：apply 的流程是「读 open.buffer → 计算 → await 写盘 → 更新 open」。
     * 两个 apply 并发时都会基于**同一份旧 buffer** 计算，后写的那次会把先写的改动
     * 整体覆盖（lost update），而且历史里会出现两条相同 rev 的记录。
     * 触发场景：AI 工具调用与客户端提交撞在一起、或两个面板同时编辑。
     */
    this.mutationTail = Promise.resolve()
  }

  /**
   * 把一次写操作排进队列，保证同一时刻只有一个在跑。
   * 前一个失败不会断链（用 `then(ok, err)` 接住两种结果）。
   *
   * @template T
   * @param {() => Promise<T>} run
   * @returns {Promise<T>}
   */
  enqueueMutation(run) {
    const result = this.mutationTail.then(run, run)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  // ---------------------------------------------------------------- 打开 / 读取

  /**
   * 用**内容**打开一份演示文稿：写到托管目录，再当作普通文件打开。
   *
   * 为什么需要它：原生文件对话框（`<input type="file">`）只给出 `File` ——
   * 内容，标准 DOM 下拿不到绝对路径。而本插件按**路径**读写文件，所以这里把内容
   * 落到托管目录再打开。这就是「用普通应用那种打开文件的方式」在插件侧的实现。
   *
   * 每次都以唯一文件名写入：同名旧文件可能正被打开着（画布里有撤销历史），
   * 直接覆盖会破坏那份文档。
   *
   * @param {Uint8Array|Buffer} bytes 文件内容
   * @param {string} [name] 原始文件名（仅用于命名与显示）
   * @returns {Promise<object>} 与 open() 相同的 Deck
   */
  async openBytes(bytes, name) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = join(tmpdir(), 'dsh-ppt-canvas', 'picked')
    mkdirSync(dir, { recursive: true })
    const base = typeof name === 'string' && /\.pptx$/i.test(name) ? name : 'picked.pptx'
    const safe = base.replace(/[\\/:*?"<>|]/g, '_')
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const filePath = join(dir, `${stamp}-${safe}`)
    writeFileSync(filePath, bytes)
    return this.open(filePath, { force: true })
  }

  /**
   * 打开一个 pptx（已打开且文件未变更时复用缓存）。
   * @param {string} rawPath
   * @returns {Promise<object>} Deck
   */
  async open(rawPath, options = {}) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      throw new DeckError('badRequest', 'path is required')
    }
    const filePath = resolve(rawPath)
    if (!existsSync(filePath)) {
      throw new DeckError('notFound', `file not found: ${filePath}`)
    }
    const stat = statSync(filePath)
    if (!stat.isFile()) throw new DeckError('badRequest', `not a file: ${filePath}`)
    if (stat.size > 80 * 1024 * 1024) {
      throw new DeckError('badRequest', `presentation is too large (${stat.size} bytes)`)
    }

    const cached = this.decks.get(filePath)
    const mtimeMs = stat.mtimeMs
    if (cached !== undefined && cached.mtimeMs === mtimeMs && options.force !== true) {
      this.current = cached
      return this.view(cached)
    }

    const buffer = await readFile(filePath)
    let deck
    try {
      deck = readDeck(buffer, filePath, 0)
    } catch (error) {
      throw new DeckError('ioFailed', `cannot parse ${filePath}: ${error.message}`)
    }
    const history = cached?.history ?? this.history
    if (cached === undefined) {
      history.reset(filePath, 0, 'open')
    } else {
      // 复用了缓存句柄，但磁盘内容可能已经被**外部程序**换掉了。
      // 此时必须把历史清空：旧快照的 before/after 都属于旧内容，留着它们
      // 会让「撤销一次」把旧快照写回磁盘，**静默覆盖外部修改**。
      // 判据：打开时记录的 mtime 与当前不同，或内容长度变化。
      const drifted = options.force === true || cached.mtimeMs !== mtimeMs
      if (drifted) history.reset(filePath, 0, 'reload')
    }
    const open = new OpenDeck(filePath, buffer, deck, history)
    open.mtimeMs = mtimeMs
    open.deck.rev = open.rev
    this.decks.set(filePath, open)
    this.current = open
    return this.view(open)
  }

  /** 生成（或复用）内置演示文稿并打开它。 */
  async openDemo(dir) {
    const { filePath, bytes } = await ensureDemoDeck(dir)
    const cached = this.decks.get(filePath)
    if (cached !== undefined && bytes === undefined) return this.view(cached)
    if (bytes !== undefined) {
      // demo.js 已经写好文件；走 open() 的解析路径保证同一条代码路。
      this.decks.delete(filePath)
    }
    return this.open(filePath)
  }

  /** 强制重新读取当前文档（外部程序改过文件时用）。 */
  async reload() {
    const open = this.requireCurrent()
    return this.open(open.filePath, { force: true })
  }

  /** 当前文档的 Deck 视图；没有打开任何文档时抛 noDeck。 */
  view(open = this.current) {
    if (open === null || open === undefined) throw new DeckError('noDeck', 'no presentation is open')
    const deck = open.deck
    deck.rev = open.rev
    // 让客户端能廉价地判断「磁盘上的文件是否被外部程序改过」：
    // 它拿这个值和 /api/status 的 fileMtimeMs 对比即可，不必每次都重解析整包。
    deck.fileMtimeMs = open.mtimeMs
    return deck
  }

  /**
   * 轻量状态：只读 stat，不解析包。供客户端轮询外部改动用。
   *
   * 为什么需要单独的接口：`/api/deck` 返回整份 Deck（大文档几百 KB JSON），
   * 4 秒一次轮询不划算；而外部改动检测只需要 rev + mtime。
   *
   * @returns {{file: string, rev: number, mtimeMs: number, changed: boolean}}
   */
  status() {
    const open = this.requireCurrent()
    const onDisk = safeMtime(open.filePath)
    return {
      file: open.filePath,
      rev: open.rev,
      mtimeMs: onDisk,
      openedMtimeMs: open.mtimeMs,
      // 磁盘 mtime 与打开时记录的不一致 = 外部改过（保存过 / 被替换）
      changed: onDisk !== 0 && open.mtimeMs !== 0 && onDisk !== open.mtimeMs,
    }
  }

  /**
   * 写入前的护栏：文件是否已被外部程序改动。
   *
   * **不校验会静默丢数据**：apply 用的是内存里的 buffer，若 PowerPoint 在此期间
   * 保存过文件，我们的写入会覆盖掉外部修改（且撤销快照 before 也是旧的）。
   * 实测（tools/probe-external-edit.mjs）：外部覆盖后 /api/deck 仍返回旧内容。
   *
   * @param {object} open
   * @throws {DeckError} code=staleFile
   */
  assertUnchangedOnDisk(open) {
    const onDisk = safeMtime(open.filePath)
    if (onDisk === 0 || open.mtimeMs === 0) return // 拿不到 mtime 时不阻断
    if (onDisk === open.mtimeMs) return
    throw new DeckError(
      'staleFile',
      '文件已被其他程序修改（例如 PowerPoint 保存过），为避免覆盖那部分改动，本次写入已中止。请先重载。',
      { file: open.filePath, openedMtimeMs: open.mtimeMs, currentMtimeMs: onDisk },
    )
  }

  /** 当前打开文档的内部句柄（含 buffer），仅供 API/工具层使用。 */
  requireCurrent() {
    if (this.current === null) throw new DeckError('noDeck', 'no presentation is open')
    return this.current
  }

  /** 按 deckKey 找文档（媒体路由用）。 */
  byKey(deckKey) {
    for (const candidate of this.decks.values()) {
      if (candidate.deckKey === deckKey) return candidate
    }
    return undefined
  }

  // ---------------------------------------------------------------- 补丁 / 历史

  /**
   * 校验并应用一个修改方案。
   * @param {object} patch §5 的 Patch
   * @param {{dryRun?: boolean, source?: string, requestId?: string}} options
   */
  async apply(patch, options = {}) {
    // **入队前**就绑定目标文档：排队期间可能有人 /api/open 切了文档，
    // 那时再 requireCurrent() 会把本次补丁写到**另一份文件**上
    // （两份文稿常有相同的 s1:2 之类 id，校验根本拦不住）。
    const target = this.requireCurrent()
    return this.enqueueMutation(() => {
      if (this.current !== target) {
        throw new DeckError('staleDeck', '文档在排队期间被切换，本次修改已放弃（请重新发送）', {
          expected: target.filePath,
          current: this.current === null ? null : this.current.filePath,
        })
      }
      return this.applyUnlocked(patch, options, target)
    })
  }

  /** apply 的实际实现；只应由 enqueueMutation 调用（保证串行）。 */
  async applyUnlocked(patch, options = {}, bound) {
    const open = bound ?? this.requireCurrent()
    if (this.current !== open) {
      throw new DeckError('staleDeck', '文档已切换，本次修改已放弃')
    }
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new DeckError('badRequest', 'patch must be an object')
    }
    if (options.requestId !== undefined) {
      const entry = this.contexts.get(options.requestId)
      if (entry !== undefined && entry.payload.deckRev !== open.rev) {
        throw new DeckError('staleRev', 'the document changed after the instruction was captured', {
          requestedRev: entry.payload.deckRev,
          currentRev: open.rev,
        })
      }
    }

    let result
    try {
      result = applyPatch(open.buffer, open.deck, open.filePath, patch, { dryRun: options.dryRun === true })
    } catch (error) {
      if (error && error.code === 'validationFailed') {
        throw new DeckError('validationFailed', error.message, error.details)
      }
      if (error && typeof error.code === 'string') {
        throw new DeckError(error.code, error.message, error.details)
      }
      throw new DeckError('ioFailed', `patch failed: ${error.message}`)
    }

    const summary = typeof patch.summary === 'string' && patch.summary !== '' ? patch.summary : 'AI 修改'
    if (options.dryRun === true) {
      return {
        applied: false,
        dryRun: true,
        rev: open.rev,
        summary,
        changedIds: result.changedIds ?? [],
        ops: result.ops ?? [],
        warnings: result.warnings ?? [],
        deck: null,
      }
    }
    if ((result.changedIds ?? []).length === 0 && (result.ops ?? []).every(o => o.status === 'skipped')) {
      throw new DeckError('validationFailed', 'the patch changed nothing', { violations: result.ops ?? [] })
    }

    const rev = open.rev + 1
    const nextBuffer = Buffer.from(result.buffer)
    // 落盘前确认磁盘上的文件没被外部程序改过（否则会静默覆盖别人的修改）。
    if (options.force !== true) this.assertUnchangedOnDisk(open)
    await writeAtomic(open.filePath, nextBuffer)
    // 顺序：先写盘、再记历史。若历史写快照失败（磁盘满/权限），文件已经变了，
    // 内存状态必须跟着更新，否则后续 apply 会被 staleFile 永久卡住。
    try {
      this.history.push({
        filePath: open.filePath,
        rev,
        before: open.buffer,
        after: nextBuffer,
        summary,
        ops: result.ops ?? [],
      })
    } catch (error) {
      // 尽力把内存状态同步到"已写盘"的事实，再报错让调用方知道历史不可用。
      open.buffer = nextBuffer
      open.mtimeMs = safeMtime(open.filePath)
      try { open.deck = readDeck(nextBuffer, open.filePath, rev) } catch { /* 保底 */ }
      throw new DeckError('ioFailed', `patch 已写入文件，但撤销历史记录失败：${error.message}`, {
        file: open.filePath, rev,
      })
    }
    open.buffer = nextBuffer
    open.mtimeMs = safeMtime(open.filePath)
    let deck
    try {
      deck = readDeck(nextBuffer, open.filePath, rev)
    } catch (error) {
      throw new DeckError('ioFailed', `the written presentation cannot be re-read: ${error.message}`)
    }
    open.deck = deck
    // 与 view() 保持一致：契约声明 Deck 顶层有 fileMtimeMs，
    // 但 apply 这里直接返回 readDeck 的结果，漏了它 → 客户端按契约读会拿到 undefined。
    deck.fileMtimeMs = open.mtimeMs
    return {
      applied: true,
      dryRun: false,
      rev,
      summary,
      changedIds: result.changedIds ?? [],
      ops: result.ops ?? [],
      warnings: result.warnings ?? [],
      deck,
    }
  }

  /** 撤销 steps 步。 */
  async undo(steps = 1) {
    const target = this.requireCurrent()
    return this.enqueueMutation(() => {
      if (this.current !== target) {
        throw new DeckError('staleDeck', '文档在排队期间被切换，本次撤销已放弃')
      }
      return this.#restore('undo', steps, target)
    })
  }

  /** 重做 steps 步。 */
  async redo(steps = 1) {
    const target = this.requireCurrent()
    return this.enqueueMutation(() => {
      if (this.current !== target) {
        throw new DeckError('staleDeck', '文档在排队期间被切换，本次重做已放弃')
      }
      return this.#restore('redo', steps, target)
    })
  }

  async #restore(direction, steps, bound) {
    const open = bound ?? this.requireCurrent()
    const count = Number.isFinite(steps) ? Math.max(1, Math.trunc(steps)) : 1
    // **先**校验磁盘没被外部改过，再动历史游标。
    // 顺序反了会出真问题：history.undo() 会立刻推进 cursor 与 rev，若随后
    // assertUnchangedOnDisk 抛 staleFile，文件没写但内存历史已经前进 ——
    // 之后的 undo/redo/rev 全部错乱（表现为"撤销一次跳到更早的状态"）。
    this.assertUnchangedOnDisk(open)
    const outcome = direction === 'undo'
      ? this.history.undo(open.filePath, count)
      : this.history.redo(open.filePath, count)
    if (outcome === null || outcome === undefined) {
      throw new DeckError(
        direction === 'undo' ? 'nothingToUndo' : 'nothingToRedo',
        direction === 'undo' ? 'there is nothing to undo' : 'there is nothing to redo',
        { history: this.history.status(open.filePath) },
      )
    }
    const buffer = Buffer.from(outcome.buffer)
    await writeAtomic(open.filePath, buffer)
    open.buffer = buffer
    open.mtimeMs = safeMtime(open.filePath)
    this.history.commitRestore(open.filePath, outcome.rev)
    const deck = readDeck(buffer, open.filePath, outcome.rev)
    open.deck = deck
    deck.fileMtimeMs = open.mtimeMs
    return deck
  }

  /** 历史状态（含 canUndo / canRedo / 条目摘要）。 */
  historyStatus() {
    const open = this.requireCurrent()
    return this.history.status(open.filePath)
  }

  // ---------------------------------------------------------------- AI 上下文

  /**
   * 暂存一次「选区 + 指令」上下文，返回 requestId。
   * 客户端在发指令前调用；模型工具再按 requestId 取回完整上下文。
   */
  putContext(payload) {
    if (payload === null || typeof payload !== 'object') {
      throw new DeckError('badRequest', 'context must be an object')
    }
    const requestId = typeof payload.requestId === 'string' && payload.requestId !== ''
      ? payload.requestId
      : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const open = this.current
    const entry = {
      payload: {
        ...payload,
        requestId,
        deckRev: typeof payload.deckRev === 'number' ? payload.deckRev : (open === null ? 0 : open.rev),
        createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : Date.now(),
      },
      createdAt: Date.now(),
      consumed: false,
    }
    this.#pruneContexts()
    this.contexts.set(requestId, entry)
    return entry.payload
  }

  /** 取回上下文（不消费）。 */
  getContext(requestId) {
    const entry = this.contexts.get(requestId)
    if (entry === undefined) {
      throw new DeckError('notFound', `no canvas context for requestId ${requestId}`)
    }
    return { context: entry.payload, consumed: entry.consumed }
  }

  /** 取回并标记已消费（模型的第一次读取算消费，便于审计“AI 是否真的读了选区”）。 */
  consumeContext(requestId) {
    const { context } = this.getContext(requestId)
    const entry = this.contexts.get(requestId)
    entry.consumed = true
    return context
  }

  #pruneContexts() {
    const now = Date.now()
    for (const [id, entry] of this.contexts) {
      if (now - entry.createdAt > CONTEXT_TTL_MS) this.contexts.delete(id)
    }
    while (this.contexts.size >= MAX_CONTEXTS) {
      const oldest = this.contexts.keys().next().value
      if (oldest === undefined) break
      this.contexts.delete(oldest)
    }
  }
}

/** 原子写盘：同目录临时文件 + rename，避免半个文件。 */
async function writeAtomic(filePath, buffer) {
  const { writeFile, rename, unlink } = await import('node:fs/promises')
  const tmp = `${filePath}.dsh-ppt-${process.pid}-${Date.now().toString(36)}.tmp`
  try {
    await writeFile(tmp, buffer)
    await rename(tmp, filePath)
  } catch (error) {
    try { await unlink(tmp) } catch { /* temp file may not exist */ }
    throw new DeckError('ioFailed', `cannot write ${filePath}: ${error.message}`, { cause: String(error) })
  }
}

export { deckKeyOf }
