// tools/sync-client-css.mjs
//
// DSH 的客户端 bundle 只能通过 __ModuleLoader__ 注入的 require 取模块 ——
// 同目录的额外文件不在模块表里，require('./app.js') 会在运行时抛
// "require(...) missed the module table"。
//
// 所以这里把源文件内联成两个可分发产物：
//   client/ppt-style.js + client/app.js + client/client.js
//       → plugin/client.js                      （DSH 的客户端插件入口）
//   client/ppt-style.js + client/app.js + client/window-app.js
//       → client/window-bundle.js               （独立窗口页面按需加载，由 Host 路由服务）
//
// 内联点是源文件里的占位标记，重复运行幂等。
//
// 用法：node tools/sync-client-css.mjs [--check]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STYLE = join(ROOT, 'client', 'ppt-style.js')
const APP = join(ROOT, 'client', 'app.js')
const MINI = join(ROOT, 'client', 'mini-react.js')
const PANEL_ENTRY = join(ROOT, 'client', 'client.js')
const WINDOW_ENTRY = join(ROOT, 'client', 'window-app.js')
const PANEL_TARGET = join(ROOT, 'plugin', 'client.js')
const WINDOW_TARGET = join(ROOT, 'client', 'window-bundle.js')

const STYLES_START = '  /* __DSH_PPT_STYLES_START__ */'
const STYLES_END = '  /* __DSH_PPT_STYLES_END__ */'
const APP_START = '  /* __DSH_PPT_APP_START__ */'
const APP_END = '  /* __DSH_PPT_APP_END__ */'

/** 从 ppt-style.js 里取出 CSS 模板字符串的字面量内容。 */
export function readCss() {
  const source = readFileSync(STYLE, 'utf8')
  const match = /const CSS = `([\s\S]*?)`\s*\n/.exec(source)
  if (match === null) throw new Error('cannot find `const CSS = `...`` in client/ppt-style.js')
  const css = match[1]
  if (css.includes('`')) throw new Error('the CSS template must not contain a backtick')
  if (css.includes('${')) throw new Error('the CSS template must not contain ${ interpolation')
  return css
}

/**
 * 取出 createPptApp 的完整源码（含它上方的 JSDoc，构造函数从注释末尾开始）。
 * @returns {{doc: string, code: string}}
 */
export function readAppSource() {
  const source = readFileSync(APP, 'utf8')
  const start = source.indexOf('function createPptApp(')
  if (start === -1) throw new Error('client/app.js does not define createPptApp')
  const body = source.slice(start)
  if (body.includes('</script')) throw new Error('client/app.js must not contain a </script sequence')
  // 往上吃掉紧邻的 JSDoc（/** ... */）一起内联，注释一起走。
  const before = source.slice(0, start)
  const docEnd = before.lastIndexOf('*/')
  const docStart = docEnd === -1 ? -1 : before.lastIndexOf('/**', docEnd)
  const doc = docStart === -1 ? '' : before.slice(docStart, docEnd + 2)
  const withDoc = `${doc}\n${body}`
  // 去掉单行 /** ... */ 形式以外的缩进问题：app.js 是顶层函数，直接返回。
  return { doc, code: body, combined: withDoc }
}

/** 用 payload 替换标记之间的内容（payload 每行按 indent 缩进）。 */
function replaceBlock(source, startMarker, endMarker, payload, indent = '  ') {
  const startAt = source.indexOf(startMarker)
  const endAt = source.indexOf(endMarker)
  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(`missing ${startMarker} / ${endMarker} placeholder block`)
  }
  const indented = payload
    .split('\n')
    .map(line => (line.trim() === '' ? '' : `${indent}${line}`))
    .join('\n')
  const head = source.slice(0, startAt) + startMarker
  const tail = `${indent}${source.slice(endAt)}`
  return `${head}\n${indented}\n${tail}`
}

/** 生成 plugin/client.js 的内容（DSH 客户端插件入口）。 */
export function buildPanelBundle() {
  const css = readCss()
  const app = readAppSource()
  let out = readFileSync(PANEL_ENTRY, 'utf8')
  out = replaceBlock(out, STYLES_START, STYLES_END, `const __STYLES__ = ${JSON.stringify(css)}`)
  out = replaceBlock(out, APP_START, APP_END, app.combined)
  return out
}

/**
 * 生成独立窗口用的 bundle：一个 IIFE 里放 CSS / 迷你渲染层 / createPptApp / 窗口入口，
 * 页面只需要一次 <script src>。
 */
export function buildWindowBundle() {
  const css = readCss()
  const app = readAppSource()
  const mini = readFileSync(MINI, 'utf8')
  const entry = readFileSync(WINDOW_ENTRY, 'utf8')
  const indent = (text, pad) => text.split('\n').map(line => (line.trim() === '' ? '' : `${pad}${line}`)).join('\n')
  return [
    '/* 由 tools/sync-client-css.mjs 生成 —— 不要直接编辑这个文件。',
    ' * 源：client/ppt-style.js + client/mini-react.js + client/app.js + client/window-app.js',
    ' */',
    '(function () {',
    `  window.__DSH_PPT_STYLES__ = ${JSON.stringify(css)}`,
    '',
    '  // ---- 迷你渲染层（React 兼容子集，独立窗口专用） ----',
    indent(mini, '  '),
    '',
    '  // ---- 共享界面层 ----',
    indent(app.combined, '  '),
    '',
    '  // ---- 独立窗口入口 ----',
    indent(entry, '  '),
    '})()',
    '',
  ].join('\n')
}

function emit(target, content, check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  if (current === content) return { target, changed: false }
  if (check) return { target, changed: true }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  return { target, changed: true }
}

export function write({ check = false } = {}) {
  const results = [
    emit(PANEL_TARGET, buildPanelBundle(), check),
    emit(WINDOW_TARGET, buildWindowBundle(), check),
  ]
  return { results, changed: results.filter(result => result.changed) }
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === join(process.argv[1])

if (isMain) {
  const check = process.argv.includes('--check')
  const { changed } = write({ check })
  if (check && changed.length > 0) {
    console.error('sync-client-css: 以下文件与源不同步，请运行 node tools/sync-client-css.mjs')
    for (const item of changed) console.error(`  - ${item.target.replace(ROOT, '.')}`)
    process.exit(1)
  }
  if (check) console.log('sync-client-css: OK (in sync)')
  else {
    console.log(`sync-client-css: ${changed.length === 0 ? 'unchanged' : `wrote ${changed.length} file(s)`}`)
    for (const item of changed) console.log(`  + ${item.target.replace(ROOT, '.')}`)
  }
}
