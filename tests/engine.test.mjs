// tests/engine.test.mjs — dsh-ppt-canvas 引擎自检
//
// 无框架：直接跑，PASS/FAIL 逐条打印，最后一行 TOTAL <n> PASSED <n> FAILED <n>，有失败则退出码 1。
// 运行：<node> tests/engine.test.mjs
//
// 覆盖：XML 层往返、zip 往返、fixture 解析、补丁应用与回读、校验失败（且文件不变）、
// dryRun 不落盘、撤销/重做字节级还原、中日韩文本空格保真、未触碰的页字节不变、
// DeckStore 端到端（打开 → 上下文 → 应用 → 撤销 → 历史）。

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseXml, serializeXml, findAll, findFirst, textOf, createElement, appendChild, childrenOf, childOf, removeChild, removeChildren, setAttr, setText } from '../host/xml.js'
import { readZipEntries, readZip, writeZip, crc32 } from '../host/zip.js'
import { readDeck, loadPackage, deckKeyOf } from '../host/pptx-read.js'
import { applyPatch } from '../host/pptx-write.js'
import { DeckStore } from '../host/deck-store.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'demo.pptx')

let passed = 0
let failed = 0
const failures = []

function check(name, fn) {
  try {
    const result = fn()
    if (result === false) throw new Error('returned false')
    passed++
    console.log(`PASS ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

async function checkAsync(name, fn) {
  try {
    const result = await fn()
    if (result === false) throw new Error('returned false')
    passed++
    console.log(`PASS ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

/**
 * 把 zip 条目字节解成文本。
 * 必须经 Buffer.from：Uint8Array.prototype.toString() 会**忽略**编码参数，
 * 直接返回逗号分隔的字节值（这就是之前 xml:space 检测失败的真正原因）。
 */
function entryText(buffer, name) {
  const bytes = readZip(buffer).get(name)
  assert(bytes !== undefined, `zip entry ${name} is missing`)
  return Buffer.from(bytes).toString('utf8')
}

const workDir = mkdtempSync(join(tmpdir(), 'dsh-ppt-test-'))
const deckPath = join(workDir, 'deck.pptx')
copyFileSync(FIXTURE, deckPath)
/** 跨断言传递的小工具袋子（避免顶层 const 的 TDZ 问题）。 */
const probe = {}

// ---------------------------------------------------------------- XML 层

check('xml: 往返保持结构', () => {
  const source = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:root xmlns:a="urn:a" b="x &amp; y">`
    + `<a:p algn="ctr"><a:r><a:rPr sz="1800"/><a:t xml:space="preserve"> hi &lt;b&gt; 你好 </a:t></a:r></a:p>`
    + `<a:empty/></a:root>`
  const root = parseXml(source)
  const round = parseXml(serializeXml(root))
  assertEqual(round.name, 'a:root')
  assertEqual(textOf(round), ' hi <b> 你好 ')
  assertEqual(findAll(round, 'a:rPr')[0].attrs.sz, '1800')
  assertEqual(findAll(round, 'a:t')[0].attrs['xml:space'], 'preserve')
  assertEqual(findFirst(round, 'a:p').attrs.algn, 'ctr')
})

check('xml: 属性里的引号与实体', () => {
  const root = parseXml('<r a="he said &quot;hi&quot;" b=\'single\'/>')
  assertEqual(root.attrs.a, 'he said "hi"')
  assertEqual(root.attrs.b, 'single')
  assertEqual(serializeXml(root), '<r a="he said &quot;hi&quot;" b="single"/>')
})

check('xml: 文本与实体解码', () => {
  const root = parseXml('<r>a&amp;b&#65;&#x42;</r>')
  assertEqual(textOf(root), 'a&bAB')
})

// ---------------------------------------------------------------- ZIP 层

check('zip: 字节级往返', () => {
  const original = readFileSync(FIXTURE)
  const entries = readZipEntries(original)
  assert(entries.length > 20, `expected many entries, got ${entries.length}`)
  const rebuilt = writeZip(entries.map(entry => ({ name: entry.name, data: readZip(original).get(entry.name) })))
  const a = readZip(original)
  const b = readZip(rebuilt)
  assertEqual(b.size, a.size, 'entry count')
  for (const [name, bytes] of a) {
    const other = b.get(name)
    assert(other !== undefined, `entry ${name} missing after round-trip`)
    assertEqual(Buffer.compare(Buffer.from(bytes), Buffer.from(other)), 0, `entry ${name} differs`)
  }
})

check('zip: crc32 与已知值一致', () => {
  assertEqual(crc32(Buffer.from('123456789', 'utf8')), 0xCBF43926)
})

// ---------------------------------------------------------------- fixture 解析

check('read: 页面尺寸与形状结构', () => {
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  assertEqual(deck.slides.length, 3, 'slide count')
  assertEqual(Math.round(deck.slideWidth), Math.round(13.333 * 96), 'slide width px')
  assertEqual(Math.round(deck.slideHeight), 720, 'slide height px')
  const slide1 = deck.slides[0]
  assertEqual(slide1.shapes.length, 7, 'slide 1 shape count')
  assertEqual(slide1.background, '#F7F8FA')
  const title = slide1.shapes.find(shape => shape.text !== null && shape.text.plain.includes('2026 年第三季度复盘'))
  assert(title !== undefined, 'title text box not found')
  assertEqual(title.kind, 'text')
  assertEqual(title.type, 17)
  assertEqual(title.text.bold, true)
  assertEqual(title.text.color, '#FFFFFF')
  const line = slide1.shapes.find(shape => shape.kind === 'line')
  assert(line !== undefined, 'connector not found')
  assertEqual(line.type, 9)
})

check('read: z 顺序与 XML 顺序一致（第一个子元素在最底）', () => {
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const slide1 = deck.slides[0]
  const band = slide1.shapes[0]
  const title = slide1.shapes[1]
  assertEqual(band.z, 0, 'band is the first (backmost) shape')
  assertEqual(title.z, 1, 'title is painted above the band')
  const zs = slide1.shapes.map(shape => shape.z)
  assertEqual(zs.join(','), zs.slice().sort((a, b) => a - b).join(','), 'z is monotonic in document order')
})

check('read: 图片与媒体', () => {
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const slide2 = deck.slides[1]
  const picture = slide2.shapes.find(shape => shape.kind === 'image')
  assert(picture !== undefined, 'picture not found on slide 2')
  assertEqual(picture.type, 13)
  assert(picture.image.mediaId !== null, 'media id resolved')
  assertEqual(deck.media[picture.image.mediaId].mime, 'image/png')
  assertEqual(deck.media[picture.image.mediaId].width, 720)
  assert(picture.image.url.includes(deckKeyOf(FIXTURE)), 'media url carries the deck key')
})

check('read: 表格', () => {
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const table = deck.slides[1].shapes.find(shape => shape.kind === 'table')
  assert(table !== undefined, 'table not found')
  assertEqual(table.table.rows, 4)
  assertEqual(table.table.cols, 4)
  const first = table.table.cells.find(cell => cell.r === 0 && cell.c === 0)
  assertEqual(first.text, '指标')
  assert(table.geometry.w > 100, 'table geometry resolved from p:xfrm')
})

check('read: 圆角半径（椭圆 = 半高）', () => {
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const ellipse = deck.slides[2].shapes.find(shape => shape.style.cornerRadius > 0)
  assert(ellipse !== undefined, 'ellipse not found')
  assertEqual(ellipse.style.prst, 'ellipse')
  assertEqual(ellipse.style.cornerRadius, Math.round((ellipse.geometry.h / 2) * 100) / 100)
})

check('read: 行距/内边距/自动缩放（排版三要素，之前整段丢失）', () => {
  // 回归：此前模型只有文本与字号，行距（a:lnSpc）、正文框内边距（a:bodyPr 的 lIns 等）、
  // 自动缩放（a:spAutoFit）全部丢弃 —— 画布因此「排版全没了」。
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const body = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain.includes('本季度三条主线'))
  assert(body !== undefined, 'body text box not found')

  // 行距：fixture 里每段都是 125%
  for (const paragraph of body.text.paragraphs) {
    assertEqual(paragraph.lnSpc, 1.25, `lnSpc must be read (para: ${JSON.stringify(paragraph.runs[0]?.text?.slice(0, 12))})`)
    assertEqual(paragraph.lnSpcIsPx, false, 'a percentage line spacing is not px')
  }
  // 内边距：没有 lIns 覆盖时是 PowerPoint 默认值
  assertEqual(body.text.insets.left, 9.6)
  assertEqual(body.text.insets.top, 4.8)
  // 自动缩放：这个框写的是 a:spAutoFit
  assertEqual(body.text.autofit, 'shape')
  // 垂直锚点也要在（中间对齐的大标题靠它）
  const title = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain.includes('第三季度复盘'))
  assertEqual(title.text.anchor, 'middle')
})

check('read: 本段没写的字段沿用母版默认值，母版也没有才是 null', () => {
  // 继承规则：
  //   - 段落自己写了 → 用段落的
  //   - 段落没写但母版 p:txStyles 写了 → 用母版的（实测用户文件的行距/段前只在这里）
  //   - 两处都没有 → null，**不编造数值**
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const body = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain.includes('本季度三条主线'))
  for (const paragraph of body.text.paragraphs) {
    // fixture 的段落自己写了 lnSpc=125%，覆盖母版
    assertEqual(paragraph.lnSpc, 1.25, '段落自己的 lnSpc 优先于母版')
    // fixture 的母版与段落都没有 spcBef/spcAft → 必须是 null
    assertEqual(paragraph.spaceBefore, null, '两处都没有 spcBef 时必须是 null')
    assertEqual(paragraph.spaceAfter, null, '两处都没有 spcAft 时必须是 null')
    // indent 来自母版 bodyStyle 的 marL（fixture 母版给了 228600 EMU = 24px），
    // 所以这里**不应该**是 null —— 曾经因为完全没读母版而丢失。
    assert(
      paragraph.indent === null || paragraph.indent > 0,
      'indent 要么是母版来的正数，要么两处都没有才为 null',
    )
  }
})

check('read: 母版文本默认值真的被读取（回归：曾定义了函数却从未调用）', () => {
  // 这是真实发生过的半成品 bug：`readMasterTextDefaults` 定义完整，
  // 但没有任何调用点，`readTextBody` 的第三个参数永远是 undefined ——
  // 于是母版里的 lnSpc / spcBef / marL 一个都没生效，而代码看起来是"已实现"的。
  const deck = readDeck(readFileSync(FIXTURE), FIXTURE, 0)
  const texts = deck.slides.flatMap(slide => slide.shapes)
    .filter(shape => shape.text !== null && shape.text.plain.trim() !== '')

  // fixture 的母版 bodyStyle 定义了 marL，正文段落应当至少有一个承接到了缩进
  const withIndent = texts.filter(shape => shape.text.paragraphs.some(p => p.indent !== null && p.indent > 0))
  assert(withIndent.length > 0, '至少要有一个段落从母版承接了 indent（说明母版被真的读了）')

  // 而且母版给的行距必须是有限正数（读了但读错也要拦住）
  for (const shape of texts) {
    for (const paragraph of shape.text.paragraphs) {
      if (paragraph.lnSpc === null) continue
      assert(Number.isFinite(paragraph.lnSpc) && paragraph.lnSpc > 0, `lnSpc 必须是有限正数，实际 ${paragraph.lnSpc}`)
      assert(paragraph.lnSpc < 5, `lnSpc 不像行距倍数：${paragraph.lnSpc}`)
    }
  }
})

// ---------------------------------------------------------------- 补丁

check('patch: 混合补丁应用后回读一致', () => {
  const before = readFileSync(deckPath)
  const deck = readDeck(before, deckPath, 0)
  const slide1 = deck.slides[0]
  const title = slide1.shapes.find(shape => shape.text !== null && shape.text.plain.includes('2026 年第三季度复盘'))
  const band = slide1.shapes[0]
  const patch = {
    summary: '标题改红并右对齐 + 色块换色 + 几何/层级/复制/对齐',
    ops: [
      { op: 'setTextStyle', id: title.id, color: '#D93025', align: 'right', fontSize: 34, bold: true },
      { op: 'setText', id: title.id, paragraphs: [{ runs: [{ text: '2026 Q3 复盘' }] }] },
      { op: 'setFill', id: band.id, color: '#0B7285' },
      { op: 'setGeometry', id: title.id, x: 60, y: 30, w: 900, h: 90 },
      { op: 'duplicate', id: band.id, dx: 10, dy: 10 },
      { op: 'bringToFront', id: band.id },
      { op: 'align', ids: [title.id, slide1.shapes[2].id], mode: 'left' },
    ],
  }
  const result = applyPatch(before, deck, deckPath, patch, {})
  assert(result.buffer.length > 1000, 'output buffer produced')
  writeFileSync(deckPath, result.buffer)

  const after = readDeck(readFileSync(deckPath), deckPath, 1)
  const titleAfter = after.slides[0].shapes.find(shape => shape.id === title.id)
  assertEqual(titleAfter.text.plain, '2026 Q3 复盘')
  assertEqual(titleAfter.text.color, '#D93025')
  assertEqual(titleAfter.text.align, 'right')
  assertEqual(Math.round(titleAfter.text.fontSize), 34)
  const bandAfter = after.slides[0].shapes.find(shape => shape.id === band.id)
  assertEqual(bandAfter.style.fill.color, '#0B7285')
  assertEqual(bandAfter.z, after.slides[0].shapes.length - 1, 'band moved to the top')
  probe.alignedX = titleAfter.geometry.x
  probe.secondX = after.slides[0].shapes.find(shape => shape.id === slide1.shapes[2].id).geometry.x
  assertEqual(Math.round(probe.alignedX), Math.round(probe.secondX), 'align left')
  assertEqual(after.slides[0].shapes.length, 8, 'duplicate added one shape')
  // px→EMU→px 必须无损：整数 px 经 9525 EMU/px 往返后不允许漂移。
  // （对齐会改写 x，所以这里只校验未被对齐覆盖的尺寸字段。）
  assertEqual(titleAfter.geometry.w, 900, 'geometry w round-trips exactly')
  assertEqual(titleAfter.geometry.h, 90, 'geometry h round-trips exactly')
})

check('patch: setText 逐段沿用旧段落样式（空首行不再把整框拉平成默认值）', () => {
  // 真实场景（2026-10-15 用户实测）：文本框第一段是空行（无 pPr / 无带格式 run），
  // 用户就地改一个字，客户端只发 {runs:[{text}]} —— 样式必须逐段保住，
  // 否则字号 / 颜色 / 对齐全部退化成默认值。
  const before = readFileSync(deckPath)
  const zipEntries = readZipEntries(before)
  const slide1Xml = Buffer.from(zipEntries.find(entry => entry.name === 'ppt/slides/slide1.xml').data).toString('utf8')
  const root = parseXml(slide1Xml)

  // 找 slide1 里第一个带非空文本的 sp，把它的 txBody 换成：
  // 第 1 段 = 空行（无 pPr 无 run），第 2 段 = sz=4400 / b=1 / FFC000 / 居中。
  const sps = findAll(root, 'p:sp')
  const titleSp = sps.find(sp => findAll(sp, 'a:t').some(t => textOf(t).trim() !== ''))
  assert(titleSp !== undefined, 'fixture slide1 has a text shape')
  const txBody = findFirst(titleSp, 'p:txBody')
  assert(txBody !== undefined, 'the text shape has a txBody')
  for (const p of childrenOf(txBody, 'a:p')) removeChild(txBody, p)
  removeChildren(txBody, 'a:endParaRPr')
  appendChild(txBody, createElement('a:p'))
  const p2 = createElement('a:p')
  appendChild(p2, createElement('a:pPr', { algn: 'ctr' }))
  const r2 = createElement('a:r')
  const rPr2 = createElement('a:rPr', { lang: 'zh-CN', sz: '4400', b: '1' })
  const fill2 = createElement('a:solidFill')
  appendChild(fill2, createElement('a:srgbClr', { val: 'FFC000' }))
  appendChild(rPr2, fill2)
  appendChild(r2, rPr2)
  const t2 = createElement('a:t')
  setText(t2, '原标题第二行')
  appendChild(r2, t2)
  appendChild(p2, r2)
  appendChild(txBody, p2)
  const injected = writeZip(zipEntries.map(entry => ({
    name: entry.name,
    data: entry.name === 'ppt/slides/slide1.xml' ? Buffer.from(serializeXml(root)) : entry.data,
  })))

  const ptPx = 44 * 96 / 72 // sz=4400 → 44pt → px
  const deck1 = readDeck(injected, deckPath, 0)
  const title1 = deck1.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain.includes('原标题第二行'))
  assert(title1 !== undefined, 'injected text readable from the deck model')
  const styledBefore = title1.text.paragraphs[1].runs[0]
  assert(Math.abs(styledBefore.fontSize - ptPx) < 0.01, `styled run fontSize parses (got ${styledBefore.fontSize})`)

  // 就地编辑提交形态：三段纯文本（空行 / 改后 / 新增），不带任何样式字段。
  const patch = {
    summary: '就地编辑',
    ops: [{
      op: 'setText',
      id: title1.id,
      paragraphs: [
        { runs: [{ text: '' }] },
        { runs: [{ text: '改一个字' }] },
        { runs: [{ text: '新增一行' }] },
      ],
    }],
  }
  const result = applyPatch(injected, deck1, deckPath, patch, {})
  assert(result.buffer.length > 1000, 'patch applied')
  const after = readDeck(result.buffer, deckPath, 1)
  const title2 = after.slides[0].shapes.find(shape => shape.id === title1.id)
  assertEqual(title2.text.plain, '\n改一个字\n新增一行')
  const kept = title2.text.paragraphs[1].runs[0]
  assert(Math.abs(kept.fontSize - ptPx) < 0.01, `第二段字号保留（got ${kept.fontSize}）`)
  assertEqual(kept.color, '#FFC000', '第二段颜色保留')
  assertEqual(kept.bold, true, '第二段加粗保留')
  assertEqual(title2.text.paragraphs[1].align, 'center', '第二段对齐保留')
  const added = title2.text.paragraphs[2].runs[0]
  assert(Math.abs(added.fontSize - ptPx) < 0.01, `新增段沿用最后一个旧段落的样式（got ${added.fontSize}）`)
  assertEqual(added.color, '#FFC000', '新增段颜色沿用')
})

check('patch: 复制出来的元素拿到新的 cNvPr id', () => {
  const deck = readDeck(readFileSync(deckPath), deckPath, 1)
  const ids = deck.slides[0].shapes.map(shape => shape.shapeId)
  assertEqual(new Set(ids).size, ids.length, 'shape ids are unique on the slide')
})

check('patch: 校验失败（未知 op / 未知 id / 错误颜色）不落盘', () => {
  const beforeBytes = readFileSync(deckPath)
  const beforeMtime = statSync(deckPath).mtimeMs
  const deck = readDeck(beforeBytes, deckPath, 1)
  const cases = [
    { summary: 'x', ops: [{ op: 'setColour', id: deck.slides[0].shapes[1].id, color: '#FF0000' }] },
    { summary: 'x', ops: [{ op: 'setFill', id: 's1:99999', color: '#FF0000' }] },
    { summary: 'x', ops: [{ op: 'setFill', id: deck.slides[0].shapes[1].id, color: 'red' }] },
    { summary: 'x', ops: [{ op: 'align', ids: [deck.slides[0].shapes[1].id], mode: 'left' }] },
    { summary: '', ops: [{ op: 'setFill', id: deck.slides[0].shapes[1].id, color: '#FF0000' }] },
    { summary: 'x', ops: [{ op: 'setFill', id: deck.slides[0].shapes[1].id, color: '#FF0000', extra: 1 }] },
  ]
  for (const patch of cases) {
    let caught = null
    try { applyPatch(beforeBytes, deck, deckPath, patch, {}) } catch (error) { caught = error }
    assert(caught !== null, `expected a validation failure for ${JSON.stringify(patch.ops[0])}`)
    assertEqual(caught.code, 'validationFailed', 'error code')
    assert(Array.isArray(caught.details?.violations) && caught.details.violations.length > 0, 'violations reported')
  }
  assertEqual(Buffer.compare(beforeBytes, readFileSync(deckPath)), 0, 'file bytes unchanged')
  assertEqual(statSync(deckPath).mtimeMs, beforeMtime, 'file mtime unchanged')
})

check('patch: dryRun 返回 ops 且不产生新字节', () => {
  const beforeBytes = readFileSync(deckPath)
  const deck = readDeck(beforeBytes, deckPath, 1)
  const title = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain !== '')
  const result = applyPatch(beforeBytes, deck, deckPath, {
    summary: '试算',
    ops: [{ op: 'setFill', id: title.id, color: '#123456' }],
  }, { dryRun: true })
  assertEqual(result.buffer, beforeBytes, 'dryRun returns the input buffer')
  assertEqual(result.ops.length, 1)
  assertEqual(result.ops[0].status, 'applied')
  assertEqual(Buffer.compare(beforeBytes, readFileSync(deckPath)), 0, 'file unchanged')
  const reread = readDeck(readFileSync(deckPath), deckPath, 1)
  const titleAgain = reread.slides[0].shapes.find(shape => shape.id === title.id)
  assert(titleAgain.style.fill.color !== '#123456', 'dryRun must not change the deck')
})

check('patch: 未触碰的页字节不变', () => {
  const base = readFileSync(deckPath)
  const deck = readDeck(base, deckPath, 1)
  const title = deck.slides[0].shapes.find(shape => shape.text !== null)
  const result = applyPatch(base, deck, deckPath, {
    summary: '只改第一页',
    ops: [{ op: 'setFill', id: title.id, color: '#ABCDEF' }],
  }, {})
  const before = readZip(base)
  const after = readZip(result.buffer)
  assertEqual(Buffer.compare(Buffer.from(before.get('ppt/slides/slide2.xml')), Buffer.from(after.get('ppt/slides/slide2.xml'))), 0, 'slide2.xml untouched')
  assertEqual(Buffer.compare(Buffer.from(before.get('ppt/slides/slide3.xml')), Buffer.from(after.get('ppt/slides/slide3.xml'))), 0, 'slide3.xml untouched')
  assertEqual(Buffer.compare(Buffer.from(before.get('ppt/media/image1.png')), Buffer.from(after.get('ppt/media/image1.png'))), 0, 'media untouched')
  assert(Buffer.compare(Buffer.from(before.get('ppt/slides/slide1.xml')), Buffer.from(after.get('ppt/slides/slide1.xml'))) !== 0, 'slide1.xml changed')
})

check('patch: 中日韩文本首尾空格保真（xml:space=preserve）', () => {
  const base = readFileSync(deckPath)
  const deck = readDeck(base, deckPath, 1)
  const title = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain !== '')
  const result = applyPatch(base, deck, deckPath, {
    summary: '带空格的文本',
    ops: [{ op: 'setText', id: title.id, paragraphs: [{ runs: [{ text: '  两边有空格  ' }] }, { runs: [{ text: '第二段' }] }] }],
  }, {})
  const xml = entryText(result.buffer, 'ppt/slides/slide1.xml')
  assert(xml.includes('xml:space="preserve"'), 'xml:space="preserve" must be written')
  const reread = readDeck(result.buffer, deckPath, 2)
  const after = reread.slides[0].shapes.find(shape => shape.id === title.id)
  assertEqual(after.text.plain, '  两边有空格  \n第二段')
})

check('patch: 删除元素', () => {
  const base = readFileSync(deckPath)
  const deck = readDeck(base, deckPath, 1)
  const slide2 = deck.slides[1]
  const victim = slide2.shapes.find(shape => shape.kind === 'image')
  const result = applyPatch(base, deck, deckPath, {
    summary: '删掉图片',
    ops: [{ op: 'remove', id: victim.id }],
  }, {})
  const reread = readDeck(result.buffer, deckPath, 2)
  assert(reread.slides[1].shapes.every(shape => shape.id !== victim.id), 'removed shape is gone')
  assertEqual(reread.slides[1].shapes.length, slide2.shapes.length - 1)
})

check('patch: 表格页往返不变（含表格的 slide 不因别的页改动而变化）', () => {
  const base = readFileSync(deckPath)
  const deck = readDeck(base, deckPath, 1)
  const title = deck.slides[0].shapes.find(shape => shape.text !== null)
  const result = applyPatch(base, deck, deckPath, {
    summary: '改第一页',
    ops: [{ op: 'setTextStyle', id: title.id, bold: false }],
  }, {})
  const reread = readDeck(result.buffer, deckPath, 2)
  const table = reread.slides[1].shapes.find(shape => shape.kind === 'table')
  assertEqual(table.table.rows, 4)
  assertEqual(table.table.cols, 4)
  assertEqual(table.table.cells.find(cell => cell.r === 3 && cell.c === 3).text, '-38%')
})

// ---------------------------------------------------------------- DeckStore 端到端

await checkAsync('store: 打开 → 上下文 → 应用 → 撤销 → 重做 → 历史', async () => {
  const storePath = join(workDir, 'store.pptx')
  copyFileSync(FIXTURE, storePath)
  const store = new DeckStore()

  const deck = await store.open(storePath)
  assertEqual(deck.rev, 0)
  assertEqual(deck.slides.length, 3)

  const title = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain.includes('2026'))
  const context = store.putContext({
    requestId: 'req_test_1',
    deckRev: deck.rev,
    instruction: '把标题改成红色并右对齐',
    selectionMode: 'single',
    slideIndex: 0,
    selectedIds: [title.id],
    elements: [{ id: title.id, name: title.name, kind: title.kind, z: title.z, geometry: title.geometry, style: title.style, text: { plain: title.text.plain } }],
  })
  assertEqual(context.requestId, 'req_test_1')
  const consumed = store.consumeContext('req_test_1')
  assertEqual(consumed.instruction, '把标题改成红色并右对齐')

  const applied = await store.apply({
    summary: '标题改红并右对齐',
    ops: [{ op: 'setTextStyle', id: title.id, color: '#D93025', align: 'right' }],
  }, { source: 'ai', requestId: 'req_test_1' })
  assertEqual(applied.applied, true)
  assertEqual(applied.rev, 1)
  assertEqual(applied.changedIds.includes(title.id), true)
  const afterTitle = applied.deck.slides[0].shapes.find(shape => shape.id === title.id)
  assertEqual(afterTitle.text.color, '#D93025')
  assertEqual(afterTitle.text.align, 'right')

  const status = store.historyStatus()
  assertEqual(status.canUndo, true)
  assertEqual(status.canRedo, false)

  const undone = await store.undo(1)
  assertEqual(undone.rev, 0)
  const reverted = undone.slides[0].shapes.find(shape => shape.id === title.id)
  assert(reverted.text.color !== '#D93025', 'undo restored the original colour')

  const redone = await store.redo(1)
  assertEqual(redone.rev, 1)
  assertEqual(redone.slides[0].shapes.find(shape => shape.id === title.id).text.align, 'right')

  // 磁盘上的字节与撤销/重做一致
  const onDisk = readDeck(readFileSync(storePath), storePath, 0)
  assertEqual(onDisk.slides[0].shapes.find(shape => shape.id === title.id).text.color, '#D93025')
})

await checkAsync('store: 撤销到最初后返回字节级原文件', async () => {
  const path = join(workDir, 'undo-all.pptx')
  copyFileSync(FIXTURE, path)
  const originalBytes = readFileSync(path)
  const store = new DeckStore()
  const deck = await store.open(path)
  const title = deck.slides[0].shapes.find(shape => shape.text !== null)
  await store.apply({ summary: 'a', ops: [{ op: 'setFill', id: title.id, color: '#111111' }] })
  await store.apply({ summary: 'b', ops: [{ op: 'setFill', id: title.id, color: '#222222' }] })
  await store.undo(2)
  const restored = readFileSync(path)
  // 字节级一致：撤销回到最初就是原始文件内容
  assertEqual(Buffer.compare(originalBytes, restored), 0, 'undo to origin restores the exact original bytes')
})

await checkAsync('store: 校验失败的错误码是 validationFailed，且文件不变', async () => {
  const path = join(workDir, 'invalid.pptx')
  copyFileSync(FIXTURE, path)
  const store = new DeckStore()
  const deck = await store.open(path)
  let caught = null
  try {
    await store.apply({ summary: 'bad', ops: [{ op: 'nope', id: deck.slides[0].shapes[0].id }] })
  } catch (error) { caught = error }
  assert(caught !== null, 'expected a failure')
  assertEqual(caught.code, 'validationFailed')
  assertEqual(store.requireCurrent().rev, 0, 'rev did not advance')
  assertEqual(Buffer.compare(readFileSync(FIXTURE), readFileSync(path)), 0, 'file unchanged')
})

await checkAsync('store: 没有打开文档时的错误码是 noDeck', async () => {
  const store = new DeckStore()
  let caught = null
  try { store.view() } catch (error) { caught = error }
  assertEqual(caught?.code, 'noDeck')
})

await checkAsync('store: 内置演示文稿可打开（assets 存在时）', async () => {
  const store = new DeckStore()
  const candidates = [
    join(HERE, '..', 'plugin', 'assets', 'demo.pptx'),
    join(HERE, '..', 'host', 'assets', 'demo.pptx'),
    FIXTURE,
  ]
  const available = candidates.find(candidate => existsSync(candidate))
  assert(available !== undefined, 'no demo asset available')
  const deck = await store.openDemo(workDir)
  assert(deck.slides.length >= 3, 'demo deck has slides')
})

// ---------------------------------------------------------------- 汇总

rmSync(workDir, { recursive: true, force: true })

console.log('')
if (failures.length > 0) {
  console.log('失败明细：')
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error.stack?.split('\n').slice(0, 3).join(' | ')}`)
}
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}`)
process.exit(failed === 0 ? 0 : 1)
