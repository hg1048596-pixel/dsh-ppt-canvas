// tools/probe-profile.mjs — 用宿主自己的 bundle 加载器检查 profile
//
// 背景：插件在 DSH Desktop 里「条目存在但从未激活」（工具与路由都没注册），
// 而宿主把 skippedBundles 静默吞掉、不打日志，从外部 HTTP 又全被准入层挡住。
// 这里直接跑 @deepseek-ai/dsh-app-boot 的 loadProfileDirectory —— 与应用启动
// 时**同一条代码路径** —— 于是「为什么被跳过 / patch 层里有什么」都能看到。
//
// 用法：<node> tools/probe-profile.mjs
//   前置：tools/_app-boot.js 必须已由 tools/asar-extract.mjs 抽出（见 README）。

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = 'D:\\deepseek harness desktop official'
const BOOT_JS = join(dirname(fileURLToPath(import.meta.url)), '_app-boot.js')

if (!existsSync(BOOT_JS)) {
  console.error(`probe-profile: ${BOOT_JS} is missing — extract it first:`)
  console.error('  node tools/asar-extract.mjs "<app.asar>" "dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js" tools/_app-boot.js')
  process.exit(1)
}

// app-boot 的依赖都在 app.asar 内，而沙箱不允许在 temp 建 junction，
// 所以预先用 tools/asar-extract-tree.mjs 把 app-boot 及其依赖解到 tools/.probe/。
const STAGE = join(dirname(fileURLToPath(import.meta.url)), '.probe', 'node_modules')
const BOOT_ENTRY = join(STAGE, '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')

if (!existsSync(BOOT_ENTRY)) {
  console.error(`probe-profile: ${BOOT_ENTRY} is missing — stage it first:`)
  console.error('  node tools/asar-extract-tree.mjs "<app.asar>" "dsh/node_modules/@deepseek-ai/dsh-app-boot" "tools/.probe/node_modules/@deepseek-ai/dsh-app-boot"')
  console.error('  …以及 js-yaml / yaml / semver / schemastery / @deepseek-ai/cordis 等同级依赖')
  process.exit(1)
}

let boot
try {
  boot = await import(new URL(`file:///${BOOT_ENTRY.replace(/\\/g, '/')}`).href)
} catch (error) {
  console.error(`probe-profile: cannot import dsh-app-boot — ${error.message}`)
  process.exit(1)
}

const profileDir = join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const installAnchor = join(APP_DIR, 'resources', 'app.asar', 'dsh', 'package.json')

console.log(`profile      : ${profileDir}`)
console.log(`installAnchor: ${installAnchor}`)
console.log('')

let loaded
try {
  loaded = boot.loadProfileDirectory('probe', profileDir, installAnchor, {})
} catch (error) {
  console.error(`loadProfileDirectory threw: ${error.message}`)
  process.exit(1)
}

console.log(`layers (${loaded.layers.length}):`)
for (const layer of loaded.layers) {
  const isMine = layer.packageName === 'dsh-ppt-canvas'
  console.log(`  ${isMine ? '>>>' : '   '} ${layer.packageName}  patches=${layer.patches.length}  dir=${layer.packageDir}`)
  if (isMine) {
    console.log(`       patchPaths: ${JSON.stringify(layer.patchPaths)}`)
    console.log(`       patches   : ${JSON.stringify(layer.patches)}`)
  }
}

console.log('')
console.log(`skippedBundles (${loaded.skippedBundles.length}):`)
for (const skipped of loaded.skippedBundles) {
  console.log(`  - ${skipped.packageName}: ${skipped.reason}`)
}
if (loaded.skippedBundles.length === 0) console.log('  (none)')

const mine = loaded.layers.find(layer => layer.packageName === 'dsh-ppt-canvas')
console.log('')
if (mine === undefined) {
  console.log('结论：dsh-ppt-canvas 的 bundle 层**没有**被加载（见上面的 skippedBundles）。')
} else {
  console.log('结论：bundle 层已加载，patch 内容如上。条目未激活的原因不在这一层。')
}
void readdirSync
