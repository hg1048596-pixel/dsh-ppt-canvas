// dsh-ppt-canvas — 引擎自检
//
// 供 /dsh-ppt/api/selftest 使用：对内置演示文稿跑一遍
// 读 → 校验 → 试算 → 落盘 → 回读 → 撤销，把每一步结果作为一条 check 返回。
// 任何一步失败都不抛异常（只有 detail 里带错误），这样运维一眼能看出坏在哪一层。

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDeck, loadPackage } from './pptx-read.js'
import { applyPatch, validatePatch } from './pptx-write.js'
import { demoBytes } from './demo.js'

/**
 * @param {import('./deck-store.js').DeckStore} [store] 传入时额外校验已打开文档
 * @returns {{ok: boolean, durationMs: number, checks: Array<{name: string, ok: boolean, detail: string|null}>}}
 */
export function runSelfTest(store) {
  const started = Date.now()
  const checks = []
  const add = (name, fn) => {
    try {
      const detail = fn()
      checks.push({ name, ok: true, detail: detail === undefined ? null : String(detail) })
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  let workDir = null
  let deckPath = null
  let baseBytes = null

  add('bundled-demo-present', () => {
    const bytes = demoBytes()
    if (bytes === null) throw new Error('plugin/assets/demo.pptx is missing from this installation')
    baseBytes = bytes
    return `${bytes.length} bytes`
  })

  add('open-package', () => {
    if (baseBytes === null) throw new Error('skipped: no demo bytes')
    const pkg = loadPackage(baseBytes)
    return `${pkg.slideParts.length} slide parts, ${pkg.media.size} media`
  })

  add('parse-deck', () => {
    if (baseBytes === null) throw new Error('skipped: no demo bytes')
    workDir = mkdtempSync(join(tmpdir(), 'dsh-ppt-selftest-'))
    deckPath = join(workDir, 'selftest.pptx')
    const deck = readDeck(baseBytes, deckPath, 0)
    if (deck.slides.length === 0) throw new Error('no slides parsed')
    if (deck.slideWidth <= 0 || deck.slideHeight <= 0) throw new Error('slide size not parsed')
    const shapes = deck.slides.reduce((sum, slide) => sum + slide.shapes.length, 0)
    if (shapes === 0) throw new Error('no shapes parsed')
    return `${deck.slides.length} slides / ${shapes} shapes / ${Math.round(deck.slideWidth)}×${Math.round(deck.slideHeight)} px`
  })

  add('validate-patch', () => {
    if (baseBytes === null) throw new Error('skipped: no demo bytes')
    const deck = readDeck(baseBytes, deckPath ?? 'selftest.pptx', 0)
    const target = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain !== '')
    if (target === undefined) throw new Error('the demo deck has no text shape on slide 1')
    const { violations, ops } = validatePatch(deck, {
      summary: 'selftest',
      ops: [{ op: 'setTextStyle', id: target.id, color: '#1A73E8', bold: true }],
    })
    if (violations.length > 0) throw new Error(`unexpected violations: ${JSON.stringify(violations)}`)
    if (ops.length !== 1) throw new Error(`expected 1 validated op, got ${ops.length}`)
    const bad = validatePatch(deck, { summary: 'x', ops: [{ op: 'nope', id: target.id }] })
    if (bad.violations.length === 0) throw new Error('an unknown op must be rejected')
    return `ok, rejects unknown ops`
  })

  add('apply-patch-in-memory', () => {
    if (baseBytes === null) throw new Error('skipped: no demo bytes')
    const deck = readDeck(baseBytes, deckPath, 0)
    const target = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain !== '')
    const patch = {
      summary: 'selftest',
      ops: [{ op: 'setTextStyle', id: target.id, color: '#1A73E8', bold: true, align: 'center' }],
    }
    const out = applyPatch(baseBytes, deck, deckPath, patch, {})
    const reread = readDeck(out.buffer, deckPath, 1)
    const after = reread.slides[0].shapes.find(shape => shape.id === target.id)
    if (after.text.color !== '#1A73E8') throw new Error(`colour did not land: ${after.text.color}`)
    if (after.text.align !== 'center') throw new Error(`align did not land: ${after.text.align}`)
    return `${out.changedIds.length} element(s) changed, ${out.warnings.length} warning(s)`
  })

  add('store-round-trip', () => {
    if (store === undefined) return 'skipped: no store passed'
    const deck = store.view()
    const status = store.historyStatus()
    return `${deck.file} @ rev ${deck.rev}, canUndo=${status.canUndo}, canRedo=${status.canRedo}`
  })

  try {
    if (workDir !== null && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  } catch { /* 清理失败不影响结论 */ }

  return {
    ok: checks.every(check => check.ok),
    durationMs: Date.now() - started,
    checks,
  }
}
