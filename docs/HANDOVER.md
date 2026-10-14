# HANDOVER — dsh-ppt-canvas 交接文档

> 给接手的 agent。本文档只写**我实测验证过的**事实，凡属推测会明确标注。
> 最后更新：由上一任 agent 在任期末尾写下。

---

## 1. 这个项目是什么

一个 **DSH（DeepSeek Harness）插件**，功能是「用户与 AI 协同编辑 PPT」：

- 在画布上**点选 / Shift 多选 / 框选** PPT 元素（文字、色块、图片、表格…）
- 把「选中元素属性 + 自然语言指令」交给 AI，AI 通过工具调用返回**结构化修改方案**
- 方案直接落到 `.pptx` 文件并刷新画布
- 支持撤销重做、错误处理

**当前状态：核心链路可用，但有未完成项与已知问题（见第 6 节）。**

---

## 2. 环境与运行时事实（最重要，先读这节）

| 项 | 值 |
|---|---|
| 工作区（插件开发树） | `D:\deepseek harness plugin\dsh-ppt-canvas` |
| DSH checkout | `D:\deepseek harness desktop official\resources\app.asar\dsh\` |
| DSH profile | `C:\Users\Hanson Gao\.dsh\profiles\desktop` |
| 插件安装位置 | `<profile>\node_modules\dsh-ppt-canvas` |
| 安装方式 | `package.json` 里 `"dsh-ppt-canvas": "link:D:/deepseek harness plugin/dsh-ppt-canvas"`（junction，**不是拷贝**） |
| GUI | `http://127.0.0.1:19387` |
| 独立通道（插件自起的 HTTP 服务） | `http://127.0.0.1:19488`（占用则顺延 19489-19492） |
| Node | `C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| 版本控制 | **没有 git**（`git rev-parse` 失败）。改坏了无法回滚，改动前自己留备份 |

### 2.1 四个必须知道的坑

1. **`plugin/index.js` 绝对不能存在。**
   Node 解析目录包时优先命中 `index.js`，曾导致宿主长期加载最早版本的副本且**无任何报错**。
   `tools/sync-plugin.mjs` 会主动删除它。当前状态已验证：不存在。

2. **改 host 代码必须重启 DSH。**
   HMR 默认 `ignored: ["**/node_modules", ...]`，而插件就装在 `node_modules` 下。
   客户端 bundle 随页面刷新即可更新，host 不行。

3. **`inject` 数组会让插件永久挂起。**
   历史事故：`export const inject = ['timer']` 导致 Cordis 静默挂起插件（不报错、不打日志、不 mount）。
   现在 `host/index.js` 是 `export const inject = []`，所有服务用 `ctx.get()` + 判空。
   **不要**为了方便把服务加进 `inject`。

4. **CSS 是普通字符串，语法错误完全静默。**
   真实事故：样式插入点撞进选择器中间，产出 `.dsh-ppt-el.kind-text>/* ... */` 这种无法解析的行，
   浏览器丢弃整条规则，JS/构建/测试全都不报错。
   现在有 `tests/css.test.mjs` 专门守这个。**用脚本插入样式后务必跑它。**

### 2.2 宿主能力：实测「有」与「没有」

> 这些是**实测结论**，不要从服务目录推断。服务目录描述的是契约，不代表运行时真的注入了。

**可用：**
- `ctx.get('tools')` → 工具注册（`register` / `get` / `schemas`；**没有 `call`**）
- `ctx.get('webServer')` / `connection` → 存在，但本机路由**不生效**（见下）
- 客户端 `sessions`：`retain(id,{source})` → `reference.ready` → `binding.session.prompt(content, mode, signal?, requestId?)`
  - `content = [{ type:'text', text }]`，`mode='queue'`，用完必须 `reference.release()`
- 客户端 `sessions.list` → ObservableSnapshot（形状 `{ ids, byId, phase, projectionsBySession }`）
- 客户端 `uiWorkspace`：`listDirectory(path?)` / `pickDirectory()` / `insertSessionBefore` 等
- 客户端 `uiWorkspace.listDirectory()` → `{ path, crumbs, entries[{name,path,hidden}] }`
  - ⚠️ 条目**没有 `kind` 字段**，目录/文件只能按「名字里有没有 `.`」启发式区分

**没有 / 不可用：**
- **宿主 `/dsh-ppt` 路由始终 404**（DSH Desktop 准入层：任何路径都返回空 body 404，POST 返回空 body 405）
  → 所以插件**自起 loopback 服务 19488** 作为主通道，`registerRoutes` 只是附加通道
- **`ctx.get('uiWorkspace')` 在客户端曾整个缺失**（不同版本表现不同，务必判空）
- **没有「新建会话」的可用入口**：`uiWorkspace.startSession/connectWorkspace/openSession` 实测不可用，
  `sessions.create()` 不返回带 id 的会话，`sessions.fork()` 不返回值
  → 现状是「从真实会话列表里选一个连上」，不是新建
- **没有选择文件的系统对话框**：`pickDirectory()` 只给目录；`directoryPicker` 服务按设计只提供目录；
  桌面端 Electron 主进程只注册了 `dialog.showOpenDialog({properties:['openDirectory']})`
- `desktopBrowserAccess` 服务不存在
- **PowerPoint COM 打不开文件**（受保护视图）：`Presentations.Open` 报 "could not open the file"，
  换路径、`Unblock-File` 都无效

---

## 3. 命令速查

```powershell
$node = "C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$dev  = "D:\deepseek harness plugin\dsh-ppt-canvas"

# 全部测试 + 同步检查（健康度基线）
& $node "$dev\tools\test-all.mjs"

# 只检查同步状态（host→plugin 是否一致）
& $node "$dev\tools\sync-plugin.mjs" --check

# 把 host/ 与 client/ 同步到 plugin/（改完源码必须跑，否则宿主加载的还是旧代码）
& $node "$dev\tools\sync-plugin.mjs"

# 打印一份 pptx 的 Deck 模型（人工核对渲染）
& $node "$dev\tools\inspect-deck.mjs" <deck.pptx> [--json]

# 打印某形状的**原始 OOXML**（判断字段是「文件里没有」还是「读取时丢了」）
& $node "$dev\tools\probe-xml.mjs" <deck.pptx> <匹配文本> [slideN]

# 把当前打开的文档复制到 debug/ 供诊断（并列出未实现特性的检查结果）
& $node "$dev\tools\debug-copy.mjs"

# 诊断插件自身装配状态（工具注册成没成）
Invoke-WebRequest "http://127.0.0.1:19488/dsh-ppt/api/requests" -UseBasicParsing | % Content
```

**当前测试基线（全绿）：**

```
engine 26 | api 24 | client 18 | css 4 | no-window 6 | host-load 10 | render 7 | sync OK
```

---

## 4. 架构

### 4.1 目录与职责

```
dsh-ppt-canvas/
├── package.json          main/exports → ./plugin/host.js；exports["./client"] → ./plugin/client.js
│                         dsh.bundle.patch = ./cordis.patch.yml；dsh.client.platform = "web"
├── cordis.patch.yml      insert 一行 loader entry（id: ppt-canvas, name: dsh-ppt-canvas）
├── host/                 ← 真正的源码（宿主半端）
│   ├── index.js          入口：inject=[]；起独立服务、注册路由、注册工具；写 health
│   ├── api.js            HTTP 处理器：handleRequest(req,res,store,bus,logger) + GET/POST 路由
│   ├── deck-store.js     打开/缓存/补丁/历史；open() / openBytes() / openDemo() / requireCurrent()
│   ├── pptx-read.js      PPTX → Deck 模型（含母版文本默认值继承）
│   ├── pptx-write.js     Deck 补丁 → PPTX 字节（保前缀 XML 层）
│   ├── render.js         LibreOffice 精确渲染（promoteSlide + renderSlidePng）
│   ├── history.js        撤销/重做
│   ├── zip.js            自研 ZIP 编解码（node:zlib），零运行时依赖
│   ├── xml.js            保前缀 XML 解析/序列化
│   ├── tools.js          4 个模型工具定义
│   ├── selftest.js       自检（6 项）
│   ├── demo.js           内置演示文稿生成
│   └── standalone-server.js  loopback 服务（19488-19492）
├── client/               ← 真正的源码（客户端半端）
│   ├── client.js         DSH 客户端入口：inject=['slots','timer','sessions']；服务适配层
│   ├── app.js            createPptApp()：全部 UI（~2400 行）+ __forTests 测试钩子
│   └── ppt-style.js      CSS 模板（const CSS = `...`）
├── plugin/               ← 构建产物，不要直接改
│   ├── host.js           = host/index.js（改名）
│   ├── client.js         = client/client.js 内联 CSS + app.js（占位标记注入）
│   └── *.js              = host/ 同名文件
├── tests/                engine / api / client-harness / css / no-window / host-load / render
├── tools/                构建、同步、测试、诊断、探针
├── docs/CONTRACT.md      ★ Deck 模型 + 补丁格式的**冻结契约**
├── archive/standalone-window/   已删除的独立窗口功能（含恢复说明与 5 个坑）
└── debug/                ← 临时产物（17.6 MB，可清）
```

### 4.2 客户端 bundle 的加载约定（容易踩）

`plugin/client.js` 是 **classic script**，调用 `window.__ModuleLoader__?.load({ id, factory })`。
factory **只收到 `require`**，且**返回值就是 exports**：

```js
return { inject, apply }    // 必须显式 return
```

**绝不能引用 `module` / `exports`** —— 会直接崩。

### 4.3 通道选择（为什么有两套地址）

```js
const API        = options.apiBase        ?? '/dsh-ppt/api'                    // 宿主路由（本机 404）
const STANDALONE = options.standaloneBase ?? 'http://127.0.0.1:19488/dsh-ppt/api' // 插件自起
```

`callApi` 按 `channelChoice` 择一试，遇到 `network`/`badResponse` 才换下一条；
插件明确返回的业务错误（4xx/5xx 带 code）**原样抛出，不换通道**。

### 4.4 精确渲染（render.js）—— 两个决定性实测

1. **LibreOffice 的 `--convert-to png` 只导出第 1 页**，且 `PageRange` 过滤器选项**被忽略**
   （用两个不同 PageRange 导出，字节数与哈希**完全相同**）。
   → 逐页渲染只能**把第 N 页提升为第 1 页**再渲染。
2. **提升必须是外科式的**：只替换 `ppt/slides/slide1.xml` 与 `ppt/slides/_rels/slide1.xml.rels`，
   其余部件（母版/版式/主题/媒体）逐字节不动；`presentation.xml` 与 `[Content_Types].xml` 都不用改。
   `tests/render.test.mjs` 专门断言「其余部件逐字节不变」——写坏包会直接毁用户文件。

其他实测：
- 每次转换约 **1.3 秒**（profile 预热后）；首次 2.6 秒
- **两个 LibreOffice 进程共用 profile 会互相等待甚至卡死**（实测 `--version` 卡 39 秒）
  → 渲染用独立 profile 目录
- 缓存键 = `文件路径 | size | mtimeMs | page | width` 的 sha1 前 16 位

### 4.5 画布坐标与缩放（刚修过的两个 bug）

- **`.dsh-ppt-slidewrap` 用 CSS `zoom`，不能用 `transform: scale()`。**
  `transform` 只改视觉、**不改布局尺寸** → 内层布局盒子（1280×720）溢出外层（640×360），
  `margin:0 auto` 无从居中，表现是「幻灯片完整但贴在左上角」。
- `localPoint` 用 `getBoundingClientRect()`（**已含缩放**）再 `/ zoom` → 得到幻灯片坐标。
  改动缩放方式时**必须重新核对**这条。

### 4.6 客户端选择的坐标空间

`renderShape` 用 `shape.geometry`（**幻灯片 px**，原点在幻灯片左上角），
绝对定位在 `.dsh-ppt-slide`（`position:relative`）内。
px = EMU / 9525。所以命中测试、框选、高亮框三者天然同一坐标系。

---

## 5. 关键约定

### 5.1 Deck 模型 / 补丁格式是**冻结契约**

见 `docs/CONTRACT.md`。要点：

- 坐标单位是 **px**（EMU/9525）
- z-order = `p:spTree` 子元素顺序，**首个子元素 = z 0 = 最底层**
- 补丁 op：`setText`（用 `paragraphs:[{runs:[{text}]}]`，**不是 `text`**）、`setTextStyle`、
  `move` / `resize` / `setFill` / `setLine` / `reorder` / `delete` 等
- `apply` 的 body 形如 `{ patch: { rev, summary, ops } }`，**不是**扁平的 `{rev, ops}`
- 颜色只接受 `#RRGGBB`
- 文本排版字段（`lnSpc` / `spaceBefore` / `spacAfter` / `indent` / `insets` / `autofit`）已加入契约

### 5.2 排版继承链：**排版信息大量在母版里**

实测用户文件：幻灯片里 48 个 run **全都自带 `sz`**，但
`lnSpc=0.9` 与 `spcBef=10pt` **只在 `slideMaster1.xml` 的 `p:txStyles`** 里定义。

继承规则（`pptx-read.js` 已实现）：

| 情况 | 取值 |
|---|---|
| 段落自己写了 | 用段落的 |
| 段落没写、母版 `p:txStyles` 写了 | 用母版的 |
| 两处都没有 | `null`，**绝不编造数值** |

实现链路：`readDeck` → `findPart(/^ppt\/slideMasters\/slideMaster\d+\.xml$/)` →
`readMasterTextDefaults()` → `context.masterText` → `readShape` 按 `kind==='title'`
选 `titleStyle` 或 `bodyStyle` → `readTextBody(txBody, theme, masterDefaults)`。

**⚠️ 这里曾有一个典型的「看起来已实现」的 bug**：`readMasterTextDefaults` 函数定义完整，
但**没有任何调用点**，`readTextBody` 的第三个参数永远是 `undefined` ——
母版的 `lnSpc` / `spcBef` / `marL` 一个都没生效。表现就是文字行距错、挤在一起、逐行累积偏移。

已修复并在真实文件上验证：

```
修复前: lnSpc=undefined（渲染退回 1.2）  spcBef=undefined  indent=undefined
修复后: lnSpc=0.789 / 0.979 / 0.833      spcBef=13.333px   indent=24px
```

（`spcBef=13.333px` = 母版 `spcPts 1000`(10pt)，`indent=24px` = `marL 228600` EMU。）

`tests/engine.test.mjs` 里新增了两项回归测试守这件事，其中一项专门断言
「至少要有一个段落从母版承接到了缩进」——**只断言函数存在是不够的，必须断言它被调用了**。


### 5.3 修排版问题的正确工作流

不要按通用经验猜。用这个顺序：

1. `tools/debug-copy.mjs` 把用户实际文件复制进 `debug/`（并列出未实现特性检查）
2. `tools/probe-xml.mjs` 打印该形状的**原始 OOXML**
3. `tools/inspect-deck.mjs --json` 看 **Deck 模型里有什么**
4. 对照 2 与 3：**文件里有但模型里没有 = 读取时丢了**（改 reader）；
   模型里有但画布上不对 = 渲染问题（改 renderer）
5. 给这条差异写一个测试再修

这套流程是有效的：靠它找到了 `a:lnSpc` 被整段丢弃、以及母版继承这两个真因。

### 5.4 沟通与用户偏好

- **中文回复**
- 用户**不接受猜测式修复**，每轮必须给出可验证结论
- 用户反复要求：按钮变灰/失败要能看到**具体原因**（现在原因直接印在界面上 + `health`）
- 用户曾多次因为我基于臆想的 API 写代码而返工 → **新功能先查真实契约再写**

---

## 6. 已知问题与未完成项（★ 接手重点）

### 6.1 未验证：工具注册是否真的成功 ★

上一任在离开前发现：`GET /api/requests` 的 `health.toolRegistration` 报 **`failed`**，
根因是自己写的代码用同一个 `tools` 服务既收集定义又注册，`register` 被调两次，第二次因重名抛错。

**已修**：改为先用只收集的桩拿定义、再**逐个**注册，每个单独记账（`ok` / `partial` / `failed` + 具体哪个工具失败）。

**但用户尚未重启 DSH 验证。** 接手第一件事应该是：

```powershell
# 重启 DSH 后
Invoke-WebRequest "http://127.0.0.1:19488/dsh-ppt/api/requests" -UseBasicParsing | % Content
# 看 health.toolRegistration 是否为 "ok"
```

注意：`Tool.listTools`（Inspect）**看不到**插件注册的工具——它只返回「当前 Agent 可见」的工具。
所以**不要用 listTools 判断工具是否注册成功**，用 `health`。

### 6.2 已完成：母版文本默认值继承

原本是个半成品（函数定义了但从未调用）。**已在任期末尾修复并验证**，见 5.2。
不需要再处理，但**不要删掉那两项回归测试**。

### 6.3 未完成：其他 OOXML 特性

| 特性 | 影响 |
|---|---|
| 项目符号 `a:buChar`/`a:buAutoNum` | 行首对不齐（母版里常见 `•`） |
| 悬挂缩进 `indent` + `marL` | 与项目符号配套 |
| 主题字体 `+mj-lt` / `+mn-lt` | 字体回退 → 字宽不同 → 换行位置不同 |
| `normAutofit` 缩字号适应 | 文字溢出 |
| 表格单元格填充/边框/垂直对齐 | 表格观感 |
| 形状旋转是否真的应用 | 需确认 Client 是否用 `geometry.rotation` |

**注意**：由于现在默认走 LibreOffice **精确渲染**，这些对「看」的影响大幅下降；
但对**内置重画模式**（`renderMode='dom'`）仍然存在。

### 6.4 未验证：真实文件上的渲染与交互效果

上一任最后几轮的修复（CSS 损坏、`zoom` 居中、母版继承）**都没有得到用户验证**。
接手时应先请用户确认：

1. 幻灯片是否居中（不再贴左上角）
2. 点选时高亮框是否与元素对齐
3. 图片是否显示
4. 精确渲染下字体/行距是否与 PowerPoint 一致

如果**仍有错位**，需要用户区分两种：
- 高亮框**整体偏移**（都偏右/偏下）→ 坐标映射，查 `localPoint` 与 `zoom`
- 高亮框**位置对但形状不对** → shape 几何解析，对着该文件 XML 查

> 教训：这四轮里有三轮是「用户报症状 → 我猜原因 → 改错地方 → 用户再报」。
> 真正有效的做法是第 5.3 节那套（原始 XML ↔ Deck 模型 对照），
> **先拿到用户的真实文件再动手**，不要凭通用经验改。


### 6.5 设计债：精确渲染是静态图

精确渲染下画布是 PNG，**不能在画布上直接编辑文字**（文字编辑走右侧属性面板，这本来也是设计）。
AI 改完文档后底图会按新 mtime 自动重渲染。

已具备但**未实现**的组合：编辑时用内置重画（即时）、空闲/预览时用精确渲染。

### 6.6 「新建会话」做不到

本机没有可用的建会话入口（见 2.2）。现状是从真实会话列表选一个连上。
若用户坚持要「自动新建全新对话」，**需要宿主侧提供建会话接口**，插件侧做不到。

### 6.7 渲染保真是近似（内置重画模式）

内置 DOM 重画对主题/母版继承、图表、SmartArt 都不完整；文本溢出仅告警。
**默认已改为精确渲染**，但内置模式仍在（可切换）。

### 6.8 可清理的临时产物

- `debug/`（17.6 MB，118 文件）— 诊断产物，含用户文件的副本 `repro.pptx`（**注意隐私，清理前确认**）
- `.windowtest/`（0.1 MB）— 独立窗口时期的 Electron 探针，功能已移除
- `tools/_*.js`（1.2 MB，10 个）— 从 `app.asar` 抽出的**宿主源码**，只读参考资料
- `tools/.probe/`、`tools/_scdir/` — 探针用的抽出产物

`tools/probe-ppt-com.ps1` 目前**无法直接执行**（PowerShell 执行策略禁止未签名脚本），
需要内联执行或改 `.cmd`。

### 6.9 单文档限制

同一时间只操作一份演示文稿；文件被 PowerPoint 占用时写盘会失败（有明确报错）。
浏览器拖拽拿不到本地路径（Electron 才给 `File.path`）——
不过现在「打开」走 `<input type="file">` + `Content.path`/base64 上传（见 `POST /api/files`），这条路可用。

---

## 7. 一次典型改动的完整流程

```powershell
$node = "C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$dev  = "D:\deepseek harness plugin\dsh-ppt-canvas"

# 1) 改源码：只改 host/ 与 client/，不要改 plugin/
#    （plugin/ 是产物；但 host/ 与 client/ 才是真源，sync 会覆盖 plugin/）

# 2) 同步到 plugin/ 并跑全部测试
& $node "$dev\tools\sync-plugin.mjs"
& $node "$dev\tools\test-all.mjs"

# 3) 若改了 host → 必须重启 DSH（HMR 不覆盖 node_modules）
#    若只改了 client → 刷新页面即可

# 4) 验证：health / selftest / 实际点一遍
& $node -e "fetch('http://127.0.0.1:19488/dsh-ppt/api/selftest').then(r=>r.json()).then(j=>console.log(j.value.ok, j.value.checks.length))"
```

**任何时候都不要用 PowerShell 的 `Set-Content` / 字符串替换去重写源码** ——
历史上多次破坏 UTF-8 中文与反引号（曾造成 README 连字符损坏、`app.js` 语法错误）。
一律用编辑工具，或用已封装好的 `tools/*.mjs`。

---

## 8. 快速定位表

| 症状 | 先查 |
|---|---|
| 按钮灰、功能无反应 | 界面上的原因文本 + `sessionDiagnostics` + `GET /api/requests` 的 `health` |
| 插件完全不工作、无日志 | `inject` 是否非空；`plugin/index.js` 是否存在；host 改后是否重启 |
| 独立通道连不上 | `netstat` 看 19488；`/api/requests` 是否 200 |
| 工具没出现在 AI 面前 | `health.toolRegistration`（**不要**用 `Tool.listTools` 判断） |
| 图片不显示 | `<img src>` 是否拼到了 19488（`mediaUrlCandidates`） |
| 排版不对 | 按 5.3 的流程：原始 XML ↔ Deck 模型 对照 |
| 画布位置/点选错位 | `.dsh-ppt-slidewrap` 的缩放方式（必须是 `zoom`）；`localPoint` 的 `/zoom` |
| 渲染慢 | 缓存是否命中（`renderSlidePng` 返回 `cached`）；是否每页都重转 |
| 样式不生效且无报错 | 跑 `tests/css.test.mjs`（CSS 语法错误是静默的） |
