// tools/probe-runs.mjs — 逐 run dump 一个形状的完整文字与样式
//
// 用途：判断「同段多字号」是**作者原始内容**还是**工具写坏的**。
// 判据不是"有没有多字号"，而是"切点处字号是否变化 + 文本是否被切成半个词"。
// 真实 PPT 里作者常给单词某几个字母加样式；而样式边界 bug 会把同一段纯文本
// 在两个不同字号间随机切分。
//
// 用法：<node> tools/probe-runs.mjs <deck.pptx> <slideN> <shapeNameFragment>

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const { readDeck } = await import(`file:///${join(ROOT, 'host', 'pptx-read.js').replace(/\\/g, '/')}`)

const file = process.argv[2]
const page = Number(process.argv[3])
const fragment = (process.argv[4] ?? '').toLowerCase()

const deck = readDeck(readFileSync(file), file, 0)
const slide = deck.slides[page - 1]
if (slide === undefined) {
  console.error(`没有第 ${page} 页`)
  process.exit(1)
}

for (const shape of slide.shapes) {
  if (shape.text === null || shape.text === undefined) continue
  if (fragment !== '' && !String(shape.name).toLowerCase().includes(fragment)) continue
  console.log(`\n=== 第 ${page} 页 ${shape.name} (${shape.id}) ===`)
  console.log(`几何: ${shape.geometry.w}×${shape.geometry.h} @ (${shape.geometry.x},${shape.geometry.y})`)
  console.log(`整框 plain:\n${JSON.stringify(shape.text.plain)}`)
  ;(shape.text.paragraphs ?? []).forEach((paragraph, pIndex) => {
    console.log(`\n  段落 p${pIndex}  align=${paragraph.align}  lnSpc=${paragraph.lnSpc}  段内 ${paragraph.runs.length} 个 run`)
    paragraph.runs.forEach((run, rIndex) => {
      const size = run.fontSize === null || run.fontSize === undefined ? '-' : run.fontSize
      console.log(`    run${rIndex}  sz=${String(size).padEnd(7)} color=${String(run.color).padEnd(9)} b=${run.bold ? 1 : 0}  ${JSON.stringify(run.text)}`)
    })
  })
}
