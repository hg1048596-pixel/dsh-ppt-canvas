# 已归档：独立桌面窗口（standalone window）

## 为什么在这里

这个插件最初包含一个「把画布弹成独立 Electron 桌面窗口」的功能 —— 无系统标题栏、
可自由拖到任意屏幕、位置跨重启记忆。**该功能已按要求整体移除**，源文件保存在本目录，
以便将来需要时恢复。

移除的原因是部署环境：DSH Desktop 给 WebServer 的所有路由套了一层准入，
而插件在宿主侧的可观测性极差（读不到宿主 stdout、探测全被准入层挡回空 404/405）。
独立窗口这条链路因此长期无法验证，最终按用户决定撤掉，先把画布面板做扎实。

## 这里有什么

```
host/
  window-launcher.js     Electron 运行时发现链（DSH_PPT_ELECTRON → profile vendor → 全局 → cwd）
                         + CanvasWindow 进程管理与状态持久化
  window.cjs             Electron 主进程脚本：frameless 窗口、拖动/缩放、位置上报、
                         跟随宿主 PID 退出、外链交给系统浏览器
  window-preload.cjs     contextBridge 暴露最小化/最大化/关闭/置顶
  window-geometry.cjs    换屏与越界钳制、位置解析（CJS，供 window.cjs require）
client/
  window-app.js          窗口入口：把迷你渲染层包成 React/ReactDOM 后调 createPptApp
  window-bundle.js       生成的单文件 bundle（CSS + 迷你渲染层 + app.js + 窗口入口）
  mini-react.js          迷你 React 运行时（无 React UMD 可用、CDN 被墙时手写的兼容子集）
  app.js                 当时的界面层（含 IS_WINDOW 分支）
  ppt-style.js           当时的样式（含 .dsh-ppt-window / .dsh-ppt-winbtn）
tests/
  window.test.mjs        18 项：窗口摆放数学、运行时发现链、/dsh-ppt/window 路由、bundle 内容
  mini-react.test.mjs    14 项：迷你渲染层的 children/属性/hooks/增量更新语义
tools/
  sync-client-css.mjs    当时的构建脚本（同时产出面板 bundle 与窗口 bundle）
                         —— 现已被 tools/build-client.mjs 取代（只产出面板 bundle）
```

## 恢复时必须注意的坑（都是踩过的）

1. **`ELECTRON_RUN_AS_NODE` 必须从子进程环境里彻底移除。**
   本机 DSH 进程把它设成了 `'1'`。设成 `''` 或 `'0'` **都不行** —— 实测 Electron 33
   在这两种情况下依然退化成纯 Node 模式，此时进程里没有内建 API，
   `require('electron')` 抛 `MODULE_NOT_FOUND`，窗口以 `0x80000003` 秒退。
   唯一可靠的做法是重建 env 对象并跳过这个键。

2. **被 vendor 的裸 `electron.exe` 不提供 `require('electron')`。**
   那个模块由 npm 包装包提供。`dsh-pet-remielle/vendor/electron-win32-x64` 只有二进制，
   所以主脚本必须能拿到内建 API 而不能依赖模块名解析（当时的做法是
   `electronModuleFor()` 解析出包装包绝对路径，再用 `DSH_PPT_ELECTRON_MODULE` 传给脚本）。

3. **`plugin/index.js` 绝不能存在。**
   Node 解析目录包时优先命中 `index.js`。当时的同步脚本把 `host/index.js` 同时写成了
   `plugin/host.js` 和 `plugin/index.js`，宿主于是加载了那个停在最早版本的副本，
   而且**没有任何报错** —— 这个坑排查了很久。`tools/sync-plugin.mjs` 现在会主动删除它，
   `tests/host-load.test.mjs` 也会断言它不存在。

4. **要在 DSH 的 HMR 忽略规则之外才可能热重载。**
   HMR 默认 `ignored: ["**/node_modules", "**/.*", "cache", "data"]`，
   而插件装在 `profile/node_modules/` 下 —— 改 host 代码**必须重启 DSH** 才会生效。

5. **沙箱里管道式 stdio 会被拒（`spawn EPERM`）。**
   受限模式下降级为 `stdio: 'ignore'` 重试，先保住「能开窗」，
   代价是拿不到子进程上报的位置（改为窗口自己落盘）。

## 恢复步骤

```powershell
$arc = "archive\standalone-window"
Copy-Item "$arc\host\*"    "host\"    -Force
Copy-Item "$arc\client\*"  "client\"  -Force
Copy-Item "$arc\tests\*"   "tests\"   -Force
Copy-Item "$arc\tools\sync-client-css.mjs" "tools\" -Force
```

然后需要重新接线（这些改动**没有**被归档保留，是本次移除时删掉的）：

- `host/index.js`：重新 import `CanvasWindow`，构造并传给 `registerRoutes` / `registerTools`；
- `host/api.js`：恢复 `/window`、`/window-bundle.js` 路由与 `handleWindow`；
- `host/tools.js`：恢复 `ppt_canvas_window` 工具；
- `client/client.js`：恢复 `onOpenWindow` 与 `openWindow`；
- `client/app.js`：恢复 `IS_WINDOW` 分支与 `windowControls` 标题栏按钮；
- `client/ppt-style.js`：恢复 `.dsh-ppt-window` / `.dsh-ppt-winbtn` 规则；
- `tools/build-client.mjs`：重新加回窗口 bundle 的产出；
- `tools/test-all.mjs`：把 `window` / `mini-react` 两个套件加回列表。

`tests/no-window.test.mjs` 会在恢复后失败 —— 那是设计如此：它是「移除是否彻底」的
回归检查，恢复功能时应当一并删除或改写。
