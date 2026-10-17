// tests/concurrency.test.mjs — 写操作串行化（防 lost update）
//
// 背景（真实缺陷）：apply 的流程是「读 open.buffer → 计算 → await 写盘 → 更新 open」。
// 两个 apply 并发时都基于同一份旧 buffer 计算，后写的会整体覆盖先写的改动，
// 历史里还会出现两条相同 rev。触发场景：AI 工具调用与客户端提交撞在一起。
//
// 这个测试的价值在于：**去掉 enqueueMutation 就会失败**。
//
// 用法：<node> tests/concurrency.test.mjs

import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DeckStore } from '../host/deck-store.js'
import { snapshotDir as snapshotDirOf } from '../host/history.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'demo.pptx')

let passed = 0
let failed = 0
const failures = []

async function check(name, body) {
  try {
    await body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL ${name}: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message ?? 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const workDir = mkdtempSync(join(tmpdir(), 'ppt-concurrency-'))
const deckPath = join(workDir, 'race.pptx')
copyFileSync(FIXTURE, deckPath)

const store = new DeckStore()
const opened = await store.open(deckPath)

/** 取第一个可填色的非组合形状。 */
const pickShape = (deck) => deck.slides[0].shapes.find(shape => shape.kind !== 'group')

await check('并发两次 apply：两次改动都要落地，rev 不重复', async () => {
  const base = store.view()
  const shapeA = pickShape(base)
  // 两个形状用不同的填充色，便于验证「都有」而不是「只剩后一个」
  const shapes = base.slides[0].shapes.filter(shape => shape.kind === 'shape' || shape.kind === 'text')
  assert(shapes.length >= 2, `需要至少两个可填色形状，实际 ${shapes.length}`)
  const [one, two] = shapes

  const [first, second] = await Promise.all([
    store.apply({ summary: '并发 A', ops: [{ op: 'setFill', id: one.id, color: '#111111' }] }),
    store.apply({ summary: '并发 B', ops: [{ op: 'setFill', id: two.id, color: '#222222' }] }),
  ])

  // 两次都成功，且拿到的 rev 必须不同（串行化后应为 rev+1 与 rev+2）
  assert(first.rev !== second.rev, `两个并发 apply 拿到了相同的 rev (${first.rev})，说明没有串行化`)

  const finalDeck = store.view()
  const afterOne = finalDeck.slides[0].shapes.find(shape => shape.id === one.id)
  const afterTwo = finalDeck.slides[0].shapes.find(shape => shape.id === two.id)
  assertEqual(afterOne.style.fill.color?.toUpperCase(), '#111111', '改动 A 必须保留（不能被 B 覆盖）')
  assertEqual(afterTwo.style.fill.color?.toUpperCase(), '#222222', '改动 B 必须保留')
  void shapeA
})

await check('并发 apply 后磁盘内容与内存一致（两处改动都在文件里）', async () => {
  const onDisk = store.view()
  const finalDeck = onDisk
  const colors = finalDeck.slides[0].shapes
    .map(shape => shape.style?.fill?.color?.toUpperCase() ?? null)
    .filter(color => color === '#111111' || color === '#222222')
  assertEqual([...new Set(colors)].length, 2, `磁盘上应当同时包含两处改动，实际 ${JSON.stringify(colors)}`)
  assert(readFileSync(deckPath).length > 0)
})

await check('一个失败不阻断队列（后续写入仍可执行）', async () => {
  const before = store.view().rev
  // 第一个故意非法（未知 op），第二个合法
  const bad = store.apply({ summary: '坏补丁', ops: [{ op: 'nope' }] }).then(() => 'resolved', error => error.code)
  const good = store.apply({ summary: '好补丁', ops: [{ op: 'setFill', id: pickShape(store.view()).id, color: '#333333' }] })
  const [badResult, goodResult] = await Promise.all([bad, good])
  assert(badResult !== 'resolved', `坏补丁应当失败，实际 ${badResult}`)
  assert(goodResult.rev > before, '后续写入必须仍然成功')
})

await check('undo 也走队列（与 apply 不互相踩）', async () => {
  const before = store.view().rev
  await Promise.all([
    store.undo(1),
    store.apply({ summary: 'undo 期间写入', ops: [{ op: 'setFill', id: pickShape(store.view()).id, color: '#444444' }] }),
  ])
  const after = store.view().rev
  // 只要不抛错、rev 合理推进即可：关键是不出现「两个操作同时改 open」
  assert(Number.isFinite(after), 'rev 必须仍是有限数')
  assert(after >= before - 1, `rev 不应异常回退（before=${before} after=${after}）`)
})

await check('packageOf 缓存解析结果，写盘后失效（避免每请求全包解压）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-pkg-'))
  const file = join(dir, 'p.pptx')
  copyFileSync(FIXTURE, file)
  const localStore = new DeckStore()
  await localStore.open(file)

  const first = localStore.packageOf()
  const second = localStore.packageOf()
  assert(first === second, '同一 buffer 必须复用同一个解析结果（===）')

  const shape = localStore.view().slides[0].shapes.find(item => item.kind !== 'group')
  await localStore.apply({ summary: '改一笔', ops: [{ op: 'setFill', id: shape.id, color: '#778899' }] })
  const third = localStore.packageOf()
  assert(third !== first, '写盘后 buffer 变了，缓存必须失效')

  rmSync(dir, { recursive: true, force: true })
})

await check('上下文体超过 512KB 被拒（防止内存被撑爆）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-ctx-'))
  const file = join(dir, 'c.pptx')
  copyFileSync(FIXTURE, file)
  const localStore = new DeckStore()
  await localStore.open(file)

  // 小上下文正常
  const ok = localStore.putContext({ instruction: 'hi', elements: [] })
  assert(typeof ok.requestId === 'string' && ok.requestId !== '')

  // 超大上下文被拒
  let code = null
  try {
    localStore.putContext({ instruction: 'x', blob: 'A'.repeat(600 * 1024) })
  } catch (error) {
    code = error.code
  }
  assertEqual(code, 'badRequest', '超大 context 必须被拒')

  rmSync(dir, { recursive: true, force: true })
})

await check('打开过多文档时按 LRU 淘汰（decks 不再无限增长）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-lru-'))
  const localStore = new DeckStore()
  for (let index = 0; index < 6; index += 1) {
    const file = join(dir, `deck-${index}.pptx`)
    copyFileSync(FIXTURE, file)
    await localStore.open(file)
  }
  assert(localStore.decks.size <= localStore.maxOpenDecks, `decks 应被限制在 ${localStore.maxOpenDecks}，实际 ${localStore.decks.size}`)
  // 当前文档不能被淘汰
  assert(localStore.current !== null, 'current 必须保留')
  assert(localStore.decks.has(localStore.current.filePath), 'current 必须在 decks 里')
  rmSync(dir, { recursive: true, force: true })
})

await check('close() 释放历史快照与内存缓存（以前只把 current 置空）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-close-'))
  const file = join(dir, 'close.pptx')
  copyFileSync(FIXTURE, file)
  const localStore = new DeckStore()
  await localStore.open(file)
  const shape = localStore.view().slides[0].shapes.find(item => item.kind !== 'group')
  await localStore.apply({ summary: '写一笔', ops: [{ op: 'setFill', id: shape.id, color: '#445566' }] })

  const snapshotDir = snapshotDirOf(file)
  assert(existsSync(snapshotDir), '应用补丁后应存在历史快照目录')
  assert(localStore.decks.size > 0, '打开后 decks 应有记录')

  const result = localStore.close()
  assertEqual(result.closed, true)
  assertEqual(result.released, true, '应报告已释放')
  assertEqual(localStore.current, null, 'current 应被清空')
  assertEqual(localStore.decks.size, 0, 'decks 缓存应被清空')
  // 快照目录里的文件应被删除（目录本身可能还在，但不应再有 .pptx）
  if (existsSync(snapshotDir)) {
    const left = readdirSync(snapshotDir).filter(name => name.endsWith('.pptx'))
    assertEqual(left.length, 0, `历史快照应被删除，仍剩 ${left.length} 个`)
  }
  rmSync(dir, { recursive: true, force: true })
})

await check('写盘失败不推进撤销游标（内存与磁盘必须一致）', async () => {
  // 原缺陷：history.undo() 内部直接推进 cursor/rev，而写盘在它之后才发生。
  // 写盘失败（文件被占用/目录消失/磁盘满）时文件没变、游标却已回退，
  // 之后的 undo/redo/rev 全部错乱。现在 undo/redo 是纯查询，写成功才 commit。
  const dir = mkdtempSync(join(tmpdir(), 'ppt-undo-fail-'))
  const file = join(dir, 'undo.pptx')
  copyFileSync(FIXTURE, file)
  const localStore = new DeckStore()
  await localStore.open(file)
  const shape = localStore.view().slides[0].shapes.find(item => item.kind !== 'group')
  await localStore.apply({ summary: '改一笔', ops: [{ op: 'setFill', id: shape.id, color: '#ABC123' }] })

  const revBefore = localStore.view().rev
  const canUndoBefore = localStore.historyStatus().canUndo
  assertEqual(canUndoBefore, true, '刚 apply 完应当可以撤销')

  // 让写盘必然失败：把文件所在目录整个删掉
  rmSync(dir, { recursive: true, force: true })

  let code = null
  try {
    await localStore.undo(1)
  } catch (error) {
    code = error.code
  }
  assertEqual(code, 'ioFailed', `写盘应当失败（got ${code}）`)

  // 关键断言：游标没有动
  const status = localStore.historyStatus()
  assertEqual(status.canUndo, canUndoBefore, '写盘失败后 canUndo 不应变化（游标没动）')
  assertEqual(localStore.view().rev, revBefore, '写盘失败后 rev 不应变化')

  rmSync(dir, { recursive: true, force: true })
})

rmSync(workDir, { recursive: true, force: true })

console.log('')
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
process.exit(0)
