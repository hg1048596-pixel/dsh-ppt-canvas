// dsh-ppt-canvas — 编辑历史（撤销 / 重做）
//
// 语义：每个「撤销点」保存写盘**之前**的完整字节流。撤销 = 把某一步的 before
// 写回文件；重做 = 把 after 写回。存字节而不是存 diff：OOXML 的补丁做逆运算
// 极易失真（run 合并、样式继承、关系表），字节回放是唯一无损的做法。
//
// 落盘位置：<tmp>/dsh-ppt-canvas/<deckKey>/<seq>-<rev>.pptx
// 上限：每个 deck 50 个快照，超出丢弃最旧的。

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deckKeyOf } from './pptx-read.js'

const MAX_SNAPSHOTS = 50

/** 快照根目录。 */
export function snapshotDir(filePath) {
  return join(tmpdir(), 'dsh-ppt-canvas', deckKeyOf(filePath))
}

/** 单个 deck 的历史记录。 */
class DeckHistory {
  constructor(filePath) {
    this.filePath = filePath
    this.rev = 0
    /** @type {Array<{rev: number, before: string, after: string, summary: string, ops: object[], at: number}>} */
    this.entries = []
    /** 当前游标：entries 中「已应用」到的位置（-1 表示回到最初状态）。 */
    this.cursor = -1
    this.seq = 0
  }

  get dir() {
    return snapshotDir(this.filePath)
  }

  ensureDir() {
    const dir = this.dir
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * 写一份快照。
   *
   * **必须原子**：直接 writeFileSync 到最终路径时，进程若在写一半被杀，
   * 会留下截断的 pptx；而 readSnapshot 不校验大小，undo 会把截断文件写回用户的文稿。
   * 这里改成「同目录临时文件 + rename」。
   */
  writeSnapshot(kind, rev, buffer) {
    const dir = this.ensureDir()
    const path = join(dir, `${String(this.seq).padStart(4, '0')}-${kind}-${rev}.pptx`)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, buffer)
    renameSync(tmp, path)
    this.seq++
    return path
  }

  /** 读快照；文件缺失或明显截断（大小 0）都当作不可用。 */
  readSnapshot(path) {
    if (!existsSync(path)) return null
    try {
      const buffer = readFileSync(path)
      if (buffer.length < 22) return null // 比 ZIP 的 EOCD 还小，肯定不是有效包
      return buffer
    } catch {
      return null
    }
  }

  prune() {
    while (this.entries.length > MAX_SNAPSHOTS) {
      const dropped = this.entries.shift()
      this.cursor = Math.max(-1, this.cursor - 1)
      for (const path of [dropped.before, dropped.after]) {
        try { if (existsSync(path)) rmSync(path) } catch { /* 临时文件清理失败不影响主流程 */ }
      }
    }
  }
}

/** 历史存储。 */
export function createHistory() {
  /** @type {Map<string, DeckHistory>} */
  const decks = new Map()

  const ensure = (filePath) => {
    const key = join(filePath).toLowerCase()
    let history = decks.get(key)
    if (history === undefined) {
      history = new DeckHistory(filePath)
      decks.set(key, history)
    }
    return history
  }

  return {
    /** 注册/重置一个 deck 的基线（打开文件时调用）。 */
    reset(filePath, rev = 0, summary = 'open') {
      const history = ensure(filePath)
      history.rev = rev
      history.entries = []
      history.cursor = -1
      history.summary = summary
      return history
    },

    /** 记录一次成功写入：before = 旧字节，after = 新字节。 */
    push({ filePath, rev, before, after, summary, ops = [] }) {
      const history = ensure(filePath)
      // 撤销后再编辑：丢弃游标之后的分支（标准编辑器语义）。
      if (history.cursor < history.entries.length - 1) {
        for (const dropped of history.entries.splice(history.cursor + 1)) {
          for (const path of [dropped.before, dropped.after]) {
            try { if (existsSync(path)) rmSync(path) } catch { /* ignore */ }
          }
        }
      }
      const beforePath = history.writeSnapshot('before', rev, before)
      const afterPath = history.writeSnapshot('after', rev, after)
      history.entries.push({
        rev,
        before: beforePath,
        after: afterPath,
        summary: summary ?? 'edit',
        ops,
        at: Date.now(),
      })
      history.cursor = history.entries.length - 1
      history.rev = rev
      history.prune()
      return history
    },

    /**
     * 查询「撤销 steps 步」会得到什么，**不改任何状态**。
     *
     * 为什么要拆成 peek + commit：以前这里直接推进 cursor/rev，而写盘在调用方
     * 之后才发生。写盘失败（文件被占用、磁盘满、staleFile）时文件没变，但内存里
     * 的游标已经回退了 —— 之后的 undo/redo/rev 全部错乱
     * （表现为"撤销一次跳到更早的状态"、canUndo 突然变 false）。
     */
    undo(filePath, steps = 1) {
      const history = ensure(filePath)
      const count = Math.max(1, Math.trunc(steps))
      if (history.cursor - count + 1 < 0) return null
      const target = history.entries[history.cursor - count + 1]
      const buffer = history.readSnapshot(target.before)
      if (buffer === null) return null
      const cursorAfter = history.cursor - count
      const rev = cursorAfter < 0 ? 0 : history.entries[cursorAfter].rev
      return {
        buffer,
        rev,
        cursorAfter,
        canUndo: cursorAfter >= 0,
        canRedo: cursorAfter < history.entries.length - 1,
      }
    },

    /** 查询「重做 steps 步」，同样不改状态。 */
    redo(filePath, steps = 1) {
      const history = ensure(filePath)
      const count = Math.max(1, Math.trunc(steps))
      if (history.cursor + count > history.entries.length - 1) return null
      const target = history.entries[history.cursor + count]
      const buffer = history.readSnapshot(target.after)
      if (buffer === null) return null
      const cursorAfter = history.cursor + count
      return {
        buffer,
        rev: history.entries[cursorAfter].rev,
        cursorAfter,
        canUndo: cursorAfter >= 0,
        canRedo: cursorAfter < history.entries.length - 1,
      }
    },

    /**
     * 写盘**成功之后**才调用：把游标与 rev 推进到目标位置。
     * @param {string} filePath
     * @param {number} rev
     * @param {number} [cursorAfter]
     */
    commitRestore(filePath, rev, cursorAfter) {
      const history = ensure(filePath)
      if (Number.isFinite(cursorAfter)) history.cursor = cursorAfter
      if (Number.isFinite(rev)) history.rev = rev
      return history.rev
    },

    /** 历史状态 + 人类可读的条目。 */
    status(filePath) {
      const history = ensure(filePath)
      return {
        rev: history.rev,
        canUndo: history.cursor >= 0,
        canRedo: history.cursor < history.entries.length - 1,
        entries: history.entries
          .map((entry, index) => ({
            rev: entry.rev,
            summary: entry.summary,
            at: entry.at,
            applied: index <= history.cursor,
          }))
          .reverse(),
      }
    },

    /** 丢弃一个 deck 的全部快照与内存记录。 */
    forget(filePath) {
      const key = join(filePath).toLowerCase()
      const history = decks.get(key)
      if (history !== undefined) {
        try {
          if (existsSync(history.dir)) {
            for (const name of readdirSync(history.dir)) {
              try { rmSync(join(history.dir, name)) } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
      }
      decks.delete(key)
    },

    /** 诊断用：当前跟踪的 deck 数。 */
    size() {
      return decks.size
    },
  }
}

export { deckKeyOf, MAX_SNAPSHOTS }
