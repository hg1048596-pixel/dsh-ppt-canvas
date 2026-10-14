/**
 * dsh-ppt-canvas — 独立窗口的几何计算
 *
 * 单独一个文件是为了可测、也可被 CJS 加载：host/window.cjs 是 Electron 主进程脚本
 * （CJS，且依赖 electron 运行时，在 Node 里 import 不了），但「窗口应该摆在哪」这段
 * 数学必须能单测 —— 它决定了换显示器 / 改分辨率之后窗口会不会跑到屏幕外。
 */

'use strict'

/**
 * 把期望的窗口矩形收进某块屏幕的工作区。
 * 规则：
 *  - 优先落在包含期望坐标的那块屏；找不到就用第一块（主屏）；
 *  - 尺寸先按最小尺寸抬高，再按工作区缩小（不超出屏幕）；
 *  - 位置最后 clamp，保证窗口完整可见（不会被拖到标题栏够不着的地方）。
 *
 * @param {{x: number, y: number, width: number, height: number}} bounds 期望矩形
 * @param {Array<{workArea: {x: number, y: number, width: number, height: number}}>} displays 屏幕列表
 * @param {{width: number, height: number}} minimum 最小尺寸（minWidth/minHeight）
 * @returns {{x: number, y: number, width: number, height: number}} 整数矩形
 */
function clampToWorkArea(bounds, displays, minimum) {
  const list = Array.isArray(displays) && displays.length > 0
    ? displays
    : [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
  const contains = (area) => bounds.x >= area.x - 40
    && bounds.x < area.x + area.width
    && bounds.y >= area.y - 40
    && bounds.y < area.y + area.height
  const area = (list.find((display) => contains(display.workArea)) || list[0]).workArea

  const minWidth = minimum !== undefined && minimum !== null && Number.isFinite(minimum.width) ? minimum.width : 720
  const minHeight = minimum !== undefined && minimum !== null && Number.isFinite(minimum.height) ? minimum.height : 480

  const width = Math.round(Math.min(Math.max(bounds.width, minWidth), area.width))
  const height = Math.round(Math.min(Math.max(bounds.height, minHeight), area.height))
  const x = Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width))
  const y = Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height))
  return { x, y, width, height }
}

/** 没有历史坐标时的居中位置。 */
function centeredBounds(area, width, height) {
  const w = Math.round(Math.min(width, area.width))
  const h = Math.round(Math.min(height, area.height))
  return {
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + Math.max(0, (area.height - h) / 2 - 20)),
    width: w,
    height: h,
  }
}

/**
 * 解析持久化的窗口位置。两个坐标都必须是有效数才认（只有一个有效时宁可居中，
 * 免得出现「x 记住了、y 回到 0」这种半吊子位置）。
 * @param {unknown} x
 * @param {unknown} y
 * @returns {{x: number, y: number} | null}
 */
function parsePosition(x, y) {
  if (x === undefined || x === null || x === '' || y === undefined || y === null || y === '') return null
  const px = Number(x)
  const py = Number(y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null
  return { x: Math.round(px), y: Math.round(py) }
}

module.exports = { clampToWorkArea, centeredBounds, parsePosition }
