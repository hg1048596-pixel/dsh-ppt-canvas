// tools/probe-placeholder-write.mjs — 验证「真实占位符」的写入几何是否正确
//
// 背景：真实 PowerPoint / python-pptx 的标题、正文是占位符，它们的 `<p:spPr/>`
// 里没有 `a:xfrm` —— 位置和尺寸继承自 slideLayout / slideMaster。
// 读取端已实现两级继承，但写入端如果拿 XML 里的「0 几何」做基线，
// move/resize 会把继承来的尺寸**物化成 0×0**，形状直接消失（比报错更糟）。
//
// 这个脚本对一个真实文件跑 move/resize，然后回读写出的 XML，确认：
//   1. 位移是相对**继承几何**算的；
//   2. 宽高没有被写成 0。
//
// 用法：<node> tools/probe-placeholder-write.mjs [deck.pptx]
// 默认用系统里一份带占位符的真实模板；找不到就明确报错。

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readDeck } from '../host/pptx-read.js'
import { applyPatch } from '../host/pptx-write.js'
import { readZipEntries } from '../host/zip.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  process.argv[2],
  'C:/Users/Hanson Gao/Desktop/项目产物/Lenovo 2026 PPT Template.pptx',
  'C:/Users/Hanson Gao/Desktop/项目产物/联想市场部实习第一周工作报告.pptx',
  join(HERE, '..', 'tests', 'fixtures', 'demo.pptx'),
].filter(Boolean)

const source = CANDIDATES.find(candidate => existsSync(candidate))
if (source === undefined) {
  console.error('找不到可用于验证的 pptx，请把路径作为第一个参数传入')
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'ppt-ph-write-'))
const file = join(dir, 'subject.pptx')
copyFileSync(source, file)

try {
  const buffer = readFileSync(file)
  const deck = readDeck(buffer, file, 0)

  const placeholder = deck.slides
    .flatMap(slide => slide.shapes)
    .find(shape => shape.placeholder !== null && shape.placeholder !== undefined)

  console.log(`file : ${source}`)
  if (placeholder === undefined) {
    console.log('这份文件没有占位符，本探针不适用（改用带 <p:ph> 的文稿）')
    process.exit(0)
  }
  const g = placeholder.geometry
  console.log(`shape: ${placeholder.name} (${placeholder.id}) type=${placeholder.placeholder.type}`)
  console.log(`读取几何: x=${g.x} y=${g.y} w=${g.w} h=${g.h}`)

  const expectX = g.x + 50
  const expectY = g.y + 20

  const moved = applyPatch(buffer, deck, file, {
    summary: 'probe move',
    ops: [{ op: 'move', id: placeholder.id, dx: 50, dy: 20 }],
  }, {})

  const entries = readZipEntries(moved.buffer)
  const slidePart = entries.find(entry => /^ppt\/slides\/slide1\.xml$/.test(entry.name))
  const xml = Buffer.from(slidePart.data).toString('utf8')

  // 必须**定位到该占位符自己**的 sp，再找它的 a:xfrm。
  // 取「文件里第一个 off/ext」是错的 —— 那属于别的形状（我第一版就栽在这）。
  const shapeId = placeholder.shapeId ?? placeholder.id.split(':')[1]
  const spPattern = new RegExp(`<p:sp>(?:(?!</p:sp>)[\\s\\S])*?<p:cNvPr id="${shapeId}"[\\s\\S]*?</p:sp>`)
  const spMatch = spPattern.exec(xml)
  if (spMatch === null) {
    console.log(`✗ 找不到 shapeId=${shapeId} 对应的 p:sp`)
    process.exit(1)
  }
  const spXml = spMatch[0]
  const hasXfrm = /<a:xfrm[\s>]/.test(spXml)
  const match = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/><a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(spXml)
  console.log(`该 sp 现在${hasXfrm ? '有' : '没有'} a:xfrm`)
  if (match === null) {
    console.log('✗ 写出的 XML 里没有找到 a:off/a:ext')
    process.exit(1)
  }
  const px = (emu) => Math.round((Number(emu) / 9525) * 100) / 100
  const got = { x: px(match[1]), y: px(match[2]), w: px(match[3]), h: px(match[4]) }
  console.log(`写出几何: x=${got.x} y=${got.y} w=${got.w} h=${got.h}`)
  console.log(`期望     : x=${expectX} y=${expectY} w=${g.w} h=${g.h}`)

  const positionOk = Math.abs(got.x - expectX) < 0.5 && Math.abs(got.y - expectY) < 0.5
  const sizeOk = got.w > 0 && got.h > 0
  console.log('')
  console.log(positionOk ? '✓ 位移基于继承几何计算' : '✗ 位移基线错误（可能是从 0 起算）')
  console.log(sizeOk ? '✓ 宽高保留（未被物化成 0）' : '✗ 宽高被写成 0，形状会被压没')
  process.exit(positionOk && sizeOk ? 0 : 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
