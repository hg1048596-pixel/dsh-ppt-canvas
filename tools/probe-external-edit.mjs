// tools/probe-external-edit.mjs — 验证「外部改动」是否被感知（数据丢失风险）
//
// 背景：客户端每 4 秒轮询 /api/history，比的是宿主**内存里的 rev**；
// 而 PowerPoint 在外部保存文件不会改变这个 rev。若 apply 又基于内存里的旧 buffer，
// 外部修改会被静默覆盖。
//
// 用法：<node> tools/probe-external-edit.mjs
// 注意：全程只在系统临时目录里操作副本，不碰任何用户文件。

import { copyFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE = process.env.DSH_PPT_API ?? 'http://127.0.0.1:19488/dsh-ppt/api'

const post = async (path, body = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

const live = join(tmpdir(), 'ppt-ext-test', 'live.pptx')
const other = join(ROOT, 'tests', 'fixtures', 'pages.pptx')

// 副本用 demo.pptx（3 页），覆盖用 pages.pptx（3 页但每页带 PAGE-N-MARKER）
copyFileSync(join(ROOT, 'tests', 'fixtures', 'demo.pptx'), live)

const opened = await post('/open', { path: live })
if (opened.ok !== true) {
  console.error(`打开副本失败：${JSON.stringify(opened.error)}`)
  console.error('（先确认 DSH 在跑、插件已加载）')
  process.exit(1)
}
const firstTextOf = (deck) => deck.slides
  .flatMap(slide => slide.shapes)
  .map(shape => shape.text?.plain ?? '')
  .find(text => text.trim() !== '') ?? ''

console.log(`1) 打开副本：${opened.value.slides.length} 页 rev=${opened.value.rev}`)
console.log(`   首段文本：${JSON.stringify(firstTextOf(opened.value).slice(0, 26))}`)
console.log(`   文件 mtime：${statSync(live).mtimeMs.toFixed(0)}`)

// 模拟 PowerPoint 外部保存：用内容不同的文件覆盖
copyFileSync(other, live)
console.log('2) 已用内容不同的文件覆盖副本（模拟外部保存）')
console.log(`   文件 mtime：${statSync(live).mtimeMs.toFixed(0)}`)

const afterView = await post('/deck', {})
const afterText = firstTextOf(afterView.value)
console.log(`3) 再取 deck（不 force）：${afterView.value.slides.length} 页 rev=${afterView.value.rev}`)
console.log(`   首段文本：${JSON.stringify(afterText.slice(0, 26))}`)
console.log('   （注意：/deck 不 force 时**本就**返回内存视图，这是设计；检测靠下面的 /status）')

// /api/status 是新增的轻量检测接口。若 404，说明运行的宿主还是旧代码。
const statusResponse = await fetch(`${BASE}/status`)
if (statusResponse.status === 404) {
  console.log('')
  console.log('4) GET /api/status → 404')
  console.log('   运行中的宿主仍是不含外部改动检测的旧版本。**请重启 DSH 后重跑本脚本。**')
  process.exit(0)
}
const statusPayload = await statusResponse.json()
console.log('')
console.log(`4) GET /api/status → rev=${statusPayload.value.rev} mtimeMs=${statusPayload.value.mtimeMs} changed=${statusPayload.value.changed}`)
const detected = statusPayload.value.changed === true
console.log(detected
  ? '   ✓ 外部改动被正确检测到（changed=true）'
  : '   ✗ 未检测到外部改动（期望 changed=true）')

// 写入守卫：此时 apply 必须被 staleFile 拒绝
const openedAgain = await post('/deck', {})
const targetShape = openedAgain.value.slides[0].shapes.find(shape => shape.kind !== 'group')
const attempt = await post('/apply', {
  patch: { summary: '外部改动后尝试写入', ops: [{ op: 'setFill', id: targetShape.id, color: '#123456' }] },
})
console.log(`5) 外部改动后 apply → code=${attempt.error?.code ?? '(成功：不应发生)'}`)
const guarded = attempt.error?.code === 'staleFile'
console.log(guarded
  ? '   ✓ 写入被 staleFile 中止（外部修改不会被覆盖）'
  : '   ✗ 写入没被拦住')

// force 重载后应恢复可用
const reloaded = await post('/deck', { force: true })
const retry = await post('/apply', {
  patch: { summary: '重载后写入', ops: [{ op: 'setFill', id: targetShape.id, color: '#123456' }] },
})
console.log(`6) force 重载后 apply → ${retry.ok === true ? '✓ 成功' : '✗ ' + JSON.stringify(retry.error)}`)

console.log('')
console.log(guarded && detected && retry.ok === true
  ? '结论：外部改动检测 + 写入守卫 + 重载恢复 全部生效'
  : '结论：仍有环节未生效，见上面各步')

