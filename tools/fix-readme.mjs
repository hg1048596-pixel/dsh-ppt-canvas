// tools/fix-readme.mjs — 一次性修正 README 里「独立窗口」遗留段落
//
// 事故原因：早先用 PowerShell 的字符串替换改写 UTF-8 中文 Markdown，把连字符与
// 行首的项目符号弄坏了（client-harness → client harness、"  **…" 丢了 "- "）。
// 精确多行匹配很容易再踩空，所以这里改成按锚点做区间裁剪，幂等且不用担心空白差异。
//
// 用法：<node> tools/fix-readme.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const README = join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md')
let text = readFileSync(README, 'utf8')
const applied = []

/** 简单替换（幂等）。 */
function replace(from, to, label) {
  if (!text.includes(from)) return
  text = text.split(from).join(to)
  applied.push(label ?? from.slice(0, 50))
}

replace('tests/client harness.mjs', 'tests/client-harness.mjs')
replace('tests/no window.test.mjs', 'tests/no-window.test.mjs')
replace('archive/standalone window/', 'archive/standalone-window/')
replace('client harness', 'client-harness')
replace('no window', 'no-window')
replace('standalone window', 'standalone-window')
replace('`deck store.js`', '`deck-store.js`')
for (const line of [
  '**AI 编辑的是原文件**',
  '**渲染是保真近似，不是像素级还原**',
  '**文本溢出只给告警**',
  '**只处理一个打开中的文档**',
  '**写盘需要文件未被独占**',
  '**AI 可能不调用工具**',
]) {
  replace(`  ${line}`, `- ${line}`, `bullet: ${line.slice(0, 24)}`)
}

// 「拖拽拿不到路径」到本节末尾这一段整体裁掉，重写成移除后的现状。
const startAnchor = '  **浏览器里拖拽拿不到本地路径**'
const endAnchor = '\n## 📄 许可证'
const start = text.indexOf(startAnchor)
const end = text.indexOf(endAnchor)
if (start !== -1 && end !== -1 && end > start) {
  const replacement = [
    '- **浏览器里拖拽拿不到本地路径**：这是浏览器的隐私限制（Chromium 只把本地路径交给 Electron',
    '  渲染进程）。所以面板里的拖拽只在能拿到路径时生效；拿不到时插件会明确提示改用「打开」按钮选文件。',
    '- **独立桌面窗口已移除**：源文件与恢复步骤保留在 `archive/standalone-window/`（含一份说明，',
    '  记录当时踩过的坑，例如 `ELECTRON_RUN_AS_NODE` 必须整键删除、被 vendor 的裸 `electron.exe`',
    '  不提供 `require(\'electron\')`、`plugin/index.js` 会遮蔽真正的入口）。',
    '- **受限宿主下宿主路由可能不注册**：DSH Desktop 会给 WebServer 的路由套一层准入，实测插件路由',
    '  在这类宿主里拿不到请求。因此插件**优先**走自起的独立 loopback 服务（`127.0.0.1:19488`，',
    '  被占用则顺延），宿主路由只作为附加通道。',
    '- **改 host 代码必须重启 DSH**：HMR 默认忽略 `**/node_modules`，而插件就装在 profile 的',
    '  `node_modules` 下 —— 热重载永远不会重新加载它。客户端 bundle 会随页面刷新更新。',
    '- 依赖 Host 的 `webServer` 或 `connection` 服务；`tools` 服务缺失时工具不注册（仅画布可用）。',
    '',
  ].join('\n')
  text = text.slice(0, start) + replacement + text.slice(end + 1)
  applied.push('limitations: 重写「独立窗口」遗留段落')
}

replace('- **拖拽**：把 `.pptx` 直接拖到面板或独立窗口上（拖进去时整块界面会变蓝并提示）；', '- **拖拽**：把 `.pptx` 直接拖到面板上（拖进去时整块界面会变蓝并提示）；')

writeFileSync(README, text)
console.log(`fix-readme: applied ${applied.length} fix(es)`)
for (const item of applied) console.log(`  - ${item}`)
