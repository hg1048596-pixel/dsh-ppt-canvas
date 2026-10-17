// host/temp-sweep.js — 清理插件自己的临时区
//
// 为什么需要：插件在临时目录里写了三类东西，都**没有回收机制**：
//   - picked/   上传的演示文稿副本（每次「打开文件」一份）
//   - render/   渲染缓存 PNG + 每页 staged 整包 pptx + LibreOffice profile
//   - <deckKey>/ 撤销历史快照（每步两份完整 pptx）
// 一份 80MB 的文稿编辑 50 步，历史就有约 8GB。长期使用会把用户临时盘吃满。
//
// 策略：启动时删掉**超过保留期**的内容（默认 7 天），保留近期以便撤销/缓存命中。
// 只删本插件自己的目录，且只在启动时跑一次，不与正在进行的读写竞争。

import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 清理插件临时区里过期的内容。
 *
 * @param {object} [options]
 * @param {number} [options.retentionMs] 保留期（默认 7 天）
 * @param {object} [options.logger]
 * @returns {{removed: number, freedBytes: number}}
 */
export function sweepTemp(options = {}) {
  const retention = Number.isFinite(options.retentionMs) ? options.retentionMs : DEFAULT_RETENTION_MS
  const logger = options.logger
  const root = join(tmpdir(), 'dsh-ppt-canvas')
  const cutoff = Date.now() - retention
  let removed = 0
  let freedBytes = 0

  const sizeOf = (target) => {
    try {
      const stat = statSync(target)
      if (!stat.isDirectory()) return stat.size
      let total = 0
      for (const entry of readdirSync(target, { withFileTypes: true })) {
        total += sizeOf(join(target, entry.name))
      }
      return total
    } catch {
      return 0
    }
  }

  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return { removed, freedBytes } // 目录还不存在
  }

  for (const entry of entries) {
    const target = join(root, entry.name)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(target).mtimeMs
    } catch {
      continue
    }
    if (mtimeMs >= cutoff) continue
    const bytes = sizeOf(target)
    try {
      rmSync(target, { recursive: true, force: true })
      removed += 1
      freedBytes += bytes
    } catch {
      // 被占用就跳过，下次启动再清
    }
  }

  if (removed > 0) {
    logger?.info?.(`[dsh-ppt-canvas] temp sweep: removed ${removed} stale item(s), freed ${(freedBytes / 1024 / 1024).toFixed(1)} MB`)
  }
  return { removed, freedBytes }
}
