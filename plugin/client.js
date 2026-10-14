/* dsh-ppt-canvas — Client half（DSH 对话面板入口）
 *
 * 把共享界面层（client/app.js）包成 DSH 客户端插件：
 *  - 侧边栏底部注册「▦ PPT 画布」按钮；
 *  - shell.overlay 注册浮层面板（标题栏可拖动 / 右下角可缩放 / 位置记忆）；
 *  - 注入宿主能力：ctx.sessions 绑定当前会话、session.prompt 发指令、
 *    uiWorkspace.pickDirectory 走原生文件选择、ctx.timeout / ctx.interval 做定时。
 *
 * 本文件与 client/app.js、client/ppt-style.js 一起由 tools/sync-client-css.mjs 内联成
 * plugin/client.js —— 那是 DSH 唯一服务的客户端文件。
 *
 * ⚠️ 修改警告：__ModuleLoader__.load 的 factory 只注入 require，不注入 module/exports。
 *    factory 的【返回值】就是模块导出 —— 直接 return { inject, apply }，
 *    任何地方都不要引用 module / exports / module.exports，
 *    否则启动时整屏 "Failed to load plugins"。
 */

window.__ModuleLoader__?.load({ id: 'dsh-ppt-canvas', factory: (require) => {
  const React = require('react')

  // timer：ctx.timeout / ctx.interval（随插件卸载清理）
  // sessions：列出现有会话，取最新那个作为指令的目标
  // sessionController：投递指令（Remote('prompt')）
  // sessions：列出现有会话（取被打开的那个）并 retain 出 binding，用 session.prompt 发指令
  const inject = ['slots', 'timer', 'sessions']

  /* __DSH_PPT_STYLES_START__ */
  const __STYLES__ = "\n.dsh-ppt-footbtn{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:6px;display:flex;align-items:center;gap:6px;}\n.dsh-ppt-footbtn:hover{background:rgba(128,128,128,.15);}\n\n/* ---------------- 可拖动浮窗（对话面板） ---------------- */\n.dsh-ppt-float{position:fixed;z-index:1200;pointer-events:auto;display:flex;flex-direction:column;\n  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:14px;\n  box-shadow:0 24px 70px rgba(0,0,0,.42);overflow:hidden;}\n.dsh-ppt-float.is-dragging{box-shadow:0 30px 80px rgba(0,0,0,.5);}\n.dsh-ppt-float>.dsh-ppt-panel{position:static!important;inset:auto!important;width:100%!important;height:100%!important;\n  border:0;border-radius:0;box-shadow:none;max-width:none;max-height:none;}\n.dsh-ppt-header.is-draggable{cursor:grab;user-select:none;}\n.dsh-ppt-float.is-dragging .dsh-ppt-header.is-draggable{cursor:grabbing;}\n.dsh-ppt-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;z-index:5;\n  background:linear-gradient(135deg,transparent 45%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 45%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 55%,transparent 55%,transparent 70%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 70%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 80%,transparent 80%);}\n\n/* ---------------- 独立窗口模式 ---------------- */\n/* 已移除：独立窗口功能（Electron 窗口）已归档到 archive/standalone-window/。 */\n\n/* ---------------- 拖拽打开 ---------------- */\n.dsh-ppt-drop{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;\n  background:rgba(26,115,232,.18);backdrop-filter:blur(1px);border:2px dashed var(--dsw-alias-brand-primary,#1a73e8);\n  border-radius:inherit;pointer-events:none;}\n.dsh-ppt-dropcard{display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;\n  padding:18px 26px;border-radius:12px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#111);\n  box-shadow:0 16px 40px rgba(0,0,0,.35);max-width:78%;}\n.dsh-ppt-dropcard b{font-size:14px;}\n.dsh-ppt-dropcard span{font-size:12px;color:var(--dsw-alias-label-secondary,#666);}\n\n.dsh-ppt-panel{\n  position:fixed;right:20px;bottom:20px;width:min(1180px,calc(100vw - 60px));height:min(760px,calc(100vh - 60px));\n  display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;z-index:1200;\n  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:14px;\n  box-shadow:0 24px 70px rgba(0,0,0,.42);font-size:13px;line-height:1.5;\n}\n.dsh-ppt-launcher{\n  position:fixed;right:20px;bottom:20px;pointer-events:auto;z-index:1200;border:0;cursor:pointer;\n  padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-on-accent,#fff);\n  background:var(--dsw-alias-brand-primary,#1a73e8);box-shadow:0 8px 26px rgba(0,0,0,.35);\n}\n\n/* ---------------- 顶栏 ---------------- */\n.dsh-ppt-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;flex:none;\n  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));}\n.dsh-ppt-title{display:flex;align-items:center;gap:10px;min-width:0;}\n.dsh-ppt-logo{display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;border-radius:5px;\n  background:var(--dsw-alias-brand-primary,#1a73e8);color:#fff;font-size:11px;font-weight:700;letter-spacing:.5px;flex:none;}\n.dsh-ppt-titles{display:flex;flex-direction:column;min-width:0;}\n.dsh-ppt-titles b{font-size:13px;font-weight:600;}\n.dsh-ppt-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44vw;}\n.dsh-ppt-tools{display:flex;align-items:center;gap:6px;flex:none;}\n.dsh-ppt-sep{width:1px;height:16px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.35));margin:0 2px;}\n.dsh-ppt-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;\n  cursor:pointer;font-size:12px;padding:4px 10px;border-radius:7px;white-space:nowrap;}\n.dsh-ppt-btn:hover:not(:disabled){background:rgba(128,128,128,.14);}\n.dsh-ppt-btn:disabled{opacity:.45;cursor:not-allowed;}\n.dsh-ppt-btn.is-primary{background:var(--dsw-alias-brand-primary,#1a73e8);border-color:transparent;color:var(--dsw-alias-label-on-accent,#fff);font-weight:600;}\n.dsh-ppt-btn-close{font-weight:700;padding:4px 9px;}\n.dsh-ppt-revbadge,.dsh-ppt-sessionbadge{font-size:11px;padding:2px 8px;border-radius:999px;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-sessionbadge.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);border-color:currentColor;}\n\n/* ---------------- 主体 ---------------- */\n.dsh-ppt-body{display:flex;flex:1;min-height:0;}\n.dsh-ppt-thumbs{width:168px;flex:none;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;\n  border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));}\n.dsh-ppt-thumb{position:relative;border:1px solid transparent;background:transparent;padding:0;border-radius:8px;cursor:pointer;text-align:left;}\n.dsh-ppt-thumb.is-active{border-color:var(--dsw-alias-brand-primary,#1a73e8);box-shadow:0 0 0 2px rgba(26,115,232,.22);}\n.dsh-ppt-thumbhead{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 4px;}\n.dsh-ppt-thumbno{font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-thumbpage{font-size:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:5px;\n  background:transparent;color:inherit;cursor:pointer;padding:1px 5px;}\n.dsh-ppt-thumbpage:hover{background:rgba(128,128,128,.16);}\n.dsh-ppt-thumbframe{position:relative;overflow:hidden;border-radius:4px;background:#fff;\n  box-shadow:0 1px 4px rgba(0,0,0,.28);}\n.dsh-ppt-thumbslide{position:absolute;left:0;top:0;pointer-events:none;}\n\n.dsh-ppt-center{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#f3f4f6);}\n.dsh-ppt-canvaswrap{flex:1;min-height:0;overflow:auto;padding:18px;}\n.dsh-ppt-canvasstage{position:relative;margin:0 auto;}\n.dsh-ppt-canvas{position:relative;border-radius:4px;box-shadow:0 6px 26px rgba(0,0,0,.34);background:#fff;touch-action:none;}\n.dsh-ppt-slidewrap{position:relative;margin:0 auto;}\n.dsh-ppt-slide{position:relative;overflow:hidden;}\n.dsh-ppt-canvasmeta{position:absolute;right:6px;bottom:-18px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n\n/* ---------------- 精确渲染底图 + 只画高亮的覆盖层 ---------------- */\n.dsh-ppt-rendered{position:absolute;left:0;top:0;display:block;user-select:none;pointer-events:none;\n  image-rendering:auto;z-index:0;}\n.dsh-ppt-slide.is-overlay{background:transparent;}\n.dsh-ppt-el.is-overlay{background:transparent;}\n.dsh-ppt-el.is-overlay.is-selected{outline:2px solid var(--dsw-alias-brand-primary,#1a73e8);outline-offset:-1px;\n  background:rgba(26,115,232,.12);}\n.dsh-ppt-el.is-overlay.is-hovered{outline:1.5px dashed rgba(26,115,232,.75);outline-offset:-1px;}\n.dsh-ppt-el.is-overlay.is-ai-changed{outline:2px solid #F29900;outline-offset:-1px;background:rgba(242,153,0,.14);}\n\n/* ---------------- 元素 ---------------- */\n.dsh-ppt-el{position:absolute;box-sizing:border-box;}\n.dsh-ppt-el.kind-text{padding:2px 1px;}\n.dsh-ppt-el.is-hovered{outline:1px dashed rgba(26,115,232,.75);outline-offset:0;}\n.dsh-ppt-el.is-selected{outline:2px solid var(--dsw-alias-brand-primary,#1a73e8);outline-offset:0;background-color:rgba(26,115,232,.08);}\n.dsh-ppt-el.is-selected::after{content:\"\";position:absolute;inset:-2px;border-radius:2px;pointer-events:none;\n  background:\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left top/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left top/2px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right top/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right top/2px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left bottom/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left bottom/2px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right bottom/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right bottom/2px 7px no-repeat;\n}\n.dsh-ppt-el.is-ai-changed{animation:dshPptPulse 1.1s ease-in-out 3;background-color:rgba(255,229,143,.55);\n  outline:2px solid #F2C200;outline-offset:0;}\n@keyframes dshPptPulse{0%,100%{background-color:rgba(255,229,143,.22)}50%{background-color:rgba(255,229,143,.75)}}\n.dsh-ppt-marquee{position:absolute;border:1px solid var(--dsw-alias-brand-primary,#1a73e8);\n  background:rgba(26,115,232,.14);pointer-events:none;z-index:9999;}\n.dsh-ppt-imfill{position:absolute;inset:0;pointer-events:none;}\n.dsh-ppt-chartbadge,.dsh-ppt-groupbadge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);\n  font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(128,128,128,.22);color:var(--dsw-alias-label-secondary,#666);white-space:nowrap;}\n.dsh-ppt-cell{border:1px solid rgba(0,0,0,.22);padding:3px 5px;overflow:hidden;color:#222;background:#fff;}\n.dsh-ppt-cell.is-head{background:#eef2f7;font-weight:600;}\n\n/* ---------------- 属性检查器 ---------------- */\n.dsh-ppt-inspector{width:262px;flex:none;overflow-y:auto;padding:10px 12px;\n  border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));display:flex;flex-direction:column;gap:9px;}\n.dsh-ppt-inspector-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;\n  color:var(--dsw-alias-label-secondary,#888);text-transform:uppercase;letter-spacing:.04em;}\n.dsh-ppt-inspector-count{font-weight:500;text-transform:none;letter-spacing:0;}\n.dsh-ppt-inspector-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.dsh-ppt-inspector-foot{margin-top:auto;padding-top:8px;}\n.dsh-ppt-empty{font-size:12px;color:var(--dsw-alias-label-secondary,#888);}\n\n/* ---------------- 最右：AI 思考与回复（可折叠） ---------------- */\n.dsh-ppt-aipane{width:288px;flex:none;display:flex;flex-direction:column;min-height:0;\n  border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-2,#fafbfc);}\n/* 折叠态：一条 26px 的竖条，贴在右边缘，把宽度还给画布 */\n.dsh-ppt-aipane.is-collapsed{width:26px;align-items:center;justify-content:center;gap:6px;padding:8px 0;\n  border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));border-top:0;border-right:0;border-bottom:0;\n  background:var(--dsw-alias-bg-layer-2,#fafbfc);color:var(--dsw-alias-label-secondary,#888);cursor:pointer;}\n.dsh-ppt-aipane.is-collapsed:hover{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-aipane-collapsed-label{writing-mode:vertical-rl;text-orientation:mixed;font-size:11px;letter-spacing:.08em;\n  white-space:nowrap;user-select:none;}\n.dsh-ppt-aipane-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-aipane-dot.is-busy{animation:dsh-ppt-pulse 1.1s ease-in-out infinite;}\n@keyframes dsh-ppt-pulse{0%,100%{opacity:.35;}50%{opacity:1;}}\n.dsh-ppt-aipane-head{display:flex;align-items:center;justify-content:space-between;gap:8px;\n  padding:9px 10px 9px 12px;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary,#888);\n  text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));}\n.dsh-ppt-aipane-head-right{display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;}\n.dsh-ppt-aipane-toggle{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;\n  padding:2px 5px;border-radius:5px;}\n.dsh-ppt-aipane-toggle:hover{background:rgba(26,115,232,.14);color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-aipane-live{font-weight:500;text-transform:none;letter-spacing:0;color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-aipane-idle{font-weight:500;text-transform:none;letter-spacing:0;opacity:.7;}\n.dsh-ppt-aipane-error{margin:8px 12px 0;padding:6px 8px;border-radius:6px;font-size:11px;\n  background:rgba(217,48,37,.1);color:var(--dsw-alias-state-error-primary,#d93025);}\n.dsh-ppt-aipane-sec{display:flex;flex-direction:column;min-height:0;flex:1;padding:8px 12px 4px;}\n.dsh-ppt-aipane-sec.is-reply{flex:1.4;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));}\n.dsh-ppt-aipane-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#888);margin-bottom:4px;}\n.dsh-ppt-aipane-body{flex:1;min-height:40px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;\n  font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#222);}\n.dsh-ppt-aipane-empty{opacity:.5;font-style:italic;}\n.dsh-ppt-aipane-hint{padding:6px 12px 10px;font-size:11px;opacity:.65;}\n.dsh-ppt-field{display:flex;flex-direction:column;gap:4px;}\n.dsh-ppt-field>label{font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px;}\n.dsh-ppt-inline{display:flex;align-items:center;gap:6px;}\n.dsh-ppt-btnrow{display:flex;flex-wrap:wrap;gap:5px;}\n.dsh-ppt-input{width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:4px 7px;border-radius:6px;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-base,transparent);color:inherit;}\n.dsh-ppt-textarea{resize:vertical;min-height:52px;}\n.dsh-ppt-numfield{display:flex;align-items:center;gap:4px;}\n.dsh-ppt-numlabel{font-size:11px;color:var(--dsw-alias-label-secondary,#888);width:16px;flex:none;}\n.dsh-ppt-num{padding:4px 5px;}\n.dsh-ppt-color{width:32px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));\n  border-radius:6px;background:transparent;cursor:pointer;flex:none;}\n.dsh-ppt-mini{font-size:11px;padding:3px 8px;border-radius:6px;cursor:pointer;color:inherit;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;}\n.dsh-ppt-mini:hover{background:rgba(128,128,128,.16);}\n.dsh-ppt-mini.is-on{background:var(--dsw-alias-brand-primary,#1a73e8);border-color:transparent;color:#fff;font-weight:600;}\n.dsh-ppt-mini.is-danger{color:var(--dsw-alias-state-error-primary,#d93025);border-color:currentColor;}\n\n/* ---------------- 指令栏 ---------------- */\n.dsh-ppt-instruction{flex:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding:8px 12px 10px;\n  display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05));}\n.dsh-ppt-instr-head{display:flex;align-items:center;gap:10px;font-size:11px;}\n.dsh-ppt-instr-title{font-weight:600;}\n.dsh-ppt-instr-sel{color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-instr-draft{color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-instr-sending{color:var(--dsw-alias-brand-primary,#1a73e8);font-weight:600;}\n.dsh-ppt-instr-body{display:flex;gap:8px;align-items:flex-end;}\n.dsh-ppt-instr-input{flex:1;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 9px;border-radius:8px;resize:vertical;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-base,#fff);color:inherit;}\n.dsh-ppt-instr-actions{display:flex;gap:6px;flex:none;}\n.dsh-ppt-drafts{display:flex;flex-wrap:wrap;gap:6px;}\n.dsh-ppt-chip{font-size:11px;padding:2px 9px;border-radius:999px;cursor:pointer;background:rgba(26,115,232,.14);\n  border:1px solid rgba(26,115,232,.45);}\n.dsh-ppt-chip:hover{background:rgba(26,115,232,.24);}\n.dsh-ppt-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-sessionmenu{position:absolute;top:38px;right:12px;z-index:40;min-width:220px;max-height:280px;overflow:auto;\n  display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:10px;\n  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));box-shadow:0 12px 34px rgba(0,0,0,.3);}\n.dsh-ppt-sessionmenu-title{font-size:11px;opacity:.7;padding:2px 6px 4px;}\n.dsh-ppt-sessionmenu-item{text-align:left;border:0;background:transparent;color:inherit;cursor:pointer;\n  font-size:11px;padding:5px 7px;border-radius:6px;font-family:ui-monospace,Consolas,monospace;\n  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.dsh-ppt-sessionmenu-item:hover{background:rgba(26,115,232,.14);}\n.dsh-ppt-sessionmenu-item.is-current{font-weight:600;color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-sessionmenu-item.is-new{margin-top:3px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:0 0 6px 6px;}\n.dsh-ppt-sessionmenu-empty{font-size:10px;opacity:.6;padding:4px 7px;}\n.dsh-ppt-sessionbadge{cursor:pointer;}\n.dsh-ppt-diag{margin-top:4px;font-size:10px;opacity:.7;word-break:break-all;font-family:ui-monospace,Consolas,monospace;}\n.dsh-ppt-histlist{display:flex;flex-direction:column;gap:2px;}\n.dsh-ppt-histrow{display:flex;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-histrev{flex:none;font-variant-numeric:tabular-nums;}\n.dsh-ppt-histsum{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n\n/* ---------------- 日志 / Toast / 弹窗 ---------------- */\n.dsh-ppt-log{flex:none;max-height:96px;overflow-y:auto;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));\n  font-size:11px;color:var(--dsw-alias-label-secondary,#888);display:flex;flex-direction:column;gap:2px;}\n.dsh-ppt-logrow.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);}\n.dsh-ppt-logrow.is-warn{color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-logrow.is-ai{color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-toasts{position:absolute;right:14px;top:54px;display:flex;flex-direction:column;gap:8px;z-index:30;max-width:340px;}\n.dsh-ppt-toast{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:10px;font-size:12px;\n  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));\n  box-shadow:0 12px 30px rgba(0,0,0,.3);}\n.dsh-ppt-toast.is-ok{border-color:var(--dsw-alias-state-success-primary,#1f9d55);}\n.dsh-ppt-toast.is-error{border-color:var(--dsw-alias-state-error-primary,#d93025);}\n.dsh-ppt-toast.is-warn{border-color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-toast-body{display:flex;flex-direction:column;gap:2px;flex:1;}\n.dsh-ppt-toast-body span{color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-toast-x{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;}\n.dsh-ppt-modal-back{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:40;}\n.dsh-ppt-modal{width:min(560px,86%);display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:12px;\n  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));\n  box-shadow:0 20px 50px rgba(0,0,0,.4);}\n.dsh-ppt-modal-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888);}\n/* ---------------- 打开演示文稿：面板内文件浏览器 ---------------- */\n.dsh-ppt-modal.is-picker{width:min(620px,92vw);max-height:82vh;display:flex;flex-direction:column;}\n.dsh-ppt-picker-bar{display:flex;gap:6px;margin:8px 0 6px;}\n.dsh-ppt-picker-list{flex:1;min-height:120px;max-height:46vh;overflow-y:auto;margin-top:8px;\n  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));border-radius:8px;padding:4px;}\n.dsh-ppt-picker-row{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;\n  cursor:pointer;font-size:12.5px;padding:6px 8px;border-radius:6px;\n  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.dsh-ppt-picker-row:hover{background:rgba(26,115,232,.14);}\n.dsh-ppt-picker-row.is-dir{color:var(--dsw-alias-label-secondary,#666);}\n.dsh-ppt-picker-row.is-pptx{font-weight:600;color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-picker-more{padding:4px 8px;font-size:11px;opacity:.6;}.dsh-ppt-modal-actions{display:flex;justify-content:flex-end;gap:8px;}\n.dsh-ppt-loading{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:10px;\n  background:rgba(0,0,0,.28);color:#fff;font-size:13px;z-index:20;}\n.dsh-ppt-spinner{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;\n  animation:dshPptSpin .8s linear infinite;}\n@keyframes dshPptSpin{to{transform:rotate(360deg)}}\n.dsh-ppt-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;}\n.dsh-ppt-welcome b{font-size:15px;}\n.dsh-ppt-welcome p{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-welcome .dsh-ppt-btnrow{margin-top:10px;}\n"
    /* __DSH_PPT_STYLES_END__ */

  /* __DSH_PPT_APP_START__ */
  /**
   * @param {object} options 见文件头
   * @returns {{React: object, Component: Function, createStore: Function, initialState: Function,
   *            install: Function, savePrefs: Function, extractDroppedPath: Function}}
   */
  function createPptApp(options) {
    const React = options.React
    const doc = options.document ?? globalThis.document
    const win = options.window ?? globalThis.window
    const h = React.createElement
    const API = options.apiBase ?? '/dsh-ppt/api'
    // 只支持面板模式（独立窗口模式已随功能移除）
    const STORAGE_KEY = options.storageKey ?? 'dsh_ppt_canvas_v1'
    const STYLE_TAG_ID = options.styleTagId ?? 'dsh-ppt-canvas-style'
    // 会话：`promptTo(text, sessionId)` 由 client.js 提供（内部走 sessions.retain +
    // binding.session.prompt），`sessionId` 由 client.js 在渲染时用 slot 的 hook 解析后传入。
    const promptTo = typeof options.promptTo === 'function' ? options.promptTo : null
    const sessionDiagnostics = typeof options.sessionDiagnostics === 'function' ? options.sessionDiagnostics : null
    // 连接会话：没有可用的建会话入口（实测），所以是「从真实列表里选一个」。
    const selectSession = typeof options.selectSession === 'function' ? options.selectSession : null
    const listSessionIds = typeof options.listSessionIds === 'function' ? options.listSessionIds : null
    // 把连接的会话归入工作区，让它在左侧列表里和普通对话一样出现。
    const attachToWorkspace = typeof options.attachToWorkspace === 'function' ? options.attachToWorkspace : null
    // AI 思考过程与回复：订阅已连接会话的事件流（client.js 里实现）。
    const watchAi = typeof options.watchAi === 'function' ? options.watchAi : null
    const aiSnapshot = typeof options.aiSnapshot === 'function' ? options.aiSnapshot : null
    /** 已连接的会话 id（面板状态，存 localStorage 持久化）。 */
    const sessionIdRef = { current: undefined }

    async function ensureInWorkspace(sessionId) {
      if (attachToWorkspace === null) return
      const workspaceId = typeof sessionIdRef.workspaceId === 'string' ? sessionIdRef.workspaceId : undefined
      try {
        await attachToWorkspace(sessionId, workspaceId)
      } catch { /* 归入失败只影响列表显示 */ }
    }

    /**
     * 新建会话并连接。
     *
     * 优先用宿主返回的 id；宿主只说「已请求新建」而不给 id 时，轮询 slot 的会话列表
     * 找出新出现的那个（返回的 id 才是最可靠的路）。
     *
     * @param {(id: string) => void} onConnected 连上后回调（用来同步 store / 持久化）
     * @returns {Promise<{ ok: boolean, sessionId?: string, message?: string }>}
     */
    async function connectNewSession() {
      if (selectSession === null) return { ok: false, message: '宿主没有提供会话来源。' }
      const before = new Set(Array.isArray(sessionIdRef.latest) ? sessionIdRef.latest : [])
      const created = selectSession()
      if (created === null || created.ok !== true) {
        return { ok: false, message: created?.error?.message ?? '未知原因' }
      }
      let picked = typeof created.sessionId === 'string' ? created.sessionId : ''
      for (let attempt = 0; attempt < 15 && picked === ''; attempt += 1) {
        await new Promise(resolve => { timeout(resolve, 200) })
        const now = Array.isArray(sessionIdRef.latest) ? sessionIdRef.latest : []
        const fresh = now.filter(id => !before.has(id))
        picked = fresh.length > 0 ? fresh[fresh.length - 1] : ''
      }
      if (picked === '') {
        // 把「哪条路成功、以及为什么没给 id」一并报出来 —— 否则同样的提示无法定位。
        const detail = Array.isArray(created.tried) && created.tried.length > 0
          ? `；尝试过：${created.tried.join('；')}`
          : ''
        return {
          ok: false,
          message: `宿主没有返回会话 id（成功的是 ${created.via ?? '未知入口'}${detail}）`,
        }
      }
      sessionIdRef.current = picked
      return { ok: true, sessionId: picked }
    }
    const pickPath = typeof options.pickPath === 'function' ? options.pickPath : null
    // 系统原生的「打开文件」对话框（`<input type="file">`）。普通应用那种打开方式。
    const pickPptx = typeof options.pickPptx === 'function' ? options.pickPptx : null
    // 目录浏览：宿主**没有**选文件的对话框（pickDirectory 只给目录），
    // 所以面板自己列目录、只把 .pptx 作为可打开项。
    const listDirectory = typeof options.listDirectory === 'function' ? options.listDirectory : null

    const timeout = typeof options.timeout === 'function'
      ? options.timeout
      : (fn, ms) => { const handle = setTimeout(fn, ms); return () => clearTimeout(handle) }

    // ------------------------------------------------------------------ 工具

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const px = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0)

    function loadPrefs() {
      try {
        const raw = win.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch (error) {
        return {}
      }
    }

    const prefs = loadPrefs()

    function savePrefs(patch) {
      Object.assign(prefs, patch)
      try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)) } catch (error) { /* 隐私模式忽略 */ }
    }

    /**
     * Host API 的两条通道。
     *
     * 1. `API`（同源 `/dsh-ppt/api`）：正常情况下的路。
     * 2. `STANDALONE`（插件自己起的 loopback 服务）：宿主路由表没生效时的兜底。
     *    插件在 19488 起服务（被占用则向后顺延），并在挂载日志里打印实际地址。
     * 首次失败后记住可用的那条，避免每次请求都白试一遍。
     */
    const STANDALONE = options.standaloneBase ?? 'http://127.0.0.1:19488/dsh-ppt/api'
    let channelChoice = prefs.channel === 'standalone' ? 'standalone' : 'host'
    const channels = () => (channelChoice === 'standalone' ? [STANDALONE, API] : [API, STANDALONE])

    function apiError(code, message, details) {
      const error = new Error(message)
      error.code = code
      error.details = details
      return error
    }

    /** 单条通道的一次请求；非 JSON 响应、网络错误、`ok:false` 都抛 ApiError。 */
    async function callOnce(base, path, body) {
      const init = body === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const url = `${base}/${path}`
      let response
      try {
        response = await win.fetch(url, init)
      } catch (error) {
        throw apiError('network', `无法连接 Host（${url}：${error.message}）`)
      }
      // 先读文本再解析：失败时要把真实响应体写进错误里。
      // 只报「HTTP 405」等于什么都没说 —— 分不清是插件的 JSON 错误、DSH 的鉴权层，
      // 还是 SPA 兜底页。带上 content-type 与前 200 个字符就能一眼定位。
      let text = ''
      try { text = await response.text() } catch (error) { text = `<无法读取响应体：${error.message}>` }
      const contentType = response.headers?.get?.('content-type') ?? '(none)'
      let payload = null
      if (text !== '') {
        try { payload = JSON.parse(text) } catch (error) { payload = null }
      }
      if (payload === null || typeof payload !== 'object') {
        const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text)
        const hint = looksLikeHtml
          ? '（这是 DSH 前端的页面，说明请求没走到插件路由）'
          : (text === '' ? '（响应体为空）' : '')
        throw apiError(
          'badResponse',
          `${init.method} ${url} → HTTP ${response.status} ${hint}`
          + ` · content-type=${contentType} · body=${text.slice(0, 200)}`,
        )
      }
      if (payload.ok !== true) {
        const failure = payload.error ?? {}
        throw apiError(failure.code ?? 'internal', failure.message ?? '未知错误', failure.details)
      }
      return payload.value
    }

    /** 走可用通道；换通道成功后就记住它。 */
    async function callApi(path, body) {
      const order = channels()
      let firstFailure = null
      for (const base of order) {
        try {
          const value = await callOnce(base, path, body)
          const picked = base === STANDALONE ? 'standalone' : 'host'
          if (picked !== channelChoice) { channelChoice = picked; savePrefs({ channel: picked }) }
          return value
        } catch (error) {
          if (firstFailure === null) firstFailure = error
          // 只有「没连上 / 不是插件响应」才值得换通道；插件明确返回的业务错误要原样抛出。
          if (error.code !== 'network' && error.code !== 'badResponse') throw error
        }
      }
      throw firstFailure ?? apiError('network', '没有可用的 Host 通道')
    }

    /**
     * 通道候选列表（媒体 URL 要分别拼到它们上面）。
     * 与 callApi 的择一顺序一致：先用当前选中的，再用另一条。
     */
    function channelCandidates() {
      return channelChoice === 'standalone' ? [STANDALONE, API] : [API, STANDALONE]
    }

    /**
     * 精确渲染的图片地址（走当前优先通道）。
     *
     * 与媒体图不同，这里**不**做双通道兜底：渲染是先请求、失败再退回 DOM 重画
     * （见 CanvasPane 的 onError），比换地址更直接、也更快给出可用画面。
     */
    function renderUrl({ page, width, rev }) {
      const base = channelChoice === 'standalone' ? STANDALONE : API
      const query = `page=${page}&w=${width}&rev=${rev}`
      return `${base}/render?${query}`
    }

    const ERROR_HINT = {
      noDeck: '还没有打开演示文稿',
      notFound: '找不到文件或对象',
      validationFailed: 'AI 给的修改方案没通过校验',
      staleRev: '文档在指令发出后被改动过，请重新发送',
      ioFailed: '文件读写失败（可能被 PowerPoint 占用）',
      nothingToUndo: '没有可撤销的步骤',
      nothingToRedo: '没有可重做的步骤',
      network: '连不上 Host 插件接口',
    }

    function describeError(error) {
      const hint = ERROR_HINT[error.code]
      return hint === undefined ? error.message : `${hint}：${error.message}`
    }

    // ---------------------------------------------------------------- 拖拽打开

    /**
     * 从 HTML5 拖放事件里取被拖入文件的绝对路径。
     *
     * 浏览器出于隐私不会把本地路径交给网页；只有 Electron 渲染进程会把路径挂在
     * File.path 上（Electron 容器里拖入本地文件就是这种情况）。所以这里两条路都试：
     *   1) File.path（Electron）
     *   2) dataTransfer 里的 file:// URI（少数环境会带）
     * 都拿不到时返回 null，由调用方给出「请手动填写路径」的提示。
     *
     * @param {DragEvent} event
     * @returns {{path: string, name: string, from: string} | null}
     */
    function extractDroppedPath(event) {
      const transfer = event?.dataTransfer
      if (transfer === null || transfer === undefined) return null

      const files = transfer.files
      let name = ''
      if (files !== null && files !== undefined && files.length > 0) {
        const file = files[0]
        name = file.name ?? ''
        // Electron 的 File 对象带绝对路径（标准浏览器里是 undefined）。
        if (typeof file.path === 'string' && file.path !== '') {
          return { path: file.path, name, from: 'file.path' }
        }
      }

      const looksLikePath = (value) => {
        if (typeof value !== 'string' || value === '') return null
        const text = value.trim().split(/\r?\n/)[0].trim()
        if (text === '') return null
        if (/^file:\/\//i.test(text)) {
          try {
            const url = new URL(text)
            // Windows 下 pathname 是 /D:/dir/file.pptx，去掉前导斜杠。
            let path = decodeURIComponent(url.pathname)
            if (/^\/[a-zA-Z]:/.test(path)) path = path.slice(1)
            return path
          } catch {
            return null
          }
        }
        // Windows 绝对路径（拖拽时很多环境会以 text/plain 给出）
        if (/^[a-zA-Z]:[\\/]/.test(text)) return text
        // UNC 路径
        if (/^\\\\[^\\]+\\/.test(text)) return text
        return null
      }

      for (const type of ['text/uri-list', 'text/plain', 'application/x-moz-file']) {
        let raw = null
        try { raw = transfer.getData(type) } catch { raw = null }
        const path = looksLikePath(raw)
        if (path !== null) return { path, name, from: type }
      }
      return null
    }

    function looksLikePptx(path) {
      return typeof path === 'string' && /\.pptx$/i.test(path.trim())
    }

    // ------------------------------------------------------------------ 微 store

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : patch
          let changed = false
          for (const key of Object.keys(next)) {
            if (state[key] !== next[key]) { changed = true; break }
          }
          if (!changed) return
          state = { ...state, ...next }
          for (const fn of [...listeners]) {
            try { fn() } catch (error) { /* 单个订阅者出错不影响其他 */ }
          }
        },
        subscribe(fn) {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
      }
    }

    function useStore(store) {
      const [, tick] = React.useState(0)
      React.useEffect(() => store.subscribe(() => tick((n) => n + 1)), [store])
      return store.get()
    }

    function initialState() {
      return {
        open: prefs.open === true,
        sessionId: typeof prefs.sessionId === 'string' ? prefs.sessionId : '',
        sessionMenuOpen: false,
        connectedSession: false,
        // AI 面板默认折叠（画布优先）；用户展开后记住选择。
        aiCollapsed: prefs.aiCollapsed !== false,
        // 画布画法：'fitted' = LibreOffice 精确渲染（默认）；'dom' = 内置 DOM 近似重画。
        renderMode: prefs.renderMode === 'dom' ? 'dom' : 'fitted',
        // AI 思考/回复（由 client.js 的 watchAi 推送写入）
        ai: { thinking: '', reply: '', error: null },
        deck: null,
        loading: false,
        loadingLabel: '',
        error: null,
        slideIndex: typeof prefs.slideIndex === 'number' ? prefs.slideIndex : 0,
        selectedIds: [],
        hoverId: null,
        zoom: typeof prefs.zoom === 'number' ? prefs.zoom : 1,
        marquee: null,
        instruction: '',
        sending: false,
        pendingRequestId: null,
        drafts: [],
        log: [],
        toasts: [],
        highlights: {},
        showInspector: prefs.showInspector !== false,
        showThumbs: prefs.showThumbs !== false,
        askPath: false,
        pickerPath: '',
        listing: null,
        listingError: null,
        pathDraft: prefs.lastDir ?? '',
        dragDepth: 0,
        dropHint: null,
        history: { rev: 0, canUndo: false, canRedo: false },
        maximized: false,
            }
    }

    // ------------------------------------------------------------------ 画布渲染

    /** 一个 Shape → 绝对定位的 DOM 元素（坐标以幻灯片 px 为单位）。 */
    /**
     * 精确渲染模式下，只画**选中/悬停/被 AI 改动**的框，不画内容。
     *
     * 为什么不能继续用 renderShape：精确渲染的 PNG 里已经包含了形状本身
     * （背景色块、表格、文字、母版元素都在里面），再叠一层 DOM 重画就会双重绘制。
     * 所以这里只保留几何，供命中测试与高亮使用。
     */
    function renderShapeOverlay(shape, shapeOptions) {
      const { selected, hovered, highlighted, onPointerDown, interactive } = shapeOptions
      const geometry = shape.geometry
      const style = {
        position: 'absolute',
        left: `${px(geometry.x)}px`,
        top: `${px(geometry.y)}px`,
        width: `${px(Math.max(0, geometry.w))}px`,
        height: `${px(Math.max(0, geometry.h))}px`,
        zIndex: String(shape.z + 1),
        background: 'transparent',
      }
      if (Number.isFinite(geometry.rotation) && geometry.rotation !== 0) {
        style.transform = `rotate(${px(geometry.rotation)}deg)`
        style.transformOrigin = 'center center'
      }
      const classes = ['dsh-ppt-el', 'is-overlay']
      if (selected) classes.push('is-selected')
      if (hovered && !selected) classes.push('is-hovered')
      if (highlighted) classes.push('is-ai-changed')
      const props = {
        key: shape.id,
        className: classes.join(' '),
        style,
        'data-shape-id': shape.id,
        title: shape.name,
      }
      if (interactive && onPointerDown !== null && onPointerDown !== undefined) {
        props.onPointerDown = (event) => onPointerDown(event, shape)
      }
      return h('div', props)
    }

    function renderShape(shape, shapeOptions) {
      const { selected, hovered, highlighted, onPointerDown, interactive } = shapeOptions
      const geometry = shape.geometry
      const style = {
        position: 'absolute',
        left: `${px(geometry.x)}px`,
        top: `${px(geometry.y)}px`,
        width: `${px(Math.max(0, geometry.w))}px`,
        height: `${px(Math.max(0, geometry.h))}px`,
        zIndex: String(shape.z + 1),
      }
      if (Number.isFinite(geometry.rotation) && geometry.rotation !== 0) {
        style.transform = `rotate(${px(geometry.rotation)}deg)`
        style.transformOrigin = 'center center'
      }
      if (geometry.flipH || geometry.flipV) {
        const scaleX = geometry.flipH ? -1 : 1
        const scaleY = geometry.flipV ? -1 : 1
        const rotate = Number.isFinite(geometry.rotation) && geometry.rotation !== 0 ? ` rotate(${px(geometry.rotation)}deg)` : ''
        style.transform = `scale(${scaleX}, ${scaleY})${rotate}`
      }
      const radius = shape.style ? shape.style.cornerRadius : 0
      if (Number.isFinite(radius) && radius > 0) style.borderRadius = `${px(radius)}px`

      const classes = ['dsh-ppt-el', `kind-${shape.kind}`]
      if (selected) classes.push('is-selected')
      if (hovered && !selected) classes.push('is-hovered')
      if (highlighted) classes.push('is-ai-changed')

      const props = {
        key: shape.id,
        className: classes.join(' '),
        style,
        'data-shape-id': shape.id,
        title: `${shape.name}${shape.placeholder !== null && shape.placeholder !== undefined ? `（占位符 ${shape.placeholder.type ?? ''}）` : ''}`,
      }
      if (interactive && onPointerDown !== null && onPointerDown !== undefined) {
        props.onPointerDown = (event) => onPointerDown(event, shape)
      }

      return h('div', props, renderShapeBody(shape))
    }

    /**
     * 媒体 URL 的**候选列表**：把 Host 给的路径分别拼到两条通道上。
     *
     * 为什么不只拼当前通道：`channelChoice` 初值是 'host'，要等第一次 API 调用成功
     * 才会翻成 standalone —— 而图片往往在切通道之前就开始加载了。靠一个可能还没更新的
     * 标志决定图片地址，就会出现「第一批图片全裂」。所以这里给出两个候选，
     * 由 <img> 自己在 onError 时换下一个（见 renderShapeBody）。
     */
    function mediaUrlCandidates(url) {
      if (typeof url !== 'string' || url === '') return []
      if (/^(https?:|data:|blob:)/i.test(url)) return [url]
      const path = url.startsWith('/') ? url : `/${url}`
      const bases = typeof channelCandidates === 'function' ? channelCandidates() : [API, STANDALONE]
      return [...new Set(bases.map(base => {
        const origin = /^https?:\/\//i.test(base) ? base.replace(/\/dsh-ppt\/api\/?$/, '') : ''
        return `${origin}${path}`
      }))]
    }

    function renderShapeBody(shape) {
      const children = []

      if (shape.kind === 'image' && shape.image !== null && shape.image !== undefined) {
        const crop = shape.image.crop ?? { l: 0, t: 0, r: 0, b: 0 }
        const scaleX = Math.max(0.02, 1 - crop.l - crop.r)
        const scaleY = Math.max(0.02, 1 - crop.t - crop.b)
        const inner = {
          position: 'absolute',
          left: '0',
          top: '0',
          width: `${px(100 / scaleX)}%`,
          height: `${px(100 / scaleY)}%`,
          marginLeft: `${px(-100 * crop.l / scaleX)}%`,
          marginTop: `${px(-100 * crop.t / scaleY)}%`,
          objectFit: 'fill',
          userSelect: 'none',
          pointerEvents: 'none',
        }
        const candidates = mediaUrlCandidates(shape.image.url)
        if (candidates.length > 0) {
          // 自愈：第一条通道失败就换下一条（路径在 src 里用空格分隔，onError 时右移一位）。
          children.push(h('img', {
            key: 'img',
            src: candidates.join(' '),
            style: inner,
            alt: shape.name,
            draggable: false,
            onError: (event) => {
              const node = event?.currentTarget ?? event?.target
              if (node === null || node === undefined) return
              const rest = String(node.getAttribute('data-rest') ?? '').split(' ').filter(Boolean)
              const queue = rest.length > 0 ? rest : candidates.slice(1)
              if (queue.length === 0) return
              node.setAttribute('data-rest', queue.slice(1).join(' '))
              node.src = queue[0]
            },
          }))
        }
        const fillColor = shape.style?.fill
        if (fillColor && fillColor.type === 'solid' && /^#[0-9a-fA-F]{6}$/.test(fillColor.color ?? '')) {
          children.unshift(h('div', { key: 'imfill', className: 'dsh-ppt-imfill', style: { background: fillColor.color } }))
        }
        return children
      }

      if (shape.kind === 'line') {
        const { w, h: height } = shape.geometry
        const angle = Math.atan2(height, w) * 180 / Math.PI
        const length = Math.sqrt(w * w + height * height)
        const line = shape.style?.line ?? { color: '#000000', width: 1, dash: 'solid' }
        children.push(h('div', {
          key: 'line',
          className: 'dsh-ppt-line',
          style: {
            position: 'absolute',
            left: '0',
            top: '50%',
            width: `${px(length)}px`,
            height: `${px(Math.max(1, line.width ?? 1))}px`,
            background: line.color ?? '#000000',
            transform: `rotate(${px(angle)}deg)`,
            transformOrigin: '0 50%',
          },
        }))
        return children
      }

      if (shape.kind === 'text') {
        children.push(renderText(shape))
        return children
      }

      if (shape.kind === 'table' && shape.table !== null && shape.table !== undefined) {
        children.push(renderTable(shape))
        return children
      }

      if (shape.kind === 'chart') {
        children.push(h('div', { key: 'chart', className: 'dsh-ppt-chartbadge' }, '图表'))
        return children
      }

      if (shape.kind === 'group') {
        const count = Array.isArray(shape.children) ? shape.children.length : 0
        children.push(h('div', { key: 'group', className: 'dsh-ppt-groupbadge' }, `组合 · ${count}`))
        return children
      }

      return children
    }

    function fillStyle(style) {
      const fill = style?.fill
      if (fill === null || fill === undefined) return null
      if (fill.type === 'solid' && /^#[0-9a-fA-F]{6}$/.test(fill.color ?? '')) return fill.color
      if (fill.type === 'none') return 'transparent'
      if (fill.type === 'gradient' && fill.gradient !== null && fill.gradient !== undefined) {
        const stops = (fill.gradient.stops ?? [])
          .filter(stop => /^#[0-9a-fA-F]{6}$/.test(stop.color ?? ''))
          .map(stop => `${stop.color} ${px(clamp(stop.pos ?? 0, 0, 1) * 100)}%`)
        if (stops.length >= 2) {
          const angle = Number.isFinite(fill.gradient.angle) ? fill.gradient.angle : 90
          return `linear-gradient(${px(angle)}deg, ${stops.join(', ')})`
        }
        if (stops.length === 1) return stops[0].split(' ')[0]
      }
      return null
    }

    function borderStyle(style) {
      const line = style?.line
      if (line === null || line === undefined) return null
      const width = Math.max(0.5, Number.isFinite(line.width) ? line.width : 1)
      const color = /^#[0-9a-fA-F]{6}$/.test(line.color ?? '') ? line.color : 'rgba(128,128,128,.6)'
      const dash = line.dash === 'dash' || line.dash === 'sysDash' || line.dash === 'lgDash' ? 'dashed'
        : line.dash === 'dot' || line.dash === 'sysDot' ? 'dotted'
          : 'solid'
      return `${px(width)}px ${dash} ${color}`
    }

    function alignToCss(align) {
      const value = align ?? ''
      if (value === 'ctr' || value === 'center') return 'center'
      if (value === 'r' || value === 'right') return 'right'
      if (value === 'just' || value === 'justify' || value === 'dist') return 'justify'
      return 'left'
    }

    function renderText(shape) {
      const text = shape.text ?? {}
      const paragraphs = Array.isArray(text.paragraphs) ? text.paragraphs : []
      // 正文框内边距：PowerPoint 默认 lIns/rIns=9.6px、tIns/bIns=4.8px，
      // 读取端从 a:bodyPr 解析（可被 lIns 等属性覆盖）。缺了它文字位置会偏。
      const insets = text.insets ?? { left: 9.6, top: 4.8, right: 9.6, bottom: 4.8 }
      const anchor = text.anchor ?? 'top'
      const container = {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // 垂直对齐用 justifyContent（把整块文字作为一个整体对齐）：
        // 之前用的是 anchorToFlex + 同样的 justifyContent，语义没错，但配合
        // 固定 lineHeight 1.25 且忽略 lnSpc/内边距，行距与文字位置都是错的。
        padding: `${px(insets.top)}px ${px(insets.right)}px ${px(insets.bottom)}px ${px(insets.left)}px`,
        boxSizing: 'border-box',
        textAlign: alignToCss(text.align),
        color: text.color ?? '#111111',
        fontSize: `${px(text.fontSize ?? 18)}px`,
        fontWeight: text.bold === true ? 700 : 400,
        fontStyle: text.italic === true ? 'italic' : 'normal',
        fontFamily: text.fontFamily ?? 'inherit',
        // 整块文字的默认行距；每段可用自己的 lnSpc 覆盖
        lineHeight: 1.2,
        overflow: 'visible',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }
      if (anchor === 'middle' || anchor === 'ctr') {
        container.justifyContent = 'center'
      } else if (anchor === 'bottom' || anchor === 'b') {
        container.justifyContent = 'flex-end'
      } else {
        container.justifyContent = 'flex-start'
      }

      if (paragraphs.length === 0) {
        return h('div', { key: 'text', className: 'dsh-ppt-text', style: container }, text.plain ?? '')
      }
      return h('div', { key: 'text', className: 'dsh-ppt-text', style: container },
        paragraphs.map((paragraph, index) => {
          const runs = Array.isArray(paragraph.runs) ? paragraph.runs : []
          const pStyle = {
            textAlign: alignToCss(paragraph.align ?? text.align),
            minHeight: '1.2em',
            // 行距：lnSpc 是倍数（如 125% → 1.25）；lnSpcIsPx 时是绝对 px，换算成倍数
            ...(paragraph.lnSpc === null || paragraph.lnSpc === undefined
              ? {}
              : (() => {
                  if (paragraph.lnSpcIsPx === true) {
                    const base = paragraph.runs?.[0]?.fontSize ?? text.fontSize ?? 18
                    return { lineHeight: base > 0 ? paragraph.lnSpc / base : 1.2 }
                  }
                  return { lineHeight: paragraph.lnSpc }
                })()),
            // 段前/段后间距（px）
            ...(paragraph.spaceBefore === null || paragraph.spaceBefore === undefined
              ? {}
              : { marginTop: `${px(paragraph.spaceBefore)}px` }),
            ...(paragraph.spaceAfter === null || paragraph.spaceAfter === undefined
              ? {}
              : { marginBottom: `${px(paragraph.spaceAfter)}px` }),
            // 左缩进
            ...(paragraph.indent === null || paragraph.indent === undefined
              ? {}
              : { marginLeft: `${px(paragraph.indent)}px` }),
          }
          if (runs.length === 0) return h('div', { key: `p${index}`, style: pStyle }, '\u00A0')
          return h('div', { key: `p${index}`, style: pStyle }, runs.map((run, runIndex) => h('span', {
            key: `r${runIndex}`,
            style: {
              color: run.color ?? text.color ?? '#111111',
              fontSize: run.fontSize === null || run.fontSize === undefined ? undefined : `${px(run.fontSize)}px`,
              fontWeight: run.bold === true ? 700 : undefined,
              fontStyle: run.italic === true ? 'italic' : undefined,
              textDecoration: run.underline === true ? 'underline' : undefined,
              fontFamily: run.fontFamily ?? undefined,
            },
          }, run.text ?? '')))
        }),
      )
    }

    function renderTable(shape) {
      const table = shape.table
      const rows = table.rows ?? 0
      const cols = table.cols ?? 0
      if (rows <= 0 || cols <= 0) return h('div', { key: 'table', className: 'dsh-ppt-chartbadge' }, '表格')
      const cells = new Map()
      for (const cell of table.cells ?? []) cells.set(`${cell.r}:${cell.c}`, cell.text ?? '')
      const style = {
        display: 'grid',
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        width: '100%',
        height: '100%',
        fontSize: '12px',
        lineHeight: 1.3,
        overflow: 'hidden',
      }
      const children = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          children.push(h('div', {
            key: `${r}:${c}`,
            className: r === 0 ? 'dsh-ppt-cell is-head' : 'dsh-ppt-cell',
          }, cells.get(`${r}:${c}`) ?? ''))
        }
      }
      return h('div', { key: 'table', style }, children)
    }

    /** 整页：背景 + 所有元素 + 选中高亮。 */
    function SlideView(props) {
      const { slide, width, height, selection, hoverId, highlights, onPointerDown, interactive, marquee, overlayOnly } = props
      if (slide === null || slide === undefined) return null
      const background = /^#[0-9a-fA-F]{6}$/.test(slide.background ?? '') ? slide.background : '#FFFFFF'
      return h('div', {
        className: `dsh-ppt-slide${overlayOnly === true ? ' is-overlay' : ''}`,
        style: {
          width: `${px(width)}px`,
          height: `${px(height)}px`,
          // 精确渲染时底图已经画了背景，DOM 层要透明，否则会盖住 PNG。
          background: overlayOnly === true ? 'transparent' : background,
        },
      },
        (slide.shapes ?? []).map(shape => (overlayOnly === true ? renderShapeOverlay : renderShape)(shape, {
          selected: selection.indexOf(shape.id) !== -1,
          hovered: hoverId === shape.id,
          highlighted: highlights[shape.id] === true,
          onPointerDown,
          interactive,
        })),
        marquee === null || marquee === undefined ? null : h('div', {
          className: 'dsh-ppt-marquee',
          style: {
            left: `${px(marquee.x)}px`,
            top: `${px(marquee.y)}px`,
            width: `${px(marquee.w)}px`,
            height: `${px(marquee.h)}px`,
          },
        }),
      )
    }

    function intersects(rect, geometry) {
      if (geometry === null || geometry === undefined) return false
      return !(geometry.x > rect.x + rect.w
        || geometry.x + geometry.w < rect.x
        || geometry.y > rect.y + rect.h
        || geometry.y + geometry.h < rect.y)
    }

    // ------------------------------------------------------------------ 画布交互

    function CanvasPane(props) {
      const { store, state, deck, slide } = props
      const hostRef = React.useRef(null)
      const wrapRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const slideW = deck.slideWidth
      const slideH = deck.slideHeight
      const zoom = state.zoom
      const width = slideW * zoom
      const height = slideH * zoom

      // 打开新文档时自动适配缩放：画布尺寸可能远大于面板中栏（实测 1835×1024 的文件
      // 在 ~460px 的中栏里直接溢出贴左 —— 溢出内容上 margin:0 auto 不生效）。
      // 只在换文档时跑一次；rev 变化和手动缩放都不触发。
      const fitKey = deck.file
      React.useEffect(() => {
        const wrap = wrapRef.current
        if (wrap === null) return
        const availW = wrap.clientWidth - 36 // .dsh-ppt-canvaswrap 左右 padding 18px
        const availH = wrap.clientHeight - 36
        if (availW <= 0 || availH <= 0 || slideW <= 0 || slideH <= 0) return
        const fit = Math.round(clamp(Math.min(availW / slideW, availH / slideH), 0.05, 1) * 100) / 100
        if (Math.abs(store.get().zoom - fit) > 0.005) {
          store.set({ zoom: fit })
          savePrefs({ zoom: fit })
        }
      }, [fitKey, slideW, slideH, store])

      // 精确渲染：LibreOffice 出的整页 PNG。
      // URL 带上 rev，让文档被改过之后浏览器不会拿旧图（Host 侧也按 mtime 缓存）。
      const renderMode = state.renderMode === 'dom' ? 'dom' : 'fitted'
      const [renderFailed, setRenderFailed] = React.useState(false)
      React.useEffect(() => { setRenderFailed(false) }, [slide.id, deck.rev])
      const slideNumber = deck.slides.indexOf(slide) + 1
      const rendered = renderMode === 'fitted' && typeof renderUrl === 'function'
        ? renderUrl({ page: slideNumber, width: Math.round(Math.max(960, slideW * 2)), rev: deck.rev })
        : null

      const localPoint = React.useCallback((event) => {
        const host = hostRef.current
        if (host === null) return { x: 0, y: 0 }
        const rect = host.getBoundingClientRect()
        return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }
      }, [zoom])

      const hitShape = React.useCallback((event) => {
        let node = event.target
        while (node !== null && node !== undefined) {
          if (node.dataset !== undefined && node.dataset.shapeId !== undefined && node.dataset.shapeId !== '') return node.dataset.shapeId
          node = node.parentElement
        }
        return null
      }, [])

      const onShapePointerDown = React.useCallback((event, shape) => {
        if (event.button !== 0) return
        event.stopPropagation()
        const additive = event.shiftKey || event.ctrlKey || event.metaKey
        const current = store.get().selectedIds
        let next
        if (additive) {
          next = current.indexOf(shape.id) === -1
            ? current.concat([shape.id])
            : current.filter(id => id !== shape.id)
        } else if (current.indexOf(shape.id) !== -1) {
          next = current
        } else {
          next = [shape.id]
        }
        store.set({ selectedIds: next, error: null })
      }, [store])

      const onCanvasPointerDown = React.useCallback((event) => {
        if (event.button !== 0) return
        const host = hostRef.current
        if (host === null) return
        const additive = event.shiftKey || event.ctrlKey || event.metaKey
        const base = additive ? store.get().selectedIds : []
        if (!additive) store.set({ selectedIds: [] })
        const start = localPoint(event)
        dragRef.current = { start, base, moved: false }
        host.setPointerCapture?.(event.pointerId)
        const onMove = (moveEvent) => {
          const drag = dragRef.current
          if (drag === null) return
          const point = localPoint(moveEvent)
          const rect = {
            x: Math.min(drag.start.x, point.x),
            y: Math.min(drag.start.y, point.y),
            w: Math.abs(point.x - drag.start.x),
            h: Math.abs(point.y - drag.start.y),
          }
          if (!drag.moved && rect.w < 3 && rect.h < 3) return
          drag.moved = true
          store.set({ marquee: rect })
        }
        const onUp = (upEvent) => {
          const drag = dragRef.current
          dragRef.current = null
          win.removeEventListener('pointermove', onMove)
          win.removeEventListener('pointerup', onUp)
          store.set({ marquee: null })
          if (drag === null || !drag.moved) return
          const point = localPoint(upEvent)
          const rect = {
            x: Math.min(drag.start.x, point.x),
            y: Math.min(drag.start.y, point.y),
            w: Math.abs(point.x - drag.start.x),
            h: Math.abs(point.y - drag.start.y),
          }
          const hits = (slide.shapes ?? []).filter(shape => intersects(rect, shape.geometry)).map(shape => shape.id)
          const merged = drag.base.concat(hits.filter(id => drag.base.indexOf(id) === -1))
          store.set({ selectedIds: merged })
        }
        win.addEventListener('pointermove', onMove)
        win.addEventListener('pointerup', onUp)
      }, [localPoint, slide, store])

      const onWheel = React.useCallback((event) => {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        const next = clamp(store.get().zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.2, 4)
        store.set({ zoom: Math.round(next * 100) / 100 })
        savePrefs({ zoom: Math.round(next * 100) / 100 })
      }, [store])

      const onHover = React.useCallback((event) => {
        const id = hitShape(event)
        if (store.get().hoverId !== id) store.set({ hoverId: id })
      }, [hitShape, store])

      return h('div', { className: 'dsh-ppt-canvaswrap', ref: wrapRef, onWheel },
        h('div', { className: 'dsh-ppt-canvasstage', style: { width: `${px(width)}px` } },
          h('div', {
            className: 'dsh-ppt-canvas',
            ref: hostRef,
            style: { width: `${px(width)}px`, height: `${px(height)}px` },
            onPointerDown: onCanvasPointerDown,
            onPointerMove: onHover,
            onPointerLeave: () => store.set({ hoverId: null }),
          },
            h('div', {
              className: 'dsh-ppt-slidewrap',
              // 用 CSS `zoom` 而不是 transform: scale()：
              // transform 只改视觉、**不改布局尺寸**，于是内层仍是未缩放的 1280×720、
              // 外层只有 640×360，内层布局盒子溢出外层，margin:auto 也就无法居中
              // —— 表现就是幻灯片「完整但贴在左上角」。zoom 会同时缩放布局尺寸。
              style: { zoom: String(zoom) },
            },
            // 精确渲染：LibreOffice 出的整页 PNG 作为底图（含母版元素）。
            // 失败或没装 LibreOffice 时 solved=false，自动退回 DOM 重画。
            rendered !== null && renderMode === 'fitted' && renderFailed !== true
              ? h('img', {
                  className: 'dsh-ppt-rendered',
                  src: rendered,
                  alt: slide.name,
                  draggable: false,
                  onError: () => setRenderFailed(true),
                  // 注意用幻灯片原生尺寸（slideW×slideH），不要乘 zoom —— 本元素在
                  // zoom 容器内，CSS zoom 会再乘一次，显式乘过就会双重缩放：
                  // zoom≠1 时 PNG 缩在角落而覆盖层是正常大小，表现即「高亮框不对齐」。
                  style: { width: `${px(slideW)}px`, height: `${px(slideH)}px` },
                })
              : null,
            h(SlideView, {
              slide,
              width: slideW,
              height: slideH,
              selection: state.selectedIds,
              hoverId: state.hoverId,
              highlights: state.highlights,
              onPointerDown: onShapePointerDown,
              interactive: true,
              marquee: state.marquee,
              // 底图已在时，DOM 只画高亮框，避免双重绘制。
              overlayOnly: rendered !== null && renderMode === 'fitted' && renderFailed !== true,
            })),
          ),
          h('div', { className: 'dsh-ppt-canvasmeta' },
            `${deck.slides.indexOf(slide) + 1} / ${deck.slides.length} · ${Math.round(zoom * 100)}%`,
            state.selectedIds.length > 0 ? ` · 已选 ${state.selectedIds.length}` : '',
          ),
        ),
      )
    }

    // ------------------------------------------------------------------ 缩略图

    function ThumbRail(props) {
      const { store, deck, state } = props
      const thumbW = 132
      const scale = thumbW / deck.slideWidth
      return h('div', { className: 'dsh-ppt-thumbs' },
        deck.slides.map((slide, index) => h('button', {
          key: slide.id,
          className: `dsh-ppt-thumb${index === state.slideIndex ? ' is-active' : ''}`,
          title: `${slide.name}（点击左上角选择整页）`,
          onClick: () => {
            store.set({ slideIndex: index, selectedIds: [] })
            savePrefs({ slideIndex: index })
          },
        },
          h('div', { className: 'dsh-ppt-thumbhead' },
            h('span', { className: 'dsh-ppt-thumbno' }, String(index + 1)),
            h('button', {
              className: 'dsh-ppt-thumbpage',
              title: '选中整页元素',
              onClick: (event) => {
                event.stopPropagation()
                store.set({ slideIndex: index, selectedIds: slide.shapes.map(shape => shape.id) })
                savePrefs({ slideIndex: index })
              },
            }, '整页'),
          ),
          h('div', { className: 'dsh-ppt-thumbframe', style: { height: `${px(deck.slideHeight * scale)}px`, width: `${px(thumbW)}px` } },
            h('div', {
              className: 'dsh-ppt-thumbslide',
              style: { transform: `scale(${scale})`, transformOrigin: 'top left', width: `${px(deck.slideWidth)}px`, height: `${px(deck.slideHeight)}px` },
            }, h(SlideView, {
              slide,
              width: deck.slideWidth,
              height: deck.slideHeight,
              selection: index === state.slideIndex ? state.selectedIds : [],
              hoverId: null,
              highlights: index === state.slideIndex ? state.highlights : {},
              onPointerDown: null,
              interactive: false,
              marquee: null,
            })),
          ),
        )),
      )
    }

    // ------------------------------------------------------------------ 属性检查器

    function normalizeColor(value) {
      return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : '#FFFFFF'
    }

    function findShape(deck, id) {
      if (deck === null) return null
      for (const slide of deck.slides) {
        for (const shape of slide.shapes) {
          if (shape.id === id) return shape
          if (Array.isArray(shape.children)) {
            for (const child of shape.children) if (child.id === id) return child
          }
        }
      }
      return null
    }

    function numberField(label, value, onCommit) {
      return h('div', { className: 'dsh-ppt-numfield', key: label ?? 'value' },
        label === null ? null : h('span', { className: 'dsh-ppt-numlabel' }, label),
        h('input', {
          type: 'number',
          className: 'dsh-ppt-input dsh-ppt-num',
          defaultValue: Number.isFinite(value) ? Math.round(value * 10) / 10 : 0,
          onBlur: (event) => {
            const parsed = Number(event.target.value)
            if (Number.isFinite(parsed)) onCommit(parsed)
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.target.blur()
          },
        }),
      )
    }

    /**
     * 最右侧：AI 思考过程与回复。
     *
     * 内容来自 `client.js` 的 `watchAi`（订阅已连接会话的事件流）：`state.ai` 里是
     * `{ thinking, reply, error }`。面板不自己订阅 —— 事件流要 retain 会话，那件事
     * 在注入层做，界面层只读结果。
     */
    function AiPane(props) {
      const { store, state } = props
      const ai = state.ai ?? { thinking: '', reply: '', error: null }
      const thinkingRef = React.useRef(null)
      const replyRef = React.useRef(null)
      // 跟随最新内容：思考与回复都在增长，自动滚到底部。
      React.useEffect(() => {
        for (const ref of [thinkingRef, replyRef]) {
          const node = ref.current
          if (node !== null && node !== undefined && typeof node.scrollTop === 'number') {
            node.scrollTop = node.scrollHeight
          }
        }
      }, [ai.thinking, ai.reply])

      // 折叠后只剩一条贴边的竖条，不占画布宽度（默认折叠，避免一上来就挤掉 PPT）。
      const collapsed = state.aiCollapsed !== false
      const toggle = () => {
        const next = !collapsed
        store.set({ aiCollapsed: next })
        savePrefs({ aiCollapsed: next })
      }
      if (collapsed) {
        return h('button', {
          className: 'dsh-ppt-aipane is-collapsed',
          title: '展开 AI 思考与回复',
          onClick: toggle,
        },
          h('span', { className: 'dsh-ppt-aipane-collapsed-label' }, 'AI 思考与回复'),
          state.sending ? h('span', { className: 'dsh-ppt-aipane-dot is-busy' }) : null,
        )
      }

      const empty = ai.thinking === '' && ai.reply === ''
      return h('div', { className: 'dsh-ppt-aipane' },
        h('div', { className: 'dsh-ppt-aipane-head' },
          h('span', null, 'AI 思考与回复'),
          h('span', { className: 'dsh-ppt-aipane-head-right' },
            state.connectedSession === true
              ? h('span', { className: 'dsh-ppt-aipane-live' }, state.sending ? '思考中…' : '已连接')
              : h('span', { className: 'dsh-ppt-aipane-idle' }, '未连接会话'),
            h('button', {
              className: 'dsh-ppt-aipane-toggle',
              title: '折叠（把空间还给画布）',
              onClick: toggle,
            }, '»'),
          ),
        ),
        ai.error !== null && ai.error !== ''
          ? h('div', { className: 'dsh-ppt-aipane-error' }, ai.error)
          : null,
        h('div', { className: 'dsh-ppt-aipane-sec' },
          h('div', { className: 'dsh-ppt-aipane-title' }, '思考过程'),
          h('div', { className: 'dsh-ppt-aipane-body', ref: thinkingRef },
            ai.thinking === '' ? h('span', { className: 'dsh-ppt-aipane-empty' }, '（还没有推理内容）') : ai.thinking),
        ),
        h('div', { className: 'dsh-ppt-aipane-sec is-reply' },
          h('div', { className: 'dsh-ppt-aipane-title' }, '回复'),
          h('div', { className: 'dsh-ppt-aipane-body', ref: replyRef },
            ai.reply === '' ? h('span', { className: 'dsh-ppt-aipane-empty' }, '（还没有回复）') : ai.reply),
        ),
        empty && !state.sending
          ? h('div', { className: 'dsh-ppt-aipane-hint' }, '发送指令后，这里会实时显示 AI 的推理与最终回复。')
          : null,
      )
    }

    function Inspector(props) {
      const { store, deck, state, onManualEdit } = props
      const selected = state.selectedIds.map(id => findShape(deck, id)).filter(shape => shape !== null)
      if (selected.length === 0) {
        return h('div', { className: 'dsh-ppt-inspector' },
          h('div', { className: 'dsh-ppt-inspector-head' }, '属性'),
          h('div', { className: 'dsh-ppt-empty' }, '在画布上点选 / 框选元素，这里会显示它的位置、尺寸、样式与层级。'),
        )
      }
      const first = selected[0]
      const update = (ops, label) => onManualEdit(ops, label ?? (selected.length === 1 ? first.id : null))
      return h('div', { className: 'dsh-ppt-inspector' },
        h('div', { className: 'dsh-ppt-inspector-head' },
          '属性',
          h('span', { className: 'dsh-ppt-inspector-count' }, selected.length > 1 ? `${selected.length} 个元素` : first.kind),
        ),
        h('div', { className: 'dsh-ppt-inspector-name', title: first.name }, first.name),
        h('div', { className: 'dsh-ppt-grid2' },
          numberField('X', first.geometry.x, value => update([{ op: 'setGeometry', id: first.id, x: value }])),
          numberField('Y', first.geometry.y, value => update([{ op: 'setGeometry', id: first.id, y: value }])),
          numberField('宽', first.geometry.w, value => update([{ op: 'setGeometry', id: first.id, w: Math.max(1, value) }])),
          numberField('高', first.geometry.h, value => update([{ op: 'setGeometry', id: first.id, h: Math.max(1, value) }])),
        ),
        first.text !== null && first.text !== undefined
          ? h('div', { className: 'dsh-ppt-field' },
              h('label', null, '文本'),
              h('textarea', {
                className: 'dsh-ppt-input dsh-ppt-textarea',
                defaultValue: first.text.plain ?? '',
                rows: 3,
                onBlur: (event) => update([{
                  op: 'setText',
                  id: first.id,
                  paragraphs: String(event.target.value).split('\n').map(line => ({ runs: [{ text: line }] })),
                }]),
              }),
            )
          : null,
        h('div', { className: 'dsh-ppt-field' },
          h('label', null, '字号 / 颜色'),
          h('div', { className: 'dsh-ppt-inline' },
            numberField(null, first.text?.fontSize ?? 18, value => update([{ op: 'setTextStyle', id: first.id, fontSize: value }])),
            h('input', {
              type: 'color',
              className: 'dsh-ppt-color',
              value: normalizeColor(first.text?.color ?? '#111111'),
              onChange: (event) => update([{ op: 'setTextStyle', id: first.id, color: event.target.value.toUpperCase() }], '文字颜色'),
            }),
          ),
        ),
        h('div', { className: 'dsh-ppt-field' },
          h('label', null, '对齐'),
          h('div', { className: 'dsh-ppt-btnrow' },
            ['left', 'center', 'right'].map(align => h('button', {
              key: align,
              className: `dsh-ppt-mini${alignToCss(first.text?.align) === align ? ' is-on' : ''}`,
              onClick: () => update([{ op: 'setTextStyle', id: first.id, align }], '对齐'),
            }, { left: '左', center: '中', right: '右' }[align])),
            h('button', {
              className: `dsh-ppt-mini${first.text?.bold === true ? ' is-on' : ''}`,
              onClick: () => update([{ op: 'setTextStyle', id: first.id, bold: first.text?.bold !== true }], '粗体'),
            }, 'B'),
          ),
        ),
        h('div', { className: 'dsh-ppt-field' },
          h('label', null, '填充 / 描边'),
          h('div', { className: 'dsh-ppt-inline' },
            h('input', {
              type: 'color',
              className: 'dsh-ppt-color',
              title: '填充色',
              value: normalizeColor(first.style?.fill?.color ?? '#FFFFFF'),
              onChange: (event) => update([{ op: 'setFill', id: first.id, color: event.target.value.toUpperCase() }], '填充色'),
            }),
            h('input', {
              type: 'color',
              className: 'dsh-ppt-color',
              title: '描边色',
              value: normalizeColor(first.style?.line?.color ?? '#333333'),
              onChange: (event) => update([{ op: 'setLine', id: first.id, color: event.target.value.toUpperCase() }], '描边色'),
            }),
            h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'setLine', id: first.id, color: null }], '去掉描边') }, '无边框'),
          ),
        ),
        h('div', { className: 'dsh-ppt-field' },
          h('label', null, `层级 z=${first.z}`),
          h('div', { className: 'dsh-ppt-btnrow' },
            h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'sendToBack', id: first.id }], '置底') }, '置底'),
            h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'bringToFront', id: first.id }], '置顶') }, '置顶'),
            h('button', { className: 'dsh-ppt-mini', onClick: () => update([{ op: 'duplicate', id: first.id, dx: 16, dy: 16 }], '复制') }, '复制'),
            h('button', { className: 'dsh-ppt-mini is-danger', onClick: () => update([{ op: 'remove', id: first.id }], '删除') }, '删除'),
          ),
        ),
        selected.length > 1
          ? h('div', { className: 'dsh-ppt-field' },
              h('label', null, '批量对齐'),
              h('div', { className: 'dsh-ppt-btnrow' },
                ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map(mode => h('button', {
                  key: mode,
                  className: 'dsh-ppt-mini',
                  onClick: () => update([{ op: 'align', ids: selected.map(shape => shape.id), mode }], `对齐 ${mode}`),
                }, { left: '左齐', hcenter: '水平中', right: '右齐', top: '顶齐', vcenter: '垂直中', bottom: '底齐' }[mode])),
                h('button', {
                  className: 'dsh-ppt-mini',
                  onClick: () => update([{ op: 'align', ids: selected.map(shape => shape.id), mode: 'distributeH' }], '水平等距'),
                }, '水平等距'),
              ),
            )
          : null,
        h('div', { className: 'dsh-ppt-inspector-foot' },
          h('button', { className: 'dsh-ppt-mini', onClick: () => store.set({ selectedIds: [] }) }, '取消选择'),
        ),
      )
    }

    function selectionElement(shape) {
      return {
        id: shape.id,
        name: shape.name,
        kind: shape.kind,
        z: shape.z,
        geometry: shape.geometry,
        style: shape.style,
        text: shape.text === null || shape.text === undefined ? null : {
          plain: shape.text.plain,
          fontSize: shape.text.fontSize,
          color: shape.text.color,
          bold: shape.text.bold,
          italic: shape.text.italic,
          align: shape.text.align,
          fontFamily: shape.text.fontFamily,
        },
        image: shape.image === null || shape.image === undefined ? null : { mediaId: shape.image.mediaId },
      }
    }

    // ------------------------------------------------------------------ 顶栏

    function Header(props) {
      const { store, state, deck, actions, titleBar } = props
      // 会话相关的值**必须**在这里重新推导，不能引用 Panel 里的局部变量：
      // Header 是独立组件，Panel 的局部名在它里面是未声明的自由变量 ——
      // 这正是「点会话按钮整页白屏」的原因（渲染到菜单那段时抛 ReferenceError）。
      const connectedSessionId = typeof state.sessionId === 'string' ? state.sessionId : ''
      const sessionReady = connectedSessionId !== ''
      // 可选会话列表由 Panel 传入（它才拿得到 slot 的 sessionIds）
      const availableSessions = Array.isArray(props.sessionIds) ? props.sessionIds : []
      const file = deck === null ? null : deck.file
      return h('div', {
        className: `dsh-ppt-header${titleBar !== undefined && titleBar.draggable === true ? ' is-draggable' : ''}`,
        ...(titleBar !== undefined && titleBar.draggable === true && titleBar.onPointerDown !== undefined
          ? { onPointerDown: titleBar.onPointerDown, title: '按住这里可以拖动整个面板' }
          : {}),
      },
        h('div', { className: 'dsh-ppt-title' },
          h('span', { className: 'dsh-ppt-logo' }, 'PPT'),
          h('div', { className: 'dsh-ppt-titles' },
            h('b', null, '协同编辑画布'),
            h('span', { className: 'dsh-ppt-sub', title: file ?? '' },
              deck === null
                ? '未打开演示文稿'
                : `${file.split(/[/\\]/).pop()} · rev ${deck.rev} · ${deck.slides.length} 页`),
          ),
        ),
        h('div', { className: 'dsh-ppt-tools' },
          h('button', {
            className: 'dsh-ppt-btn is-primary',
            disabled: state.sending,
            title: '打开本地 .pptx（系统文件对话框；也可以直接把文件拖进来）',
            onClick: () => { void actions.pickAndOpen() },
          }, '打开'),
          h('button', {
            className: 'dsh-ppt-btn',
            disabled: state.sending,
            title: '打开内置演示文稿',
            onClick: () => actions.openDemo(),
          }, '演示文稿'),
          h('button', {
            className: 'dsh-ppt-btn',
            disabled: state.sending || deck === null,
            title: '重新读取文件（外部改过之后用）',
            onClick: () => actions.reload(),
          }, '重载'),
          h('span', { className: 'dsh-ppt-sep' }),
          h('button', {
            className: 'dsh-ppt-btn',
            disabled: !state.history.canUndo || state.sending,
            title: '撤销（Ctrl+Z）',
            onClick: () => actions.undo(),
          }, '↶ 撤销'),
          h('button', {
            className: 'dsh-ppt-btn',
            disabled: !state.history.canRedo || state.sending,
            title: '重做（Ctrl+Shift+Z）',
            onClick: () => actions.redo(),
          }, '↷ 重做'),
          state.history.entries !== undefined && state.history.entries.length > 0
            ? h('span', { className: 'dsh-ppt-revbadge', title: '最近一次修改' }, `rev ${state.history.rev}`)
            : null,
          h('span', { className: 'dsh-ppt-sep' }),
          // 画布画法切换：精确渲染（LibreOffice）↔ 内置重画（快，但只是近似）
          h('button', {
            className: 'dsh-ppt-btn',
            title: state.renderMode === 'dom'
              ? '当前是内置重画（近似）。点这里改用 LibreOffice 精确渲染。'
              : '当前是 LibreOffice 精确渲染。点这里改用内置重画（更快，但排版是近似）。',
            onClick: () => {
              const next = state.renderMode === 'dom' ? 'fitted' : 'dom'
              store.set({ renderMode: next })
              savePrefs({ renderMode: next })
            },
          }, state.renderMode === 'dom' ? '渲染：内置' : '渲染：精确'),
          // 会话状态按钮：显示当前连的是哪个，点它切换（或新建）
          h('button', {
            className: `dsh-ppt-btn dsh-ppt-sessionbadge${sessionReady ? ' is-ok' : ''}`,
            title: sessionReady
              ? `已连接 ${connectedSessionId}；点击切换会话`
              : '还没有连接会话；首次发送会自动新建一个，也可以点这里选',
            onClick: (event) => {
              event.stopPropagation()
              store.set({ sessionMenuOpen: state.sessionMenuOpen !== true })
            },
          }, sessionReady ? `会话 ${String(connectedSessionId).slice(-6)}` : '未连接会话'),
          state.sessionMenuOpen === true
            ? h('div', { className: 'dsh-ppt-sessionmenu' },
                h('div', { className: 'dsh-ppt-sessionmenu-title' }, '连接到会话'),
                ...availableSessions.slice(-8).reverse().map(id => h('button', {
                  key: id,
                  className: `dsh-ppt-sessionmenu-item${id === connectedSessionId ? ' is-current' : ''}`,
                  onClick: () => {
                    store.set({ sessionId: id, sessionMenuOpen: false })
                    savePrefs({ sessionId: id })
                    void ensureInWorkspace(id)
                    logOp(`已连接会话 ${id}`, 'ok')
                  },
                }, id === connectedSessionId ? `✓ ${id}` : id)),
                h('button', {
                  className: 'dsh-ppt-sessionmenu-item is-new',
                  onClick: () => { void actions.newSession() },
                }, '↻ 连接到最近会话'),
                availableSessions.length === 0
                  ? h('div', { className: 'dsh-ppt-sessionmenu-empty' },
                      '宿主没有返回会话列表。请先在左侧打开或新建一个对话，再点这里刷新。')
                  : null,
              )
            : null,
          h('span', { className: 'dsh-ppt-sep' }),
          h('button', {
            className: 'dsh-ppt-btn dsh-ppt-btn-close',
            title: '最小化面板（数据保留）',
            onClick: () => store.set({ open: false }),
          }, '—'),
        ),
      )
    }

    // ------------------------------------------------------------------ 拖拽层

    /** 拖拽提示条；拖进文件时覆盖整个界面。 */
    function DropOverlay(props) {
      const { state } = props
      if (state.dragDepth <= 0) return null
      return h('div', { className: 'dsh-ppt-drop' },
        h('div', { className: 'dsh-ppt-dropcard' },
          h('b', null, '松开即可打开这份演示文稿'),
          h('span', null, state.dropHint ?? '仅支持 .pptx；打开后画布会直接读写这个文件（可撤销）'),
        ),
      )
    }

    // ------------------------------------------------------------------ 指令框

    function InstructionBar(props) {
      const { store, state, actions, sessionDiagnostics } = props
      const rows = state.selectedIds.length
      // 只要有通道就允许点：首次点击会自动新建并连接会话。
      const canSend = promptTo !== null
      // 禁用条件的实时清单：按钮灰着的时候，用户能一眼看出是哪一项没满足
      // （之前只显示一句笼统的话，导致「还是灰的」这种反馈无法定位）。
      const text = state.instruction.trim()
      const blockers = [
        promptTo === null ? '未接入 AI 通道' : null,
        rows === 0 ? '未选中元素' : null,
        text === '' ? '指令为空' : null,
        state.sending ? '正在处理上一条' : null,
      ].filter(item => item !== null)
      return h('div', { className: 'dsh-ppt-instruction' },
        h('div', { className: 'dsh-ppt-instr-head' },
          h('span', { className: 'dsh-ppt-instr-title' }, 'AI 修改指令'),
          h('span', { className: 'dsh-ppt-instr-sel' }, rows === 0 ? '未选中元素' : `已选中 ${rows} 个元素`),
          state.sending ? h('span', { className: 'dsh-ppt-instr-sending' }, 'AI 处理中…') : null,
          state.drafts.length > 0 ? h('span', { className: 'dsh-ppt-instr-draft' }, `${state.drafts.length} 条待发`) : null,
        ),
        h('div', { className: 'dsh-ppt-instr-body' },
          h('textarea', {
            className: 'dsh-ppt-instr-input',
            placeholder: 'Enter 发送给 AI，Shift+Enter 加入待发。例如：把标题改成红色并右对齐',
            value: state.instruction,
            rows: 2,
            onChange: (event) => store.set({ instruction: event.target.value }),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              // Enter 优先「发送给 AI」（用户的主要意图）；要攒多条时用 Shift+Enter
              // 加入待发，或点「加入待发」按钮。
              if (event.shiftKey) {
                event.preventDefault()
                actions.addDraft()
                return
              }
              event.preventDefault()
              actions.send()
            },
          }),
          h('div', { className: 'dsh-ppt-instr-actions' },
            h('button', {
              className: 'dsh-ppt-btn',
              disabled: state.instruction.trim() === '',
              title: 'Shift+Enter：加入待发列表（Enter 直接发送）',
              onClick: () => actions.addDraft(),
            }, '加入待发'),
            h('button', {
              className: 'dsh-ppt-btn is-primary',
              disabled: state.sending || rows === 0 || text === '' || promptTo === null,
              title: blockers.length === 0
                ? 'Ctrl/⌘ + Enter：发送给 AI'
                : `还不能发送：${blockers.join('、')}`,
              onClick: () => { void actions.send() },
            }, state.sending ? 'AI 处理中…' : '发送给 AI'),
          ),
        ),
        // 按钮灰着时，把差哪一项直接写出来（缺什么补什么，不用再问）。
        blockers.length > 0 && !state.sending
          ? h('div', { className: 'dsh-ppt-diag' }, `发送前提：${blockers.join(' · ')}`)
          : null,
        state.drafts.length > 0
          ? h('div', { className: 'dsh-ppt-drafts' }, state.drafts.map((draft, index) => h('span', {
              key: `${index}-${draft}`,
              className: 'dsh-ppt-chip',
              onClick: () => store.set({ instruction: draft, drafts: state.drafts.filter((_, i) => i !== index) }),
              title: '点击编辑这条指令',
            }, draft.length > 28 ? `${draft.slice(0, 28)}…` : draft)))
          : null,
        promptTo === null
          ? h('div', { className: 'dsh-ppt-warn' },
              '「把指令发给 AI」这条链路没接上。',
              h('div', { className: 'dsh-ppt-diag' },
                typeof sessionDiagnostics === 'function' ? sessionDiagnostics() : '无诊断'),
            )
          : null,
        state.history.entries !== undefined && state.history.entries.length > 0
          ? h('div', { className: 'dsh-ppt-histlist' }, state.history.entries.slice(0, 4).map((entry, index) => h('div', {
              key: `${entry.rev}-${index}`,
              className: 'dsh-ppt-histrow',
            },
              h('span', { className: 'dsh-ppt-histrev' }, `rev ${entry.rev}`),
              h('span', { className: 'dsh-ppt-histsum', title: entry.summary }, entry.summary ?? ''),
            )))
          : null,
      )
    }

    // ------------------------------------------------------------------ 路径弹窗

    /**
     * 打开演示文稿 —— **面板内的文件浏览器**。
     *
     * 为什么不用系统文件对话框：这台宿主**没有**选文件的对话框。
     * 实测：`uiWorkspace.pickDirectory()` 明确是「目录选择器」（点「打开」弹出的是
     * 选择工作区的窗口就是这个原因），`directoryPicker` 服务按设计只提供目录，
     * 桌面端 Electron 主进程里也只注册了 `dialog.showOpenDialog({properties:['openDirectory']})`。
     * 所以选文件只能在面板里自己做。
     *
     * 浏览靠 `uiWorkspace.listDirectory(path?)`：返回 `{ path, entries[{name,path}], crumbs }`。
     * 「选择文件夹」按钮仍然有用 —— 它跳到目标目录，省得一层层点。
     */
    function PathDialog(props) {
      const { store, state, onConfirm } = props
      if (!state.askPath) return null
      const listing = state.listing
      const entries = Array.isArray(listing?.entries) ? listing.entries : []
      // 目录判定：listDirectory 的条目只有 {name, path, hidden}，没有 kind 字段，
      // 所以按「名字里有 . 视为文件」这一惯例区分（目录名通常不带点）。
      const isDir = (entry) => typeof entry?.name === 'string' && !entry.name.includes('.')
      const dirEntries = entries.filter(isDir)
      const fileEntries = entries.filter(entry => !isDir(entry))
      const pptx = fileEntries.filter(entry => /\.pptx$/i.test(entry.name))
      const other = fileEntries.filter(entry => !/\.pptx$/i.test(entry.name))

      const browse = (path) => {
        store.set({ listing: null, listingError: null })
        Promise.resolve(listDirectory === null ? null : listDirectory(path))
          .then(next => {
            if (next === null) {
              store.set({ listingError: '宿主没有提供目录浏览（uiWorkspace.listDirectory）。请直接输入路径。' })
              return
            }
            store.set({ listing: next, pickerPath: next.path ?? path ?? '' })
          })
          .catch(error => store.set({ listingError: describeError(error) }))
      }

      const openEntry = (entry) => {
        store.set({ pathDraft: entry.path, askPath: false })
        onConfirm(entry.path)
      }

      return h('div', { className: 'dsh-ppt-modal-back', onClick: () => store.set({ askPath: false }) },
        h('div', { className: 'dsh-ppt-modal is-picker', onClick: (event) => event.stopPropagation() },
          h('b', null, '打开演示文稿'),
          h('div', { className: 'dsh-ppt-modal-hint' },
            '点击列表里的 .pptx 打开；双击文件夹进入。也可以直接输入绝对路径，或把文件拖到面板上。'),

          // 路径条 + 操作
          h('div', { className: 'dsh-ppt-picker-bar' },
            h('button', {
              className: 'dsh-ppt-btn',
              title: '回到宿主主目录',
              onClick: () => browse(undefined),
            }, '⌂'),
            h('button', {
              className: 'dsh-ppt-btn',
              title: '上一层',
              onClick: () => {
                const current = state.pickerPath ?? ''
                const cut = Math.max(current.lastIndexOf('\\'), current.lastIndexOf('/'))
                if (cut > 2) browse(current.slice(0, cut))
              },
            }, '↑'),
            h('button', {
              className: 'dsh-ppt-btn',
              title: '用系统的目录选择器跳到某个文件夹（宿主只提供选目录）',
              onClick: () => {
                if (pickPath === null) return
                Promise.resolve(pickPath()).then((picked) => {
                  if (typeof picked === 'string' && picked !== '') browse(picked)
                })
              },
            }, '选文件夹…'),
            h('button', { className: 'dsh-ppt-btn', onClick: () => browse(state.pickerPath ?? undefined) }, '↻'),
          ),
          h('input', {
            className: 'dsh-ppt-input',
            value: state.pickerPath ?? '',
            placeholder: 'D:\\work',
            onChange: (event) => store.set({ pickerPath: event.target.value }),
            onKeyDown: (event) => { if (event.key === 'Enter') browse(store.get().pickerPath) },
          }),

          state.listingError !== null && state.listingError !== undefined
            ? h('div', { className: 'dsh-ppt-warn' }, state.listingError)
            : null,

          listing === null
            ? h('div', { className: 'dsh-ppt-empty' }, '正在读取目录…（若长时间无内容，说明宿主没有提供目录浏览）')
            : h('div', { className: 'dsh-ppt-picker-list' },
                dirEntries.map(entry => h('button', {
                  key: `d-${entry.path}`,
                  className: 'dsh-ppt-picker-row is-dir',
                  onClick: () => browse(entry.path),
                }, '📁 ', entry.name)),
                pptx.map(entry => h('button', {
                  key: `f-${entry.path}`,
                  className: 'dsh-ppt-picker-row is-pptx',
                  onClick: () => openEntry(entry),
                }, '📊 ', entry.name)),
                other.length > 0
                  ? h('div', { className: 'dsh-ppt-picker-more' }, `（另有 ${other.length} 个非 .pptx 文件未列出）`)
                  : null,
                dirEntries.length === 0 && pptx.length === 0
                  ? h('div', { className: 'dsh-ppt-empty' }, '这个目录里没有子文件夹，也没有 .pptx 文件。')
                  : null,
              ),

          h('div', { className: 'dsh-ppt-modal-actions' },
            h('button', { className: 'dsh-ppt-btn', onClick: () => store.set({ askPath: false }) }, '取消'),
            h('button', { className: 'dsh-ppt-btn is-primary', onClick: () => onConfirm() }, '打开输入的路径'),
          ),
        ),
      )
    }

    function Toasts(props) {
      const { store, state } = props
      if (state.toasts.length === 0) return null
      return h('div', { className: 'dsh-ppt-toasts' }, state.toasts.map(toast => h('div', {
        key: toast.id,
        className: `dsh-ppt-toast is-${toast.kind}`,
      },
        h('div', { className: 'dsh-ppt-toast-body' },
          h('b', null, toast.title),
          toast.detail === undefined ? null : h('span', null, toast.detail),
        ),
        toast.action === undefined ? null : h('button', {
          className: 'dsh-ppt-btn is-primary',
          onClick: () => { toast.action.run(); store.set({ toasts: store.get().toasts.filter(item => item.id !== toast.id) }) },
        }, toast.action.label),
        h('button', {
          className: 'dsh-ppt-toast-x',
          onClick: () => store.set({ toasts: store.get().toasts.filter(item => item.id !== toast.id) }),
        }, '×'),
      )))
    }

    // ------------------------------------------------------------------ 拖动浮窗

    /**
     * 浮层面板外壳：把 Panel 包进一个可以用标题栏自由拖动的窗口。
     * （浏览器没有原生窗口拖动，所以用 pointer 事件 + 绝对定位自己实现；
     *   只处理面板内部的拖动，不改窗口位置。）
     */
    function FloatingPanel(props) {
      const { store, openPanel, titleBar, geometry } = props
      const state = useStore(store)
      const geo = geometry ?? { load: () => null, save: () => {}, initial: { width: 1180, height: 760 } }

      const [box, setBox] = React.useState(() => {
        const saved = geo.load()
        return {
          x: saved !== null && Number.isFinite(saved.x) ? saved.x : null,
          y: saved !== null && Number.isFinite(saved.y) ? saved.y : null,
          width: saved?.width ?? geo.initial.width,
          height: saved?.height ?? geo.initial.height,
          dragging: false,
        }
      })
      const dragRef = React.useRef(null)
      const boxRef = React.useRef(box)
      boxRef.current = box

      const clampBox = React.useCallback((next) => {
        const maxX = Math.max(0, win.innerWidth - 160)
        const maxY = Math.max(0, win.innerHeight - 60)
        return {
          ...next,
          x: next.x === null ? null : clamp(next.x, -next.width + 160, maxX),
          y: next.y === null ? null : clamp(next.y, 0, maxY),
          width: clamp(next.width, 620, Math.max(620, win.innerWidth - 24)),
          height: clamp(next.height, 380, Math.max(380, win.innerHeight - 24)),
        }
      }, [])

      const persist = React.useCallback((next) => {
        geo.save({ x: next.x, y: next.y, width: next.width, height: next.height })
      }, [geo])

      /** 标题栏拖动（不含按钮区域）。 */
      const onTitlePointerDown = React.useCallback((event) => {
        if (event.button !== 0) return
        const target = event.target
        if (target !== null && target !== undefined && typeof target.closest === 'function' && target.closest('button') !== null) return
        const host = event.currentTarget.parentElement
        if (host === null || host === undefined) return
        const rect = host.getBoundingClientRect()
        dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
        setBox(current => ({ ...current, dragging: true }))
      }, [])

      /** 右下角缩放。 */
      const onResizePointerDown = React.useCallback((event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const start = { x: event.clientX, y: event.clientY, w: boxRef.current.width, h: boxRef.current.height }
        const onMove = (moveEvent) => {
          setBox(current => clampBox({
            ...current,
            width: start.w + (moveEvent.clientX - start.x),
            height: start.h + (moveEvent.clientY - start.y),
          }))
        }
        const onUp = () => {
          win.removeEventListener('pointermove', onMove)
          win.removeEventListener('pointerup', onUp)
          setBox(current => { persist(current); return current })
        }
        win.addEventListener('pointermove', onMove)
        win.addEventListener('pointerup', onUp)
      }, [clampBox, persist])

      React.useEffect(() => {
        if (!box.dragging) return undefined
        const onMove = (event) => {
          const drag = dragRef.current
          if (drag === null) return
          setBox(current => clampBox({
            ...current,
            x: event.clientX - drag.offsetX,
            y: event.clientY - drag.offsetY,
          }))
        }
        const onUp = () => {
          dragRef.current = null
          setBox(current => {
            const next = { ...current, dragging: false }
            persist(next)
            return next
          })
        }
        win.addEventListener('pointermove', onMove)
        win.addEventListener('pointerup', onUp)
        return () => {
          win.removeEventListener('pointermove', onMove)
          win.removeEventListener('pointerup', onUp)
        }
      }, [box.dragging, clampBox, persist])

      React.useEffect(() => {
        const onResize = () => setBox(current => clampBox(current))
        win.addEventListener('resize', onResize)
        return () => win.removeEventListener('resize', onResize)
      }, [clampBox])

      if (!state.open) {
        return h('button', {
          className: 'dsh-ppt-launcher',
          title: '打开 PPT 协同编辑画布',
          onClick: () => openPanel(),
        }, 'PPT 画布')
      }

      const style = {
        left: box.x === null ? undefined : `${px(box.x)}px`,
        top: box.y === null ? undefined : `${px(box.y)}px`,
        width: `${px(box.width)}px`,
        height: `${px(box.height)}px`,
        right: box.x === null ? '20px' : undefined,
        bottom: box.y === null ? '20px' : undefined,
      }

      return h('div', { className: `dsh-ppt-float${box.dragging ? ' is-dragging' : ''}`, style },
        h(Panel, {
          store,
          titleBar: titleBar === undefined
            ? { draggable: true, onPointerDown: onTitlePointerDown, onClose: () => store.set({ open: false }) }
            : { ...titleBar, draggable: true, onPointerDown: onTitlePointerDown },
        }),
        h('div', {
          className: 'dsh-ppt-resize is-se',
          title: '拖动改变大小',
          onPointerDown: onResizePointerDown,
        }),
      )
    }

    // ------------------------------------------------------------------ 主界面

    function Panel(props) {
      const { store, titleBar } = props
      const state = useStore(store)
      const deck = state.deck
      const slide = deck === null ? null : (deck.slides[state.slideIndex] ?? deck.slides[0] ?? null)
      // 已连接的会话：状态里持久化（首次发送时若为空就新建一个）。
      // 同步进 ref：actions.send() 不在渲染作用域里，只能通过 ref 读。
      const connectedSessionId = typeof state.sessionId === 'string' ? state.sessionId : ''
      sessionIdRef.current = connectedSessionId
      const sessionReady = connectedSessionId !== ''
      const availableSessions = Array.isArray(props.sessionIds) ? props.sessionIds : []
      sessionIdRef.latest = availableSessions
      sessionIdRef.workspaceId = typeof props.workspaceId === 'string' ? props.workspaceId : sessionIdRef.workspaceId

      // 已连接会话的布尔位交给 AI 面板显示状态（state 里存 id，这里派生一下）。
      if (state.connectedSession !== sessionReady) store.set({ connectedSession: sessionReady })

      /**
       * 订阅 AI 事件流。会话变化时重订阅；卸载时退订（watchAi 返回的退订函数会
       * 释放 retain 出来的引用）。
       */
      React.useEffect(() => {
        if (watchAi === null || connectedSessionId === '') return undefined
        const off = watchAi(connectedSessionId, (next) => {
          store.set({ ai: { thinking: next.thinking ?? '', reply: next.reply ?? '', error: next.error ?? null } })
        })
        return () => { if (typeof off === 'function') off() }
      }, [connectedSessionId, store])

      /**
       * 让连接的会话出现在左侧工作区列表里（和普通对话一样）。
       * 放在 effect 里而不是各个连接入口里：这样「从 localStorage 恢复的会话」
       * 「菜单里选的会话」「首次发送自动连的会话」三条路都会归入工作区。
       */
      const attachedRef = React.useRef('')
      React.useEffect(() => {
        if (connectedSessionId === '' || attachedRef.current === connectedSessionId) return
        attachedRef.current = connectedSessionId
        void ensureInWorkspace(connectedSessionId)
      }, [connectedSessionId])

      /**
       * 打开对话框时读一次目录。宿主没有选文件的对话框，所以这里是唯一的
       * 「浏览并选 .pptx」入口；`listDirectory()` 省略参数即宿主主目录。
       */
      const startedListingRef = React.useRef(false)
      React.useEffect(() => {
        if (state.askPath !== true) {
          startedListingRef.current = false
          return
        }
        if (startedListingRef.current) return
        startedListingRef.current = true
        if (listDirectory === null) {
          store.set({ listingError: '宿主没有提供目录浏览（uiWorkspace.listDirectory）。请直接输入路径。' })
          return
        }
        Promise.resolve(listDirectory(undefined))
          .then(listing => store.set({ listing, pickerPath: listing?.path ?? '' }))
          .catch(error => store.set({ listingError: describeError(error) }))
      }, [state.askPath, store])

      const toast = React.useCallback((title, toastOptions = {}) => {
        const id = `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`
        const entry = { id, title, detail: toastOptions.detail, kind: toastOptions.kind ?? 'info', action: toastOptions.action }
        store.set(current => ({ toasts: current.toasts.concat([entry]).slice(-4) }))
        timeout(() => {
          store.set(current => ({ toasts: current.toasts.filter(item => item.id !== id) }))
        }, toastOptions.duration ?? 6000)
      }, [store])

      const logOp = React.useCallback((text, kind) => {
        store.set(current => ({
          log: [{ id: `l${Date.now()}${Math.random().toString(36).slice(2, 5)}`, text, kind, at: Date.now() }]
            .concat(current.log).slice(0, 60),
        }))
      }, [store])

      const refreshHistory = React.useCallback(async () => {
        try {
          const status = await callApi('history')
          store.set({ history: status })
        } catch (error) { /* 没有打开文档时忽略 */ }
      }, [store])

      const adoptDeck = React.useCallback((next) => {
        store.set(current => {
          const ids = new Set(next.slides.flatMap(item => item.shapes.map(shape => shape.id)))
          return {
            deck: next,
            selectedIds: current.selectedIds.filter(id => ids.has(id)),
            slideIndex: clamp(current.slideIndex, 0, Math.max(0, next.slides.length - 1)),
            error: null,
          }
        })
      }, [store])

      const highlightChanged = React.useCallback((ids) => {
        if (!Array.isArray(ids) || ids.length === 0) return
        const patch = {}
        for (const id of ids) patch[id] = true
        store.set(current => ({ highlights: { ...current.highlights, ...patch } }))
        timeout(() => {
          store.set(current => {
            const next = { ...current.highlights }
            for (const id of ids) delete next[id]
            return highlightsEqual(next, current.highlights) ? {} : { highlights: next }
          })
        }, 3200)
      }, [store])

      const actionsRef = React.useRef({})
      const pendingRef = React.useRef({ requestId: null, baseRev: 0, changedIds: [] })

      const adoptAiResult = React.useCallback((next) => {
        adoptDeck(next)
        const changed = pendingRef.current.changedIds
        if (changed.length > 0) highlightChanged(changed)
        pendingRef.current = { requestId: null, baseRev: 0, changedIds: [] }
      }, [adoptDeck, highlightChanged])

      const waitForAi = React.useCallback(async (requestId, baseRev) => {
        const deadline = Date.now() + 150000
        let sawRunning = false
        let idleTicks = 0
        while (Date.now() < deadline) {
          // 不再依赖「会话 running」信号：AI 是否改了文档，直接看 rev 有没有推进
          // （下面按 rev 判定），所以这里不需要额外的会话状态探测。
          let running = false
          if (running) {
            sawRunning = true
            idleTicks = 0
          } else if (sawRunning) {
            idleTicks += 1
            if (idleTicks >= 2) break
          }
          await new Promise(resolve => { timeout(resolve, 1000) })
        }
        try {
          const status = await callApi('history')
          store.set({ history: status })
          if (status.rev > baseRev) {
            const next = await callApi('deck', {})
            adoptAiResult(next)
            logOp(`AI 已应用修改：rev ${baseRev} → ${status.rev}`, 'ok')
            toast('AI 已应用修改', { kind: 'ok', detail: `文档已更新到 rev ${status.rev}，改动元素已高亮。` })
          } else {
            logOp('AI 未产生文档改动', 'warn')
            toast('AI 没有返回修改方案', {
              kind: 'warn',
              detail: '可能它只回了文字、或没有调用 ppt_canvas_apply。可重试，或用右侧属性面板手动改。',
              action: { label: '重试', run: () => { void actionsRef.current.send() } },
            })
          }
        } catch (error) {
          toast('刷新失败', { kind: 'error', detail: describeError(error) })
        } finally {
          store.set({ sending: false, pendingRequestId: null })
        }
      }, [adoptAiResult, logOp, store, toast])

      const actions = React.useMemo(() => ({
        async openDemo() {
          store.set({ loading: true, loadingLabel: '准备内置演示文稿…', error: null })
          try {
            const next = await callApi('demo', {})
            adoptDeck(next)
            savePrefs({ open: true })
            logOp(`打开内置演示文稿（${next.slides.length} 页）`, 'ok')
          } catch (error) {
            store.set({ error: describeError(error) })
            toast('打开失败', { kind: 'error', detail: describeError(error) })
          } finally {
            store.set({ loading: false, loadingLabel: '' })
            await refreshHistory()
          }
        },
        async openPath(path) {
          if (!looksLikePptx(path)) {
            toast('这不是 .pptx 文件', { kind: 'warn', detail: `收到的是：${String(path).slice(0, 120)}` })
            return
          }
          store.set({ loading: true, loadingLabel: '解析 .pptx…', error: null })
          try {
            const next = await callApi('open', { path })
            adoptDeck(next)
            savePrefs({ open: true, lastDir: path })
            logOp(`打开 ${next.file}（${next.slides.length} 页）`, 'ok')
          } catch (error) {
            store.set({ error: describeError(error) })
            toast('打开失败', { kind: 'error', detail: describeError(error) })
          } finally {
            store.set({ loading: false, loadingLabel: '' })
            await refreshHistory()
          }
        },

        /**
         * 把「原生对话框选中的内容」交给 Host 打开：Host 落到托管目录后再按路径打开
         * （插件是按路径读写文件的，而标准 DOM 拿不到 File 的本地路径）。
         */
        async openBytes(name, content) {
          store.set({ loading: true, loadingLabel: '读取所选文件…', error: null })
          try {
            const next = await callApi('files', { files: [{ name, content }] })
            adoptDeck(next)
            savePrefs({ open: true })
            logOp(`打开 ${next.file}（${next.slides.length} 页）`, 'ok')
          } catch (error) {
            store.set({ error: describeError(error) })
            toast('打开失败', { kind: 'error', detail: describeError(error) })
          } finally {
            store.set({ loading: false, loadingLabel: '' })
            await refreshHistory()
          }
        },

        /**
         * 普通应用的「打开文件」：先弹系统原生对话框；容器不支持时退回面板内浏览器。
         * @returns {Promise<void>}
         */
        async pickAndOpen() {
          if (pickPptx === null) {
            store.set({ askPath: true })
            return
          }
          let picked
          try {
            picked = await pickPptx()
          } catch (error) {
            toast('无法打开文件对话框', { kind: 'warn', detail: describeError(error) })
            store.set({ askPath: true })
            return
          }
          if (picked === null || picked === undefined) return // 用户取消
          if (typeof picked.path === 'string' && picked.path !== '') {
            await actionsRef.current.openPath(picked.path)
            return
          }
          if (typeof picked.content === 'string' && picked.content !== '') {
            await actionsRef.current.openBytes(picked.name, picked.content)
            return
          }
          store.set({ askPath: true })
        },
        async reload() {
          store.set({ loading: true, loadingLabel: '重新读取文件…' })
          try {
            const next = await callApi('deck', { force: true })
            adoptDeck(next)
            logOp('已重新读取文件', 'ok')
          } catch (error) {
            toast('重载失败', { kind: 'error', detail: describeError(error) })
          } finally {
            store.set({ loading: false, loadingLabel: '' })
            await refreshHistory()
          }
        },
        async undo() {
          try {
            const next = await callApi('undo', { steps: 1 })
            adoptDeck(next)
            logOp('撤销一步', 'ok')
          } catch (error) {
            toast('撤销失败', { kind: 'error', detail: describeError(error) })
          } finally {
            await refreshHistory()
          }
        },
        async redo() {
          try {
            const next = await callApi('redo', { steps: 1 })
            adoptDeck(next)
            logOp('重做一步', 'ok')
          } catch (error) {
            toast('重做失败', { kind: 'error', detail: describeError(error) })
          } finally {
            await refreshHistory()
          }
        },
        async manual(ops, label) {
          if (ops.length === 0) return
          const targetId = ops[0]?.id
          try {
            const result = await callApi('apply', {
              patch: { summary: label ?? '手动调整', ops },
              source: 'user',
            })
            adoptDeck(result.deck)
            highlightChanged(result.changedIds ?? (targetId === undefined ? [] : [targetId]))
            logOp(`手动调整：${label ?? ops.map(op => op.op).join('、')}`, 'user')
          } catch (error) {
            toast('调整失败', { kind: 'error', detail: describeError(error) })
          } finally {
            await refreshHistory()
          }
        },
        addDraft() {
          const text = store.get().instruction.trim()
          if (text === '') return
          store.set(current => ({ drafts: current.drafts.concat([text]), instruction: '' }))
        },
        /** 连接到一个会话（标题栏会话菜单里的「连接到最近会话」）。 */
        async newSession() {
          store.set({ sessionMenuOpen: false })
          if (selectSession === null) {
            toast('无法连接会话', { kind: 'warn', detail: '宿主没有提供会话来源。' })
            return
          }
          const result = await connectNewSession()
          if (result.ok !== true) {
            toast('连接会话失败', { kind: 'error', detail: result.message })
            return
          }
          logOp(`已连接会话 ${result.sessionId}`, 'ok')
        },

        async send() {
          if (promptTo === null) {
            toast('这里不能发指令', { kind: 'warn', detail: '请在对话面板的「PPT 画布」里发送。' })
            return
          }
          const snapshot = store.get()
          const text = [snapshot.instruction.trim()].concat(snapshot.drafts).filter(item => item !== '').join('；')
          if (text === '') return
          if (snapshot.selectedIds.length === 0) {
            toast('请先选择元素', { kind: 'warn', detail: '点击、Shift 多选或框选画布上的元素。' })
            return
          }
          let sessionId = typeof sessionIdRef.current === 'string' ? sessionIdRef.current : ''
          // 首次发送且还没连接：自动新建一个会话并连上（用户不需要先去别处点新建）。
          if (sessionId === '') {
            toast('正在连接会话…', { detail: '首次发送会自动连接到一个可用会话。' })
            const created = await connectNewSession()
            if (created.ok !== true) {
              toast('连接会话失败', { kind: 'error', detail: created.message })
              return
            }
            sessionId = created.sessionId
            store.set({ sessionId })
            savePrefs({ sessionId })
            await ensureInWorkspace(sessionId)
            logOp(`已连接会话 ${sessionId}`, 'ok')
          }
          const currentDeck = snapshot.deck
          const slideIndex = snapshot.slideIndex
          const elements = snapshot.selectedIds
            .map(id => findShape(currentDeck, id))
            .filter(shape => shape !== null)
            .map(selectionElement)
          if (elements.length === 0) {
            toast('选中的元素已不存在', { kind: 'warn', detail: '文档可能已被改动，请重新选择。' })
            return
          }
          const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
          const payload = {
            requestId,
            deckRev: currentDeck.rev,
            instruction: text,
            selectionMode: elements.length > 1 ? 'multi' : 'single',
            slideIndex,
            selectedIds: elements.map(element => element.id),
            elements,
            locale: 'zh-CN',
            createdAt: Date.now(),
          }
          store.set({ sending: true, error: null })
          try {
            await callApi('context', payload)
          } catch (error) {
            store.set({ sending: false, error: describeError(error) })
            toast('提交选区失败', { kind: 'error', detail: describeError(error) })
            return
          }
          const message = [
            '【PPT 协同编辑】我在 PPT 画布上选中了 ' + elements.length + ' 个元素：',
            elements.map(element => `- ${element.name}（${element.id}，${element.kind}）`).join('\n'),
            '',
            '我的修改要求：' + text,
            '',
            '请先调用 ppt_canvas_context（requestId=' + requestId + '）取回这些元素的完整属性（位置、尺寸、样式、层级、文本），',
            '再据此生成最小必要的 ops，调用 ppt_canvas_apply（requestId=' + requestId + '）应用；',
            '如果方案不确定，先用 dryRun: true 试算。修改会在画布上实时呈现给用户。',
          ].join('\n')
          const result = await promptTo(message, sessionId)
          if (result === undefined || result.ok !== true) {
            const detail = result?.error === undefined ? '未知错误' : `${result.error.code}: ${result.error.message}`
            store.set({ sending: false })
            toast('指令没有发送成功', { kind: 'error', detail })
            return
          }
          store.set({ drafts: [], instruction: '', sending: true })
          pendingRef.current.requestId = requestId
          logOp(`已发送指令给 AI：${text}`, 'ai')
          toast('已发送给 AI', { detail: 'AI 正在生成修改方案，完成后画布会自动刷新。' })
          await waitForAi(requestId, currentDeck.rev)
        },
      }), [adoptDeck, logOp, refreshHistory, store, toast, waitForAi])

      React.useEffect(() => { actionsRef.current = actions }, [actions])

      // 快捷键：Ctrl+Z / Ctrl+Shift+Z
      React.useEffect(() => {
        const onKey = (event) => {
          if (!store.get().open) return
          const tag = event.target?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault()
            if (event.shiftKey) actions.redo()
            else actions.undo()
          }
          if (event.key === 'Escape' && prefs.open === true) store.set({ selectedIds: [], askPath: false })
        }
        win.addEventListener('keydown', onKey)
        return () => win.removeEventListener('keydown', onKey)
      }, [actions, store])

      // 首次打开：恢复上次的文件（面板模式还要恢复「上次是打开状态」）。
      const booted = React.useRef(false)
      React.useEffect(() => {
        if (booted.current) return
        booted.current = true
        if (prefs.open !== true) return
        if (typeof prefs.lastDir === 'string' && prefs.lastDir !== '') actions.openPath(prefs.lastDir)
        else actions.openDemo()
      }, [actions])

      React.useEffect(() => { void refreshHistory() }, [refreshHistory])

      // 外部改动（另一处面板 / PowerPoint / AI 工具）时自动重载：rev 变了就刷新。
      React.useEffect(() => {
        let stopped = false
        const tick = async () => {
          if (stopped) return
          if (store.get().deck === null || store.get().sending) return
          try {
            const status = await callApi('history')
            if (!stopped && status.rev !== store.get().deck.rev) {
              const next = await callApi('deck', {})
              if (!stopped) {
                adoptDeck(next)
                logOp(`检测到外部改动，已刷新到 rev ${next.rev}`, 'ok')
              }
            }
          } catch (error) { /* 静默：轮询失败不该打扰用户 */ }
        }
        const dispose = options.interval === undefined
          ? (() => { const handle = setInterval(tick, 4000); return () => clearInterval(handle) })()
          : options.interval(tick, 4000)
        return () => { stopped = true; dispose() }
      }, [adoptDeck, logOp, store])

      // 拖拽打开：整块面板/窗口都是投放目标。
      const onDragEnter = React.useCallback((event) => {
        event.preventDefault()
        const path = extractDroppedPath(event)
        const hint = path === null
          ? '浏览器不会把本地路径交给网页 —— 请用「打开」按钮选择文件'
          : (looksLikePptx(path.path) ? null : `只支持 .pptx（收到 ${path.name || path.path}）`)
        store.set({ dragDepth: store.get().dragDepth + 1, dropHint: hint })
      }, [store])

      const onDragOver = React.useCallback((event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }, [])

      const onDragLeave = React.useCallback((event) => {
        event.preventDefault()
        const depth = Math.max(0, store.get().dragDepth - 1)
        store.set({ dragDepth: depth, dropHint: depth === 0 ? null : store.get().dropHint })
      }, [store])

      const onDrop = React.useCallback((event) => {
        event.preventDefault()
        const dropped = extractDroppedPath(event)
        store.set({ dragDepth: 0, dropHint: null })
        if (dropped === null) {
          toast('拿不到文件路径', {
            kind: 'warn',
            detail: '浏览器出于隐私不提供本地路径。已为你打开文件浏览器，请在里面选 .pptx。',
          })
          store.set({ askPath: true })
          return
        }
        if (!looksLikePptx(dropped.path)) {
          toast('只支持 .pptx', { kind: 'warn', detail: `收到的是 ${dropped.name || dropped.path}` })
          return
        }
        logOp(`拖入文件：${dropped.path}（来自 ${dropped.from}）`, 'user')
        void actions.openPath(dropped.path)
      }, [actions, logOp, store, toast])

      const dropProps = {
        onDragEnter,
        onDragOver,
        onDragLeave,
        onDrop,
      }

      if (!state.open) {
        return h('button', {
          className: 'dsh-ppt-launcher',
          title: '打开 PPT 协同编辑画布',
          onClick: () => store.set({ open: true }),
          ...dropProps,
        }, 'PPT 画布')
      }

      const shellClass = 'dsh-ppt-panel'
      return h('div', { className: shellClass, ...dropProps },
        h(Header, { store, state, deck, actions, titleBar, sessionIds: availableSessions }),
        h('div', { className: 'dsh-ppt-body' },
          state.showThumbs && deck !== null ? h(ThumbRail, { store, deck, state }) : null,
          h('div', { className: 'dsh-ppt-center' },
            deck === null
              ? h('div', { className: 'dsh-ppt-welcome' },
                  h('b', null, '把 .pptx 拖进来，或点下面的按钮'),
                  h('p', null, '打开后：点选 / Shift 多选 / 框选画布上的元素，选中状态实时高亮。'),
                  h('p', null, '输入自然语言修改要求交给 AI，修改方案会直接落到文件并刷新画布。'),
                  h('div', { className: 'dsh-ppt-btnrow' },
                    h('button', { className: 'dsh-ppt-btn is-primary', onClick: () => actions.openDemo() }, '打开内置演示文稿'),
                    h('button', {
                      className: 'dsh-ppt-btn',
                      onClick: () => { void actions.pickAndOpen() },
                    }, '打开本地 .pptx'),
                  ),
                )
              : h(CanvasPane, { store, state, deck, slide }),
            state.loading
              ? h('div', { className: 'dsh-ppt-loading' }, h('span', { className: 'dsh-ppt-spinner' }), state.loadingLabel)
              : null,
          ),
          state.showInspector && deck !== null
            ? h(Inspector, { store, deck, state, onManualEdit: (ops, label) => actions.manual(ops, label) })
            : null,
          h(AiPane, { store, state }),
        ),
        h(InstructionBar, { store, state, actions, sessionReady, sessionDiagnostics }),
        state.log.length > 0
          ? h('div', { className: 'dsh-ppt-log' }, state.log.slice(0, 6).map(entry => h('div', {
              key: entry.id,
              className: `dsh-ppt-logrow is-${entry.kind}`,
            }, entry.text)))
          : null,
        h(PathDialog, {
          store,
          state,
          // 传入明确的路径（点列表项）或留空（用输入框里的路径）。
          onConfirm: (explicitPath) => {
            const path = typeof explicitPath === 'string' && explicitPath !== ''
              ? explicitPath
              : store.get().pathDraft.trim()
            if (path === '') return
            store.set({ askPath: false })
            void actions.openPath(path)
          },
        }),
        h(DropOverlay, { state }),
        h(Toasts, { store, state }),
      )
    }

    /** 两个高亮集合是否等价（避免无意义的重渲染）。 */
    function highlightsEqual(a, b) {
      const keysA = Object.keys(a)
      const keysB = Object.keys(b)
      if (keysA.length !== keysB.length) return false
      for (const key of keysA) if (b[key] !== a[key]) return false
      return true
    }

    /** 注入样式表（幂等）。 */
    function installStyles() {
      if (options.styles === undefined || options.styles === '') return
      if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
      const tag = doc.createElement('style')
      tag.dataset.plugin = 'dsh-ppt-canvas'
      tag.dataset.pluginCss = STYLE_TAG_ID
      tag.textContent = options.styles
      doc.head.appendChild(tag)
    }

    /**
     * 挂载。返回 { store, openPanel, component, dispose }。
     * @param {object} [mountOptions]
     */
    // store 在 install() 里创建，client.js 取用。
    let store = null

    function install(mountOptions = {}) {
      installStyles()
      const created = createStore(initialState())
      // client.js 拿这个 store 实例给 FloatingPanel，
      // 侧边栏按钮也用它开面板，两者状态必须是一份。
      store = created
      const openPanel = () => {
        created.set({ open: true })
        savePrefs({ open: true })
      }

      if (mountOptions.root !== undefined && mountOptions.root !== null) {
            const root = mountOptions.root
        const ReactDOM = mountOptions.ReactDOM
        const element = h(Panel, { store: created })
        if (ReactDOM !== undefined && ReactDOM !== null && typeof ReactDOM.createRoot === 'function') {
          const reactRoot = ReactDOM.createRoot(root)
          reactRoot.render(element)
          return { store: created, openPanel, dispose: () => reactRoot.unmount() }
        }
        root.appendChild(element)
        return { store: created, openPanel, dispose: () => { root.innerHTML = '' } }
      }

      return { store: created, openPanel, component: h(Panel, { store: created }), dispose: () => {} }
    }

    return {
      React,
      Panel,
      FloatingPanel,
      /** 状态容器（client.js 在 install 后取用）。 */
      store,
      createStore,
      initialState,
      install,
      savePrefs,
      extractDroppedPath,
      looksLikePptx,
      callApi,
      describeError,
      /**
       * 测试与诊断入口：真实的宿主是 React / 迷你渲染层，这里只暴露「不建 DOM 也能
       * 观察界面」的少量能力，避免测试去猜内部结构。
       */
      __forTests: {
        /** 渲染单个形状（用来核对 style 值，例如行距与内边距）。 */
        renderShape,
        /** 媒体 URL 的候选列表（核对图片地址拼得对不对）。 */
        mediaUrlCandidates,
        /** 展开元素直到宿主标签（例如 'button' / 'div'）。 */
        renderToTag(element, depth = 0) {
          if (element === null || element === undefined || depth > 16) return null
          if (typeof element === 'string') return element
          if (typeof element !== 'object' || element.$$typeof !== 'element') return null
          if (typeof element.type === 'function') {
            let rendered = null
            try { rendered = element.type(element.props) } catch (error) { return null }
            return this.renderToTag(rendered, depth + 1)
          }
          return element.type
        },
        openPanel() { if (store !== null) store.set({ open: true }) },
        closePanel() { if (store !== null) store.set({ open: false }) },
        getStore() { return store },
      },
    }
  }

    /* __DSH_PPT_APP_END__ */

  const PANEL_GEOM_KEY = 'dsh_ppt_canvas_geom'

  /** 面板几何（位置/尺寸）持久化在 localStorage：刷新后还在原处。 */
  function loadGeometry() {
    try {
      const raw = localStorage.getItem(PANEL_GEOM_KEY)
      const parsed = raw === null ? null : JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return null
      if (parsed.x !== null && parsed.x !== undefined && !Number.isFinite(parsed.x)) return null
      return parsed
    } catch (error) {
      return null
    }
  }

  function saveGeometry(geometry) {
    try { localStorage.setItem(PANEL_GEOM_KEY, JSON.stringify(geometry)) } catch (error) { /* 忽略 */ }
  }

  function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    /**
     * 会话连接 —— **显式连接，不猜「当前会话」**。
     *
     *   1. 面板记住一个已连接的会话 id（首次发送时若为空就自动选一个）；
     *   2. 标题栏的会话按钮显示当前连的是哪个，点它可以在已有会话之间切换；
     *   3. 发送时用 `sessions.retain(id)` 取 binding，调 `binding.session.prompt(...)`。
     *
     * 会话列表与身份来源（都是**实测**出来的，不是从服务目录推的）：
     *
     *   - `ctx.get('uiWorkspace')` 在本机**不存在**（实测返回 undefined），
     *     所以一切依赖它的建会话路径都不可用 —— 代码里不再指望它。
     *   - 客户端 `sessions` 服务的真实实例上有 `list`（ObservableSnapshot 存储，
     *     形状 `{ ids, byId, phase, projectionsBySession }`），这是可靠的会话来源。
     *   - `sessions.create()` 存在但**不返回带 id 的会话**（实测），`fork` 也不返回 id。
     *     因此「新建会话」在本机没有可用入口 —— 面板改为**让用户在已有会话里选**，
     *     并且那个列表里就包含他自己正在用的会话。
     *
     * 发送契约（用 cordis_inspect_query 的 client/Service.listService 核对）：
     *
     *   sessions.retain(id, { source }) -> SessionReference
     *     reference.ready               -> Promise<SessionBinding>
     *     reference.release()           -> 释放引用（引用计数，必须还）
     *   binding.session（= ISession）
     *     .prompt(content, mode, signal?, requestId?) -> Promise<RemoteResult<{ok,value}>>
     */
    const promptSessions = ctx.get('sessions')
    let diag = promptSessions === undefined
      ? 'sessions 服务不存在'
      : (typeof promptSessions.retain === 'function' ? 'sessions.retain 可用' : 'sessions 服务没有 retain()')

    /**
     * 读会话列表快照。`list` 是 ObservableSnapshot：有 `getSnapshot()` 就直接用，
     * 否则把实例本身当作快照（两种形态都兼容）。
     * @returns {{ ids: string[], byId: object } | null}
     */
    const sessionListSnapshot = () => {
      const store = promptSessions?.list
      if (store === undefined || store === null) return null
      let snapshot = store
      if (typeof store.getSnapshot === 'function') {
        try { snapshot = store.getSnapshot() } catch { return null }
      }
      if (snapshot === null || typeof snapshot !== 'object') return null
      const byId = snapshot.byId ?? {}
      const ids = Array.isArray(snapshot.ids) ? snapshot.ids.slice() : Object.keys(byId)
      return { ids, byId, phase: snapshot.phase }
    }

    /** 当前可选的会话 id 列表（最新在后）。 */
    const listSessionIds = () => {
      const snapshot = sessionListSnapshot()
      if (snapshot === null) return []
      const fromStore = snapshot.ids.map(id => snapshot.byId?.[id]?.id ?? id)
      return [...new Set(fromStore)].filter(id => typeof id === 'string' && id !== '')
    }

    /** 诊断文本（面板上会显示）。 */
    const sessionDiagnostics = () => diag

    /**
     * AI 的思考过程与回复 —— 从会话事件流里读。
     *
     * 数据形状（实测自 `dsh-api-session-controller` 的客户端实现）：
     *
     *   reference.binding.eventSource        -> ObservableSnapshot
     *     .getSnapshot()                     -> { entries, hasMore, revision, change }
     *       entries[i] = { type: 'event'|'transient', event }
     *         'event' 条目：event.type === 'assistant/message'
     *                       event.data.message.content = [{ type:'reasoning'|'text', text }]
     *         'transient' 条目：event.data.chunk = { type:'reasoning'|'text', … }
     *                       text 分片是 text-delta（增量），reasoning 是整块 text。
     *
     * 订阅要在 retain 出来的 binding 上做；会话还没连接时没有可订阅的源，
     * 所以这里对外只暴露「最近一次读到的内容」，由面板按节拍读取。
     */
    const aiState = { thinking: '', reply: '', error: null, sessionId: '' }

    /** 从一份事件窗口里抽出「最近一轮」的 reasoning 与正文。 */
    const extractAi = (window) => {
      const entries = Array.isArray(window?.entries) ? window.entries : []
      let durable = null
      let liveThinking = ''
      const liveText = new Map()
      for (const entry of entries) {
        const event = entry?.event
        if (event === null || event === undefined) continue
        if (event.type === 'assistant/message') {
          const content = event.data?.message?.content ?? event.data?.content
          if (Array.isArray(content)) durable = content
          continue
        }
        // 实时分片（当前这一轮还在跑）
        const chunk = event.data?.chunk
        if (chunk === null || chunk === undefined) continue
        if (chunk.type === 'reasoning' && typeof chunk.text === 'string') {
          liveThinking = chunk.text
        } else if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          const index = typeof chunk.index === 'number' ? chunk.index : 0
          liveText.set(index, (liveText.get(index) ?? '') + chunk.text)
        }
      }

      let thinking = ''
      let reply = ''
      for (const block of durable ?? []) {
        if (block?.type === 'reasoning' && typeof block.text === 'string') thinking += block.text
        else if (block?.type === 'text' && typeof block.text === 'string') reply += block.text
      }
      if (reply === '' && liveText.size > 0) {
        reply = [...liveText.entries()].sort((a, b) => a[0] - b[0]).map(pair => pair[1]).join('')
      }
      if (thinking === '') thinking = liveThinking
      return { thinking, reply }
    }

    /**
     * 订阅当前已连接会话的事件流。返回取消订阅的函数（拿不到会话就返回 no-op）。
     * @param {string} sessionId
     * @param {(state: {thinking: string, reply: string, error: string|null}) => void} emit
     */
    const watchAi = (sessionId, emit) => {
      if (promptSessions === undefined || typeof promptSessions.retain !== 'function') return () => {}
      if (typeof sessionId !== 'string' || sessionId === '') return () => {}
      let reference
      let unsubscribe = () => {}
      try {
        reference = promptSessions.retain(sessionId, { source: 'controllerOperation' })
        reference.ready.then((binding) => {
          const source = binding?.eventSource
          if (source === undefined || typeof source.subscribe !== 'function') {
            emit({ thinking: '', reply: '', error: '会话没有事件源（eventSource）' })
            return
          }
          const publish = () => {
            try {
              const extracted = extractAi(source.getSnapshot())
              emit({ ...extracted, error: null })
            } catch (error) {
              emit({ thinking: '', reply: '', error: error instanceof Error ? error.message : String(error) })
            }
          }
          publish()
          unsubscribe = source.subscribe(publish)
        }, (error) => {
          emit({ thinking: '', reply: '', error: `取会话失败：${error instanceof Error ? error.message : String(error)}` })
        })
      } catch (error) {
        emit({ thinking: '', reply: '', error: error instanceof Error ? error.message : String(error) })
      }
      return () => {
        try { unsubscribe() } catch { /* 忽略 */ }
        try { reference?.release() } catch { /* 忽略 */ }
      }
    }

    /** 面板按节拍读取的接口。 */
    const aiSnapshot = () => ({ ...aiState })

    /**
     * prompt：给定会话 id 就投递。连不上或投递失败都返回结构化错误。
     * @param {string} text
     * @param {string} sessionId
     */
    const promptTo = promptSessions === undefined || typeof promptSessions.retain !== 'function'
      ? null
      : async (text, sessionId) => {
          if (typeof sessionId !== 'string' || sessionId === '') {
            return { ok: false, error: { code: 'no-session', message: '还没有连接会话' } }
          }
          let reference
          try {
            reference = promptSessions.retain(sessionId, { source: 'controllerOperation' })
            const binding = await reference.ready
            const requestId = `ppt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            // 'queue'：当前有回合在跑时排队，不打断它。
            const result = await binding.session.prompt([{ type: 'text', text }], 'queue', undefined, requestId)
            if (result !== null && typeof result === 'object' && result.ok === true) {
              diag = `已投递到 ${sessionId}`
              return { ok: true }
            }
            const failure = result?.error ?? {}
            diag = `投递被拒：${failure.code ?? 'unknown'} ${failure.message ?? ''}`
            return { ok: false, error: { code: failure.code ?? 'rejected', message: failure.message ?? '会话没有接受这条指令' } }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            diag = `投递失败：${message}`
            return { ok: false, error: { code: 'prompt-failed', message } }
          } finally {
            try { reference?.release() } catch { /* 释放失败不影响本次结果 */ }
          }
        }

    /**
     * 建会话：**按方法逐个试探**，不假设某个服务一定有哪些方法。
     *
     * 起因：服务目录（Service.listService）里 `uiWorkspace.startSession` 是文档化的方法，
     * 但实际运行时这个服务上没有它 —— 目录描述的是能力契约，不等于这个组合里真的注入了。
     * 所以这里不写死一条路，而是把几种候选依序试一遍，并把「实际可用的方法名」写进错误，
     * 让下一次能直接照实现改。
     *
     * @returns {Promise<{ ok: boolean, sessionId?: string, error?: { code: string, message: string } }>}
     */
    /**
     * 新建会话。
     *
     * **本机没有可用的建会话入口**（实测）：`uiWorkspace` 服务不存在，
     * `sessions.create()` / `sessions.fork()` 都不返回带 id 的会话。
     * 所以这里不再假装能建，而是**从真实会话列表里挑一个连上** —— 列表里就包含
     * 用户自己正在用的会话（`sessions.list` 是实测存在且可用的来源）。
     *
     * @returns {Promise<{ ok: boolean, sessionId?: string, error?: { code: string, message: string } }>}
     */
    const selectSession = () => {
      const ids = listSessionIds()
      if (ids.length === 0) {
        const keys = promptSessions === undefined ? "服务缺失" : Object.keys(promptSessions).join(",")
        const message = `宿主没有返回任何会话（sessions 上的键：[${keys}]）。`
          + "请先在左侧打开或新建一个对话，然后点标题栏的会话按钮选择它。"
        diag = message
        return { ok: false, error: { code: "no-session", message } }
      }
      const picked = ids[ids.length - 1]
      diag = `已连接会话 ${picked}（共 ${ids.length} 个）`
      return { ok: true, sessionId: picked }
    }

    /**
     * 把会话归入工作区，让它在左侧列表里和普通对话一样出现。
     *
     * 用 `workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId?)`
     * —— 契约说明是「Move a Session within one Workspace account」，
     * `beforeSessionId` 省略即追加到末尾。工作区 id 由面板从 `useWorkspaces`
     * 快照里拿到（`workspaceId` → 逐个回退到服务试探）。
     *
     * 这是**尽力而为**：宿主不认这个会话（或没有工作区）时只记诊断，不报错 ——
     * 会话本身在 `sessions.list` 里，连接与发送都不受影响。
     *
     * @param {string} sessionId
     * @param {string} [workspaceId]
     * @returns {Promise<{ ok: boolean, message?: string }>}
     */
    const attachToWorkspace = async (sessionId, workspaceId) => {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { ok: false, message: '没有会话 id' }
      }
      const workspaces = ctx.get('workspaces')
      if (workspaces === undefined || typeof workspaces.insertSessionBefore !== 'function') {
        diag = '宿主的 workspaces 服务不可用，无法把会话归入工作区'
        return { ok: false, message: diag }
      }
      let target = typeof workspaceId === 'string' && workspaceId !== '' ? workspaceId : undefined
      if (target === undefined) {
        for (const method of ['list', 'views', 'all']) {
          if (typeof workspaces[method] !== 'function') continue
          try {
            const list = await workspaces[method]()
            const first = Array.isArray(list) ? list[0] : undefined
            target = first?.workspaceId ?? first?.id
            if (target !== undefined) break
          } catch { /* 换下一个 */ }
        }
      }
      if (target === undefined) {
        diag = '拿不到工作区 id，无法把会话归入工作区'
        return { ok: false, message: diag }
      }
      try {
        await workspaces.insertSessionBefore(target, sessionId)
        diag = `已把会话 ${sessionId} 归入工作区 ${target}`
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        diag = `归入工作区失败：${message}`
        return { ok: false, message }
      }
    }

    /**
     * 走原生文件选择（返回绝对路径）。
     * 注意 `uiWorkspace` 在本机不存在（实测），所以这里必须容错：拿不到就返回 null，
     * 面板会自动退回「手动输入路径」的对话框。
     */
    const pickPath = async () => {
      const picker = ctx.get('uiWorkspace')
      if (picker === undefined || typeof picker.pickDirectory !== 'function') return null
      try {
        const picked = await picker.pickDirectory()
        return typeof picked === 'string' && picked !== '' ? picked : null
      } catch {
        return null
      }
    }

    /**
     * 用**系统原生的「打开文件」对话框**选一份 .pptx。
     *
     * 这是普通应用里那种打开方式：隐藏的 `<input type="file">` 加 `.click()`
     * 触发浏览器/Electron 的原生文件对话框 —— DSH 自己的输入框就是这么做的
     * （`filePicker.open()` 的实现就是 `fileInputRef.current?.click()`）。
     *
     * 拿到 `File` 之后有两条路：
     *   1. Electron 会给 `file.path`（真实绝对路径）—— 直接用，省一次传输；
     *   2. 标准 DOM 没有路径 —— 读成 base64 交给 Host，由 Host 落到托管目录再打开
     *      （插件是按路径读写文件的）。
     *
     * @returns {Promise<{ name?: string, path?: string, content?: string } | null>} 取消时为 null
     */
    const pickPptx = () => new Promise((resolve, reject) => {
      let input
      try {
        input = document.createElement('input')
      } catch (error) {
        reject(new Error(`无法创建文件输入元素：${error instanceof Error ? error.message : String(error)}`))
        return
      }
      input.type = 'file'
      input.accept = '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'
      input.style.display = 'none'
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        try { input.remove() } catch { /* 已经被移除 */ }
        resolve(value)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (file === undefined || file === null) { finish(null); return }
        if (typeof file.path === 'string' && file.path !== '') {
          finish({ path: file.path, name: file.name })
          return
        }
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('读取所选文件失败'))
        reader.onload = () => {
          const url = String(reader.result ?? '')
          const comma = url.indexOf(',')
          finish({ name: file.name, content: comma === -1 ? '' : url.slice(comma + 1) })
        }
        reader.readAsDataURL(file)
      })
      // 取消时浏览器不发 change：窗口重新聚焦后再等一小会儿收尾，避免 Promise 永远挂着。
      const onFocus = () => {
        setTimeout(() => { if (!settled) finish(null) }, 800)
        try { win.removeEventListener('focus', onFocus) } catch { /* 忽略 */ }
      }
      try { win.addEventListener('focus', onFocus) } catch { /* 容器可能不支持 */ }
      document.body.appendChild(input)
      input.click()
    })

    /**
     * 目录浏览。**这是选 .pptx 的唯一可行入口**：宿主没有选文件的对话框
     * （`pickDirectory` 按设计只给目录，桌面端 Electron 也只注册了 openDirectory），
     * 所以面板自己列目录、只把 .pptx 作为可打开项。
     * 省略 path 即宿主主目录。
     * @param {string} [path]
     */
    const listDirectory = async (path) => {
      const browser = ctx.get('uiWorkspace')
      if (browser === undefined || typeof browser.listDirectory !== 'function') return null
      const listing = await browser.listDirectory(path)
      return listing ?? null
    }

    const app = createPptApp({
      React,
      document,
      window,
      apiBase: '/dsh-ppt/api',
      mode: 'panel',
      storageKey: 'dsh_ppt_canvas_v1',
      styleTagId: 'dsh-ppt-canvas-style',
      styles: __STYLES__,
      promptTo,
      selectSession,
      listSessionIds,
      attachToWorkspace,
      watchAi,
      aiSnapshot,
      sessionDiagnostics,
      pickPath,
      pickPptx,
      listDirectory,
      timeout: (fn, ms) => ctx.timeout(fn, ms),
      interval: (fn, ms) => ctx.interval(fn, ms),
    })

    const installed = app.install()

    /**
     * 面板外壳。
     *
     * 会话列表**直接问服务要**（`sessions.list` 实测存在且可用）。此前依赖
     * `shell.overlay` 的 `useSessions` hook —— 本机那条路拿不到数据（hook 能调、
     * 但快照为空），而服务面是确定可用的。
     */
    const FloatingPanel = (props) => {
      let sessionIds = []
      try {
        sessionIds = listSessionIds()
      } catch { sessionIds = [] }
      return React.createElement(app.FloatingPanel, {
        sessionIds,
        store: installed.store,
        openPanel: installed.openPanel,
        geometry: {
          load: loadGeometry,
          save: saveGeometry,
          initial: { width: 1180, height: 760 },
        },
        titleBar: {
          draggable: true,
        },
      })
    }

    // 侧边栏底部：打开画布的入口按钮
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'ppt-canvas', order: 62, label: 'PPT 画布' },
      (props) => React.createElement('button', {
        className: 'dsh-ppt-footbtn',
        title: '打开 PPT 协同编辑画布',
        onClick: () => installed.openPanel(),
      }, props !== null && props !== undefined && props.wide === true ? '▦ PPT 画布' : '▦'),
    ))

    // 全屏浮层：画布主体（点击穿透由 CSS 控制）
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'ppt-canvas-panel', order: 90, label: 'PPT 协同编辑画布' },
      // slot 会把 ownerProps/standardProps（含 useSessions 等 hook）作为参数传进来，
      // 必须原样透传给面板外壳，否则拿不到当前会话。
      (props) => React.createElement(FloatingPanel, props ?? {}),
    ))

    // 诊断/测试入口（不参与正常渲染路径）
    return { app, store: installed.store }
  }

  return { inject, apply }
} })
