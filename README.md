# dsh-ppt-canvas

> DeepSeek Harness 插件：在 PPT 画布上**点选 / 框选**组件（文字、色块、图片、线条、表格），
> 输入一句自然语言修改要求，由 AI 生成具体的修改方案并**实时落到 .pptx 文件与画布**。
> 选择状态、AI 结果、PPT 文档三方同步，带撤销/重做与完整的错误处理。

灵感来自腾讯 WorkBuddy 的「人机双写」（V5.3.5，2026 07 30 发布）中的 PPT 能力：点选或框选元素 → 下达指令 → 只改选区。
本插件把它做成 DSH 的原生插件：**改的是磁盘上的真实 .pptx**，不是渲染出来的中间产物。

   

## ✨ 功能

| 能力 | 说明 |
|     |     |
| **可视化选择** | 画布按 .pptx 的真实几何/样式渲染每页元素：文本框、色块（含圆角/描边/渐变）、图片（含裁剪）、线条、表格、组合 |
| **单击选中** | 点击任一元素即选中，2px 主色描边 + 四角把手实时高亮；悬停显示虚线预览 |
| **框选（marquee）** | 空白处拖拽出选框，与选框相交的元素全部选中 |
| **多选 / 批量** | `Shift/Ctrl + 点击` 增删；属性面板出现「批量对齐」（左右/居中/顶底/水平等距） |
| **选整页** | 点击页面缩略图左上角「整页」，一次选中该页全部元素（对应 WorkBuddy 的「选页做 AI 编辑」） |
| **拖拽打开** | 把 `.pptx` 直接拖到面板上即可打开；拖拽时整块界面给出投放提示 |
| **可拖动浮窗** | 面板标题栏可拖动、右下角可缩放，位置与尺寸记忆在 localStorage |
| **自然语言指令** | 指令框输入要求，`Enter` 直接发送（`Shift+Enter` 换行）；「加入待发」可把多条攒起来一起发 |
| **选区上下文** | 选中元素的**位置、尺寸、样式、层级 z、文本内容**随指令一起交给 AI（不需要截图或复述内容） |
| **AI 修改方案** | AI 通过 `ppt_canvas_context` 取回选区，产出 `ops` 数组，再用 `ppt_canvas_apply` 落盘；复杂方案可先 `dryRun` 试算 |
| **实时同步** | 落盘后画布自动刷新到新 rev；AI 刚改动的元素淡黄色呼吸高亮 3 秒（面板每 4 秒轮询 rev） |
| **撤销 / 重做** | Host 侧字节级快照（每次写盘前留档），`Ctrl+Z` / `Ctrl+Shift+Z`，最多 50 步 |
| **错误处理** | 逐条校验错误、版本冲突（staleRev）、文件占用、AI 未产出方案 —— 都有明确提示与「重试」 |

   

## 🚀 安装

### 方式一：安装到当前 profile（推荐）

```powershell
node tools/install-profile.mjs   profile desktop
```

脚本做两件幂等的事：在 `~/.dsh/profiles/<profile>/node_modules` 下建一个指向本仓库的
junction，并把包名加进 profile `package.json` 的 `dsh.profile.bundles`。
（`dsh plugin add` 也可以，但本机 profile 的 node_modules 是用 pnpm 从
`~/.pnpm/store/v11` link 出来的，pnpm 11 默认找 `%LOCALAPPDATA%\pnpm\store`，
会以 `ERR_PNPM_UNEXPECTED_STORE` 失败——本插件零依赖，所以直接建 junction 更稳。）

卸载：`node tools/install-profile.mjs   profile desktop   uninstall`

安装后**重启 DSH**（新增 loader 行需要重新 boot）。之后：

  侧边栏底部出现 **▦ PPT 画布** 按钮；
  对话里 AI 会多出 4 个工具：`ppt_canvas_open` / `ppt_canvas_context` / `ppt_canvas_apply` / `ppt_canvas_history`。

验证装好了：

```powershell
# Host 路由应在（未重启时会 404）
curl.exe -s http://127.0.0.1:19387/dsh ppt/api/selftest
# 客户端 bundle 应在
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:19387/plugins/dsh-ppt-canvas/client.js
# 或者直接跑加载测试
node tests/host-load.test.mjs
```

### 方式二：改客户端即时生效（开发用）

`plugin/client.js` 改动**不需要重启**：DSH 的 client modules 每次请求都重读文件，HMR 会按内容 hash 热替换。
只有 `package.json` 的 `dsh.client` 声明、或 cordis 加载行变化才需要重启。

```powershell
# 改完 client/ 下的源码后同步到 plugin/（内联 CSS + 复制引擎）
node tools/sync-plugin.mjs
```

   

## 🖱 用法

1. 打开面板：点侧边栏底部 **▦ PPT 画布**（或面板最小化后右下角的「PPT 画布」启动器）。
2. 打开文件，三种方式任选：
     **拖拽**：把 `.pptx` 直接拖到面板上（拖进去时整块界面会变蓝并提示）；
     **打开**：点「打开」走系统文件选择（DSH 的目录选择服务，返回绝对路径）；
     **演示文稿**：打开内置示例（会复制到 `~/.dsh/ppt-canvas/`）。
     插件直接读写这个文件，每次修改前自动留档（可撤销）。**建议先备份**。
3. 选择元素：点选 / `Shift+点击` 多选 / 空白处拖拽框选 / 缩略图「整页」。
4. 输入指令，回车发送（`Shift+Enter` 换行）。例：
     `把标题改成红色并右对齐`
     `这三个色块统一成品牌蓝 #1A73E8，圆角 8`
     `把这行字缩小到 14px 并居中`
     `把这张图片右移 40px，并置顶`
     `把选中的两个文本框左对齐、水平等距`
5. AI 改完后画布自动刷新，改动元素高亮；不满意就 `Ctrl+Z`。

也可以在对话里直接说「打开 D:\work\deck.pptx」，AI 会调用 `ppt_canvas_open`。

### 独立桌面窗口（已移除）

这一版**不包含**「独立桌面窗口」功能。它曾经实现过（Electron 起一个可自由拖动、
位置记忆的窗口），但在这台机器上始终无法通过宿主侧的验证，已按要求整体撤掉。

源文件与恢复步骤都保存在 `archive/standalone-window/`（含一份 `README.md` 说明
当时踩过的坑：`ELECTRON_RUN_AS_NODE` 必须以删除键的方式清理、被 vendor 的裸
`electron.exe` 不提供 `require('electron')`、`plugin/index.js` 会遮蔽入口等）。

`tests/no-window.test.mjs` 会守住这个边界：面板里不再有入口按钮、没有窗口路由、
`ppt_canvas_window` 工具已注销、归档文件仍然可恢复。

   

## 🧠 它是怎么工作的

```
 Client half (plugin/client.js)                    Host half (host/*.js)
 ┌──────────────────────────┐                     ┌─────────────────────────────┐
 │ 画布：按 Deck 模型渲染   │  POST /dsh ppt/api  │ api.js   HTTP 路由          │
 │ 选择：点选/框选/多选     │ ──────────────────► │ deck store.js  唯一权威     │
 │ 指令框 + 撤销/重做 UI    │ ◄────────────────── │ pptx read.js   OOXML → Deck │
 └──────────────────────────┘   Deck / ApplyResult │ pptx write.js  Patch → OOXML│
            │                                     │ zip.js / xml.js  自研底层   │
            │ session.prompt(...)                 │ history.js  字节级快照      │
            ▼                                     │ tools.js  4 个模型工具      │
      ┌───────────┐    ppt_canvas_context/apply   │ standalone server.js        │
      │  DeepSeek │ ──────────────────────────────│   独立 loopback :19488      │
      └───────────┘                               └─────────────────────────────┘
```

**两条 HTTP 通道，客户端自动择一。** 插件优先访问自起的独立 loopback 服务
（`127.0.0.1:19488`，端口被占用则顺延），失败才回退到宿主路由 `/dsh ppt/api`。
这样即使宿主的路由表没有注册（受限宿主下很常见），画布也能连上 Host。

**界面层与宿主解耦。** `client/app.js` 里没有任何 DSH 专有 API：`React` / `ReactDOM`
由 `plugin/client.js` 从 DSH 的模块表取，`prompt` 走 `session.prompt`，`apiBase` 指向 Host
通道。`client/app.js` 与 `client/ppt-style.js` 在构建时被内联进 `plugin/client.js`。

关键设计：

  **Host 是唯一权威**。磁盘上的 .pptx 是事实，`rev` 每次成功写盘 +1；客户端永远以 Host 返回的 Deck 覆盖本地模型，所以不存在「三方各说各话」。
  **选区先暂存，再交给 AI**。客户端发指令前把选区 POST 到 `/dsh ppt/api/context` 拿到 `requestId`，AI 只能通过 `ppt_canvas_context(requestId)` 取回——这样用户消息里不需要塞大段 JSON，也便于审计「AI 是否真的读了选区」。
  **校验先于写入**。`applyPatch` 先在内存里跑完整校验与试算，任何一条 op 不合法就整包拒绝并返回逐条原因，文件一个字节都不动。
  **编辑作用在解析出来的原树上**。不是正则替换也不是重建 XML，所以不认识的属性、扩展、关系、母版引用都不会丢；未触碰的页字节级不变（有测试守着）。
  **撤销存字节不存 diff**。OOXML 补丁的逆运算极易失真，回放写盘前的完整字节是唯一无损的做法。

### 为什么不用 npm 依赖

插件以 link 方式安装在 profile 的 `node_modules` 下，解析不到宿主包，也不方便带依赖。
所以 ZIP 读写（`node:zlib` + 自研中央目录解析）、XML 保前缀解析、PPTX 读写全部自研，只依赖 `node:` 内建模块。

   

## 📋 Patch 能力（AI 可用的修改指令）

| op | 作用 |
|     |     |
| `setText` | 替换整段文本（保留原 run 样式，自动处理 `endParaRPr`） |
| `setTextStyle` | 颜色 / 字号 / 粗体 / 斜体 / 下划线 / 对齐 / 字体（同时写 `a:latin` 与 `a:ea`） |
| `setFill` | 纯色填充（`#RRGGBB`），或 `null` 清空 |
| `setLine` | 描边颜色 / 线宽 / 线型 |
| `setGeometry` | 绝对位置与尺寸（px）、旋转角度 |
| `move` / `resize` | 相对位移 / 相对缩放 |
| `align` | 左/水平居中/右/顶/垂直居中/底对齐，水平或垂直等距 |
| `setZ` / `bringToFront` / `sendToBack` | 层级调整（z = 绘制顺序，与 `p:spTree` 顺序一致） |
| `duplicate` / `remove` | 复制（自动分配新的 `cNvPr` id）/ 删除 |

单位约定：**px（96 DPI）**，`1px = 9525 EMU`。完整契约见 [docs/CONTRACT.md](docs/CONTRACT.md)。

   

## 🧪 测试

```powershell
node tools/test-all.mjs
```

七个套件 + 一个同步校验，全绿才算通过（当前 **124 项全绿**）：

| 套件 | 项数 | 覆盖 |
|     |     |     |
| `tests/engine.test.mjs` | 35 | XML 往返、zip 字节级往返、fixture 解析、补丁应用与回读、校验失败不落盘、`dryRun`、撤销/重做字节还原、CJK 空格保真、未触碰页字节不变、母版文本继承、占位符二级几何继承、文字样式保真（逐段/空行/diff）、fill/line/文本类 op 的能力校验 |
| `tests/api.test.mjs` | 33 | 真实 `node:http` 服务器 + 全链路：open → deck → context → apply(dryRun) → apply → history → staleRev → undo/redo → media → selftest；外部改动检测与 `staleFile`、并发写、`/api/files`、render 令牌与越界、非 loopback 拒绝、CSRF（来源白名单 + JSON content-type）、坏 JSON |
| `tests/concurrency.test.mjs` | 8 | 并发 apply 不丢改动、失败不阻断队列、undo 走同一队列、写盘失败不推进游标、包解析缓存失效、context 大小上限、deck LRU |
| `tests/client-harness.mjs` | 18 | 客户端 bundle 冒烟：经典脚本形态、CSS/应用层内联、factory 导出形状、插槽注册、浮窗最小化/展开、标题栏拖动、无选中时发送禁用、会话菜单能渲染、AI 面板多状态、独立窗口入口确已移除 |
| `tests/css.test.mjs` | 4 | CSS 模板结构：大括号配对、规则头未被注释/连接符截断、关键规则仍存在、注释成对 |
| `tests/no-window.test.mjs` | 6 | 独立窗口已移除的回归：窗口模块与 bundle 均已删除、归档文件仍可恢复、host 无窗口路由/启动器残留、面板无入口按钮、`ppt_canvas_window` 已注销、`/api/window` 明确 404 |
| `tests/host-load.test.mjs` | 10 | 安装后加载：`plugin/` 自包含导入、只允许 `./` `node:`、`plugin/index.js` 不得存在（会遮蔽入口）、`apply(ctx)` 装配路由与 4 个工具、缺 `webServer` 时优雅降级、工具可执行、`/api/requests` 诊断、profile 安装位置可解析 |
| `tests/render.test.mjs` | 8 | LibreOffice 精确渲染：`promoteSlide` 外科式改写（其余部件写盘回读后仍一致）、页号↔部件映射、缓存命中与失效；**未装 LibreOffice 时端到端部分会跳过**（见下） |
| `tools/sync-plugin.mjs --check` | — | `plugin/` 是否与 `host/`、`client/` 源同步 |

> ⚠️ `render` 的端到端 3 条依赖本机安装 LibreOffice；没有时会打印 skip 并以 0 退出
> （`test-all` 仍显示 OK）。这是已知的假绿点，尚未加 CI 闸门。


fixture 由 `tools/build-demo-pptx.py`（python pptx，仅用于造测试素材）+ `tools/demo-deck.json` 生成；
插件本身运行时不依赖 Python。

```powershell
$py = "C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
& $py tools/build-demo-pptx.py tests/fixtures/demo.pptx
```

诊断：

```powershell
node tools/inspect-deck.mjs tests/fixtures/demo.pptx          # 打印解析出来的 Deck
node tools/inspect-deck.mjs tests/fixtures/demo.pptx   json   # 完整 JSON
```

运行中自检：`GET http://127.0.0.1:19387/dsh ppt/api/selftest`。

   

## 📁 目录结构

```
dsh-ppt-canvas/
├── package.json              # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml          # loader 行：insert id=ppt-canvas
├── docs/CONTRACT.md          # 冻结契约：Deck / SelectionElement / Patch / HTTP API
├── host/                     # Host 引擎（真源）
│   ├── index.js              # 插件入口：装配独立服务、宿主路由与模型工具
│   ├── standalone server.js  # 自起的 loopback API 服务（127.0.0.1:19488，主通道）
│   ├── api.js                # /dsh ppt/* 路由 + loopback 校验 + 请求诊断环形缓冲
│   ├── deck store.js         # 唯一权威：打开/补丁/撤销/上下文暂存/原子写盘
│   ├── pptx read.js          # OOXML → Deck 模型
│   ├── pptx write.js         # Patch → OOXML（校验先于写入）
│   ├── zip.js                # 自研 ZIP 读写（node:zlib）
│   ├── xml.js                # 自研保前缀 XML 层
│   ├── history.js            # 字节级撤销/重做快照
│   ├── tools.js              # 4 个模型工具
│   ├── demo.js               # 内置演示文稿
│   └── selftest.js           # /api/selftest 报告
├── client/
│   ├── app.js                # 界面层（无 DSH 专有 API，宿主能力靠构造参数注入）
│   ├── client.js             # DSH 客户端插件入口（注入宿主能力 + 浮窗外壳）
│   └── ppt style.js          # 样式（构建时内联进 client bundle）
├── plugin/                   # 随包分发目录（DSH 真正加载这里）
│   ├── host.js               # 入口（host/index.js 的逐字节副本）
│   ├── client.js             # 客户端 bundle（含内联 CSS + 界面层）
│   ├── *.js / *.cjs          # 由 tools/sync-plugin.mjs 从 host/ 同步
│   └── assets/demo.pptx      # 内置演示文稿
├── archive/standalone-window/ # 已移除的独立窗口功能（源文件 + 恢复说明）
├── tools/
│   ├── install profile.mjs   # 装进 DSH profile（junction + bundles，幂等）
│   ├── sync plugin.mjs       # 源 → plugin/ 同步（  check 只校验）
│   ├── build client.mjs      # client bundle 的内联生成
│   ├── test all.mjs          # 跑全部测试
│   ├── build demo pptx.py    # fixture 生成（仅测试用）
│   ├── demo-deck.json        # fixture 设计稿
│   └── inspect deck.mjs      # 打印 Deck 模型
└── tests/
    ├── engine.test.mjs
    ├── api.test.mjs
    ├── client-harness.mjs
    ├── no-window.test.mjs
    ├── host load.test.mjs
```

   

## ⚠️ 限制与已知问题

- **AI 编辑的是原文件**。插件每次写盘前留档在临时目录（可撤销 50 步），但撤销栈不跨 DSH 重启；重要文件请先备份。
- **渲染是保真近似，不是像素级还原**：主题色/母版继承、SmartArt、图表、艺术字、3D、动画不会渲染成最终观感。图表与组合在画布上是占位标记，可以选择、可以移动/删除，但改不了内部数据。
- **文本溢出只给告警**（按 CJK=1.0em / ASCII=0.55em 估算），不会自动缩排。
- **只处理一个打开中的文档**（多文档需要改 `deck-store.js` 的 `current`）。
- **写盘需要文件未被独占**：PowerPoint 打开着该文件时写入会失败，插件会提示并保留方案供重试。
- **AI 可能不调用工具**：如果它只回了一段文字而没调 `ppt_canvas_apply`，插件会提示「AI 没有返回修改方案」并提供重试；属性面板可以直接手动改。
- **浏览器里拖拽拿不到本地路径**：这是浏览器的隐私限制（Chromium 只把本地路径交给 Electron
  渲染进程）。所以面板里的拖拽只在能拿到路径时生效；拿不到时插件会明确提示改用「打开」按钮选文件。
- **独立桌面窗口已移除**：源文件与恢复步骤保留在 `archive/standalone-window/`（含一份说明，
  记录当时踩过的坑，例如 `ELECTRON_RUN_AS_NODE` 必须整键删除、被 vendor 的裸 `electron.exe`
  不提供 `require('electron')`、`plugin/index.js` 会遮蔽真正的入口）。
- **受限宿主下宿主路由可能不注册**：DSH Desktop 会给 WebServer 的路由套一层准入，实测插件路由
  在这类宿主里拿不到请求。因此插件**优先**走自起的独立 loopback 服务（`127.0.0.1:19488`，
  被占用则顺延），宿主路由只作为附加通道。
- **改 host 代码必须重启 DSH**：HMR 默认忽略 `**/node_modules`，而插件就装在 profile 的
  `node_modules` 下 —— 热重载永远不会重新加载它。客户端 bundle 会随页面刷新更新。
- 依赖 Host 的 `webServer` 或 `connection` 服务；`tools` 服务缺失时工具不注册（仅画布可用）。
## 📄 许可证

MIT
