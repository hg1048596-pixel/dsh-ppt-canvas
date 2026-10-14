// tools/probe-status.mjs — 枚举 app-boot 里 loader 条目的 status 取值与对应分支
//
// 目的：确认 Inspect 报的 `status: "absent"` 到底意味着「导入成功但无 Config」
// 还是「导入失败」。两者的修法完全不同，不能靠猜。
//
// 用法：<node> tools/probe-status.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, '_app-boot.js'), 'utf8')
const lines = source.split('\n')

console.log('=== entry.status 赋值点 ===')
const assigned = /entry\.status\s*=\s*["'`]([a-z]+)["'`]/g
let match
while ((match = assigned.exec(source)) !== null) {
  const line = source.slice(0, match.index).split('\n').length
  console.log(`  L${line}  status = "${match[1]}"`)
}

console.log('')
console.log('=== 每个赋值点前后 12 行（看它在哪个分支里）===')
const again = /entry\.status\s*=\s*["'`]([a-z]+)["'`]/g
while ((match = again.exec(source)) !== null) {
  const line = source.slice(0, match.index).split('\n').length
  console.log(`\n--- status = "${match[1]}"  (L${line}) ---`)
  console.log(lines.slice(Math.max(0, line - 10), line + 6).map((text, index) => {
    const number = Math.max(1, line - 9) + index
    return `${String(number).padStart(5)}: ${text}`
  }).join('\n'))
}
