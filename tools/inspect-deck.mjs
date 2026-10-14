// tools/inspect-deck.mjs — 打印一份 pptx 的 Deck 模型（人工核对渲染用）
//
// 用法：<node> tools/inspect-deck.mjs tests/fixtures/demo.pptx [--json]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readDeck } from '../host/pptx-read.js'

const file = resolve(process.argv[2] ?? 'tests/fixtures/demo.pptx')
const buffer = readFileSync(file)
const deck = readDeck(buffer, file, 0)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(deck, null, 2))
  process.exit(0)
}

console.log(`file       ${deck.file}`)
console.log(`slide size ${deck.slideWidth} x ${deck.slideHeight} px`)
console.log(`media      ${Object.keys(deck.media).length}`)
for (const [id, info] of Object.entries(deck.media)) {
  console.log(`           ${id} -> ${info.url} (${info.width}x${info.height})`)
}
if (deck.warnings.length > 0) console.log(`warnings   ${deck.warnings.join(' | ')}`)
for (const slide of deck.slides) {
  console.log(`\n--- ${slide.name} (${slide.id}) bg=${slide.background} shapes=${slide.shapes.length}`)
  for (const shape of slide.shapes) {
    const g = shape.geometry
    const text = shape.text === null ? '' : ` text=${JSON.stringify(shape.text.plain.slice(0, 26))}`
    const img = shape.image === null ? '' : ` img=${shape.image.mediaId}`
    const tbl = shape.table === null ? '' : ` table=${shape.table.rows}x${shape.table.cols}`
    console.log(
      `  z=${String(shape.z).padStart(2)} ${shape.id.padEnd(8)} ${shape.kind.padEnd(6)} type=${String(shape.type).padStart(2)}`
      + ` (${g.x},${g.y} ${g.w}x${g.h}) fill=${shape.style.fill.type}${shape.style.fill.color ?? ''}`
      + ` line=${shape.style.line === null ? '-' : shape.style.line.color} radius=${shape.style.cornerRadius}`
      + `${text}${img}${tbl}`,
    )
  }
}
console.log(`\ntotal shapes ${deck.slides.reduce((sum, slide) => sum + slide.shapes.length, 0)}`)
