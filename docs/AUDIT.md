# AUDIT — dsh-ppt-canvas 分层审计与修复状态

> 本文是「重新审视 → 重构」这条目标的审计报告。
> 方法：三个并行审计代理（宿主半端 / 客户端半端 / 测试与文档一致性）+ 本机实测测量，
> 每条问题都要求给出**可复现证据**（file:line、测试、命令输出或真实文件实测）。
> 状态图例：✅ 已修复并有用例 · 🟡 已缓解/已显式告警 · ⬜ 已知限制（未修）

## 0. 基线数字（本轮结束时的实测值）

```
测试    engine 40 | concurrency 9 | api 33 | client 24 | css 4 | no-window 6 | host-load 10 | render 9 = 135
提交    38 次（含审计前既有提交）
运行时依赖  dependencies / peerDependencies / optionalDependencies 全为 {}
```

真实文件回归（每次改动后都跑）：

| 文件 | 结果 |
|---|---|
| `Industrial_Agents_Cognitive_Manufacturing.pptx`（8.9MB，纯 TextBox） | 12 页 / 109 形状 / warnings 0 |
| `Lenovo 2026 PPT Template.pptx`（占位符模板） | 10 页 / 39 形状 / 19 占位符 / **几何为 0 的占位符 0** |

---

## 1. 架构与边界

| 问题 | 状态 | 证据 |
|---|---|---|
| `plugin/index.js` 会遮蔽目录包入口（历史事故：加载到旧副本且无报错） | ✅ | `sync-plugin.mjs` 主动删除；`host-load` 用例断言其不存在 |
| `inject` 非空会让 Cordis 静默挂起插件 | ✅ | `host/index.js` 保持 `inject = []`，全部服务走 `ctx.get()` + 判空 |
| 宿主 `/dsh-ppt` 路由在本机恒 404（桌面准入层） | 🟡 | 插件自起 loopback 19488 作主通道，宿主路由只作附加通道 |
| HMR 不覆盖 `node_modules`，改 host 必须重启 | 🟡 | 已写进 HANDOVER §2.1 |
| SSE/事件流与客户端职责混在一起 | ✅ | 拆成 `watchAi`（订阅）/ `aiSnapshot`（读取）/ `adoptAiResult`（落 UI） |

## 2. 正确性（OOXML 与文档模型）

| 问题 | 状态 | 证据 |
|---|---|---|
| **占位符 `.includes` 崩溃**：`placeholder` 是对象却调字符串方法 → 所有带 `<p:ph>` 的文稿打不开 | ✅ | 修后真实模板可读；补 2 条带 `<p:ph>` 的回归用例 |
| **占位符几何为 0**：真实占位符无 `a:xfrm`，几何继承自 layout；layout 常常也没有，真值在 master | ✅ | 两级继承；实测 19 个占位符从「全 0」变为正确几何（title 1046×318 @ 58,151） |
| **占位符写入物化 0×0**：`move/resize` 从 XML 取 0 作基准，把形状压没 | ✅ | 用 deck 的有效几何做基线；实测 `move(50,20)` → `x=108 y=171 w=1046 h=318`（修复前 0,0,0,0） |
| 母版文本默认值未接线（函数定义了但从未调用） | ✅ | 母版继承生效；`lnSpc` / `spcBef` 实测从 undefined → 0.789/13.33px |
| 百分比段距 `a:spcPct` 被丢弃 | ✅ | 新增 `spaceBeforePct`/`spaceAfterPct`；旧测试曾把这个 bug 锁成"正确行为"，已改 |
| `setText`/`setTextStyle` 打在图片/表格/组合上（无文本体） | ✅ | 校验阶段拒绝（此前 setTextStyle 还会"返回 applied 但文件没变"） |
| `setFill`/`setLine` 写入 `p:xfrm` / `p:grpSpPr`（非法 schema） | ✅ | 按元素类型拒绝；实测表格 setFill → `validationFailed` |
| `duplicate` 组合只换顶层 id，子形状 id 重复 | ✅ | 遍历复制体内每个 `cNvPr` 分配新 id |
| `bringToFront`/大 `z` 把形状插到 `p:extLst` 之后 | ✅ | 改为插到 extLst 之前；用例断言 extLst 之后无形状 |
| 连续两次清空空行丢 `endParaRPr` 格式 | ✅ | 兜底链补 `endParaRPr`；用例连续清空两次 |
| `setLine {width}` 删掉原线色 | ✅ | 未提供的字段不再动；用例断言颜色保留 |
| 组合内图片 URL 仍是字面量 `__DECK__` | ✅ | 递归重写；`elementById` 也改递归（两层组合可操作） |
| 页号≠文件名导致渲染错页 | ✅ | `promoteSlide` 按 `sldIdLst` 映射；用例覆盖重排文件 |
| 多母版只取第一个 theme，其他母版取错主题色 | ✅ | 建 `layout→master→theme` 索引逐页取色；母版**文本默认值**仍取第一份（🟡 已告警） |
| `ctrTitle` 匹配不到 titleStyle（大小写） | ✅ | 类型比较改小写 |
| 无 `sldIdLst` 时页序按字典序（slide10 排 slide2 前） | ✅ | 改数字排序 |
| 坏的 `.rels` 让整份文稿打不开 | ✅ | rels 解析纳入容错，降级为 warning |
| `a:bodyPr` 缺失时崩溃 | ✅ | 判空 |

## 3. 安全

| 问题 | 状态 | 证据 |
|---|---|---|
| **CSRF**：恶意页面可用 `text/plain`（免预检）POST 改用户文档 | ✅ | 两道闸：Origin 白名单 + 强制 JSON content-type（强制浏览器预检）；3 条用例 |
| **GET 副作用**：跨站 `<img src=.../render>` 可反复拉起 LibreOffice | ✅ | render 需会话令牌（经 CORS 保护的 `/api/status` 下发）；render 串行化 |
| **zip 炸弹**：`inflateRawSync` 无输出上限，可 OOM | ✅ | 单条 256MB + 全包 1GB 预算；并补此前完全缺失的 CRC 校验 |
| `/api/open` 接受任意文件路径 | ✅ | 只接受 `.pptx`；错误信息用 basename |
| `/api/files` 先落盘再按 80MB 拒绝（留下垃圾） | ✅ | 解码后先校验；失败即删除；文件名加随机后缀 |
| loopback 判定只看 Host 头（宿主绑 0.0.0.0 时可被 LAN 伪造） | ✅ | 追加 `socket.remoteAddress` 校验 |
| 历史快照/上传/渲染缓存无回收，可吃满临时盘 | ✅ | `temp-sweep.js` 启动清理（7 天）+ 渲染缓存淘汰（240 个 PNG / 512MB 上限，中间产物即时删除） |
| `decks`/`contexts` 无内存上限 | ✅ | deck LRU(4) + context 512KB 上限 |

## 4. 健壮性与数据完整性

| 问题 | 状态 | 证据 |
|---|---|---|
| **外部改动被静默覆盖**（PowerPoint 保存后 apply 覆盖它） | ✅ | `/api/status` 轮询 mtime → 自动重载；写入前 `staleFile` 守卫；实测外部覆盖后 apply 被拒且磁盘内容保留 |
| **并发 apply 丢更新**（两次写基于同一旧 buffer） | ✅ | `enqueueMutation` 串行化；绕过队列实测「rev 相同 + 改动 A 丢失」，修复后两笔都在 |
| 排队期间切文档 → 补丁落到另一份文件 | ✅ | 入队前绑定目标 deck，回调内校验（`staleDeck`） |
| undo 先动历史游标再写盘，写失败后状态错乱 | ✅ | undo/redo 改纯查询，写成功才 `commitRestore`；用例用删目录制造写失败，断言 `canUndo`/`rev` 不变 |
| reload 复用旧历史，undo 写回旧快照覆盖外部内容 | ✅ | mtime 漂移时 `history.reset` |
| apply 写盘后 `readDeck` 失败留下「新 buffer + 旧 deck」 | ✅ | 强制重载；重载也失败则让 store 失效 |
| 历史快照非原子写（进程被杀留下截断文件） | ✅ | 临时文件 + rename；读取时拒绝过小文件 |
| `/api/close` 只清 current，历史快照与 buffer 全留 | ✅ | `store.close()` 调 `history.forget` 并清缓存 |
| 渲染缓存键用磁盘 mtime（内容来自内存 buffer） | ✅ | 改用**该页内容哈希**；用例覆盖「内容变才重渲染、不变命中」 |
| zip EOCD 注释长度判断恒真 / 局部头越界抛 RangeError | ✅ | 改严格 `===`；补越界检查 |

## 5. 性能（实测）

| 操作 | 之前 | 现在 | 手段 |
|---|---|---|---|
| `applyPatch` 写盘（8.9MB / 85 条目） | 174.2 ms | **7.3 ms** | 未触碰部件原样复制（raw+method+usize+crc） |
| 渲染暂存包（同文件） | 175.3 ms | **4.5 ms** | `loadPackage` 暴露 `rawOf`，暂存同样走原样复制 |
| 媒体请求（每次全包解压） | 10.4 ms/次 | 命中缓存 | `store.packageOf()` 按 buffer 身份缓存 |
| 上下文大小 | 无限制 | ≤512KB | `putContext` 校验 |

## 6. 测试有效性

| 问题 | 状态 | 证据 |
|---|---|---|
| css 第 4 个用例是空断言（`bad` 从未 push） | ✅ | 改为真正的「注释未闭合」检查 |
| render「其余部件逐字节不变」是同一 Buffer 自比较 | ✅ | 改为写盘再回读比较 |
| render 缺 LibreOffice 时 skip 仍 exit 0（假绿） | ✅ | 退出码 2 约定 + 汇总器 SKIP + `--allow-skip`；用 `DSH_PPT_HIDE_LIBREOFFICE=1` 实测两条路径 |
| 断言锁定错误行为（`spaceBefore === null`、占位符分流空转） | ✅ | 改为可区分的真断言（title 0% vs body 20%、indent null vs 36） |
| 假 React 的 `useEffect` 立即 cleanup → 轮询/等待不可测 | ✅ | 改真实语义 + 可调度 `timeout/interval` + 可编排 fetch |
| 关键路径零覆盖：外部改动轮询、发送后释放、对话框取消、编辑器 ×zoom、失焦提交、watchAi 泄漏 | ✅ | 新增 8 条回归（都验证过"先能失败"） |
| 客户端 no-window / host-load 等骨架测试 | ✅ | 保持 |

## 7. 文档一致性

| 问题 | 状态 | 证据 |
|---|---|---|
| README 命令被去连字符破坏（16 处，如 `tools/sync plugin.mjs`） | ✅ | `tools/fix-readme-commands.mjs`（幂等，可 `--check`） |
| README 写「99 项 / 四个套件」（实为 135 / 九个） | ✅ | 表格重写，逐套件列真实覆盖 |
| CONTRACT 与代码不符：`Enter` 语义、`sessions.binding()`、工具返回 `path` vs `file`、`selectionMode` 枚举、`fill.alpha`、`opacity` | ✅ | 全部按代码对齐（`Enter` 发送是用户明确要求，改的是文档） |
| CONTRACT 缺 `/status` `/files` `/render` `/close` `/requests`、`staleFile`/`staleDeck`/`forbiddenOrigin`、415 | ✅ | 补齐路由与错误码表 |
| HANDOVER 基线过期、新增机制未记录 | ✅ | 基线同步 + 新增「机制表」与四条写操作不变量 |

## 8. 已知限制（未修，均已显式化）

| 限制 | 说明 |
|---|---|
| 多母版的**母版文本默认值**只取第一份 master | 主题色已逐页正确；文本默认值仍取第一个 master，多母版时输出 warning |
| 图表 / SmartArt 不解析 | 精确渲染（LibreOffice）下显示正确；「渲染：内置」模式只画占位徽标 |
| 文本溢出只告警不缩排 | 未实现 `normAutofit` 缩字号 |
| 项目符号 `a:buChar` 不渲染 | 精确渲染下可见；内置模式缺失 |
| 单文档 | 同一时间只操作一份演示文稿 |
| 文件被 PowerPoint 独占时写盘失败 | 有明确报错 |
| 浏览器拖拽拿不到本地路径 | 已改为 `<input type=file>` + 内容上传（Electron 下仍用 `file.path`） |

## 9. 复核方式

```powershell
$node = "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$dev  = "D:\deepseek harness plugin\dsh-ppt-canvas"

& $node "$dev\tools\test-all.mjs"              # 135 项；缺 LibreOffice 会显示 SKIP 且非 0
& $node "$dev\tools\sync-plugin.mjs" --check   # plugin/ 与源码是否同步
& $node "$dev\tools\probe-placeholder-write.mjs"  # 占位符写入几何（真实模板）
& $node "$dev\tools\probe-external-edit.mjs"    # 外部改动检测 + staleFile（需重启后的宿主）
& $node "$dev\tools\probe-unused-imports.mjs"   # 未使用导入
& $node "$dev\tools\fix-readme-commands.mjs" --check  # README 命令是否被破坏
```
