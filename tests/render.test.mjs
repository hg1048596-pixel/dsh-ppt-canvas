// tests/render.test.mjs — 精确渲染（LibreOffice）的单元与端到端测试
//
// 重点验证两件事：
//   1. `promoteSlide` 的改写是**外科式**的：只动 slide1.xml（与它的 rels），
//      其余部件逐字节不变 —— 写坏包会直接影响用户的文件。
//   2. 逐页渲染真的渲染到不同的页（LibreOffice 的 PageRange 被忽略，实测），
//      这靠 tests/fixtures/pages.pptx 每页的 PAGE-N-MARKER 标记来确认。
//
// LibreOffice 是本机可选依赖：没装时端到端部分跳过（但会明确打印跳过原因），
// 单元部分仍然全部执行。

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadPackage } from '../host/pptx-read.js'
import { promoteSlide, findSoffice, renderSlidePng } from '../host/render.js'
import { readZip, writeZip } from '../host/zip.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'demo.pptx')
const PAGES = join(HERE, 'fixtures', 'pages.pptx')

let passed = 0
let failed = 0
let skipped = 0
const failures = []

function check(name, body) {
  try {
    body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL ${name}: ${error.message}`)
  }
}

async function checkAsync(name, body) {
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

const demoBytes = new Uint8Array(readFileSync(FIXTURE))
const demoPkg = loadPackage(demoBytes)

// ---------------------------------------------------------------- 单元：外科式改写

check('render: promoteSlide 只替换 slide1.xml 与它的 rels', () => {
  const promoted = promoteSlide(demoPkg.entries, 3)
  assertEqual(promoted.entries.size <= demoPkg.entries.size, true, '部件数不应增加')

  // slide1 变成第 3 页的内容
  const slide3 = Buffer.from(demoPkg.entries.get('ppt/slides/slide3.xml'))
  assertEqual(
    Buffer.compare(Buffer.from(promoted.entries.get('ppt/slides/slide1.xml')), slide3),
    0,
    'slide1.xml 必须等于第 3 页的内容',
  )

  // rels 也跟着换（媒体与版式引用靠它）
  const rels3 = demoPkg.entries.get('ppt/slides/_rels/slide3.xml.rels')
  if (rels3 !== undefined) {
    assertEqual(
      Buffer.compare(Buffer.from(promoted.entries.get('ppt/slides/_rels/slide1.xml.rels')), Buffer.from(rels3)),
      0,
      'slide1.xml.rels 必须等于第 3 页的 rels',
    )
  }

  // 其余部件**内容**不变（母版/版式/主题/媒体）。
  //
  // 注意：必须真的写一次 zip 再读回来比 —— promoteSlide 对未修改部件直接复用
  // 原 Buffer 引用，若直接比 `promoted.entries.get(name)`，那是同一个对象，
  // 比较恒为 0（自比较假绿）。真正的检查点是「写出的包」里这些部件的内容。
  const written = writeZip(promoted.order.map(name => ({ name, data: promoted.entries.get(name) })))
  const reread = readZip(written)
  let changed = 0
  let compared = 0
  for (const [name, bytes] of demoPkg.entries) {
    if (name === 'ppt/slides/slide1.xml' || name === 'ppt/slides/_rels/slide1.xml.rels') continue
    const after = reread.get(name)
    assert(after !== undefined, `写出的包里缺少部件 ${name}`)
    compared += 1
    if (Buffer.compare(Buffer.from(bytes), Buffer.from(after)) !== 0) changed += 1
  }
  assert(compared > 10, `应该有大量部件参与比较，实际 ${compared}`)
  assertEqual(changed, 0, '写出并回读后，slide1 之外的部件内容必须完全一致')
})

check('render: promoteSlide 不动 presentation.xml 与 Content_Types', () => {
  const promoted = promoteSlide(demoPkg.entries, 2)
  for (const name of ['ppt/presentation.xml', '[Content_Types].xml']) {
    const before = demoPkg.entries.get(name)
    if (before === undefined) continue
    assertEqual(
      Buffer.compare(Buffer.from(before), Buffer.from(promoted.entries.get(name))),
      0,
      `${name} 不应被改动（页序与部件登记都不用变）`,
    )
  }
})

check('render: promoteSlide 页号越界时报 notFound（不写出坏包）', () => {
  let code = null
  try {
    promoteSlide(demoPkg.entries, 99)
  } catch (error) {
    code = error.code
  }
  assertEqual(code, 'notFound')
})

check('render: promoteSlide 按 slideParts 映射页号（重排过的文件不会渲错页）', () => {
  // 页序来自 presentation.xml 的 sldIdLst，而部件文件名是 slideN.xml。
  // 用户重排/删除过幻灯片后两者不一致：直拼 slide${page}.xml 会取错部件。
  const reordered = promoteSlide(demoPkg.entries, 1, ['ppt/slides/slide3.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml'])
  assertEqual(
    Buffer.compare(Buffer.from(reordered.entries.get('ppt/slides/slide1.xml')), Buffer.from(demoPkg.entries.get('ppt/slides/slide3.xml'))),
    0,
    '第 1 页应取 slideParts[0]（此处是 slide3.xml）',
  )

  // 直接传部件名也应支持
  const byPart = promoteSlide(demoPkg.entries, 'ppt/slides/slide2.xml')
  assertEqual(
    Buffer.compare(Buffer.from(byPart.entries.get('ppt/slides/slide1.xml')), Buffer.from(demoPkg.entries.get('ppt/slides/slide2.xml'))),
    0,
    '直接给部件名时应复制那个部件',
  )

  // 没有 slideParts 时退回按名字取（旧行为，保持兼容）
  const legacy = promoteSlide(demoPkg.entries, 2)
  assertEqual(
    Buffer.compare(Buffer.from(legacy.entries.get('ppt/slides/slide1.xml')), Buffer.from(demoPkg.entries.get('ppt/slides/slide2.xml'))),
    0,
    '无 slideParts 时按页号拼文件名',
  )
})

check('render: findSoffice 返回存在的路径或 null', () => {
  const found = findSoffice()
  if (found !== null) assert(existsSync(found), `返回的路径必须存在：${found}`)
})

// ---------------------------------------------------------------- 端到端（需要 LibreOffice）

const soffice = findSoffice()
if (soffice === null) {
  skipped += 1
  console.log('  skip 端到端渲染：本机没有 LibreOffice，已跳过（画布会自动退回内置重画）')
} else {
  const workDir = mkdtempSync(join(tmpdir(), 'ppt-render-test-'))
  try {
    await checkAsync('render: 逐页渲染出的是不同的页（PageRange 不生效，靠提升首页）', async () => {
      copyFileSync(PAGES, join(workDir, 'pages.pptx'))
      const file = join(workDir, 'pages.pptx')
      const pkg = loadPackage(new Uint8Array(readFileSync(file)))

      const results = []
      for (const page of [1, 2, 3]) {
        const rendered = await renderSlidePng({ file, entries: pkg.entries, page, width: 480 })
        assert(rendered.buffer.length > 1000, `第 ${page} 页没有产出有效 PNG`)
        // PNG magic
        assertEqual(rendered.buffer.slice(1, 4).toString('ascii'), 'PNG', '必须是 PNG')
        results.push(rendered.buffer)
      }
      // 三页内容不同 → 字节必须不同（这正是「渲染到同一页」会失败的地方）
      assert(Buffer.compare(results[0], results[1]) !== 0, '第 1、2 页渲染结果相同，说明页号没有生效')
      assert(Buffer.compare(results[1], results[2]) !== 0, '第 2、3 页渲染结果相同，说明页号没有生效')
    })

    await checkAsync('render: 同页第二次命中缓存', async () => {
      const file = join(workDir, 'pages.pptx')
      const pkg = loadPackage(new Uint8Array(readFileSync(file)))
      await renderSlidePng({ file, entries: pkg.entries, page: 2, width: 480 })
      const again = await renderSlidePng({ file, entries: pkg.entries, page: 2, width: 480 })
      assertEqual(again.cached, true, '第二次应当命中缓存')
    })

    await checkAsync('render: 页内容变化后缓存失效（重新渲染）', async () => {
      const file = join(workDir, 'pages.pptx')
      const pkg = loadPackage(new Uint8Array(readFileSync(file)))
      // 用独立宽度，避免命中其他用例留下的缓存（缓存键含宽度）。
      const width = 461
      const before = await renderSlidePng({ file, entries: pkg.entries, page: 1, width })
      assertEqual(before.cached, false, '第一次渲染不应命中缓存')

      // 缓存键用的是**该页内容**（不是磁盘 mtime）。
      // 所以必须真的改这一页的内容：用一份内容不同的 deck 覆盖它。
      copyFileSync(join(HERE, 'fixtures', 'demo.pptx'), file)
      const changedPkg = loadPackage(new Uint8Array(readFileSync(file)))
      const after = await renderSlidePng({ file, entries: changedPkg.entries, page: 1, width })
      assertEqual(after.cached, false, '页内容变了就必须重渲染')
      assert(Buffer.compare(before.buffer, after.buffer) !== 0, '内容不同的两页应产出不同的图')

      // 内容没变时应当命中缓存（这正是「用内容做键」的意义）
      const again = await renderSlidePng({ file, entries: changedPkg.entries, page: 1, width })
      assertEqual(again.cached, true, '内容未变时应命中缓存')
    })
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

console.log('')
console.log(`TOTAL ${passed + failed} PASSED ${passed} FAILED ${failed}${skipped > 0 ? ` SKIPPED ${skipped}` : ''}`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
process.exit(0)
