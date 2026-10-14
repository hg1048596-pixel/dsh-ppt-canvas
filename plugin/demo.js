// dsh-ppt-canvas — 内置演示文稿
//
// 插件随包携带一份 .pptx 模板（plugin/assets/demo.pptx，由
// tools/build-demo-pptx.py + tools/demo-deck.json 生成）。
// 第一次点「打开演示文稿」时把它复制到用户目录，之后就在真实文件上编辑，
// 让「选择 → 指令 → AI 改 → 撤销」整条链路都能落到磁盘上验证。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 模板搜索路径：plugin/assets → host/assets → 仓库 tests/fixtures。 */
function templateCandidates() {
  return [
    join(HERE, 'assets', 'demo.pptx'),
    join(HERE, '..', 'plugin', 'assets', 'demo.pptx'),
    join(HERE, '..', 'tests', 'fixtures', 'demo.pptx'),
  ]
}

/** 找到内置模板，返回字节；找不到返回 null（调用方降级为提示语）。 */
export function demoBytes() {
  for (const candidate of templateCandidates()) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate)
    } catch { /* 继续找下一个 */ }
  }
  return null
}

/**
 * 确保演示文稿存在于磁盘上。
 * @param {string} [dir] 目标目录；默认 `~/.dsh/ppt-canvas`
 * @returns {Promise<{filePath: string, bytes: Buffer | undefined, created: boolean}>}
 */
export async function ensureDemoDeck(dir) {
  const bytes = demoBytes()
  if (bytes === null) {
    const error = new Error('the bundled demo presentation is missing from this installation')
    error.code = 'notFound'
    throw error
  }
  const target = dir !== undefined && dir !== ''
    ? join(dir, 'dsh-ppt-canvas-demo.pptx')
    : join(defaultDemoDir(), 'dsh-ppt-canvas-demo.pptx')
  mkdirSync(dirname(target), { recursive: true })
  const existed = existsSync(target)
  if (existed) {
    try {
      const current = readFileSync(target)
      if (current.length > 0) return { filePath: target, bytes: undefined, created: false }
    } catch { /* 读不动就重写 */ }
  }
  writeFileSync(target, bytes)
  return { filePath: target, bytes, created: true }
}

/** 默认演示文稿目录：优先用户主目录下的 .dsh，不可写时退回系统临时目录。 */
export function defaultDemoDir() {
  const preferred = join(homedir(), '.dsh', 'ppt-canvas')
  try {
    mkdirSync(preferred, { recursive: true })
    return preferred
  } catch {
    const fallback = join(tmpdir(), 'dsh-ppt-canvas')
    mkdirSync(fallback, { recursive: true })
    return fallback
  }
}
