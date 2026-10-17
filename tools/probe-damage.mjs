// tools/probe-damage.mjs — 核实交接文档 §6.1 描述的文字损伤是否存在于某份 pptx
//
// 背景：逐字符偏移映射的旧算法曾把 run 样式边界推错一格，把切分写进用户文件。
// 算法已修，但已写入的字节不会自愈。这个脚本用来**确认损伤是否真的存在**，
// 以及具体是哪个形状、哪种形态 —— 避免凭文档转述去猜。
//
// 用法：<node> tools/probe-damage.mjs <deck.pptx> [slideN] [shapeNameFragment]

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const { readDeck } = await import(`file:///${join(ROOT, 'host', 'pptx-read.js').replace(/\\/g, '/')}`)

const file = process.argv[2]
const onlySlide = process.argv[3] === undefined ? null : Number(process.argv[3])
const nameFilter = process.argv[4] ?? null

const deck = readDeck(readFileSync(file), file, 0)
console.log(`file : ${file}`)
console.log(`pages: ${deck.slides.length}`)
if (deck.warnings.length > 0) console.log(`warn : ${deck.warnings.slice(0, 3).join(' | ')}`)

/** 判断一个段落是否"可疑"：同一段内相邻 run 字号不同，且文本被切在半个单词里。 */
function inspectParagraph(paragraph) {
  const runs = paragraph.runs ?? []
  if (runs.length < 2) return null
  const sizes = [...new Set(runs.map(r => r.fontSize).filter(s => s !== null && s !== undefined))]
  if (sizes.length < 2) return null // 字号一致 = 混排可能是设计，不报
  // 相邻 run 之间是否切在"不该切"的位置：前一个 run 末尾不是空格/标点，
  // 且后一个 run 开头也不是空格 —— 说明同一个词被拆成两种字号
  const splits = []
  for (let i = 1; i < runs.length; i += 1) {
    const prev = runs[i - 1].text ?? ''
    const next = runs[i].text ?? ''
    if (prev === '' || next === '') continue
    const prevEnd = prev.slice(-1)
    const nextStart = next.slice(0, 1)
    const boundaryOk = /[\s,.;:!?，。；：！？、）)\]"'”’—\-]/.test(prevEnd)
      || /[\s(（\["'“‘]/.test(nextStart)
    if (!boundaryOk) {
      splits.push({ at: i, prevSize: runs[i - 1].fontSize, nextSize: runs[i].fontSize, prevTail: prev.slice(-14), nextHead: next.slice(0, 14) })
    }
  }
  return splits.length === 0 ? null : { sizes, splits }
}

let totalSuspicious = 0
for (const [index, slide] of deck.slides.entries()) {
  const page = index + 1
  if (onlySlide !== null && page !== onlySlide) continue
  for (const shape of slide.shapes) {
    if (shape.text === null || shape.text === undefined) continue
    if (nameFilter !== null && !String(shape.name).toLowerCase().includes(nameFilter.toLowerCase())) continue
    const paragraphs = shape.text.paragraphs ?? []
    const findings = []
    paragraphs.forEach((paragraph, pIndex) => {
      const result = inspectParagraph(paragraph)
      if (result !== null) findings.push({ pIndex, ...result })
    })
    if (findings.length === 0) continue
    totalSuspicious += 1
    console.log('')
    console.log(`--- 第 ${page} 页  ${shape.name} (${shape.id}) ---`)
    for (const finding of findings) {
      console.log(`  段落 p${finding.pIndex}  出现字号 ${finding.sizes.join(' / ')}`)
      for (const split of finding.splits.slice(0, 4)) {
        console.log(`    run${split.at - 1}→${split.at}  ${split.prevSize}→${split.nextSize}  ...${JSON.stringify(split.prevTail)} | ${JSON.stringify(split.nextHead)}...`)
      }
    }
  }
}

console.log('')
console.log(totalSuspicious === 0
  ? '结果：未发现"同段内相邻 run 字号不同且切在半个单词里"的可疑切分'
  : `结果：发现 ${totalSuspicious} 个可疑形状`)
