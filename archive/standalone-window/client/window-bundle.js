/* 由 tools/sync-client-css.mjs 生成 —— 不要直接编辑这个文件。
 * 源：client/ppt-style.js + client/mini-react.js + client/app.js + client/window-app.js
 */
(function () {
  window.__DSH_PPT_STYLES__ = "\n.dsh-ppt-footbtn{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:6px;display:flex;align-items:center;gap:6px;}\n.dsh-ppt-footbtn:hover{background:rgba(128,128,128,.15);}\n\n/* ---------------- 可拖动浮窗（对话面板） ---------------- */\n.dsh-ppt-float{position:fixed;z-index:1200;pointer-events:auto;display:flex;flex-direction:column;\n  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:14px;\n  box-shadow:0 24px 70px rgba(0,0,0,.42);overflow:hidden;}\n.dsh-ppt-float.is-dragging{box-shadow:0 30px 80px rgba(0,0,0,.5);}\n.dsh-ppt-float>.dsh-ppt-panel{position:static!important;inset:auto!important;width:100%!important;height:100%!important;\n  border:0;border-radius:0;box-shadow:none;max-width:none;max-height:none;}\n.dsh-ppt-header.is-draggable{cursor:grab;user-select:none;}\n.dsh-ppt-float.is-dragging .dsh-ppt-header.is-draggable{cursor:grabbing;}\n.dsh-ppt-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;z-index:5;\n  background:linear-gradient(135deg,transparent 45%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 45%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 55%,transparent 55%,transparent 70%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 70%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 80%,transparent 80%);}\n\n/* ---------------- 独立窗口模式 ---------------- */\n.dsh-ppt-window{position:fixed;inset:0;display:flex;flex-direction:column;height:100vh;width:100vw;\n  background:var(--dsw-alias-bg-layer-1,#16191d);color:var(--dsw-alias-label-primary,#e8eaed);\n  overflow:hidden;font-size:13px;line-height:1.5;}\n.dsh-ppt-window .dsh-ppt-header{cursor:default;}\n.dsh-ppt-window .dsh-ppt-body{flex:1;min-height:0;}\n.dsh-ppt-window .dsh-ppt-log{max-height:72px;}\n.dsh-ppt-winbtn{min-width:30px;text-align:center;font-size:12px;padding:4px 7px;}\n.dsh-ppt-winbtn.is-close:hover{background:var(--dsw-alias-state-error-primary,#d93025);color:#fff;border-color:transparent;}\n.dsh-ppt-window-root .dsh-ppt-boot{display:flex;align-items:center;justify-content:center;height:100%;}\n\n/* ---------------- 拖拽打开 ---------------- */\n.dsh-ppt-drop{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;\n  background:rgba(26,115,232,.18);backdrop-filter:blur(1px);border:2px dashed var(--dsw-alias-brand-primary,#1a73e8);\n  border-radius:inherit;pointer-events:none;}\n.dsh-ppt-dropcard{display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;\n  padding:18px 26px;border-radius:12px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#111);\n  box-shadow:0 16px 40px rgba(0,0,0,.35);max-width:78%;}\n.dsh-ppt-dropcard b{font-size:14px;}\n.dsh-ppt-dropcard span{font-size:12px;color:var(--dsw-alias-label-secondary,#666);}\n\n.dsh-ppt-panel{\n  position:fixed;right:20px;bottom:20px;width:min(1180px,calc(100vw - 60px));height:min(760px,calc(100vh - 60px));\n  display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;z-index:1200;\n  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:14px;\n  box-shadow:0 24px 70px rgba(0,0,0,.42);font-size:13px;line-height:1.5;\n}\n.dsh-ppt-launcher{\n  position:fixed;right:20px;bottom:20px;pointer-events:auto;z-index:1200;border:0;cursor:pointer;\n  padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-on-accent,#fff);\n  background:var(--dsw-alias-brand-primary,#1a73e8);box-shadow:0 8px 26px rgba(0,0,0,.35);\n}\n\n/* ---------------- 顶栏 ---------------- */\n.dsh-ppt-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;flex:none;\n  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));}\n.dsh-ppt-title{display:flex;align-items:center;gap:10px;min-width:0;}\n.dsh-ppt-logo{display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;border-radius:5px;\n  background:var(--dsw-alias-brand-primary,#1a73e8);color:#fff;font-size:11px;font-weight:700;letter-spacing:.5px;flex:none;}\n.dsh-ppt-titles{display:flex;flex-direction:column;min-width:0;}\n.dsh-ppt-titles b{font-size:13px;font-weight:600;}\n.dsh-ppt-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44vw;}\n.dsh-ppt-tools{display:flex;align-items:center;gap:6px;flex:none;}\n.dsh-ppt-sep{width:1px;height:16px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.35));margin:0 2px;}\n.dsh-ppt-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;\n  cursor:pointer;font-size:12px;padding:4px 10px;border-radius:7px;white-space:nowrap;}\n.dsh-ppt-btn:hover:not(:disabled){background:rgba(128,128,128,.14);}\n.dsh-ppt-btn:disabled{opacity:.45;cursor:not-allowed;}\n.dsh-ppt-btn.is-primary{background:var(--dsw-alias-brand-primary,#1a73e8);border-color:transparent;color:var(--dsw-alias-label-on-accent,#fff);font-weight:600;}\n.dsh-ppt-btn-close{font-weight:700;padding:4px 9px;}\n.dsh-ppt-revbadge,.dsh-ppt-sessionbadge{font-size:11px;padding:2px 8px;border-radius:999px;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-sessionbadge.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);border-color:currentColor;}\n\n/* ---------------- 主体 ---------------- */\n.dsh-ppt-body{display:flex;flex:1;min-height:0;}\n.dsh-ppt-thumbs{width:168px;flex:none;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;\n  border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));}\n.dsh-ppt-thumb{position:relative;border:1px solid transparent;background:transparent;padding:0;border-radius:8px;cursor:pointer;text-align:left;}\n.dsh-ppt-thumb.is-active{border-color:var(--dsw-alias-brand-primary,#1a73e8);box-shadow:0 0 0 2px rgba(26,115,232,.22);}\n.dsh-ppt-thumbhead{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 4px;}\n.dsh-ppt-thumbno{font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-thumbpage{font-size:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:5px;\n  background:transparent;color:inherit;cursor:pointer;padding:1px 5px;}\n.dsh-ppt-thumbpage:hover{background:rgba(128,128,128,.16);}\n.dsh-ppt-thumbframe{position:relative;overflow:hidden;border-radius:4px;background:#fff;\n  box-shadow:0 1px 4px rgba(0,0,0,.28);}\n.dsh-ppt-thumbslide{position:absolute;left:0;top:0;pointer-events:none;}\n\n.dsh-ppt-center{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#f3f4f6);}\n.dsh-ppt-canvaswrap{flex:1;min-height:0;overflow:auto;padding:18px;}\n.dsh-ppt-canvasstage{position:relative;margin:0 auto;}\n.dsh-ppt-canvas{position:relative;border-radius:4px;box-shadow:0 6px 26px rgba(0,0,0,.34);background:#fff;touch-action:none;}\n.dsh-ppt-slidewrap{position:absolute;left:0;top:0;}\n.dsh-ppt-slide{position:relative;overflow:hidden;}\n.dsh-ppt-canvasmeta{position:absolute;right:6px;bottom:-18px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n\n/* ---------------- 元素 ---------------- */\n.dsh-ppt-el{position:absolute;box-sizing:border-box;}\n.dsh-ppt-el.kind-text>.dsh-ppt-text{padding:2px 1px;}\n.dsh-ppt-el.is-hovered{outline:1px dashed rgba(26,115,232,.75);outline-offset:0;}\n.dsh-ppt-el.is-selected{outline:2px solid var(--dsw-alias-brand-primary,#1a73e8);outline-offset:0;background-color:rgba(26,115,232,.08);}\n.dsh-ppt-el.is-selected::after{content:\"\";position:absolute;inset:-2px;border-radius:2px;pointer-events:none;\n  background:\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left top/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left top/2px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right top/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right top/2px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left bottom/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left bottom/2px 7px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right bottom/7px 2px no-repeat,\n    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right bottom/2px 7px no-repeat;\n}\n.dsh-ppt-el.is-ai-changed{animation:dshPptPulse 1.1s ease-in-out 3;background-color:rgba(255,229,143,.55);\n  outline:2px solid #F2C200;outline-offset:0;}\n@keyframes dshPptPulse{0%,100%{background-color:rgba(255,229,143,.22)}50%{background-color:rgba(255,229,143,.75)}}\n.dsh-ppt-marquee{position:absolute;border:1px solid var(--dsw-alias-brand-primary,#1a73e8);\n  background:rgba(26,115,232,.14);pointer-events:none;z-index:9999;}\n.dsh-ppt-imfill{position:absolute;inset:0;pointer-events:none;}\n.dsh-ppt-chartbadge,.dsh-ppt-groupbadge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);\n  font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(128,128,128,.22);color:var(--dsw-alias-label-secondary,#666);white-space:nowrap;}\n.dsh-ppt-cell{border:1px solid rgba(0,0,0,.22);padding:3px 5px;overflow:hidden;color:#222;background:#fff;}\n.dsh-ppt-cell.is-head{background:#eef2f7;font-weight:600;}\n\n/* ---------------- 属性检查器 ---------------- */\n.dsh-ppt-inspector{width:262px;flex:none;overflow-y:auto;padding:10px 12px;\n  border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));display:flex;flex-direction:column;gap:9px;}\n.dsh-ppt-inspector-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;\n  color:var(--dsw-alias-label-secondary,#888);text-transform:uppercase;letter-spacing:.04em;}\n.dsh-ppt-inspector-count{font-weight:500;text-transform:none;letter-spacing:0;}\n.dsh-ppt-inspector-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.dsh-ppt-inspector-foot{margin-top:auto;padding-top:8px;}\n.dsh-ppt-empty{font-size:12px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-field{display:flex;flex-direction:column;gap:4px;}\n.dsh-ppt-field>label{font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px;}\n.dsh-ppt-inline{display:flex;align-items:center;gap:6px;}\n.dsh-ppt-btnrow{display:flex;flex-wrap:wrap;gap:5px;}\n.dsh-ppt-input{width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:4px 7px;border-radius:6px;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-base,transparent);color:inherit;}\n.dsh-ppt-textarea{resize:vertical;min-height:52px;}\n.dsh-ppt-numfield{display:flex;align-items:center;gap:4px;}\n.dsh-ppt-numlabel{font-size:11px;color:var(--dsw-alias-label-secondary,#888);width:16px;flex:none;}\n.dsh-ppt-num{padding:4px 5px;}\n.dsh-ppt-color{width:32px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));\n  border-radius:6px;background:transparent;cursor:pointer;flex:none;}\n.dsh-ppt-mini{font-size:11px;padding:3px 8px;border-radius:6px;cursor:pointer;color:inherit;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;}\n.dsh-ppt-mini:hover{background:rgba(128,128,128,.16);}\n.dsh-ppt-mini.is-on{background:var(--dsw-alias-brand-primary,#1a73e8);border-color:transparent;color:#fff;font-weight:600;}\n.dsh-ppt-mini.is-danger{color:var(--dsw-alias-state-error-primary,#d93025);border-color:currentColor;}\n\n/* ---------------- 指令栏 ---------------- */\n.dsh-ppt-instruction{flex:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding:8px 12px 10px;\n  display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05));}\n.dsh-ppt-instr-head{display:flex;align-items:center;gap:10px;font-size:11px;}\n.dsh-ppt-instr-title{font-weight:600;}\n.dsh-ppt-instr-sel{color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-instr-draft{color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-instr-sending{color:var(--dsw-alias-brand-primary,#1a73e8);font-weight:600;}\n.dsh-ppt-instr-body{display:flex;gap:8px;align-items:flex-end;}\n.dsh-ppt-instr-input{flex:1;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 9px;border-radius:8px;resize:vertical;\n  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-base,#fff);color:inherit;}\n.dsh-ppt-instr-actions{display:flex;gap:6px;flex:none;}\n.dsh-ppt-drafts{display:flex;flex-wrap:wrap;gap:6px;}\n.dsh-ppt-chip{font-size:11px;padding:2px 9px;border-radius:999px;cursor:pointer;background:rgba(26,115,232,.14);\n  border:1px solid rgba(26,115,232,.45);}\n.dsh-ppt-chip:hover{background:rgba(26,115,232,.24);}\n.dsh-ppt-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-histlist{display:flex;flex-direction:column;gap:2px;}\n.dsh-ppt-histrow{display:flex;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-histrev{flex:none;font-variant-numeric:tabular-nums;}\n.dsh-ppt-histsum{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n\n/* ---------------- 日志 / Toast / 弹窗 ---------------- */\n.dsh-ppt-log{flex:none;max-height:96px;overflow-y:auto;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));\n  font-size:11px;color:var(--dsw-alias-label-secondary,#888);display:flex;flex-direction:column;gap:2px;}\n.dsh-ppt-logrow.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);}\n.dsh-ppt-logrow.is-warn{color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-logrow.is-ai{color:var(--dsw-alias-brand-primary,#1a73e8);}\n.dsh-ppt-toasts{position:absolute;right:14px;top:54px;display:flex;flex-direction:column;gap:8px;z-index:30;max-width:340px;}\n.dsh-ppt-toast{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:10px;font-size:12px;\n  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));\n  box-shadow:0 12px 30px rgba(0,0,0,.3);}\n.dsh-ppt-toast.is-ok{border-color:var(--dsw-alias-state-success-primary,#1f9d55);}\n.dsh-ppt-toast.is-error{border-color:var(--dsw-alias-state-error-primary,#d93025);}\n.dsh-ppt-toast.is-warn{border-color:var(--dsw-alias-state-warn-primary,#b7791f);}\n.dsh-ppt-toast-body{display:flex;flex-direction:column;gap:2px;flex:1;}\n.dsh-ppt-toast-body span{color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-toast-x{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;}\n.dsh-ppt-modal-back{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:40;}\n.dsh-ppt-modal{width:min(560px,86%);display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:12px;\n  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));\n  box-shadow:0 20px 50px rgba(0,0,0,.4);}\n.dsh-ppt-modal-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-modal-actions{display:flex;justify-content:flex-end;gap:8px;}\n.dsh-ppt-loading{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:10px;\n  background:rgba(0,0,0,.28);color:#fff;font-size:13px;z-index:20;}\n.dsh-ppt-spinner{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;\n  animation:dshPptSpin .8s linear infinite;}\n@keyframes dshPptSpin{to{transform:rotate(360deg)}}\n.dsh-ppt-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;}\n.dsh-ppt-welcome b{font-size:15px;}\n.dsh-ppt-welcome p{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#888);}\n.dsh-ppt-welcome .dsh-ppt-btnrow{margin-top:10px;}\n"

  // ---- 迷你渲染层（React 兼容子集，独立窗口专用） ----
  /* dsh-ppt-canvas — 迷你渲染层（React 兼容子集）
   *
   * 独立窗口是插件自己 loadURL 的普通页面，没有 DSH 的模块表（拿不到 require('react')），
   * 而 React 的 UMD 构建既不在本机也没有构建步骤可以产出。所以这里实现一个**只覆盖本项目
   * 实际用到的那部分 React API** 的渲染层（createElement / useState / useEffect / useRef /
   * useMemo / useCallback / createRoot），让 client/app.js 这份界面代码在两种宿主下都跑：
   *
   *   - 对话面板：由 DSH 提供真正的 React（见 client/client.js 的 require('react')）
   *   - 独立窗口：由本文件提供替代实现
   *
   * 两种宿主的元素形状必须一致：React 元素带 $$typeof，这里的带 __vnode。
   * 因此所有「元素 → DOM」的翻译都集中在同一处（下面 PROP_APPLIERS / applyProp），
   * 不会出现两套宿主各写一遍导致行为分叉。
   *
   * 明确不支持（本项目也不需要）：类组件、context、Suspense、并发渲染、
   * key 之外的启发式 diff、合成事件的冒泡模拟。
   */

  ;(function (global) {
    'use strict'

    // ------------------------------------------------------------------ 元素

    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

    const RESERVED = new Set(['key', 'ref', 'children', '__self', '__source'])

    /**
     * 创建虚拟节点。
     * 支持两种调用形态：createElement(type, props, ...children) 与 createElement(type, props, [children])。
     */
    function createElement(type, props, ...children) {
      const normalized = {}
      let key = null
      let ref = null
      if (props !== null && props !== undefined) {
        for (const name of Object.keys(props)) {
          if (name === 'key') { key = props[name]; continue }
          if (name === 'ref') { ref = props[name]; continue }
          if (RESERVED.has(name)) continue
          normalized[name] = props[name]
        }
      }
      // children 优先级固定：显式 children prop 排在位置参数之前（与 React 一致）。
      const collected = []
      if (props !== null && props !== undefined && props.children !== undefined) {
        pushChildren(collected, props.children)
      }
      pushChildren(collected, children)
      if (collected.length === 1) normalized.children = collected[0]
      else if (collected.length > 1) normalized.children = collected
      return { __vnode: true, type, key, ref, props: normalized }
    }

    function pushChildren(out, value) {
      if (value === null || value === undefined || value === false || value === true) return
      if (Array.isArray(value)) {
        for (const item of value) pushChildren(out, item)
        return
      }
      out.push(value)
    }

    const Fragment = { __fragment: true }

    /** 判断是不是本渲染层产出的元素。 */
    function isElement(value) {
      return value !== null && typeof value === 'object' && value.__vnode === true
    }

    // ------------------------------------------------------------------ 属性翻译

    /** 驼峰 → kebab（dataShapeId → data-shape-id）。 */
    function kebabCase(name) {
      return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    }

    const PROP_APPLIERS = {
      /** 布尔属性：true 写入（空串），false/null/undefined 移除。 */
      boolean(node, name, value) {
        if (value === true) node.setAttribute(name, '')
        else node.removeAttribute(name)
      },
      /** 文本型属性。 */
      attribute(node, name, value) {
        if (value === null || value === undefined || value === false) node.removeAttribute(name)
        else node.setAttribute(name, String(value))
      },
      /**
       * 内联样式对象。写值用 `style[key] = x`（CSSOM 属性名），清理只针对
       * 「上一轮由本渲染层设置过、这一轮不再需要」的键 —— 不遍历 style 自身的键：
       * 那些是浏览器归一化后的 kebab 名，读回来会误判成「需要清掉」。
       */
      style(node, _name, value, tracked) {
        const style = node.style
        const next = value ?? {}
        const previousKeys = tracked instanceof Set ? tracked : new Set()
        const nextKeys = new Set()
        for (const key of Object.keys(next)) {
          nextKeys.add(key)
          const raw = next[key]
          style[key] = raw === null || raw === undefined
            ? ''
            : (typeof raw === 'number' ? `${raw}px` : String(raw))
        }
        for (const key of previousKeys) {
          if (!nextKeys.has(key)) style[key] = ''
        }
        return nextKeys
      },
      /** 事件处理器：统一用 addEventListener 绑定到元素自身。 */
      listener(node, name, value, previous) {
        const type = name.slice(2).toLowerCase()
        if (typeof previous === 'function') node.removeEventListener(type, previous)
        if (typeof value === 'function') node.addEventListener(type, value)
      },
      property(node, name, value) {
        node[name] = value
      },
    }

    const STYLE_LISTENER = /^on[A-Z]/
    const STYLE_BOOLEAN = new Set([
      'disabled', 'checked', 'selected', 'readOnly', 'required', 'autoFocus', 'multiple',
      'hidden', 'open', 'draggable', 'spellCheck',
    ])
    const STYLE_PROPERTY = new Set(['value', 'defaultValue', 'defaultChecked', 'textContent', 'innerHTML'])

    /** 把一个 prop 落到真实 DOM 上。 */
    function applyProp(node, name, value, previous) {
      if (name === 'children' || name === 'key' || name === 'ref') return
      if (STYLE_LISTENER.test(name)) {
        PROP_APPLIERS.listener(node, name, value, previous)
        return
      }
      if (name === 'style') {
        node._styleKeys = PROP_APPLIERS.style(node, name, value, node._styleKeys)
        return
      }
      if (name === 'className' || name === 'class') {
        PROP_APPLIERS.attribute(node, 'class', value)
        return
      }
      if (name === 'htmlFor') {
        PROP_APPLIERS.attribute(node, 'for', value)
        return
      }
      if (STYLE_PROPERTY.has(name)) {
        // 表单控件的 value 用 property 才生效（attribute 只设初始值）
        if (name === 'textContent' || name === 'innerHTML') {
          node[name] = value === null || value === undefined ? '' : String(value)
        } else if (name === 'defaultValue' || name === 'defaultChecked') {
          const target = name === 'defaultValue' ? 'value' : 'checked'
          if (previous === undefined) node[target] = value ?? ''
        } else {
          node[name] = value ?? ''
        }
        return
      }
      if (STYLE_BOOLEAN.has(name)) {
        PROP_APPLIERS.boolean(node, kebabCase(name), value)
        node[name] = value === true
        return
      }
      if (name.startsWith('data-') || name.startsWith('aria-')) {
        PROP_APPLIERS.attribute(node, name, value)
        return
      }
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        // 事件以外的对象 prop 交给 property（例如自定义字段）
        PROP_APPLIERS.property(node, name, value)
        return
      }
      PROP_APPLIERS.attribute(node, kebabCase(name), value)
    }

    function removeProp(node, name, previous) {
      if (STYLE_LISTENER.test(name)) {
        if (typeof previous === 'function') node.removeEventListener(name.slice(2).toLowerCase(), previous)
        return
      }
      if (name === 'style') {
        node.removeAttribute('style')
        return
      }
      if (name === 'className' || name === 'class') {
        node.removeAttribute('class')
        return
      }
      if (STYLE_PROPERTY.has(name)) {
        if (name === 'textContent' || name === 'innerHTML') node[name] = ''
        return
      }
      node.removeAttribute(kebabCase(name))
    }

    function applyProps(node, next, previous) {
      const prev = previous ?? {}
      for (const name of Object.keys(prev)) {
        if (name === 'children') continue
        if (!hasOwn(next, name)) removeProp(node, name, prev[name])
      }
      for (const name of Object.keys(next)) {
        if (name === 'children') continue
        const value = next[name]
        // style 每次都要过一遍：它的「上一轮键集」记在节点上（node._styleKeys）。
        if (name === 'style') {
          node._styleKeys = PROP_APPLIERS.style(node, name, value, node._styleKeys)
          continue
        }
        if (prev[name] === value) continue
        applyProp(node, name, value, prev[name])
      }
    }

    // ------------------------------------------------------------------ 运行时

    /** 当前正在渲染的组件实例（hook 调用靠它找到自己的槽位）。 */
    let current = null
    let rootInstance = null
    /** 待提交的 effect 队列（渲染阶段只入队，提交后统一执行）。 */
    const pendingEffects = []
    let flushScheduled = false

    function scheduleFlush() {
      if (flushScheduled) return
      flushScheduled = true
      const run = () => {
        flushScheduled = false
        const queue = pendingEffects.splice(0, pendingEffects.length)
        for (const effect of queue) {
          if (effect.cancelled === true) continue
          effect.run()
        }
      }
      if (typeof queueMicrotask === 'function') queueMicrotask(run)
      else Promise.resolve().then(run)
    }

    function ensureHooks(instance) {
      if (instance.hooks === null) instance.hooks = []
      if (instance.hookCursor === undefined) instance.hookCursor = 0
      return instance.hooks
    }

    /**
     * 取一个 hook 槽位。用哨兵区分「第一次调用」与「上次的值就是 undefined」，
     * 否则 deps 为 undefined 的 useMemo 每次都会重算。
     */
    const HOOK_EMPTY = Symbol('hook-empty')

    function nextHook(initial) {
      if (current === null) {
        throw new Error('迷你渲染层：hook 只能在组件渲染期间调用')
      }
      const hooks = ensureHooks(current)
      const index = current.hookCursor++
      if (hooks[index] === undefined) hooks[index] = { value: HOOK_EMPTY, deps: undefined }
      return { slot: hooks[index], index }
    }

    /** React 的依赖比较语义：没给 deps 或任一项变了就算变。 */
    function depsChanged(previousDeps, deps) {
      if (deps === undefined || previousDeps === undefined) return true
      if (deps.length !== previousDeps.length) return true
      for (let index = 0; index < deps.length; index++) {
        if (!Object.is(deps[index], previousDeps[index])) return true
      }
      return false
    }

    function useState(initial) {
      const { slot } = nextHook(HOOK_EMPTY)
      const instance = current
      if (slot.value === HOOK_EMPTY) {
        slot.value = typeof initial === 'function' ? initial() : initial
      }
      if (slot.setState === undefined) {
        slot.setState = (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next
          if (Object.is(value, slot.value)) return
          slot.value = value
          rerender(instance)
        }
      }
      return [slot.value, slot.setState]
    }

    function useEffect(effect, deps) {
      const { slot } = nextHook(HOOK_EMPTY)
      if (!depsChanged(slot.deps, deps)) return
      slot.deps = deps === undefined ? undefined : [...deps]
      // 先跑上一轮的清理，再把新的入队（顺序与 React 一致）。
      if (typeof slot.cleanup === 'function') {
        const cleanup = slot.cleanup
        slot.cleanup = undefined
        pendingEffects.push({ run: () => { cleanup() }, cancelled: false })
      }
      const token = { cancelled: false }
      slot.token = token
      pendingEffects.push({
        run: () => {
          if (token.cancelled) return
          const result = effect()
          if (typeof result === 'function') slot.cleanup = result
        },
        cancelled: false,
        token,
      })
      scheduleFlush()
    }

    function useRef(initial) {
      const { slot } = nextHook(HOOK_EMPTY)
      if (slot.value === HOOK_EMPTY) slot.value = { current: initial }
      return slot.value
    }

    function useMemo(factory, deps) {
      const { slot } = nextHook(HOOK_EMPTY)
      if (slot.value === HOOK_EMPTY || depsChanged(slot.deps, deps)) {
        slot.value = factory()
        slot.deps = deps === undefined ? undefined : [...deps]
      }
      return slot.value
    }

    function useCallback(callback, deps) {
      return useMemo(() => callback, deps)
    }

    // ------------------------------------------------------------------ 协调

    const TEXT_MARK = Symbol('text')

    function isTextVNode(value) {
      return typeof value === 'string' || typeof value === 'number'
    }

    function createTextNode(value) {
      return { kind: 'text', value: String(value), dom: null }
    }

    /**
     * 渲染一个 vnode 到父节点。
     * @returns {{kind: string, dom: Node|null, instance?: object}}
     */
    function mount(vnode, parentDom, before) {
      if (vnode === null || vnode === undefined || vnode === false || vnode === true) {
        return { kind: 'empty', dom: null }
      }
      if (isTextVNode(vnode)) {
        const node = { kind: 'text', value: String(vnode), dom: null }
        node.dom = global.document.createTextNode(node.value)
        parentDom.insertBefore(node.dom, before ?? null)
        return node
      }
      if (Array.isArray(vnode)) {
        // 裸数组：包一层，按有序子节点处理
        const node = { kind: 'array', items: [], dom: null, parent: parentDom }
        for (const item of vnode) node.items.push(mount(item, parentDom, before))
        return node
      }
      if (!isElement(vnode)) {
        // 不支持的对象（例如别的库的元素）：忽略而不是崩掉整个界面
        return { kind: 'empty', dom: null }
      }
      if (vnode.type === Fragment) {
        const node = { kind: 'fragment', items: [], dom: null }
        const children = toArray(vnode.props.children)
        for (const child of children) node.items.push(mount(child, parentDom, before))
        return node
      }
      if (typeof vnode.type === 'function') {
        const instance = {
          kind: 'component',
          type: vnode.type,
          props: vnode.props,
          hooks: [],
          hookCursor: 0,
          child: null,
          dom: null,
          parentDom,
          before,
        }
        return renderComponent(instance)
      }
      // 宿主元素
      const dom = global.document.createElement(String(vnode.type))
      applyProps(dom, vnode.props, {})
      const node = { kind: 'host', vnode, dom, children: [] }
      parentDom.insertBefore(dom, before ?? null)
      node.children = mountChildren(toArray(vnode.props.children), dom, null)
      if (typeof vnode.ref === 'function') vnode.ref(dom)
      else if (vnode.ref !== null && vnode.ref !== undefined && typeof vnode.ref === 'object') vnode.ref.current = dom
      return node
    }

    /**
     * 调用组件的渲染函数，并把结果挂载/更新到 DOM 上。
     * @returns {object} 组件实例（child 已是最新）
     */
    function renderComponent(instance) {
      instance.hookCursor = 0
      const saved = current
      current = instance
      let rendered
      try {
        rendered = instance.type(instance.props)
      } catch (error) {
        // 一个组件炸了不该拖垮整棵树：报错并留空位。
        reportError(error)
        rendered = null
      } finally {
        current = saved
      }
      instance.child = patch(instance.child ?? null, rendered, instance.parentDom, instance.before ?? null)
      instance.dom = instance.child === null ? null : instance.child.dom
      return instance
    }

    /** 重渲染一个组件实例（hook 的 setState 走这里），只动它自己的子树。 */
    function rerender(instance) {
      if (instance === null || instance === undefined) return
      const parentDom = instance.parentDom ?? (rootInstance === null ? null : rootInstance.container)
      if (parentDom === null || parentDom === undefined) return
      instance.parentDom = parentDom
      renderComponent(instance)
      scheduleFlush()
    }

    function mountChildren(children, parentDom, before) {
      const out = []
      for (const child of children) out.push(mount(child, parentDom, before))
      return out
    }

    function toArray(value) {
      if (value === null || value === undefined || value === false || value === true) return []
      if (Array.isArray(value)) {
        const out = []
        for (const item of value) out.push(...toArray(item))
        return out
      }
      return [value]
    }

    /**
     * 协调一组子节点。
     *
     * 规则：
     *  - 新列表里带 key 的项只能与「同 key」的旧项复用；找不到就新建。
     *    绝不能按位置去 patch 一个旧项 —— 那会把列表第 2 项当成第 1 项来改，
     *    结果是「旧节点没删干净 + 顺序错乱」。
     *  - 新列表里没 key 的项才按位置与旧项比对（普通数组渲染的自然语义）。
     */
    function reconcileChildren(oldChildren, vnodes, parentDom) {
      const keyed = new Map()
      for (const child of oldChildren) {
        const key = childKey(child)
        if (key !== null && key !== undefined) keyed.set(String(key), child)
      }
      const used = new Set()
      const next = []
      let cursor = 0
      for (const vnode of vnodes) {
        const key = isElement(vnode) ? vnode.key : null
        let previous = null
        if (key !== null && key !== undefined) {
          if (keyed.has(String(key))) {
            previous = keyed.get(String(key))
            used.add(previous)
          }
        } else {
          // 找下一个「没 key、也还没被用掉」的旧项
          while (cursor < oldChildren.length && used.has(oldChildren[cursor])) cursor++
          const candidate = cursor < oldChildren.length ? oldChildren[cursor] : null
          const candidateKey = candidate === null ? null : childKey(candidate)
          if (candidate !== null && (candidateKey === null || candidateKey === undefined)) {
            previous = candidate
            used.add(candidate)
            cursor++
          }
        }
        next.push(patch(previous, vnode, parentDom, null))
      }
      // 移除没被复用的旧节点
      for (const child of oldChildren) {
        if (used.has(child)) continue
        if (next.includes(child)) continue
        unmount(child)
      }
      // 重排：按新顺序把每个子树的 DOM 依次放到锚点之前。
      // （keyed 复用只保证节点不重建，位置仍然要显式搬。）
      let anchor = null
      for (let index = next.length - 1; index >= 0; index--) {
        const nodes = hostNodesOf(next[index])
        for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
          placeNode(parentDom, nodes[nodeIndex], anchor)
        }
        if (nodes.length > 0) anchor = nodes[0]
      }
      return next
    }

    /** 一个渲染节点在 DOM 里的连续节点序列。 */
    function hostNodesOf(node) {
      if (node === null || node === undefined) return []
      if (node.kind === 'component') return hostNodesOf(node.child)
      if (node.kind === 'fragment' || node.kind === 'array') {
        const out = []
        for (const item of node.items) out.push(...hostNodesOf(item))
        return out
      }
      if ((node.kind === 'host' || node.kind === 'text') && node.dom !== null && node.dom !== undefined) return [node.dom]
      return []
    }

    /** 把节点放到 reference 之前（reference 为空则追加到末尾）；已在位则不动。 */
    function placeNode(parentDom, node, reference) {
      if (node === null || node === undefined) return
      if (reference === node) return
      if (reference === null || reference === undefined) {
        const children = parentDom.children
        if (node.parentNode === parentDom && children[children.length - 1] === node) return
        parentDom.appendChild(node)
        return
      }
      if (node.parentNode === parentDom && node.nextSibling === reference) return
      parentDom.insertBefore(node, reference)
    }

    /** 旧节点的 key（宿主元素取 vnode.key；其它节点没有 key）。 */
    function childKey(child) {
      if (child === null || child === undefined) return null
      if (child.kind === 'host') return child.vnode.key
      return child.key ?? null
    }

    function unmount(node) {
      if (node === null || node === undefined) return
      if (node.kind === 'root') {
        unmount(node.child)
        return
      }
      if (node.kind === 'component') {
        // 组件的清理函数要跑
        for (const hook of node.hooks ?? []) {
          if (typeof hook.cleanup === 'function') {
            try { hook.cleanup() } catch (error) { reportError(error) }
            hook.cleanup = undefined
          }
        }
        unmount(node.child)
        return
      }
      if (node.kind === 'fragment' || node.kind === 'array') {
        for (const item of node.items) unmount(item)
        return
      }
      if (node.kind === 'host') {
        for (const child of node.children) unmount(child)
        if (node.dom !== null && node.dom !== undefined && typeof node.dom.remove === 'function') node.dom.remove()
        return
      }
      if (node.kind === 'text' && node.dom !== null && node.dom !== undefined && typeof node.dom.remove === 'function') {
        node.dom.remove()
      }
    }

    function reportError(error) {
      // 渲染期错误不该让整窗白屏：打日志并继续。
      if (global.console !== undefined) global.console.error('[dsh-ppt-canvas] render error:', error)
    }

    /** 把一个 vnode patch 到已有节点（previous 为 null 时挂载）。 */
    function patch(previous, vnode, parentDom, before) {
      if (previous === null || previous === undefined) return mount(vnode, parentDom, before)

      if (vnode === null || vnode === undefined || vnode === false || vnode === true) {
        unmount(previous)
        return { kind: 'empty', dom: null }
      }
      if (isTextVNode(vnode)) {
        if (previous.kind === 'text') {
          const next = String(vnode)
          if (previous.value !== next) {
            previous.value = next
            previous.dom.nodeValue = next
          }
          return previous
        }
        unmount(previous)
        return mount(vnode, parentDom, before)
      }
      if (Array.isArray(vnode)) {
        if (previous.kind === 'array') {
          previous.items = reconcileChildren(previous.items, toArray(vnode), parentDom)
          return previous
        }
        unmount(previous)
        return mount(vnode, parentDom, before)
      }
      if (!isElement(vnode)) return previous

      // 组件
      if (typeof vnode.type === 'function') {
        if (previous.kind === 'component' && previous.type === vnode.type) {
          previous.props = vnode.props
          previous.parentDom = parentDom
          previous.before = before
          return renderComponent(previous)
        }
        unmount(previous)
        return mount(vnode, parentDom, before)
      }

      // Fragment
      if (vnode.type === Fragment) {
        if (previous.kind === 'fragment') {
          previous.items = reconcileChildren(previous.items, toArray(vnode.props.children), parentDom)
          return previous
        }
        unmount(previous)
        return mount(vnode, parentDom, before)
      }

      // 宿主元素：类型不同就整体替换
      if (previous.kind !== 'host' || previous.vnode.type !== vnode.type) {
        const fresh = mount(vnode, parentDom, before)
        unmount(previous)
        return fresh
      }
      applyProps(previous.dom, vnode.props, previous.vnode.props)
      if (previous.vnode.ref !== vnode.ref) {
        if (typeof previous.vnode.ref === 'function') previous.vnode.ref(null)
        if (typeof vnode.ref === 'function') vnode.ref(previous.dom)
      }
      previous.children = reconcileChildren(previous.children, toArray(vnode.props.children), previous.dom)
      previous.vnode = vnode
      return previous
    }

    function renderTree(root) {
      const saved = current
      current = null
      try {
        root.child = patch(root.child, createElement(root.type, root.props), root.container, null)
      } catch (error) {
        reportError(error)
      } finally {
        current = saved
      }
      scheduleFlush()
    }

    /**
     * 挂载一棵界面树。
     * @param {Element} container 容器
     * @returns {{render: Function, unmount: Function}}
     */
    function createRoot(container) {
      let root = null
      rootInstance = null
      return {
        render(vnode) {
          if (root === null) {
            // 首次 render：用一个「容器型」根节点承载，patch 会把 vnode 挂进 container。
            // 这样函数组件与宿主元素走的是同一条路径，不需要特判根类型。
            root = { kind: 'root', type: null, props: {}, hooks: [], hookCursor: 0, child: null, dom: null, container }
            rootInstance = root
          }
          root.child = patch(root.child, vnode, container, null)
          scheduleFlush()
        },
        unmount() {
          if (root !== null) unmount(root)
          root = null
          rootInstance = null
          while (container.children.length > 0) container.removeChild(container.children[0])
        },
      }
    }

    global.__DSH_PPT_MINI_REACT__ = {
      createElement,
      Fragment,
      isElement,
      useState,
      useEffect,
      useRef,
      useMemo,
      useCallback,
      createRoot,
      version: 'mini-1',
    }
  })(typeof window !== 'undefined' ? window : globalThis)


  // ---- 共享界面层 ----
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
    const MODE = options.mode ?? 'panel'
    const IS_WINDOW = MODE === 'window'
    const STORAGE_KEY = options.storageKey ?? (IS_WINDOW ? 'dsh_ppt_canvas_window_v1' : 'dsh_ppt_canvas_v1')
    const STYLE_TAG_ID = options.styleTagId ?? (IS_WINDOW ? 'dsh-ppt-canvas-window-style' : 'dsh-ppt-canvas-style')
    const binding = options.binding ?? null
    const prompt = typeof options.prompt === 'function' ? options.prompt : null
    const pickPath = typeof options.pickPath === 'function' ? options.pickPath : null
    const windowControls = options.windowControls ?? null
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
     * File.path 上（本插件的独立窗口就是这种情况）。所以这里两条路都试：
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
        open: IS_WINDOW ? true : prefs.open === true,
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
        pathDraft: prefs.lastDir ?? '',
        dragDepth: 0,
        dropHint: null,
        history: { rev: 0, canUndo: false, canRedo: false },
        maximized: false,
        alwaysOnTop: false,
      }
    }

    // ------------------------------------------------------------------ 画布渲染

    /** 一个 Shape → 绝对定位的 DOM 元素（坐标以幻灯片 px 为单位）。 */
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
        if (shape.image.url !== null && shape.image.url !== undefined) {
          children.push(h('img', { key: 'img', src: shape.image.url, style: inner, alt: shape.name, draggable: false }))
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

    function anchorToFlex(anchor) {
      if (anchor === 'middle' || anchor === 'ctr') return 'center'
      if (anchor === 'bottom' || anchor === 'b') return 'flex-end'
      return 'flex-start'
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
      const style = {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: anchorToFlex(text.anchor),
        textAlign: alignToCss(text.align),
        color: text.color ?? '#111111',
        fontSize: `${px(text.fontSize ?? 18)}px`,
        fontWeight: text.bold === true ? 700 : 400,
        fontStyle: text.italic === true ? 'italic' : 'normal',
        fontFamily: text.fontFamily ?? 'inherit',
        lineHeight: 1.25,
        overflow: 'visible',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }
      if (paragraphs.length === 0) {
        return h('div', { key: 'text', className: 'dsh-ppt-text', style }, text.plain ?? '')
      }
      return h('div', { key: 'text', className: 'dsh-ppt-text', style },
        paragraphs.map((paragraph, index) => {
          const runs = Array.isArray(paragraph.runs) ? paragraph.runs : []
          const pStyle = { textAlign: alignToCss(paragraph.align ?? text.align), minHeight: '1.2em' }
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
      const { slide, width, height, selection, hoverId, highlights, onPointerDown, interactive, marquee } = props
      if (slide === null || slide === undefined) return null
      const background = /^#[0-9a-fA-F]{6}$/.test(slide.background ?? '') ? slide.background : '#FFFFFF'
      return h('div', {
        className: 'dsh-ppt-slide',
        style: { width: `${px(width)}px`, height: `${px(height)}px`, background },
      },
        (slide.shapes ?? []).map(shape => renderShape(shape, {
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
      const dragRef = React.useRef(null)
      const slideW = deck.slideWidth
      const slideH = deck.slideHeight
      const zoom = state.zoom
      const width = slideW * zoom
      const height = slideH * zoom

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

      return h('div', { className: 'dsh-ppt-canvaswrap', onWheel },
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
              style: { width: `${px(width)}px`, height: `${px(height)}px`, transform: `scale(${zoom})`, transformOrigin: 'top left' },
            }, h(SlideView, {
              slide,
              width: slideW,
              height: slideH,
              selection: state.selectedIds,
              hoverId: state.hoverId,
              highlights: state.highlights,
              onPointerDown: onShapePointerDown,
              interactive: true,
              marquee: state.marquee,
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
      const { store, state, deck, actions, sessionReady, titleBar } = props
      const file = deck === null ? null : deck.file
      return h('div', {
        className: `dsh-ppt-header${IS_WINDOW ? ' is-window' : ''}${titleBar !== undefined && titleBar.draggable === true ? ' is-draggable' : ''}`,
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
                ? (IS_WINDOW ? '把 .pptx 拖进窗口，或点「打开」' : '未打开演示文稿')
                : `${file.split(/[/\\]/).pop()} · rev ${deck.rev} · ${deck.slides.length} 页`),
          ),
        ),
        h('div', { className: 'dsh-ppt-tools' },
          h('button', {
            className: 'dsh-ppt-btn is-primary',
            disabled: state.sending,
            title: '打开本地 .pptx（可先试试把文件拖进来）',
            onClick: () => {
              if (pickPath !== null) {
                Promise.resolve(pickPath()).then((picked) => {
                  if (typeof picked === 'string' && picked !== '') void actions.openPath(picked)
                }).catch((error) => store.set({ error: describeError(error) }))
              } else {
                store.set({ askPath: true })
              }
            },
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
          !IS_WINDOW
            ? h('span', {
                className: `dsh-ppt-sessionbadge${sessionReady ? ' is-ok' : ''}`,
                title: sessionReady ? '当前会话可用：指令会发给它' : '没有打开的会话：指令只能暂存',
              }, sessionReady ? '会话已连接' : '无会话')
            : h('span', { className: 'dsh-ppt-sessionbadge', title: '独立窗口只做画布与手动调整；AI 指令请在对话面板里发' }, '独立窗口'),
          h('span', { className: 'dsh-ppt-sep' }),
          !IS_WINDOW && titleBar !== undefined && titleBar.onOpenWindow !== undefined
            ? h('button', {
                className: 'dsh-ppt-btn',
                title: '在新窗口打开（可自由拖到桌面任意位置）',
                disabled: state.sending,
                onClick: () => titleBar.onOpenWindow(),
              }, '⧉ 独立窗口')
            : null,
          windowControls !== null
            ? h(React.Fragment, null,
                h('button', {
                  className: 'dsh-ppt-btn dsh-ppt-winbtn',
                  title: state.alwaysOnTop ? '取消置顶' : '窗口置顶',
                  onClick: () => {
                    Promise.resolve(windowControls.alwaysOnTop()).then((next) => store.set({ alwaysOnTop: next === true }))
                  },
                }, state.alwaysOnTop ? '📌' : '📍'),
                h('button', {
                  className: 'dsh-ppt-btn dsh-ppt-winbtn',
                  title: '最小化',
                  onClick: () => { void windowControls.minimize() },
                }, '—'),
                h('button', {
                  className: 'dsh-ppt-btn dsh-ppt-winbtn',
                  title: state.maximized ? '还原' : '最大化',
                  onClick: () => {
                    Promise.resolve(windowControls.maximize()).then((maximized) => store.set({ maximized: maximized === true }))
                  },
                }, state.maximized ? '❐' : '□'),
                h('button', {
                  className: 'dsh-ppt-btn dsh-ppt-winbtn is-close',
                  title: '关闭窗口',
                  onClick: () => { void windowControls.close() },
                }, '✕'),
              )
            : h('button', {
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
      const { store, state, actions, sessionReady } = props
      const rows = state.selectedIds.length
      const canSend = prompt !== null && sessionReady
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
            placeholder: '例如：把标题改成红色并右对齐 / 这三个色块统一成品牌蓝 / 把这行字缩小并居中',
            value: state.instruction,
            rows: 2,
            onChange: (event) => store.set({ instruction: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                actions.send()
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                actions.addDraft()
              }
            },
          }),
          h('div', { className: 'dsh-ppt-instr-actions' },
            h('button', {
              className: 'dsh-ppt-btn',
              disabled: state.instruction.trim() === '',
              title: 'Enter：加入待发列表',
              onClick: () => actions.addDraft(),
            }, '加入待发'),
            h('button', {
              className: 'dsh-ppt-btn is-primary',
              disabled: state.sending || rows === 0 || state.instruction.trim() === '' || !canSend,
              title: canSend ? 'Ctrl/⌘ + Enter：发送给 AI' : '需要在对话面板里打开本插件才能发送指令',
              onClick: () => { void actions.send() },
            }, state.sending ? 'AI 处理中…' : '发送给 AI'),
          ),
        ),
        state.drafts.length > 0
          ? h('div', { className: 'dsh-ppt-drafts' }, state.drafts.map((draft, index) => h('span', {
              key: `${index}-${draft}`,
              className: 'dsh-ppt-chip',
              onClick: () => store.set({ instruction: draft, drafts: state.drafts.filter((_, i) => i !== index) }),
              title: '点击编辑这条指令',
            }, draft.length > 28 ? `${draft.slice(0, 28)}…` : draft)))
          : null,
        !canSend
          ? h('div', { className: 'dsh-ppt-warn' }, IS_WINDOW
              ? '独立窗口只负责画布与手动调整；要用 AI 改，请在对话面板里打开「PPT 画布」并发送指令（窗口会自动刷新）。'
              : '当前没有打开的会话：请先在左侧打开/新建一个会话，指令才能发给 AI。')
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

    function PathDialog(props) {
      const { store, state, onConfirm } = props
      if (!state.askPath) return null
      return h('div', { className: 'dsh-ppt-modal-back', onClick: () => store.set({ askPath: false }) },
        h('div', { className: 'dsh-ppt-modal', onClick: (event) => event.stopPropagation() },
          h('b', null, '打开演示文稿'),
          h('div', { className: 'dsh-ppt-modal-hint' },
            '填写 .pptx 的绝对路径。插件会直接读写这个文件（每次修改前自动留档，可撤销）。',
            MODE === 'panel' ? '也可以把文件直接拖到面板上。' : '也可以把文件直接拖进这个窗口。'),
          h('input', {
            className: 'dsh-ppt-input',
            autoFocus: true,
            value: state.pathDraft,
            placeholder: 'D:\\work\\deck.pptx',
            onChange: (event) => store.set({ pathDraft: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter') onConfirm()
              if (event.key === 'Escape') store.set({ askPath: false })
            },
          }),
          h('div', { className: 'dsh-ppt-modal-actions' },
            h('button', { className: 'dsh-ppt-btn', onClick: () => store.set({ askPath: false }) }, '取消'),
            h('button', { className: 'dsh-ppt-btn is-primary', onClick: onConfirm }, '打开'),
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
     *   独立窗口模式由 Electron 负责真正的窗口拖动，不走这里。）
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
      const sessionReady = binding !== null && binding.sessionId !== undefined

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
          const session = binding === null ? undefined : binding.session
          if (session === undefined) break
          let running = false
          try { running = session.getSnapshot()?.running === true } catch (error) { /* 会话还没就绪 */ }
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
        async openWindow() {
          try {
            const status = await callApi('window', { action: 'open' })
            if (status.opened === false) {
              toast('打不开独立窗口', { kind: 'error', detail: status.message ?? '找不到 Electron 运行时' })
              return
            }
            logOp(`独立窗口已打开（${status.backend ?? 'electron'}${status.reused === true ? '，复用' : ''}）`, 'ok')
            toast('已在新窗口打开', { detail: '可以把它拖到桌面任意位置；位置会被记住。' })
          } catch (error) {
            toast('打不开独立窗口', { kind: 'error', detail: describeError(error) })
          }
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
        async send() {
          if (prompt === null) {
            toast('独立窗口不能发指令', { kind: 'warn', detail: '请在对话面板的「PPT 画布」里发送。' })
            return
          }
          const snapshot = store.get()
          const text = [snapshot.instruction.trim()].concat(snapshot.drafts).filter(item => item !== '').join('；')
          if (text === '') return
          if (snapshot.selectedIds.length === 0) {
            toast('请先选择元素', { kind: 'warn', detail: '点击、Shift 多选或框选画布上的元素。' })
            return
          }
          const session = binding === null ? undefined : binding.session
          if (session === undefined) {
            toast('当前没有可用会话', { kind: 'warn', detail: '请先在左侧打开一个会话，指令才能发给 AI。' })
            return
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
          const result = await prompt(message)
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
          if (event.key === 'Escape' && IS_WINDOW) store.set({ selectedIds: [], askPath: false })
        }
        win.addEventListener('keydown', onKey)
        return () => win.removeEventListener('keydown', onKey)
      }, [actions, store])

      // 首次打开：恢复上次的文件（面板模式还要恢复「上次是打开状态」）。
      const booted = React.useRef(false)
      React.useEffect(() => {
        if (booted.current) return
        booted.current = true
        if (!IS_WINDOW && prefs.open !== true) return
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
          ? (IS_WINDOW
              ? '仅支持 .pptx'
              : '浏览器不会把本地路径交给网页 —— 用「打开」按钮选文件，或点「⧉ 独立窗口」后在那里拖拽')
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
            detail: IS_WINDOW
              ? '请确认拖进来的是本地 .pptx 文件。'
              : '浏览器出于隐私不提供本地路径。请点「打开」选择文件，或点「⧉ 独立窗口」后在独立窗口里拖拽。',
            action: pickPath === null ? undefined : { label: '打开', run: () => { void actions.openPath('') } },
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

      const shellClass = IS_WINDOW ? 'dsh-ppt-window' : 'dsh-ppt-panel'
      return h('div', { className: shellClass, ...dropProps },
        h(Header, { store, state, deck, actions, sessionReady, titleBar }),
        h('div', { className: 'dsh-ppt-body' },
          state.showThumbs && deck !== null ? h(ThumbRail, { store, deck, state }) : null,
          h('div', { className: 'dsh-ppt-center' },
            deck === null
              ? h('div', { className: 'dsh-ppt-welcome' },
                  h('b', null, '把 .pptx 拖进来，或点下面的按钮'),
                  h('p', null, '打开后：点选 / Shift 多选 / 框选画布上的元素，选中状态实时高亮。'),
                  h('p', null, IS_WINDOW
                    ? '这个独立窗口可以自由拖动到桌面任意位置，位置会被记住；AI 指令请在对话面板里发。'
                    : '输入自然语言修改要求交给 AI，修改方案会直接落到文件并刷新画布。'),
                  h('div', { className: 'dsh-ppt-btnrow' },
                    h('button', { className: 'dsh-ppt-btn is-primary', onClick: () => actions.openDemo() }, '打开内置演示文稿'),
                    h('button', {
                      className: 'dsh-ppt-btn',
                      onClick: () => {
                        if (pickPath !== null) {
                          Promise.resolve(pickPath()).then((picked) => {
                            if (typeof picked === 'string' && picked !== '') void actions.openPath(picked)
                          })
                        } else {
                          store.set({ askPath: true })
                        }
                      },
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
        ),
        h(InstructionBar, { store, state, actions, sessionReady }),
        state.log.length > 0
          ? h('div', { className: 'dsh-ppt-log' }, state.log.slice(0, 6).map(entry => h('div', {
              key: entry.id,
              className: `dsh-ppt-logrow is-${entry.kind}`,
            }, entry.text)))
          : null,
        h(PathDialog, {
          store,
          state,
          onConfirm: () => {
            const path = store.get().pathDraft.trim()
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
     * @param {Element} [mountOptions.root] 独立窗口模式：直接渲染到这个容器
     * @param {object}  [mountOptions.ReactDOM] 独立窗口模式的 react-dom
     */
    // 面板与独立窗口共用同一个 store：install() 里创建，client.js / window-app.js 取用。
    let store = null

    function install(mountOptions = {}) {
      installStyles()
      const created = createStore(initialState())
      // 面板与独立窗口共用同一个 store 实例：client.js 拿它给 FloatingPanel，
      // 侧边栏按钮也用它开面板，两者状态必须是一份。
      store = created
      const openPanel = () => {
        created.set({ open: true })
        savePrefs({ open: true })
      }

      if (mountOptions.root !== undefined && mountOptions.root !== null) {
        // 独立窗口模式：整个视口就是这个窗口，没有「最小化」概念。
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
      /** 面板与独立窗口共用的状态容器（client.js 在 install 后取用）。 */
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


  // ---- 独立窗口入口 ----
  /* dsh-ppt-canvas — 独立窗口入口
   *
   * 由 /dsh-ppt/window 页面用 <script> 加载（不是 DSH 的 __ModuleLoader__ 模块），
   * 因此这里不用 require：React 由同页的 client/mini-react.js 提供（挂到 window 上），
   * 界面逻辑由同页的 client/app.js 提供（createPptApp）。
   *
   * 独立窗口与对话面板共用同一份界面逻辑，差别只有：
   *  - 没有会话 → 指令栏禁用并提示「请在对话面板里发」；
   *  - 标题栏换成真正的窗口按钮（置顶 / 最小化 / 最大化 / 关闭），由 Electron 主进程提供；
   *  - 整个视口就是这块画布。
   */

  ;(function boot() {
    const root = document.getElementById('dsh-ppt-window-root')
    if (root === null) {
      console.error('[dsh-ppt-canvas] 缺少 #dsh-ppt-window-root 容器')
      return
    }

    const mini = window.__DSH_PPT_MINI_REACT__
    if (mini === undefined || mini === null) {
      root.textContent = 'dsh-ppt-canvas: 渲染层没有加载成功（client/mini-react.js）'
      return
    }
    if (typeof createPptApp !== 'function') {
      root.textContent = 'dsh-ppt-canvas: 共享界面层没有加载成功（client/app.js）'
      return
    }

    // 把迷你渲染层包成 React / ReactDOM 两副面孔，client/app.js 无需知道宿主是谁。
    const React = {
      createElement: mini.createElement,
      Fragment: mini.Fragment,
      useState: mini.useState,
      useEffect: mini.useEffect,
      useRef: mini.useRef,
      useMemo: mini.useMemo,
      useCallback: mini.useCallback,
      version: mini.version,
    }
    const ReactDOM = {
      createRoot: (container) => {
        const root = mini.createRoot(container)
        return { render: (element) => root.render(element), unmount: () => root.unmount() }
      },
    }

    // Electron 主进程通过 preload 暴露这组能力；普通浏览器里没有，此时不显示窗口按钮。
    const bridge = typeof window.dshPptWindow !== 'undefined' && window.dshPptWindow !== null
      ? window.dshPptWindow
      : null
    const windowControls = bridge === null ? null : {
      minimize: () => bridge.action('minimize'),
      maximize: () => bridge.action('maximize'),
      close: () => bridge.action('close'),
      alwaysOnTop: () => bridge.action('always-on-top'),
    }

    const app = createPptApp({
      React,
      ReactDOM,
      document,
      window,
      apiBase: typeof window.__DSH_PPT_API_BASE__ === 'string' ? window.__DSH_PPT_API_BASE__ : '/dsh-ppt/api',
      mode: 'window',
      storageKey: 'dsh_ppt_canvas_window_v1',
      styleTagId: 'dsh-ppt-canvas-window-style',
      styles: typeof window.__DSH_PPT_STYLES__ === 'string' ? window.__DSH_PPT_STYLES__ : '',
      binding: null,
      prompt: null,
      pickPath: null,
      timeout: (fn, ms) => {
        const handle = setTimeout(fn, ms)
        return () => clearTimeout(handle)
      },
      windowControls,
    })

    const installed = app.install({ root })

    // 窗口标题跟随文档：任务栏上能看出自己在编辑哪一份。
    installed.store.subscribe(() => {
      const deck = installed.store.get().deck
      const base = 'PPT 协同编辑画布'
      const next = deck === null || deck === undefined
        ? base
        : `${String(deck.file).split(/[/\\]/).pop()} · ${base}`
      if (document.title !== next) document.title = next
    })

    // 有 preload 桥时同步一次窗口按钮状态（最大化/置顶）。
    if (bridge !== null && typeof bridge.state === 'function') {
      Promise.resolve(bridge.state()).then((state) => {
        if (state !== null && typeof state === 'object') {
          installed.store.set({ maximized: state.maximized === true, alwaysOnTop: state.alwaysOnTop === true })
        }
      }).catch(() => { /* 状态读不到不影响使用 */ })
    }
  })()

})()
