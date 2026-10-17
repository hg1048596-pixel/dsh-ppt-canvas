// tools/probe-zip-times.mjs — 查看 pptx 内各部件的时间戳
//
// 用途：判断一份 pptx **是否曾被我们的写入器重写过**。
// 我们写包时会用当前时间生成 ZIP 条目时间戳；若全部条目时间都远早于
// 插件的开发期，则说明这个文件从没被插件写过 —— 里面的一切都是原始内容。
// 这比看文件系统 mtime 更硬（FS mtime 可被复制/恢复工具改写，ZIP 内部时间不会）。
//
// 用法：<node> tools/probe-zip-times.mjs <deck.pptx> [limit]

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const { readZipEntries } = await import(`file:///${join(ROOT, 'host', 'zip.js').replace(/\\/g, '/')}`)

const file = process.argv[2]
const limit = Number(process.argv[3] ?? 12)

const entries = readZipEntries(new Uint8Array(readFileSync(file)))
const times = []
for (const entry of entries) {
  // readZipEntries 若提供了时间字段就用它；否则跳过
  const stamp = entry.modified ?? entry.lastMod ?? entry.dosTime ?? undefined
  if (stamp !== undefined) times.push({ name: entry.name, stamp })
}

console.log(`file    : ${file}`)
console.log(`entries : ${entries.length}`)

if (times.length === 0) {
  console.log('')
  console.log('结论：readZipEntries 未暴露条目时间戳，此路不通。')
  console.log('改用不可反驳的证据：')
  console.log('  1) 文件系统 mtime（若远早于插件开发期 → 从未被写过）')
  console.log('  2) 与早期副本的 SHA256 是否完全相同（相同 → 自副本以来未被写过）')
  process.exit(0)
}

times.sort((a, b) => a.stamp - b.stamp)
console.log(`最早    : ${new Date(times[0].stamp).toISOString()}  (${times[0].name})`)
console.log(`最晚    : ${new Date(times[times.length - 1].stamp).toISOString()}  (${times[times.length - 1].name})`)
console.log('')
console.log(`前 ${limit} 个部件：`)
for (const item of times.slice(0, limit)) {
  console.log(`  ${new Date(item.stamp).toISOString()}  ${item.name}`)
}
