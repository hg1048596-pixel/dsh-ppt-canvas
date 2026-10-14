# dsh-ppt-canvas — 冻结契约 (v1)

本文件是三个实现面之间**唯一**的接口权威。任何一方改动这里的内容，必须先改本文件。

- **Host engine**（`host/`）：读/写 `.pptx`、生成渲染模型、应用补丁、维护修订历史。
- **Host API**（`host/api.js` + `host/tools.js`）：HTTP 路由与模型工具，是 Client 与 AI 的入口。
- **Client half**（`client/client.js`）：画布渲染、选择、指令输入、撤销重做 UI。

单位约定：JSON 里所有几何量都是 **px（96 DPI）**，`1 px = 9525 EMU`；旋转是**度**。
颜色统一用 `#RRGGBB`（不带 alpha）；`null` 表示"未显式设置 / 继承母版"。

---

## 1. Deck 文档模型（Host → Client）

```jsonc
{
  "file": "C:/path/to/Deck.pptx",   // 绝对路径
  "rev": 7,                          // 单调递增；每次成功写盘 +1
  "slideWidth": 960,                 // px
  "slideHeight": 540,
  "openedAt": 1760000000000,
  "media": {
    "image3": { "url": "/dsh-ppt/media/<deckKey>/image3.png", "mime": "image/png",
                "width": 800, "height": 450 }
  },
  "slides": [
    {
      "index": 0,                    // 0-based
      "id": "s1",                    // pptx 里的 slide part 名，稳定标识
      "name": "幻灯片 1",
      "background": "#FFFFFF",
      "shapes": [ /* Shape[] 见 §2 */ ]
    }
  ],
  "warnings": ["..."]                // 解析期降级说明，可选
}
```

## 2. Shape（画布元素 = 可选择组件）

```jsonc
{
  "id": "s1:5",          // `<slideId>:<shapeId>`；全局唯一、跨 rev 稳定
  "shapeId": "5",        // pptx `<p:cNvPr id="5">` 的 id，字符串
  "name": "Title 1",
  "kind": "text",        // text | shape | image | line | group | table | chart | media | unknown
  "type": 17,            // MSO_SHAPE_TYPE 数值（17=文本框, 1=自选图形, 13=图片, 14=占位符, 6=组合, 9=线, 19=表格, 3=图表）
  // z = 绘制顺序（paint order），0 = 画在最底下，越大越靠上。
  // 与 OOXML 的 p:spTree 子元素顺序【一致】：第一个可选子元素 = z 0（最底），最后一个 = 最顶。
  // （依据：python-pptx shapetree.py "The first shape in the sequence is the backmost in z-order
  //   and the last shape is topmost"，并用 LibreOffice 实际渲染取重叠像素复核过。）
  // Client 直接用它当 CSS z-index。
  "z": 3,
  "geometry": { "x": 60, "y": 40, "w": 840, "h": 120, "rotation": 0, "flipH": false, "flipV": false },
  "placeholder": null,   // 非占位符为 null，否则 { "idx": "0", "type": "title" }
  "style": {
    "fill": { "type": "solid", "color": "#1F4E79", "alpha": 1 },
    // type: solid | gradient | none | image | inherit
    "gradient": null,    // { "angle": 90, "stops": [{ "pos": 0, "color": "#FFF" }, ...] }
    "line": { "color": "#333333", "width": 1, "dash": "solid" },   // 可为 null
    "shadow": false,
    "opacity": 1,
    "cornerRadius": 0,   // px；roundRect/ellipse 的圆角半径，Client 用它做圆角
    "prst": "rect"       // a:prstGeom/@prst 原始值，诊断用
  },
  "text": {
    "plain": "季度复盘",                 // 全部段落文本拼接（AI 主要读这个）
    "align": "center",                  // left | center | right | justify | null
    "anchor": "middle",                 // top | middle | bottom | null（垂直对齐）
    "color": "#FFFFFF",                 // 形状级默认字色
    "fontSize": 32,                     // 形状级默认字号 px
    "bold": true, "italic": false, "fontFamily": "微软雅黑",
    "insets": { "left": 9.6, "top": 4.8, "right": 9.6, "bottom": 4.8 },  // px；a:bodyPr 的 lIns/tIns/rIns/bIns
    "autofit": "shape",                 // shape | norm | none | null（a:spAutoFit / a:normAutofit / a:noAutofit）
    "paragraphs": [
      { "level": 0, "align": "center",
        "lnSpc": 1.25,                  // 行距；倍数（lnSpcIsPx=false）或绝对 px（lnSpcIsPx=true）
        "lnSpcIsPx": false,
        "spaceBefore": null,            // 段前间距 px（a:spcBef/a:spcPts），没有就是 null
        "spaceAfter": null,             // 段后间距 px（a:spcAft/a:spcPts）
        "indent": null,                 // 左缩进 px（a:pPr/@marL）
        "runs": [
        { "text": "季度复盘", "color": "#FFFFFF", "fontSize": 32, "bold": true,
          "italic": false, "fontFamily": "微软雅黑", "underline": false }
      ] }
    ]
  },
  // kind == "image" 时：
  "image": { "mediaId": "image3", "url": "/dsh-ppt/media/<deckKey>/image3.png",
             "crop": { "l": 0, "t": 0, "r": 0, "b": 0 } },
  "table": null,          // kind == "table"：{ "rows": 2, "cols": 3, "cells": [{ "r":0,"c":0,"text":"A" }] }
  "children": null        // kind == "group"：Shape[]（组合内元素，选择到组合即选中整体）
}
```

## 3. Client → Host 选择上下文（发给 AI 的原文）

客户端在用户点击「发送给 AI」时，把下面的对象 POST 给 `/dsh-ppt/api/context`，Host 保存为一次性上下文并返回 `requestId`。

```jsonc
{
  "requestId": "req_1729140000000_ab12",   // 客户端生成
  "deckRev": 7,
  "instruction": "把标题改成红色并右对齐",     // 用户自然语言指令原文
  "selectionMode": "multi",                 // single | multi | marquee | slide
  "slideIndex": 0,
  "selectedIds": ["s1:5", "s1:7"],
  "elements": [ /* SelectionElement[] 见 §4，由客户端截取 */ ],
  "locale": "zh-CN",
  "createdAt": 1760000000000
}
```

## 4. SelectionElement（选中元素及其属性，含位置/尺寸/样式/层级/文本）

```jsonc
{
  "id": "s1:5",
  "name": "Title 1",
  "kind": "text",
  "z": 3,
  "geometry": { "x": 60, "y": 40, "w": 840, "h": 120, "rotation": 0 },
  "style": { "fill": { "type": "solid", "color": "#1F4E79" },
             "line": null, "opacity": 1 },
  "text": { "plain": "季度复盘", "fontSize": 32, "color": "#FFFFFF",
            "bold": true, "align": "center", "fontFamily": "微软雅黑" },
  "image": null
}
```

## 5. Patch（AI 产出的修改方案）

```jsonc
{
  "summary": "把标题改红并右对齐",       // 必填，一句话说明
  "ops": [
    { "op": "setText",     "id": "s1:5", "paragraphs": [ { "runs": [ { "text": "季度复盘" } ] } ] },
    { "op": "setTextStyle","id": "s1:5", "color": "#D93025", "bold": true, "fontSize": 34,
                           "align": "right", "fontFamily": "微软雅黑", "italic": false, "underline": false },
    { "op": "setFill",     "id": "s1:5", "color": "#FFF2CC" },
    { "op": "setLine",     "id": "s1:5", "color": "#D93025", "width": 2, "dash": "solid" },
    { "op": "setGeometry", "id": "s1:5", "x": 60, "y": 40, "w": 840, "h": 120, "rotation": 0 },
    { "op": "move",        "id": "s1:5", "dx": 20, "dy": -10 },
    { "op": "resize",      "id": "s1:5", "dw": 100, "dh": 0 },
    { "op": "align",       "ids": ["s1:5","s1:7"], "mode": "left" },   // left|hcenter|right|top|vcenter|bottom|distributeH|distributeV
    { "op": "setZ",        "id": "s1:5", "z": 9 },
    { "op": "bringToFront","id": "s1:5" },
    { "op": "sendToBack",  "id": "s1:5" },
    { "op": "remove",      "id": "s1:5" },
    { "op": "duplicate",   "id": "s1:5", "dx": 20, "dy": 20 }
  ]
}
```

**规则**

1. `ops` 至少 1 条；每条 `op` 必须属于上表；未知 op → 校验失败。
2. `id` 必须存在于当前 deck；`align` 的 `ids` 至少 2 个。
3. 颜色只接受 `#RRGGBB`；`fontSize`/`width`/`x`… 必须是有限数；越界（负尺寸）→ 校验失败。
4. `duplicate`/`remove`/`setZ`/`align` 之外的 op 是**幂等**的，可以安全重放。
4b. `setZ` 的 `z` 是**绘制顺序**（0 = 最底，越大越靠上），与 `p:spTree` 子元素顺序一致。`bringToFront` = 移到最后一个子元素位置；`sendToBack` = 插到 `p:nvGrpSpPr`/`p:grpSpPr` 之后的第一位。
5. 校验先于写入：任何一条 op 失败 → 整个 patch 不落盘，返回 `validationFailed` 与逐条原因。

## 6. HTTP API（Host，同源，前缀 `/dsh-ppt`）

所有响应：`{ "ok": true, "value": <T> }` 或 `{ "ok": false, "error": { "code": "...", "message": "...", "details": {...} } }`。
错误码：`badRequest` / `notFound` / `noDeck` / `validationFailed` / `staleRev` / `ioFailed` / `internal`。

| method | path | body | value |
|---|---|---|---|
| POST | `/dsh-ppt/api/open` | `{ "path": "D:/x.pptx", "createDemo": false }` | `Deck`(§1) |
| POST | `/dsh-ppt/api/demo` | `{ "dir": "D:/tmp" }`（可省） | `Deck` |
| POST | `/dsh-ppt/api/deck` | `{}` | `Deck`（重新读取并重新解析） |
| POST | `/dsh-ppt/api/context` | §3 | `{ "requestId": "...", "context": <原文> }` |
| GET  | `/dsh-ppt/api/context?requestId=...` | — | `{ "context": <原文>, "consumed": bool }` |
| POST | `/dsh-ppt/api/apply` | `{ "patch": §5, "dryRun": true, "source": "ai"\|"user", "requestId": "..." }` | `ApplyResult` |
| POST | `/dsh-ppt/api/undo` | `{ "steps": 1 }` | `Deck` |
| POST | `/dsh-ppt/api/redo` | `{ "steps": 1 }` | `Deck` |
| GET  | `/dsh-ppt/api/history` | — | `{ "rev": 7, "canUndo": true, "canRedo": false, "entries": [...] }` |
| GET  | `/dsh-ppt/media/<deckKey>/<mediaId>.<ext>` | — | 二进制图片 |
| GET  | `/dsh-ppt/api/selftest` | — | 引擎自检报告 |

```jsonc
// ApplyResult
{
  "applied": true,
  "dryRun": false,
  "rev": 8,
  "summary": "把标题改红并右对齐",
  "changedIds": ["s1:5"],
  "ops": [ { "op": "setTextStyle", "id": "s1:5", "status": "applied", "note": null } ],
  "warnings": [ { "code": "textOverflow", "id": "s1:5", "message": "文本可能溢出形状" } ],
  "deck": { /* 仅 dryRun=false 时附带新 Deck */ }
}
```

## 7. Host 模型工具（AI 调用）

| 工具 | 参数 | 返回 |
|---|---|---|
| `ppt_canvas_open` | `{ "path": string }` | `{ path, rev, slideCount }` |
| `ppt_canvas_context` | `{ "requestId": string }` | §3 的完整上下文（含元素属性 + 用户指令） |
| `ppt_canvas_apply` | `{ "patch": §5, "dryRun"?: boolean, "requestId"?: string }` | `ApplyResult`（不带 deck） |
| `ppt_canvas_history` | `{ "action": "undo"\|"redo"\|"status", "steps"?: number }` | `Deck` 摘要 / 历史状态 |

## 8. 客户端动作语义

- **选择**：点击元素 = 单选；`Shift/Ctrl + 点击` = 增删多选；空白处拖拽 = 框选（marquee，相交即选中）；点击页面缩略图左上角 = 整页选中（`selectionMode: "slide"`）。
- **高亮**：选中 = 2px 主色描边 + 8% 主色填充 + 四角把手；悬停 = 1px 虚线；AI 刚改动的元素 = 3 秒淡黄色 `#FFE58F` 呼吸高亮。
- **指令**：`Enter` = 把指令加入待发列表（不发送）；`Ctrl/Cmd + Enter` = 发送。发送即 `sessions.binding(sessionId).session.prompt([{type:'text',text}], 'queue')`。
- **撤销/重做**：`Ctrl+Z` / `Ctrl+Shift+Z` 走 Host 历史（写盘级），本地乐观预览在写盘成功后以 Host 返回的 Deck 为准（三方同步以 Host 为唯一权威）。
- **同步**：写盘成功后 Client 必须用返回的 Deck 覆盖本地模型；`rev` 不一致时以 Host 的 `rev` 为准并丢弃本地乐观状态。

## 9. 错误处理

| 场景 | 表现 |
|---|---|
| 未打开文件 | 画布显示「打开 PPTX」空态，指令框禁用 |
| 指令发送时无会话 | 提示「当前会话不可用」，保留指令草稿 |
| patch 校验失败 | 卡片显示逐条原因，画布不动，指令可重发 |
| 写盘失败（文件被占用等） | Toast + 保留 patch，提供「重试」 |
| AI 未产出 patch | 显示「AI 未返回修改方案」，提供「重试 / 手动改」 |
| rev 冲突 | 提示「文件已被其他程序修改」，提供「重新载入」 |
