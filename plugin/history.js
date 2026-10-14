// dsh-ppt-canvas — 编辑历史（撤销 / 重做）
//
// 语义：每个「撤销点」保存写盘**之前**的完整字节流。撤销 = 把某一步的 before
// 写回文件；重做 = 把 after 写回。存字节而不是存 diff：OOXML 的补丁做逆运算
// 极易失真（run 合并、样式继承、关系表），字节回放是唯一无损的做法。
//
// 落盘位置：<tmp>/dsh-ppt-canvas/<deckKey>/<seq>-<rev>.pptx
// 上限：每个 deck 50 个快照，超出丢弃最旧的。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
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

  writeSnapshot(kind, rev, buffer) {
    const dir = this.ensureDir()
    const path = join(dir, `${String(this.seq).padStart(4, '0')}-${kind}-${rev}.pptx`)
    writeFileSync(path, buffer)
    this.seq++
    return path
  }

  readSnapshot(path) {
    return existsSync(path) ? readFileSync(path) : null
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

    /** 撤销 steps 步，返回要写回的字节。 */
    undo(filePath, steps = 1) {
      const history = ensure(filePath)
      const count = Math.max(1, Math.trunc(steps))
      if (history.cursor - count + 1 < 0) return null
      const target = history.entries[history.cursor - count + 1]
      const buffer = history.readSnapshot(target.before)
      if (buffer === null) return null
      history.cursor -= count
      history.rev = history.cursor < 0 ? 0 : history.entries[history.cursor].rev
      return {
        buffer,
        rev: history.cursor < 0 ? Math.max(0, history.rev) : history.entries[history.cursor].rev,
        canUndo: history.cursor >= 0,
        canRedo: history.cursor < history.entries.length - 1,
      }
    },

    /** 重做 steps 步。 */
    redo(filePath, steps = 1) {
      const history = ensure(filePath)
      const count = Math.max(1, Math.trunc(steps))
      if (history.cursor + count > history.entries.length - 1) return null
      const target = history.entries[history.cursor + count]
      const buffer = history.readSnapshot(target.after)
      if (buffer === null) return null
      history.cursor += count
      history.rev = history.entries[history.cursor].rev
      return {
        buffer,
        rev: history.rev,
        canUndo: history.cursor >= 0,
        canRedo: history.cursor < history.entries.length - 1,
      }
    },

    /**
     * 撤销/重做写盘后由调用方确认：只推进 rev，不再新增快照。
     * （游标已在 undo/redo 内移动。）
     */
    commitRestore(filePath, rev) {
      const history = ensure(filePath)
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
