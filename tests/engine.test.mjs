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

import { parseXml, serializeXml, findAll, findFirst, textOf, createElement, appendChild, childrenOf, childOf, removeChild, removeChildren, setAttr, setText, getAttr } from '../host/xml.js'
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
    // fixture 母版 bodyStyle 的段前是 `<a:spcBef><a:spcPct val="20000"/>`（**百分比**，20%）。
    // 以前 readParaSpacing 只认 a:spcPts，把百分比形式整段丢掉，
    // 而这条测试当时写的是 `spaceBefore === null` —— 等于把 bug 锁成正确行为。
    // 现在百分比会以 spaceBeforePct 形式产出（相对字号），px 形式仍为 null。
    assertEqual(paragraph.spaceBefore, null, '百分比形式不产出 px 值')
    assertEqual(paragraph.spaceBeforePct, 0.2, '母版的 spcPct=20000 应解析成 0.2（20%）')
    // 母版没有 spcAft → 两种形式都必须是 null
    assertEqual(paragraph.spaceAfter, null, '两处都没有 spcAft 时必须是 null')
    assertEqual(paragraph.spaceAfterPct, null, '两处都没有 spcAft 时 pct 也必须是 null')
    // indent 来自母版 bodyStyle 的 marL（fixture 母版 marL=342900 EMU = 36px），
    // 所以这里**不应该**是 null —— 曾经因为完全没读母版而丢失。
    assertEqual(paragraph.indent, 36, 'indent 应来自母版 marL（36px）')
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

check('read: 带 <p:ph> 占位符的真实 PPTX 必须能读（回归：曾对 placeholder 对象调 .includes 崩溃）', () => {
  // 真实 PowerPoint 文件的标题/正文都是占位符（<p:ph type="title"/>），
  // 而 classifySp 把 placeholder 读成 `{ idx, type }` **对象**。
  // 曾经这里写成 `(placeholder ?? '').includes('title')` → 对对象调 .includes 抛 TypeError
  // → readDeck 整页失败 → /api/open 返回 500，**所有正常 PPTX 都打不开**。
  // 仓库 fixture 全是纯 TextBox 且没有 <p:ph>，所以这条必须自己造。
  const entries = readZipEntries(readFileSync(FIXTURE))
  const slideEntry = entries.find(entry => entry.name === 'ppt/slides/slide1.xml')
  const root = parseXml(Buffer.from(slideEntry.data).toString('utf8'))

  // 找一个有文字的形状，给它塞一个占位符标记
  const sp = findAll(root, 'p:sp').find(node => findAll(node, 'a:t').some(t => textOf(t).trim() !== ''))
  assert(sp !== undefined, 'fixture 里应有带文字的形状')
  const nvSpPr = findFirst(sp, 'p:nvSpPr')
  assert(nvSpPr !== undefined, '形状应有 p:nvSpPr')
  let nvPr = findFirst(nvSpPr, 'p:nvPr')
  if (nvPr === undefined) {
    nvPr = createElement('p:nvPr')
    appendChild(nvSpPr, nvPr)
  }
  const ph = createElement('p:ph')
  setAttr(ph, 'type', 'title')
  setAttr(ph, 'idx', '1')
  appendChild(nvPr, ph)

  const injected = writeZip(entries.map(entry => ({
    name: entry.name,
    data: entry.name === 'ppt/slides/slide1.xml' ? Buffer.from(serializeXml(root)) : entry.data,
  })))

  // 关键：这一步以前会抛 TypeError
  const deck = readDeck(injected, deckPath, 0)
  assert(deck.slides.length === 3, `占位符文件应当正常读出（got ${deck.slides.length} 页）`)

  const withPlaceholder = deck.slides[0].shapes.find(shape => shape.placeholder !== null && shape.placeholder !== undefined)
  assert(withPlaceholder !== undefined, '占位符应当被记录到模型里')
  assertEqual(withPlaceholder.placeholder.type, 'title', 'placeholder.type 应保留原始 OOXML 值')
  assertEqual(withPlaceholder.placeholder.idx, '1')
})

check('read: 占位符标题走 titleStyle、正文走 bodyStyle（母版继承分流正确）', () => {
  // 同上造一个带 ph 的文件，但确认取的是**不同**的母版默认值分支。
  // fixture 的母版 titleStyle 与 bodyStyle 的 lnSpc 不同，可以用它区分。
  const entries = readZipEntries(readFileSync(FIXTURE))
  const slideEntry = entries.find(entry => entry.name === 'ppt/slides/slide1.xml')
  const root = parseXml(Buffer.from(slideEntry.data).toString('utf8'))
  const sps = findAll(root, 'p:sp').filter(node => findAll(node, 'a:t').some(t => textOf(t).trim() !== ''))
  assert(sps.length >= 2, '需要至少两个带文字的形状')
  const marks = ['title', 'body']
  for (let index = 0; index < 2; index += 1) {
    const nvSpPr = findFirst(sps[index], 'p:nvSpPr')
    let nvPr = findFirst(nvSpPr, 'p:nvPr')
    if (nvPr === undefined) { nvPr = createElement('p:nvPr'); appendChild(nvSpPr, nvPr) }
    const ph = createElement('p:ph')
    setAttr(ph, 'type', marks[index])
    appendChild(nvPr, ph)
  }
  const injected = writeZip(entries.map(entry => ({
    name: entry.name,
    data: entry.name === 'ppt/slides/slide1.xml' ? Buffer.from(serializeXml(root)) : entry.data,
  })))
  const deck = readDeck(injected, deckPath, 0)
  const titled = deck.slides[0].shapes.filter(shape => shape.placeholder !== null && shape.placeholder !== undefined)
  assertEqual(titled.length, 2, '两个占位符都应保留')

  // 必须能**区分** titleStyle 与 bodyStyle，否则这个测试等于空转。
  //
  // 注意：不能用 align 区分 —— fixture 的段落自己写了 `algn="l"`，按继承规则
  // 本就该覆盖母版的居中（这是正确行为，我一开始断言错了）。要挑**幻灯片没写、
  // 只有母版有**的字段：
  //   titleStyle: spcBef=0%，无 marL
  //   bodyStyle : spcBef=20%，marL=342900(36px)
  const titleShape = titled.find(shape => shape.placeholder.type === 'title')
  const bodyShape = titled.find(shape => shape.placeholder.type === 'body')
  assert(titleShape !== undefined && bodyShape !== undefined, '两个占位符类型都要在')

  const titlePara = titleShape.text.paragraphs[0]
  const bodyPara = bodyShape.text.paragraphs[0]
  assertEqual(titlePara.spaceBeforePct, 0, `标题应继承 titleStyle 的 spcBef=0%（got ${titlePara.spaceBeforePct}）`)
  assertEqual(titlePara.indent, null, 'titleStyle 没有 marL，标题不应有缩进')

  assertEqual(bodyPara.spaceBeforePct, 0.2, `正文应继承 bodyStyle 的 spcBef=20%（got ${bodyPara.spaceBeforePct}）`)
  assertEqual(bodyPara.indent, 36, `正文应继承 bodyStyle 的 marL=36px（got ${bodyPara.indent}）`)
})

check('read: 占位符没有 a:xfrm 时从 slideLayout 继承几何（否则是 0×0@0,0）', () => {
  // 真实 PowerPoint 的标题/正文 `<p:spPr/>` 里没有 a:xfrm，位置与尺寸来自版式。
  // 不继承的话：deck 里全是 0×0@0,0 → 画布选择框看不见、框选命中不了、
  // 发给 AI 的坐标全是 0，而且写入端 move/resize 会从 0 起算。
  const entries = readZipEntries(readFileSync(FIXTURE))
  // 必须改**slide1 真正引用的那个版式**：包里可能有多份 layout，
  // 改了个没被引用的等于没改（我第一版就栽在这里）。
  const relsEntry = entries.find(entry => entry.name === 'ppt/slides/_rels/slide1.xml.rels')
  assert(relsEntry !== undefined, 'fixture 应有 slide1 的 rels')
  const relsRoot = parseXml(Buffer.from(relsEntry.data).toString('utf8'))
  const layoutRel = childrenOf(relsRoot, 'Relationship')
    .find(node => String(getAttr(node, 'Type') ?? '').endsWith('/slideLayout'))
  assert(layoutRel !== undefined, 'slide1 应引用一个 slideLayout')
  const layoutTarget = String(getAttr(layoutRel, 'Target')).replace(/^\.\.\//, 'ppt/')
  const layoutEntry = entries.find(entry => entry.name === layoutTarget)
  assert(layoutEntry !== undefined, `找不到引用的版式 ${layoutTarget}`)

  // 母版：二级继承的来源（python-pptx 生成的 deck 里 layout 占位符常没有 xfrm）
  const layoutRelsEntry = entries.find(entry => entry.name === `ppt/slideLayouts/_rels/${layoutTarget.split('/').pop()}.rels`)
  assert(layoutRelsEntry !== undefined, '版式应有一个 rels 指向母版')
  const layoutRelsRoot = parseXml(Buffer.from(layoutRelsEntry.data).toString('utf8'))
  const masterRel = childrenOf(layoutRelsRoot, 'Relationship')
    .find(node => String(getAttr(node, 'Type') ?? '').endsWith('/slideMaster'))
  assert(masterRel !== undefined, '版式应引用母版')
  const masterTarget = String(getAttr(masterRel, 'Target')).replace(/^\.\.\//, 'ppt/')
  const masterEntry = entries.find(entry => entry.name === masterTarget)
  assert(masterEntry !== undefined, `找不到引用的母版 ${masterTarget}`)

  // 版式里放一个**没有 xfrm** 的 idx=7 占位符（这正是 python-pptx / PowerPoint
  // 常见形态：layout 的标题/正文都是空 <p:spPr/>），真坐标写在母版上。
  const layoutRoot = parseXml(Buffer.from(layoutEntry.data).toString('utf8'))
  const spTree = findFirst(layoutRoot, 'p:spTree')
  const sp = createElement('p:sp')
  const nvSpPr = createElement('p:nvSpPr')
  const nvPr = createElement('p:nvPr')
  const ph = createElement('p:ph')
  setAttr(ph, 'idx', '7')
  appendChild(nvPr, ph)
  appendChild(nvSpPr, nvPr)
  appendChild(sp, nvSpPr)
  appendChild(sp, createElement('p:spPr'))
  appendChild(spTree, sp)

  // 母版里给出真正的几何 200×100@(30,40)
  const masterRoot = parseXml(Buffer.from(masterEntry.data).toString('utf8'))
  const masterTree = findFirst(masterRoot, 'p:spTree')
  const mSp = createElement('p:sp')
  const mNvSpPr = createElement('p:nvSpPr')
  const mNvPr = createElement('p:nvPr')
  const mPh = createElement('p:ph')
  setAttr(mPh, 'idx', '7')
  appendChild(mNvPr, mPh)
  appendChild(mNvSpPr, mNvPr)
  appendChild(mSp, mNvSpPr)
  const mSpPr = createElement('p:spPr')
  const xfrm = createElement('a:xfrm')
  appendChild(xfrm, createElement('a:off', { x: String(30 * 9525), y: String(40 * 9525) }))
  appendChild(xfrm, createElement('a:ext', { cx: String(200 * 9525), cy: String(100 * 9525) }))
  appendChild(mSpPr, xfrm)
  appendChild(mSp, mSpPr)
  appendChild(masterTree, mSp)

  // 幻灯片上放一个同 idx 的占位符，**不给 xfrm**
  const slideEntry = entries.find(entry => entry.name === 'ppt/slides/slide1.xml')
  const slideRoot = parseXml(Buffer.from(slideEntry.data).toString('utf8'))
  const slideTree = findFirst(slideRoot, 'p:spTree')
  const slideSp = createElement('p:sp')
  const sNvSpPr = createElement('p:nvSpPr')
  const sNvPr = createElement('p:nvPr')
  const sPh = createElement('p:ph')
  setAttr(sPh, 'idx', '7')
  appendChild(sNvPr, sPh)
  appendChild(sNvSpPr, sNvPr)
  appendChild(slideSp, sNvSpPr)
  appendChild(slideSp, createElement('p:spPr'))
  const txBody = createElement('p:txBody')
  const para = createElement('a:p')
  const run = createElement('a:r')
  const t = createElement('a:t')
  setText(t, '继承几何的标题')
  appendChild(run, t)
  appendChild(para, run)
  appendChild(txBody, para)
  appendChild(slideSp, txBody)
  appendChild(slideTree, slideSp)

  const injected = writeZip(entries.map(entry => {
    if (entry.name === layoutEntry.name) return { name: entry.name, data: Buffer.from(serializeXml(layoutRoot)) }
    if (entry.name === masterEntry.name) return { name: entry.name, data: Buffer.from(serializeXml(masterRoot)) }
    if (entry.name === 'ppt/slides/slide1.xml') return { name: entry.name, data: Buffer.from(serializeXml(slideRoot)) }
    return { name: entry.name, data: entry.data }
  }))

  const deck = readDeck(injected, deckPath, 0)
  const inherited = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain.includes('继承几何'))
  assert(inherited !== undefined, '注入的占位符应当被读出')
  // 版式里没有 xfrm，所以几何必须来自**母版**（二级继承）
  assertEqual(inherited.geometry.x, 30, 'x 应从母版继承（layout 没有 xfrm）')
  assertEqual(inherited.geometry.y, 40, 'y 应从母版继承')
  assertEqual(inherited.geometry.w, 200, '宽应从母版继承')
  assertEqual(inherited.geometry.h, 100, '高应从母版继承')
  // 无 xfrm 的占位符不该再报「geometry defaults to 0」这种误导性告警
  assert(
    !deck.warnings.some(warning => warning.includes('no a:xfrm')),
    `占位符不应产生 "no a:xfrm" 告警，实际：${JSON.stringify(deck.warnings.slice(0, 3))}`,
  )
})

check('patch: setLine 只给 width 时不得丢掉原有线色', () => {
  // 以前 setLine 无条件 removeChildren(ln,'a:solidFill')，于是 {width:3} 会把
  // #CCCCCC 的线静默变成默认黑 —— 一次不可见的样式破坏。
  const before = readFileSync(deckPath)
  const deck = readDeck(before, deckPath, 0)
  const lineShape = deck.slides[0].shapes.find(shape => shape.kind === 'line')
  assert(lineShape !== undefined, 'fixture 里应有一条线（用它的颜色做断言）')
  const originalColor = lineShape.style.line === null ? null : lineShape.style.line.color
  assert(originalColor !== null, '这条线原本应有颜色')

  const result = applyPatch(before, deck, deckPath, {
    summary: '只改线宽',
    ops: [{ op: 'setLine', id: lineShape.id, width: 3 }],
  }, {})
  const after = readDeck(result.buffer, deckPath, 1)
  const afterLine = after.slides[0].shapes.find(shape => shape.id === lineShape.id)
  assertEqual(afterLine.style.line.color, originalColor, '只改宽度时颜色必须保留')
})

check('patch: bringToFront 不把形状插到 p:extLst 之后（schema 必须合法）', () => {
  // p:spTree 的 p:extLst 必须是最后一个子元素。以前 at === remaining.length 时
  // insertBefore 退化成 append，形状跑到 extLst 后面。
  const before = readFileSync(deckPath)
  const deck = readDeck(before, deckPath, 0)
  const first = deck.slides[0].shapes[0]
  const result = applyPatch(before, deck, deckPath, {
    summary: '置顶',
    ops: [{ op: 'bringToFront', id: first.id }],
  }, {})

  const entries = readZipEntries(result.buffer)
  const slideXml = Buffer.from(entries.find(entry => entry.name === 'ppt/slides/slide1.xml').data).toString('utf8')
  const treeMatch = /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(slideXml)
  assert(treeMatch !== null, '应能取出 p:spTree')
  const tree = treeMatch[1]
  const extLstAt = tree.indexOf('<p:extLst')
  if (extLstAt !== -1) {
    // extLst 之后不允许再出现形状起始标签
    const tail = tree.slice(extLstAt)
    for (const tag of ['<p:sp>', '<p:pic>', '<p:graphicFrame>', '<p:grpSp>', '<p:cxnSp>']) {
      assert(!tail.includes(tag), `p:extLst 之后不应再有 ${tag}`)
    }
  }
  assert(true)
})

check('patch: 连续两次清空空行都保留 endParaRPr 格式（第二次不丢）', () => {
  // 第一次清空靠 run 的 rPr 克隆；清空后该段只剩 endParaRPr。
  // 以前第二次清空只看 run → styledRPrOf 返回 undefined → 格式丢失（行高回退）。
  const before = readFileSync(deckPath)
  const deck = readDeck(before, deckPath, 0)
  const body = deck.slides[0].shapes.find(shape => shape.text !== null && shape.text.paragraphs.length >= 2)
  assert(body !== undefined, '需要一个多段落的文本框')

  const clearOnce = applyPatch(before, deck, deckPath, {
    summary: '清空第一段',
    ops: [{ op: 'setText', id: body.id, paragraphs: [{ runs: [] }, ...body.text.paragraphs.slice(1).map(p => ({ runs: p.runs.map(r => ({ text: r.text })) }))] }],
  }, {})
  const deck2 = readDeck(clearOnce.buffer, deckPath, 1)
  const clearTwice = applyPatch(clearOnce.buffer, deck2, deckPath, {
    summary: '再清空第一段',
    ops: [{ op: 'setText', id: body.id, paragraphs: [{ runs: [] }, ...body.text.paragraphs.slice(1).map(p => ({ runs: p.runs.map(r => ({ text: r.text })) }))] }],
  }, {})

  const entries = readZipEntries(clearTwice.buffer)
  const slideXml = Buffer.from(entries.find(entry => entry.name === 'ppt/slides/slide1.xml').data).toString('utf8')
  // 找出该形状段落里是否有 endParaRPr（第二次清空后仍应保留）
  const spMatch = new RegExp(`<p:cNvPr id="${body.shapeId}"[\\s\\S]*?</p:sp>`).exec(slideXml)
  assert(spMatch !== null, '应能定位到该形状')
  const hasEndPara = /<a:endParaRPr[\s>]/.test(spMatch[0])
  assert(hasEndPara, '连续两次清空后仍应保留 a:endParaRPr（否则行高/字号回退）')
})

check('patch: setTextStyle 打在无文本体元素上必须被拒（不再假成功）', () => {
  // 以前：txBodyFor 返回 undefined → 什么都不写，却 push status:'applied'
  // 并让 rev +1 —— 用户看到"成功了"，文件其实没变。
  const buffer = readFileSync(deckPath)
  const deck = readDeck(buffer, deckPath, 0)
  const table = deck.slides[1].shapes.find(shape => shape.kind === 'table')
  assert(table !== undefined, 'fixture 第二页应有表格')
  let code = null
  try {
    applyPatch(buffer, deck, deckPath, {
      summary: '给表格设字体',
      ops: [{ op: 'setTextStyle', id: table.id, fontSize: 20 }],
    }, {})
  } catch (error) {
    code = error.code
  }
  assertEqual(code, 'validationFailed', '对表格 setTextStyle 必须是 validationFailed')
})

check('zip: 尾部垃圾被拒（EOCD 必须正好在文件末尾）', () => {
  // 原来 findEocd 的注释长度判断写成 `=== || <=`，后半句让它恒真，
  // 于是「尾部还有垃圾」的包也会被当成合法 EOCD（解析到错误偏移）。
  const bytes = readFileSync(FIXTURE)
  const tampered = Buffer.concat([bytes, Buffer.from('trailing-garbage')])
  let code = null
  try {
    readZipEntries(tampered)
  } catch (error) {
    code = error.code
  }
  assert(code === 'ioFailed' || code === 'badRequest',
    `尾部带垃圾的包必须被拒（got ${JSON.stringify(code)}），而不是被静默解析`)
})

check('zip: 解压预算存在（防 zip 炸弹）', () => {
  // 结构性断言：常量必须存在且合理（单条 256MB / 全包 1GB 量级）。
  // 真正构造一个炸弹包代价太大，这里守住「护栏被误删」这一类回归。
  const src = readFileSync(join(HERE, '..', 'host', 'zip.js'), 'utf8')
  assert(/MAX_ENTRY_INFLATED_BYTES\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(src), '应有单条解压上限常量')
  assert(/MAX_TOTAL_INFLATED_BYTES\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(src), '应有全包解压预算常量')
  assert(src.includes('maxOutputLength'), 'inflateRawSync 必须传 maxOutputLength')
})

check('patch: 未触碰部件的**压缩字节**原样复制（不再全包重新压缩）', () => {
  // 以前 applyPatch 用 readZip（解压后的 Map）再 writeZip({name,data})，
  // 每个条目都会被重新 deflate —— 一份 80MB 的文稿每次编辑都全包重压缩。
  // 现在未修改的条目走 raw + method + usize + crc32 原样复制。
  const before = readFileSync(deckPath)
  const beforeEntries = new Map(readZipEntries(before).map(entry => [entry.name, entry]))
  const deck = readDeck(before, deckPath, 0)
  const shape = deck.slides[0].shapes.find(item => item.kind === 'shape' || item.kind === 'text')
  const result = applyPatch(before, deck, deckPath, {
    summary: '只改一个形状的填充',
    ops: [{ op: 'setFill', id: shape.id, color: '#0F0F0F' }],
  }, {})

  const afterEntries = new Map(readZipEntries(result.buffer).map(entry => [entry.name, entry]))
  const touchedName = 'ppt/slides/slide1.xml'
  let compared = 0
  let differ = []
  for (const [name, entry] of beforeEntries) {
    if (name === touchedName) continue
    const next = afterEntries.get(name)
    if (next === undefined) continue
    compared += 1
    // 比较**压缩后的原始字节**：这才是「原样复制」的直接证据
    if (Buffer.compare(Buffer.from(entry.raw), Buffer.from(next.raw)) !== 0) differ.push(name)
  }
  assert(compared > 10, `应有大量未触碰部件参与比较，实际 ${compared}`)
  assertEqual(differ.length, 0, `未触碰部件的压缩字节必须完全一致，但以下被重压缩了：${differ.slice(0, 3).join(', ')}`)
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
  // 空行不得带 run：run 会按继承到的字号把空行撑高一行，内容整体下移
  const afterRoot = parseXml(Buffer.from(readZipEntries(result.buffer).find(entry => entry.name === 'ppt/slides/slide1.xml').data).toString('utf8'))
  const sp2 = findAll(afterRoot, 'p:sp').find(sp => findAll(sp, 'a:t').some(t => textOf(t) === '改一个字'))
  assert(sp2 !== undefined, 'edited shape present in output XML')
  const firstParagraph = childOf(findFirst(sp2, 'p:txBody'), 'a:p')
  assert(firstParagraph !== undefined, 'first paragraph exists')
  assert(findFirst(firstParagraph, 'a:r') === undefined, '空行的段落不得带 run（会把内容整体推下一行）')
})

check('patch: setText 逐字符沿用段内混排格式（原生 PPT 语义）', () => {
  // 段内混排：["AAAA"(44pt 红粗), "BB"(20pt 黑)] → 就地改成 "XXXXXX"：
  // 前 4 个字符沿用红粗 44，后 2 个沿用黑 20 —— 不再被首 run 拉平。
  const before = readFileSync(deckPath)
  const zipEntries = readZipEntries(before)
  const slide1Xml = Buffer.from(zipEntries.find(entry => entry.name === 'ppt/slides/slide1.xml').data).toString('utf8')
  const root = parseXml(slide1Xml)
  const sps = findAll(root, 'p:sp')
  const titleSp = sps.find(sp => findAll(sp, 'a:t').some(t => textOf(t).trim() !== ''))
  const txBody = findFirst(titleSp, 'p:txBody')
  for (const p of childrenOf(txBody, 'a:p')) removeChild(txBody, p)
  removeChildren(txBody, 'a:endParaRPr')
  const mkRun = (text, sz, color) => {
    const r = createElement('a:r')
    const rPr = createElement('a:rPr', { lang: 'zh-CN', sz, b: '1' })
    const fill = createElement('a:solidFill')
    appendChild(fill, createElement('a:srgbClr', { val: color }))
    appendChild(rPr, fill)
    appendChild(r, rPr)
    const t = createElement('a:t')
    setText(t, text)
    appendChild(r, t)
    return r
  }
  const p1 = createElement('a:p')
  appendChild(p1, mkRun('AAAA', '4400', 'FF0000'))
  appendChild(p1, mkRun('BB', '2000', '000000'))
  appendChild(txBody, p1)
  const injected = writeZip(zipEntries.map(entry => ({
    name: entry.name,
    data: entry.name === 'ppt/slides/slide1.xml' ? Buffer.from(serializeXml(root)) : entry.data,
  })))

  const deck1 = readDeck(injected, deckPath, 0)
  const title1 = deck1.slides[0].shapes.find(shape => shape.text !== null && shape.text.plain === 'AAAABB')
  assert(title1 !== undefined, 'injected mixed-run shape readable')
  // 场景 1：全选重打（前缀/后缀皆空）→ 整段取编辑起点字符的样式，合并为一个 run
  const result1 = applyPatch(injected, deck1, deckPath, {
    summary: '全选重打',
    ops: [{ op: 'setText', id: title1.id, paragraphs: [{ runs: [{ text: 'XXXXXX' }] }] }],
  }, {})
  const after1 = readDeck(result1.buffer, deckPath, 1)
  const t1 = after1.slides[0].shapes.find(shape => shape.id === title1.id)
  const runs1 = t1.text.paragraphs[0].runs
  assertEqual(runs1.length, 1, `全选重打应合并为一个 run（got ${runs1.length}）`)
  assertEqual(runs1[0].text, 'XXXXXX')
  assert(Math.abs(runs1[0].fontSize - 44 * 96 / 72) < 0.01, `取编辑起点样式（got ${runs1[0].fontSize}）`)
  assertEqual(runs1[0].color, '#FF0000')

  // 场景 2：中间插入（前缀 AAA / 后缀 BB 不动）→ 未动的部分各守原样式，边界不移动
  const result2 = applyPatch(injected, deck1, deckPath, {
    summary: '中间插入',
    ops: [{ op: 'setText', id: title1.id, paragraphs: [{ runs: [{ text: 'AAAAXXBB' }] }] }],
  }, {})
  const after2 = readDeck(result2.buffer, deckPath, 1)
  const t2 = after2.slides[0].shapes.find(shape => shape.id === title1.id)
  const runs2 = t2.text.paragraphs[0].runs
  assertEqual(runs2.length, 2, `中间插入不应推移样式边界（got ${runs2.length} runs: ${runs2.map(r => r.text).join('/')}）`)
  assertEqual(runs2[0].text, 'AAAAXX')
  assert(Math.abs(runs2[0].fontSize - 44 * 96 / 72) < 0.01, `前缀字号沿用（got ${runs2[0].fontSize}）`)
  assertEqual(runs2[0].color, '#FF0000', '前缀颜色沿用')
  assertEqual(runs2[1].text, 'BB')
  assert(Math.abs(runs2[1].fontSize - 20 * 96 / 72) < 0.01, `后缀字号沿用（got ${runs2[1].fontSize}）`)
  assertEqual(runs2[1].color, '#000000', '后缀颜色沿用')
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
