// host/render.js — 用 LibreOffice 把某一页渲染成 PNG
//
// 为什么这么做：画布原先用 DOM 近似重画 OOXML，但 PowerPoint 的排版大量来自继承链
// （实测用户文件：48 个 run 都自带 sz，而 lnSpc=0.9 与 spcBef=10pt **只在母版里**），
// 逐条复刻既慢又永远追不平。改用 LibreOffice 无头渲染，观感与真实文件一致。
//
// 两个实测结论决定了这里的做法：
//   1. `--convert-to png` **只导出第 1 页**，且 PageRange 过滤器选项被忽略
//      （两次不同 PageRange 导出的字节与哈希完全相同）→ 逐页渲染只能靠
//      「把目标页提升为第 1 页」再渲染。
//   2. PowerPoint COM 在本机打不开文件（受保护视图），所以走 LibreOffice。
//
// 提升方式：只替换包内 slide1.xml 的内容（连它的 .rels 一起换成目标页的），
// 文件名与 presentation.xml 都不动，因此不需要改 Content_Types 或 sldIdLst。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** LibreOffice 可执行文件的候选位置（本机实测第一项存在）。 */
const SOFFICE_CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  process.env.LOCALAPPDATA === undefined ? null : join(process.env.LOCALAPPDATA, 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter(candidate => candidate !== null)

/** 找到 soffice；找不到返回 null（调用方据此退回 DOM 渲染）。 */
export function findSoffice() {
  // 测试钩子：模拟「本机没装 LibreOffice」，用来验证「跳过不能被算作全绿」这条闸门。
  if (process.env.DSH_PPT_HIDE_LIBREOFFICE === '1') return null
  for (const candidate of SOFFICE_CANDIDATES) {
    try {
      if (existsSync(candidate)) return candidate
    } catch { /* 权限问题当作不存在 */ }
  }
  return null
}

/** 渲染输出目录（托管在临时区，避免污染用户目录）。 */
function cacheDir() {
  const dir = join(tmpdir(), 'dsh-ppt-canvas', 'render')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 把包内第 page 页的内容提升为第 1 页，写成一份单页演示文稿。
 *
 * 只替换两份部件：
 *   - `ppt/slides/slide1.xml`      ← 目标页的 XML
 *   - `ppt/slides/_rels/slide1.xml.rels` ← 目标页的 rels（媒体与版式的引用都在这）
 * 其余部件（版式、母版、主题、媒体）原样保留，所以版式引用依然有效。
 *
 * @param {Map<string, Buffer|Uint8Array>} entries 原始包
 * @param {number|string} page 1 基页号，或**直接的部件名**（推荐，见下）
 * @param {string[]} [slideParts] `sldIdLst` 顺序的部件名；给了就按它把页号映射成部件
 * @returns {{order: string[], entries: Map<string, Buffer>}} 新包的部件表
 */
/**
 * 页号 → 部件名。
 * 页序来自 presentation.xml 的 `sldIdLst`，部件文件名是 `slideN.xml`，
 * 两者在用户重排过幻灯片后不再一致。
 */
export function resolveSlidePart(page, slideParts) {
  if (typeof page === 'string' && page !== '') return page
  if (Array.isArray(slideParts) && slideParts.length > 0) {
    const index = Math.max(0, Math.trunc(Number(page)) - 1)
    return slideParts[Math.min(index, slideParts.length - 1)]
  }
  return `ppt/slides/slide${page}.xml`
}

export function promoteSlide(entries, page, slideParts) {
  const part = resolveSlidePart(page, slideParts)
  if (typeof part !== 'string' || part === '') {
    const error = new Error(`cannot resolve slide part for page ${page}`)
    error.code = 'notFound'
    throw error
  }
  const slash = part.lastIndexOf('/')
  const base = part.slice(slash + 1)
  const fromRels = `${part.slice(0, slash)}/_rels/${base}.rels`
  const slideXml = entries.get(part)
  if (slideXml === undefined) {
    const error = new Error(`presentation has no ${part}`)
    error.code = 'notFound'
    throw error
  }
  const order = []
  const out = new Map()
  for (const [name, bytes] of entries) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    order.push(name)
    out.set(name, name === 'ppt/slides/slide1.xml' ? Buffer.from(slideXml) : buffer)
  }
  const targetRels = 'ppt/slides/_rels/slide1.xml.rels'
  const rels = entries.get(fromRels)
  if (rels !== undefined) {
    if (!out.has(targetRels)) order.push(targetRels)
    out.set(targetRels, Buffer.from(rels))
  } else {
    out.delete(targetRels)
  }
  return { order, entries: out }
}

/** 跑一次 soffice 转换（Promise 化）。 */
function runSoffice(soffice, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(soffice, args, { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      reject(new Error(`LibreOffice 超时（${timeoutMs}ms）`))
    }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`LibreOffice 退出码 ${code}`))
    })
  })
}

/**
 * 渲染一页为 PNG 字节（带磁盘缓存）。
 *
 * 缓存键含**源文件 mtime 与大小**，所以文件被改过（AI 落盘、外部编辑）就会重渲染。
 *
 * @param {object} options
 * @param {string} options.file 源 pptx 路径
 * @param {Map<string, Buffer|Uint8Array>} options.entries 已解析的包
 * @param {number} options.page 1 基页号
 * @param {number} [options.width] 输出像素宽（默认 1600）
 * @param {object} [options.logger]
 * @returns {Promise<{ buffer: Buffer, cached: boolean, ms: number }>}
 */
export async function renderSlidePng({ file, entries, page, width = 1600, slideParts, logger }) {
  const soffice = findSoffice()
  if (soffice === null) {
    const error = new Error('没有找到 LibreOffice，无法做精确渲染')
    error.code = 'rendererMissing'
    throw error
  }

  // 缓存键必须用**该页内容**而不是磁盘 mtime：
  // 渲染输入是内存里的 buffer，而 mtime 可能已经变了（PowerPoint 刚保存过但 store
  // 还没 reload）。用 mtime 会把「旧 buffer 渲出的图」按「新 mtime」缓存，
  // 之后 reload 时 mtime 没再变，反而一直命中这张错图。
  const partName = resolveSlidePart(page, slideParts)
  const partBytes = entries.get(partName)
  const contentHash = createHash('sha1')
    .update(partBytes === undefined ? Buffer.alloc(0) : Buffer.from(partBytes))
    .update(String(width))
    .digest('hex')
    .slice(0, 12)
  const key = createHash('sha1')
    .update(`${file}|${partName}|${contentHash}|${page}|${width}`)
    .digest('hex')
    .slice(0, 16)
  const dir = cacheDir()
  const cachedPath = join(dir, `${key}.png`)
  if (existsSync(cachedPath)) {
    return { buffer: readFileSync(cachedPath), cached: true, ms: 0 }
  }

  const started = Date.now()
  // LibreOffice 用户配置目录：**整个进程共用一份**（放在缓存目录下的 profile/）。
  // 共用是有意为之：独立 profile 每次首渲染要多花约 1.3 秒（实测 2.6s vs 1.3s）。
  // 共用带来的并发抢锁问题由 api.js 的 renderQueue（同时只跑一个）解决。
  const profileDir = join(dir, 'profile')
  mkdirSync(profileDir, { recursive: true })
  const profileUri = `file:///${profileDir.replace(/\\/g, '/')}`

  const promoted = promoteSlide(entries, page, slideParts)
  const { writeZip } = await import('./zip.js')
  const buffer = writeZip(promoted.order.map(name => ({ name, data: promoted.entries.get(name) })))
  const stagedPath = join(dir, `${key}.pptx`)
  writeFileSync(stagedPath, buffer)

  const outDir = join(dir, key)
  mkdirSync(outDir, { recursive: true })
  const filter = `png:impress_png_Export:{"PixelWidth":{"type":"long","value":${width}}}`
  try {
    await runSoffice(soffice, [
      '--headless', '--norestore', '--invisible',
      `-env:UserInstallation=${profileUri}`,
      '--convert-to', filter,
      '--outdir', outDir,
      stagedPath,
    ], 60000)
  } catch (error) {
    const wrapped = new Error(`渲染第 ${page} 页失败：${error.message}`)
    wrapped.code = 'renderFailed'
    throw wrapped
  }

  const produced = join(outDir, `${key}.png`)
  if (!existsSync(produced)) {
    const error = new Error(`LibreOffice 没有产出图片（第 ${page} 页）`)
    error.code = 'renderFailed'
    throw error
  }
  const rendered = readFileSync(produced)
  writeFileSync(cachedPath, rendered)
  const ms = Date.now() - started
  logger?.info?.(`ppt-canvas render: page ${page} -> ${rendered.length} bytes in ${ms}ms`)
  return { buffer: rendered, cached: false, ms }
}
