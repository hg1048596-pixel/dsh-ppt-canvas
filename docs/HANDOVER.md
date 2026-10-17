# HANDOVER — dsh-ppt-canvas 交接文档

> 给接手的 agent。本文档只写**实测验证过的**事实，凡属推测会明确标注。
> 最后更新：2026-10-17，由完成了「原生 PPT 级就地编辑」十轮迭代的 agent 写下。
> 逐轮的详细过程记录在 WorkBuddy 工作区日志：
> `C:\Users\Hanson Gao\WorkBuddy\2026-10-15-00-23-54\.workbuddy\memory\2026-10-15.md`

---

## 1. 这个项目是什么

一个 **DSH（DeepSeek Harness）插件**，功能是「用户与 AI 协同编辑 PPT」：

- 在画布上**点选 / Shift 多选 / 框选** PPT 元素（文字、色块、图片、表格…）
- **单击文字形状就地编辑**（光标落在点击行，直接打字，Esc 取消）——2026-10-15 新增
- **拖动移动元素**（含多选整组，ghost 预览，松手提交 move op）——2026-10-15 新增
- 把「选中元素属性 + 自然语言指令」交给 AI，AI 通过工具调用返回**结构化修改方案**
- 方案直接落到 `.pptx` 文件并刷新画布；**提交后 DOM 桥接**（立即看到新文字，PNG 好了自动切回）
- 支持撤销重做、错误处理；**渲染异常有错误边界兜底（不再整面板消失）**

**当前状态：核心链路可用，就地编辑体验经过三轮真实管线验证；遗留项见第 6 节。**

---

## 2. 环境与运行时事实（最重要，先读这节）

| 项 | 值 |
|---|---|
| 工作区（插件开发树） | `D:\deepseek harness plugin\dsh-ppt-canvas` |
| DSH checkout | `D:\deepseek harness desktop official\resources\app.asar\dsh\` |
| DSH profile | `C:\Users\Hanson Gao\.dsh\profiles\desktop` |
| 插件安装位置 | `<profile>\node_modules\dsh-ppt-canvas` |
| 安装方式 | `package.json` 里 `"dsh-ppt-canvas": "link:..."`（junction，**不是拷贝**） |
| GUI | `http://127.0.0.1:19387`（有鉴权，401；自动化测试别走这条路，见 4.7） |
| 独立通道（插件自起 HTTP） | `http://127.0.0.1:19488`（占用则顺延 19489-19492） |
| Node | `C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| 版本控制 | **有 git 了**（2026-10-15 初始化，逐轮提交）。提交身份用 `git -c user.name=... -c user.email=...` 临时指定，**不要动全局配置** |

### 2.1 五个必须知道的坑

> ⚠️ **写操作的四条不变量**（2026-10-17 审计补，改动 deck-store 前必读）：
> 1. apply/undo/redo 都走 `enqueueMutation`（串行）；
> 2. 入队前捕获目标 `open`，回调里校验 `this.current === open`（否则 `staleDeck`）；
> 3. 落盘前 `assertUnchangedOnDisk`（否则 `staleFile`），且**必须在动 history 游标之前**；
> 4. 外部 mtime 变化后 `open()` 会 `history.reset`，避免撤销写回旧快照。


1. **`plugin/index.js` 绝对不能存在**（历史事故：目录包解析优先命中旧副本且无报错）。
   `tools/sync-plugin.mjs` 会主动删除它。
2. **改 host 代码必须重启 DSH**（HMR 忽略 node_modules）。client 改动刷新页面即可。
   **重启方式（实测可靠）**：
   ```powershell
   Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force
   Start-Sleep -Seconds 3
   explorer.exe 'D:\deepseek harness desktop official\DeepSeek Harness.exe'
   Start-Sleep -Seconds 16   # 然后轮询 health
   ```
   **GUI 程序一律走 `explorer.exe` 启动**——shell 会话注入的 `ELECTRON_RUN_AS_NODE` /
   `NODE_OPTIONS` 会让 Electron 以纯 Node 模式启动即退（无窗口无报错）。
3. **`inject` 数组会让插件永久挂起**（历史事故）。`host/index.js` 保持 `inject=[]`。
4. **CSS 是普通字符串，语法错误完全静默**（`tests/css.test.mjs` 守着）。
5. **模型 API 的 function schema 按严格模式**（2026-10-15 两轮实测）：
   - 参数不能用 `type:'json'`（编译成无 type 节点，API 报 `got 'type: null'`）
   - **布尔 `additionalProperties: true` 也会被 API 拒**（同样报 type: null）——
     必须**完整声明 properties + `additionalProperties: false`**，数组 items 内不放 `required`
   - 根节点必须是 `type: 'object'`
   - **`host/tools.js` 里现在有两条写法，别混**：
     - `ppt_canvas_apply` 的 `patch` 是**手写完整 schema**（嵌套 `additionalProperties:false` 全显式）
     - 其余三个工具的 `parameters` 写**简写**（`{ path: {type:'string'} }`、属性里 `required:true`），
       由 `registerTools` 出口的 `parameterSchema()`/`compileSchema()` **编译**成合法 JSON Schema
       （`host/tools.register` 对 parameters 是**原样透传**，不编译 —— 简写直传会让根节点没有 type 而被 API 拒）
     - 简写里的 `required: true` 会被上提成父级 `required` 数组；**属性自己的 schema 里不能留布尔 required**
   - 验证只看 `health.toolRegistration`（**不要**用 `Tool.listTools`，它只返回 Agent 可见的工具）
   - 快速自检（不重启也能验）：用一个只收集的桩跑 `registerTools`，打印各工具的
     `parameters.type` / `required` / `properties` 数量，见 7 节命令

### 2.2 宿主能力：实测「有」与「没有」

**可用：**
- `ctx.get('tools')` → 工具注册（`register` / `get` / `schemas`；**没有 `call`**）
- 客户端 `sessions`：`retain(id,{source})` → `reference.ready` → `binding.session.prompt(content,'queue',signal?,requestId?)`，用完 `release()`
- 客户端 `sessions.list` → ObservableSnapshot（`{ ids, byId, phase, projectionsBySession }`）
- 客户端 `uiWorkspace`：`listDirectory` / `pickDirectory` / `insertSessionBefore`（条目**无 kind 字段**，目录/文件按名字里有无 `.` 启发式区分）

**没有 / 不可用：**
- 宿主 `/dsh-ppt` 路由 404（DSH Desktop 准入层）→ 主通道是自起 loopback 19488
- **没有「新建会话」入口**（startSession/create/fork 实测都拿不到 id）→ 现状是"从真实列表选一个连上"
  - **会话自愈（2026-10-15 新增）**：`retain` 报 `unknown session`（宿主重启后面板记着旧 id）时，
    自动改连列表里最新的会话、同步 store 并持久化、重试一次；列表空时给可操作提示
- 没有选择文件的系统对话框（只有目录）；PowerPoint COM 打不开受保护视图的文件

---

## 3. 命令速查

```powershell
$node = "C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$dev  = "D:\deepseek harness plugin\dsh-ppt-canvas"

# 全部测试 + 同步检查（健康度基线）
& $node "$dev\tools\test-all.mjs"
& $node "$dev\tools\sync-plugin.mjs"          # 改完源码必须跑
& $node "$dev\tools\inspect-deck.mjs" <deck.pptx> [--json]
& $node "$dev\tools\probe-xml.mjs" <deck.pptx> <匹配文本> [slideN]
& $node "$dev\tools\probe-runs.mjs" <deck.pptx> <slideN> <形状名片段>   # 逐 run dump 样式
& $node "$dev\tools\probe-damage.mjs" <deck.pptx>                    # 扫可疑字号切分
& $node "$dev\tools\debug-copy.mjs"           # 复制当前文档到 debug/ 供诊断

# 诊断插件装配（重启 DSH 后看这个）
(Invoke-WebRequest "http://127.0.0.1:19488/dsh-ppt/api/requests" -UseBasicParsing).Content
# → health.toolRegistration 应为 "ok"，4 个工具

# 不重启验证 schema 是否合法（用一个只收集不注册的桩）
& $node --input-type=module -e "const m=await import('file:///D:/deepseek%20harness%20plugin/dsh-ppt-canvas/host/tools.js');const c=[];m.registerTools({register:d=>{c.push(d);return()=>{}}},{},{emit(){}},{info(){},warn(){}});for(const d of c)console.log(d.name.padEnd(22),'type='+d.parameters.type,'required='+JSON.stringify(d.parameters.required??null))"
```

**当前测试基线（全绿）：**

```
engine 37 | concurrency 9 | api 33 | client 18 | css 4 | no-window 6 | host-load 10 | render 8 | sync OK（共 125 项）
```

> 注意 `render` 的端到端 3 条**需要装有 LibreOffice**；没装时该套件会打印 skip 并以 0 退出
> （`test-all` 仍显示 OK）—— 这是已知的假绿点，尚未加 CI 闸门。

engine 里 3 个用例守着**文字样式保真管线**（逐段样式沿用 + 空行不带 run + 逐字符 diff 映射，见 5.5）；
另有 2 条守**母版继承**、1 条守**占位符二级几何继承**、2 条守**带 `<p:ph>` 的课件能读**。

**2026-10-17 审计后新增的机制（务必先读）：**

| 机制 | 位置 | 要点 |
|---|---|---|
| 外部改动检测 | `GET /api/status` + `deck.fileMtimeMs` | 客户端每 4s 轮询；`changed=true` 自动 `deck{force:true}` 重载。**外部保存不会改宿主 rev**，所以判据是 mtime 不是 rev |
| 写入守卫 `staleFile` | `deck-store.assertUnchangedOnDisk` | apply/undo/redo 落盘前比对 mtime；文件被 PowerPoint 保存过就拒绝写入（409），不覆盖别人的修改 |
| 排队绑定 `staleDeck` | `deck-store.apply/undo/redo` | 入队前捕获目标文档；排队期间 `/api/open` 换了文档就放弃本次写入（否则会写到另一份文件上） |
| 写操作串行化 | `deck-store.enqueueMutation` | apply/undo/redo 串行执行，防 lost update（并发双写会丢改动、历史出现重复 rev） |
| CSRF 两道闸 | `api.js isAllowedOrigin` + `hasJsonContentType` | 非白名单 Origin 一律 403；POST 必须 `application/json`（强制浏览器走预检）。**只省 CORS 头挡不住副作用** |
| 占位符几何继承 | `pptx-read.readLayoutPlaceholders` | slideLayout → slideMaster 两级。真实 PPT 的占位符`<p:spPr/>` 没有 `a:xfrm` |
| 占位符**写入**基线 | `pptx-write.baseGeometry` | 无 xfrm 时用 deck 模型（含继承）的几何做 move/resize/align/duplicate 的基准，绝不物化 0×0；取不到就拒绝 |
| render 令牌 | `api.js renderToken` + `GET /api/status` | render 是 GET 且有重副作用（spawn LibreOffice）；跨站 `<img>` 不带 Origin，只能靠令牌区分。令牌经 CORS 保护的 status 下发 |
| render 串行化 | `api.js renderQueue` | 同时只起一个 soffice，避免抢同一个 profile |
| zip 预算 | `zip.js MAX_ENTRY_INFLATED_BYTES` / `MAX_TOTAL…` | 单条 256MB、全包 1GB，并校验 CRC；防 zip 炸弹 |
| 临时区清理 | `host/temp-sweep.js` | 启动时删除超过 7 天的 picked/render/历史快照（此前无界增长） |
| 面板错误条 | `app.js` `.dsh-ppt-errorbar` | `state.error` 常驻可见（不是 6s 消失的 toast） |


---

## 4. 架构

### 4.1 目录与职责

```
dsh-ppt-canvas/
├── host/                 ← 宿主半端真源码
│   ├── pptx-write.js     ★ setTextBody：文字样式保真管线（本任期核心，见 5.5）
│   ├── tools.js          ★ 4 个模型工具（schema 必须严格模式，见 2.1.5）
│   ├── api.js / deck-store.js / pptx-read.js / render.js / history.js
│   ├── xml.js / zip.js / selftest.js / demo.js / standalone-server.js
├── client/
│   ├── app.js            ★ createPptApp()：全部 UI（就地编辑/拖动/DOM 桥接/错误边界）
│   ├── client.js         ★ 会话适配层（retain/promptTo + 会话自愈）
│   └── ppt-style.js
├── plugin/               ← 构建产物（sync 生成），不要直接改
├── tests/                engine / api / client-harness / css / no-window / host-load / render
├── tools/                构建、同步、测试、诊断
├── docs/CONTRACT.md      ★ 冻结契约
└── debug/                诊断产物（含用户文件副本 repro.pptx，注意隐私）
```

**外部复现环境（本任期搭建，WorkBuddy 托管 node 工作区）**：
`C:\Users\Hanson Gao\.workbuddy\binaries\node\workspace\`
- 已装：react@18.3.1、react-dom、jsdom、playwright-core；系统 Chrome 在
  `C:/Program Files/Google/Chrome/Application/chrome.exe`（playwright 用 `executablePath` 指定）
- `repro-server.mjs`：静态页挂 bundle + React UMD + 用户 deck；**/real-apply 跑真 applyPatch**（真实写入管线）；bundle 每请求从磁盘读（改 client 刷新即生效）
- `repro-shrink.mjs`：playwright 真实鼠标点击 + N 轮编辑 + 逐段 dump 字号
- `repro-real.mjs`：jsdom + 真 React 渲染（抓渲染期异常）
- ⚠️ 坑：**孤儿进程占 19999** 会让新服务 EADDRINUSE 静默失效、复现打到旧状态——
  每次起服务前 `netstat -ano | grep 19999` 查一下；复现前先确认初始状态干净
- ⚠️ jsdom 坑：HTMLElement 缺 `oninput` 探针 → React 误走 IE 垫片报 attachEvent 错；
  修复：`Object.defineProperty(HTMLElement.prototype, 'oninput', {...})`（repro-real.mjs 里有）

### 4.2 客户端 bundle 加载约定

`plugin/client.js` 是 **classic script**，`window.__ModuleLoader__?.load({ id, factory })`，
factory 只收 `require`、返回值即 exports（`return { inject, apply }`）。**绝不能引用 module/exports**。

### 4.3 通道选择

`callApi` 按 `channelChoice` 择一（host `/dsh-ppt/api` → standalone 19488），
`network`/`badResponse` 才换通道；业务错误原样抛。

### 4.4 精确渲染（render.js）—— 决定性实测

1. LibreOffice `--convert-to png` **只导出第 1 页**且忽略 PageRange → 逐页渲染要把第 N 页**外科式提升**为第 1 页（只动 slide1.xml + rels，其余部件逐字节不动，render.test.mjs 断言）
2. 每页约 **1.3 秒**（预热后）；两个 LibreOffice 共用 profile 会互相卡死 → 独立 profile
3. 缓存键 = `路径|size|mtime|page|width` sha1 前 16 位

### 4.5 画布缩放 —— 三个实测坑（都踩过）

1. **`.dsh-ppt-slidewrap` 用 CSS `zoom`**（`transform: scale()` 不改布局尺寸，无法居中）
2. **textarea 不继承 zoom 容器的缩放**（Chromium 对表单控件的 zoom 继承不可靠，实测）——
   所以就地编辑器渲染在**未缩放的 `.dsh-ppt-canvas`** 里，坐标/字号/内边距由
   `textEditStyle(shape, zoom)` **手动 ×zoom**。放进 slidewrap 会按幻灯片原尺寸错位。
3. `localPoint` = `getBoundingClientRect()`（已含缩放）`/ zoom` → 幻灯片坐标。

### 4.6 坐标空间

`shape.geometry` 是幻灯片 px（EMU/9525），原点幻灯片左上角。命中测试/框选/高亮框/编辑器同坐标系。

### 4.7 就地编辑器（本任期核心特性，架构一句话）

单击带文字的形状（无拖动、非加选）→ `state.editingId` 置位 → 在 `.dsh-ppt-canvas` 里
叠一个 `textarea`（`textEditStyle` 手动 ×zoom 定位到形状几何上）→ 聚焦打字 →
失焦提交 `setText`（走 apply → 撤销历史 → PNG 重渲染）→ **DOM 桥接期** DOM 全量渲染顶上，
新 PNG `onLoad` 后切回精确渲染。Esc 取消不提交。

关键细节（全部实测踩过）：
- **光标放到点击的「有字的行」**（`state.editCaret` 记点击点的幻灯片坐标）——
  文本框常以空行开头，光标若落第 0 字符，打字会进无样式空段
- **编辑器字号用整框 dominant 主字号**（`dominantRunStyle` 跨段统计），
  空首行不会把整框拉成 18px 默认
- **`focus({ preventScroll: true })` + 滚动复位**：Chromium 对 zoom 容器内聚焦会按
  未缩放坐标 scroll-into-view，把画布容器滚出内容区（表现为"画板消失"）
- **垂直锚点补偿**：middle/bottom 按 行数×行高 推首行位置（textEditStyle 与
  光标行计算两处同公式，改一处必须同步另一处）
- **编辑器底色**：形状有纯色填充用填充色，否则半透明白盖住底图旧文字

### 4.8 错误边界（防整面板消失）

`PanelErrorBoundary`（class 组件）包住 Panel 的三个挂载点（FloatingPanel / install×2）。
渲染异常显示在面板上（含重试/刷新），`componentDidCatch` 同步堆栈到 console；
`install()` 另挂全局 `error`/`unhandledrejection` 钩子把异常打进面板日志。
背景：就地编辑上线时一个残留 `ref` 引用让整棵树卸载、面板无声消失——
**harness 的假 React 抓不到这类错**（不下钻函数组件），需要真 React（4.7 的复现环境）。

---

## 5. 关键约定

### 5.1 Deck 模型 / 补丁格式是**冻结契约**

`docs/CONTRACT.md`。要点：坐标 px（EMU/9525）；z-order = spTree 子顺序（首个 = 底层）；
`setText` 用 `paragraphs:[{runs:[{text}]}]`；`apply` body = `{patch:{summary,ops}}`；颜色 `#RRGGBB`。

### 5.2 排版继承链：排版信息大量在母版里

`readMasterTextDefaults()` → `context.masterText` → 按 kind 选 titleStyle/bodyStyle。
规则：段落自己写了用段落的；没写用母版的；都没有就 null **绝不编造**。
两项回归测试守着（其中一项断言"至少一个段落从母版承接到了缩进"——**断言被调用，不只断言存在**）。

### 5.3 修排版问题的正确工作流

1. `tools/debug-copy.mjs` 复制用户实际文件进 debug/
2. `tools/probe-xml.mjs` 看原始 OOXML
3. `tools/inspect-deck.mjs --json` 看 Deck 模型
4. 文件里有但模型没有 = 读取丢（改 reader）；模型有但画布不对 = 渲染问题（改 renderer）
5. 给差异写测试再修

> 本任期验证：这条流程 + 真实浏览器复现（4.7 外部环境）是唯一有效路径。
> 凡是"用户报症状 → 凭经验猜 → 改错地方"的轮次全部返工。

### 5.4 沟通与用户偏好

- 中文回复；**不接受猜测式修复**，每轮要可验证结论
- 简短指令推进多步骤流程（"改"、"先别插图"）；关键技术决策先确认再执行
- 失败原因要**直接可见**（界面上/health/日志），不接受"无声消失"

### 5.5 文字样式保真管线（`pptx-write.js setTextBody`，本任期核心，逐条都是实测教训）

客户端 `setText` 只发 `{runs:[{text}]}`（就地编辑/属性面板/AI 三条路径都一样），
**所有格式保真都在写入端**。当前实现的四条规则（每条对应一个用户报过的 bug）：

1. **逐段映射**：新段落 i 对应旧段落 i（越界沿用最后一个旧段），
   pPr 与 run rPr 克隆保留。—— 否则空首行把整框拉平成默认值（"改一个字丢排版"）
2. **空行不带 run**：拼接文本为空的段落只输出骨架（pPr 照旧）——
   空 run 会按继承到的字号把空行撑高一行，内容整体下移（"内容整体下降一行"）。
   例外：该行原本有带格式文字（被清空）→ 用 `endParaRPr` 克隆原格式保行高（PowerPoint 存法）
3. **兜底链**：映射段首 run rPr → 该段 endParaRPr（**必须真带格式**：有 sz 或 solidFill，
   否则继续）→ 向后/向前找最近带样式 run 的段 —— 否则空行打字渲染成母版默认字号
   （"打两轮字突然变小"）
4. **前缀/后缀 diff 逐字符映射**：公共前缀/后缀的字符各守原 run 样式（边界不动）；
   被替换区域取**光标前一个字符**的样式（PowerPoint 语义：新输入沿用插入点之前的格式）。
   —— 之前用 `min(i, 旧长-1)` 的偏移 clamp 映射，中间插入/删除会把样式边界整体推移
   一格，混排行全乱（"字体忽大忽小排版全乱"，用户文件实际受损，见 6.2）

op 里显式给的样式字段（color/fontSize/…）一律优先于映射结果。
**任何改动先跑 engine 里那 3 个保真用例。**

---

## 6. 已知问题与未完成项（★ 接手重点）

### 6.1 ~~用户文件里的既有损伤~~ → 已核实为**误判**（2026-10-17 复核）

上一版这里写着「损坏写进了用户文件，需修复」。**经复核，该结论不成立**，证据如下（全部可复现）：

| 检查 | 结果 | 含义 |
|---|---|---|
| `debug/repro.pptx`（10-15 00:52 副本）与 `C:\Users\Hanson Gao\Desktop\Industrial_Agents_Cognitive_Manufacturing.pptx` 的 SHA256 | **完全相同** | 自副本以来文件未被写过 |
| 桌面原件文件系统 mtime | **2026-02-04 20:10**（10 月从未变过） | `writeAtomic` 用 `writeFile`+`rename`、**不保留 mtime**，写过就必然是 10 月 |
| 撤销历史快照目录是否有该文件的 key（`8f70718f52d8`） | **没有**（目录里只有 4 个别的 key） | 历史在首次落盘时创建；没有 = 从没 apply 过补丁 |
| 文本层面 | p3 的 `'t o`（多出空格）、p1 的 `technologies   enables` | 样式边界 bug **只改字符归属哪个 run，不会增删字符** |

即：`textbox 132` / `textbox 176` 里那些「同段多字号」是**作者原始排版**（p7 run5-8 是作者把半句调成 32，
p10 同理），`'Automated't o` 这类是**作者原始笔误**，都早于插件存在。

> ⚠️ 试过但**无效**的判据（避免下一位重复走）：ZIP 条目时间戳。我们的 `writeZip` 固定写
> `DOS_DATE=0x0021`（1980-01-01，为了确定性输出），与 PowerPoint 自己写的值相同，**无法区分**。
> 判断「文件有没有被我们写过」用上面三条（哈希 / mtime / 历史快照），不要用 ZIP 时间。

**结论：不需要处理，也不要再向用户提「修你文件里的损伤」** —— 那是他原本的内容。
若用户主动说某处文字不对，按正常改字流程处理即可。

复核工具：`tools/probe-damage.mjs`（扫可疑切分）、`tools/probe-runs.mjs`（逐 run dump 样式）。

### 6.2 架构边界（与原生 PPT 的差距，已向用户如实说明）

| 边界 | 现状 | 突破条件 |
|---|---|---|
| 打字不逐键重渲染 | 提交（blur）才落盘；DOM 桥接把感知差缩到最小 | LibreOffice 1.3s/页，逐键渲染不现实；要实时重排需内置排版引擎 |
| 编辑器字体度量近似 | 用模型 fontFamily + dominant 字号；模型缺主题字体（`+mj-lt`/`+mn-lt` 未解析，6.3）时回退 | 解析主题字体（6.3），或内嵌字体 |
| 单 textarea 无法逐段显示不同字号 | 用 dominant 主字号近似 | 需 contentEditable/富文本引擎 |
| 多行增删时段落样式按 index 映射整体平移 | 单次编辑场景无感知 | 需按编辑位置的树级 diff |

### 6.3 未完成：其他 OOXML 特性

项目符号 `a:buChar/buAutoNum`、悬挂缩进、**主题字体 `+mj-lt`/`+mn-lt`**（做编辑器字体匹配的前置）、
`normAutofit` 缩字号、表格单元格填充/边框、形状旋转在 Client 的应用确认。
精确渲染模式下对"看"影响小；对 DOM 桥接期（全量 renderShape）仍有影响。

### 6.4 已解决（历史条目，勿重复排查）

- 工具注册（`health.toolRegistration = ok`，4 工具，已多轮验证）
- 母版文本默认值继承（5.2，已修，回归测试在）
- 画布居中/对齐、图片显示、精确渲染（用户已确认）
- 面板消失、编辑器 zoom 错位、突然变小、内容下移、字体忽大忽小（本任期逐个修复，git 历史可查）
- `sessions.retain: unknown session`（会话自愈已实现）

### 6.5 可清理的临时产物

- `debug/`（含用户文件副本 repro.pptx，**清理前确认隐私**）
- `.windowtest/`、`tools/_*.js`（宿主源码摘录，只读参考）、`tools/.probe/`、`tools/_scdir/`

### 6.6 单文档限制

同一时间一份演示文稿；被 PowerPoint 占用时写盘失败（有明确报错）。

---

## 7. 一次典型改动的完整流程

```powershell
$node = "C:\Users\Hanson Gao\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$dev  = "D:\deepseek harness plugin\dsh-ppt-canvas"

# 1) 只改 host/ 与 client/（plugin/ 是 sync 产物）
# 2) 同步 + 全部测试
& $node "$dev\tools\sync-plugin.mjs"
& $node "$dev\tools\test-all.mjs"
# 3) host 改动 → 重启 DSH（见 2.1.2）；client 改动 → 刷新页面
# 4) 验证 health + 实际点一遍；需要真实渲染验证时用 4.7 的复现环境
# 5) git 提交（-c 指定身份）
```

**任何时候都不要用 PowerShell 的 `Set-Content`/字符串替换重写源码**（历史上多次破坏
UTF-8 中文与反引号）。一律用编辑工具或 `tools/*.mjs`。
**测试 harness 的假 React 抓不到真实渲染期错误**——涉渲染树改动的验证要过 4.7 的
真 React/jsdom 或 playwright 环境。

---

## 8. 快速定位表

| 症状 | 先查 |
|---|---|
| 面板整个消失/白屏 | 面板日志条 + console（PanelErrorBoundary 会显示错误）；用 4.7 真 React 复现 |
| 点击文字没反应/编辑器错位 | `textEditStyle` 的 ×zoom；textarea 是否在未缩放 canvas 里（4.5.2） |
| 改字后排版/字号乱 | `setTextBody` 四条规则（5.5）；engine 3 个保真用例 |
| 内容整体下移 | 空行是否带了 run（5.5 规则 2） |
| 工具调用被 API 拒（type: null） | 参数 schema 是否有布尔 additionalProperties/无 type 节点（2.1.5） |
| unknown session | 会话自愈是否生效；`sessions.list` 快照是否为空 |
| 按钮灰、无反应 | 界面原因文本 + `sessionDiagnostics` + `health` |
| 插件完全不工作 | `plugin/index.js`；inject 非空；host 改后是否重启 |
| 高亮框错位 | slidewrap 缩放方式（必须 zoom）；localPoint /zoom；textarea 是否漏乘 zoom |
| 排版不对 | 5.3 流程：原始 XML ↔ Deck 模型对照 |
| 样式静默失效 | `tests/css.test.mjs` |
