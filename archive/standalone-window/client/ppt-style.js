/* dsh-ppt-canvas — 客户端样式
 *
 * 由 tools/sync-client-css.mjs 内联进 plugin/client.js（DSH 的客户端 bundle
 * 只能通过 __ModuleLoader__ 的 require 取模块，取不到同目录的额外文件）。
 * 颜色全部走 DSW 主题变量，深浅色主题都能用。
 */

const CSS = `
.dsh-ppt-footbtn{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:6px;display:flex;align-items:center;gap:6px;}
.dsh-ppt-footbtn:hover{background:rgba(128,128,128,.15);}

/* ---------------- 可拖动浮窗（对话面板） ---------------- */
.dsh-ppt-float{position:fixed;z-index:1200;pointer-events:auto;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:14px;
  box-shadow:0 24px 70px rgba(0,0,0,.42);overflow:hidden;}
.dsh-ppt-float.is-dragging{box-shadow:0 30px 80px rgba(0,0,0,.5);}
.dsh-ppt-float>.dsh-ppt-panel{position:static!important;inset:auto!important;width:100%!important;height:100%!important;
  border:0;border-radius:0;box-shadow:none;max-width:none;max-height:none;}
.dsh-ppt-header.is-draggable{cursor:grab;user-select:none;}
.dsh-ppt-float.is-dragging .dsh-ppt-header.is-draggable{cursor:grabbing;}
.dsh-ppt-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;z-index:5;
  background:linear-gradient(135deg,transparent 45%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 45%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 55%,transparent 55%,transparent 70%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 70%,var(--dsw-alias-border-l2,rgba(128,128,128,.55)) 80%,transparent 80%);}

/* ---------------- 独立窗口模式 ---------------- */
.dsh-ppt-window{position:fixed;inset:0;display:flex;flex-direction:column;height:100vh;width:100vw;
  background:var(--dsw-alias-bg-layer-1,#16191d);color:var(--dsw-alias-label-primary,#e8eaed);
  overflow:hidden;font-size:13px;line-height:1.5;}
.dsh-ppt-window .dsh-ppt-header{cursor:default;}
.dsh-ppt-window .dsh-ppt-body{flex:1;min-height:0;}
.dsh-ppt-window .dsh-ppt-log{max-height:72px;}
.dsh-ppt-winbtn{min-width:30px;text-align:center;font-size:12px;padding:4px 7px;}
.dsh-ppt-winbtn.is-close:hover{background:var(--dsw-alias-state-error-primary,#d93025);color:#fff;border-color:transparent;}
.dsh-ppt-window-root .dsh-ppt-boot{display:flex;align-items:center;justify-content:center;height:100%;}

/* ---------------- 拖拽打开 ---------------- */
.dsh-ppt-drop{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:rgba(26,115,232,.18);backdrop-filter:blur(1px);border:2px dashed var(--dsw-alias-brand-primary,#1a73e8);
  border-radius:inherit;pointer-events:none;}
.dsh-ppt-dropcard{display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;
  padding:18px 26px;border-radius:12px;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#111);
  box-shadow:0 16px 40px rgba(0,0,0,.35);max-width:78%;}
.dsh-ppt-dropcard b{font-size:14px;}
.dsh-ppt-dropcard span{font-size:12px;color:var(--dsw-alias-label-secondary,#666);}

.dsh-ppt-panel{
  position:fixed;right:20px;bottom:20px;width:min(1180px,calc(100vw - 60px));height:min(760px,calc(100vh - 60px));
  display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;z-index:1200;
  background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:14px;
  box-shadow:0 24px 70px rgba(0,0,0,.42);font-size:13px;line-height:1.5;
}
.dsh-ppt-launcher{
  position:fixed;right:20px;bottom:20px;pointer-events:auto;z-index:1200;border:0;cursor:pointer;
  padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-on-accent,#fff);
  background:var(--dsw-alias-brand-primary,#1a73e8);box-shadow:0 8px 26px rgba(0,0,0,.35);
}

/* ---------------- 顶栏 ---------------- */
.dsh-ppt-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));}
.dsh-ppt-title{display:flex;align-items:center;gap:10px;min-width:0;}
.dsh-ppt-logo{display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;border-radius:5px;
  background:var(--dsw-alias-brand-primary,#1a73e8);color:#fff;font-size:11px;font-weight:700;letter-spacing:.5px;flex:none;}
.dsh-ppt-titles{display:flex;flex-direction:column;min-width:0;}
.dsh-ppt-titles b{font-size:13px;font-weight:600;}
.dsh-ppt-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44vw;}
.dsh-ppt-tools{display:flex;align-items:center;gap:6px;flex:none;}
.dsh-ppt-sep{width:1px;height:16px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.35));margin:0 2px;}
.dsh-ppt-btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;color:inherit;
  cursor:pointer;font-size:12px;padding:4px 10px;border-radius:7px;white-space:nowrap;}
.dsh-ppt-btn:hover:not(:disabled){background:rgba(128,128,128,.14);}
.dsh-ppt-btn:disabled{opacity:.45;cursor:not-allowed;}
.dsh-ppt-btn.is-primary{background:var(--dsw-alias-brand-primary,#1a73e8);border-color:transparent;color:var(--dsw-alias-label-on-accent,#fff);font-weight:600;}
.dsh-ppt-btn-close{font-weight:700;padding:4px 9px;}
.dsh-ppt-revbadge,.dsh-ppt-sessionbadge{font-size:11px;padding:2px 8px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-sessionbadge.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);border-color:currentColor;}

/* ---------------- 主体 ---------------- */
.dsh-ppt-body{display:flex;flex:1;min-height:0;}
.dsh-ppt-thumbs{width:168px;flex:none;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;
  border-right:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));}
.dsh-ppt-thumb{position:relative;border:1px solid transparent;background:transparent;padding:0;border-radius:8px;cursor:pointer;text-align:left;}
.dsh-ppt-thumb.is-active{border-color:var(--dsw-alias-brand-primary,#1a73e8);box-shadow:0 0 0 2px rgba(26,115,232,.22);}
.dsh-ppt-thumbhead{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 4px;}
.dsh-ppt-thumbno{font-size:11px;color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-thumbpage{font-size:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:5px;
  background:transparent;color:inherit;cursor:pointer;padding:1px 5px;}
.dsh-ppt-thumbpage:hover{background:rgba(128,128,128,.16);}
.dsh-ppt-thumbframe{position:relative;overflow:hidden;border-radius:4px;background:#fff;
  box-shadow:0 1px 4px rgba(0,0,0,.28);}
.dsh-ppt-thumbslide{position:absolute;left:0;top:0;pointer-events:none;}

.dsh-ppt-center{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#f3f4f6);}
.dsh-ppt-canvaswrap{flex:1;min-height:0;overflow:auto;padding:18px;}
.dsh-ppt-canvasstage{position:relative;margin:0 auto;}
.dsh-ppt-canvas{position:relative;border-radius:4px;box-shadow:0 6px 26px rgba(0,0,0,.34);background:#fff;touch-action:none;}
.dsh-ppt-slidewrap{position:absolute;left:0;top:0;}
.dsh-ppt-slide{position:relative;overflow:hidden;}
.dsh-ppt-canvasmeta{position:absolute;right:6px;bottom:-18px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);}

/* ---------------- 元素 ---------------- */
.dsh-ppt-el{position:absolute;box-sizing:border-box;}
.dsh-ppt-el.kind-text>.dsh-ppt-text{padding:2px 1px;}
.dsh-ppt-el.is-hovered{outline:1px dashed rgba(26,115,232,.75);outline-offset:0;}
.dsh-ppt-el.is-selected{outline:2px solid var(--dsw-alias-brand-primary,#1a73e8);outline-offset:0;background-color:rgba(26,115,232,.08);}
.dsh-ppt-el.is-selected::after{content:"";position:absolute;inset:-2px;border-radius:2px;pointer-events:none;
  background:
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left top/7px 2px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left top/2px 7px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right top/7px 2px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right top/2px 7px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left bottom/7px 2px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) left bottom/2px 7px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right bottom/7px 2px no-repeat,
    linear-gradient(var(--dsw-alias-brand-primary,#1a73e8),var(--dsw-alias-brand-primary,#1a73e8)) right bottom/2px 7px no-repeat;
}
.dsh-ppt-el.is-ai-changed{animation:dshPptPulse 1.1s ease-in-out 3;background-color:rgba(255,229,143,.55);
  outline:2px solid #F2C200;outline-offset:0;}
@keyframes dshPptPulse{0%,100%{background-color:rgba(255,229,143,.22)}50%{background-color:rgba(255,229,143,.75)}}
.dsh-ppt-marquee{position:absolute;border:1px solid var(--dsw-alias-brand-primary,#1a73e8);
  background:rgba(26,115,232,.14);pointer-events:none;z-index:9999;}
.dsh-ppt-imfill{position:absolute;inset:0;pointer-events:none;}
.dsh-ppt-chartbadge,.dsh-ppt-groupbadge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(128,128,128,.22);color:var(--dsw-alias-label-secondary,#666);white-space:nowrap;}
.dsh-ppt-cell{border:1px solid rgba(0,0,0,.22);padding:3px 5px;overflow:hidden;color:#222;background:#fff;}
.dsh-ppt-cell.is-head{background:#eef2f7;font-weight:600;}

/* ---------------- 属性检查器 ---------------- */
.dsh-ppt-inspector{width:262px;flex:none;overflow-y:auto;padding:10px 12px;
  border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));display:flex;flex-direction:column;gap:9px;}
.dsh-ppt-inspector-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;
  color:var(--dsw-alias-label-secondary,#888);text-transform:uppercase;letter-spacing:.04em;}
.dsh-ppt-inspector-count{font-weight:500;text-transform:none;letter-spacing:0;}
.dsh-ppt-inspector-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dsh-ppt-inspector-foot{margin-top:auto;padding-top:8px;}
.dsh-ppt-empty{font-size:12px;color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-field{display:flex;flex-direction:column;gap:4px;}
.dsh-ppt-field>label{font-size:11px;color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.dsh-ppt-inline{display:flex;align-items:center;gap:6px;}
.dsh-ppt-btnrow{display:flex;flex-wrap:wrap;gap:5px;}
.dsh-ppt-input{width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:4px 7px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-base,transparent);color:inherit;}
.dsh-ppt-textarea{resize:vertical;min-height:52px;}
.dsh-ppt-numfield{display:flex;align-items:center;gap:4px;}
.dsh-ppt-numlabel{font-size:11px;color:var(--dsw-alias-label-secondary,#888);width:16px;flex:none;}
.dsh-ppt-num{padding:4px 5px;}
.dsh-ppt-color{width:32px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));
  border-radius:6px;background:transparent;cursor:pointer;flex:none;}
.dsh-ppt-mini{font-size:11px;padding:3px 8px;border-radius:6px;cursor:pointer;color:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;}
.dsh-ppt-mini:hover{background:rgba(128,128,128,.16);}
.dsh-ppt-mini.is-on{background:var(--dsw-alias-brand-primary,#1a73e8);border-color:transparent;color:#fff;font-weight:600;}
.dsh-ppt-mini.is-danger{color:var(--dsw-alias-state-error-primary,#d93025);border-color:currentColor;}

/* ---------------- 指令栏 ---------------- */
.dsh-ppt-instruction{flex:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));padding:8px 12px 10px;
  display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05));}
.dsh-ppt-instr-head{display:flex;align-items:center;gap:10px;font-size:11px;}
.dsh-ppt-instr-title{font-weight:600;}
.dsh-ppt-instr-sel{color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-instr-draft{color:var(--dsw-alias-state-warn-primary,#b7791f);}
.dsh-ppt-instr-sending{color:var(--dsw-alias-brand-primary,#1a73e8);font-weight:600;}
.dsh-ppt-instr-body{display:flex;gap:8px;align-items:flex-end;}
.dsh-ppt-instr-input{flex:1;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 9px;border-radius:8px;resize:vertical;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-bg-base,#fff);color:inherit;}
.dsh-ppt-instr-actions{display:flex;gap:6px;flex:none;}
.dsh-ppt-drafts{display:flex;flex-wrap:wrap;gap:6px;}
.dsh-ppt-chip{font-size:11px;padding:2px 9px;border-radius:999px;cursor:pointer;background:rgba(26,115,232,.14);
  border:1px solid rgba(26,115,232,.45);}
.dsh-ppt-chip:hover{background:rgba(26,115,232,.24);}
.dsh-ppt-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary,#b7791f);}
.dsh-ppt-histlist{display:flex;flex-direction:column;gap:2px;}
.dsh-ppt-histrow{display:flex;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-histrev{flex:none;font-variant-numeric:tabular-nums;}
.dsh-ppt-histsum{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

/* ---------------- 日志 / Toast / 弹窗 ---------------- */
.dsh-ppt-log{flex:none;max-height:96px;overflow-y:auto;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));
  font-size:11px;color:var(--dsw-alias-label-secondary,#888);display:flex;flex-direction:column;gap:2px;}
.dsh-ppt-logrow.is-ok{color:var(--dsw-alias-state-success-primary,#1f9d55);}
.dsh-ppt-logrow.is-warn{color:var(--dsw-alias-state-warn-primary,#b7791f);}
.dsh-ppt-logrow.is-ai{color:var(--dsw-alias-brand-primary,#1a73e8);}
.dsh-ppt-toasts{position:absolute;right:14px;top:54px;display:flex;flex-direction:column;gap:8px;z-index:30;max-width:340px;}
.dsh-ppt-toast{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:10px;font-size:12px;
  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));
  box-shadow:0 12px 30px rgba(0,0,0,.3);}
.dsh-ppt-toast.is-ok{border-color:var(--dsw-alias-state-success-primary,#1f9d55);}
.dsh-ppt-toast.is-error{border-color:var(--dsw-alias-state-error-primary,#d93025);}
.dsh-ppt-toast.is-warn{border-color:var(--dsw-alias-state-warn-primary,#b7791f);}
.dsh-ppt-toast-body{display:flex;flex-direction:column;gap:2px;flex:1;}
.dsh-ppt-toast-body span{color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-toast-x{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px;}
.dsh-ppt-modal-back{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:40;}
.dsh-ppt-modal{width:min(560px,86%);display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:12px;
  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));
  box-shadow:0 20px 50px rgba(0,0,0,.4);}
.dsh-ppt-modal-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-modal-actions{display:flex;justify-content:flex-end;gap:8px;}
.dsh-ppt-loading{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:10px;
  background:rgba(0,0,0,.28);color:#fff;font-size:13px;z-index:20;}
.dsh-ppt-spinner{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;
  animation:dshPptSpin .8s linear infinite;}
@keyframes dshPptSpin{to{transform:rotate(360deg)}}
.dsh-ppt-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;}
.dsh-ppt-welcome b{font-size:15px;}
.dsh-ppt-welcome p{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#888);}
.dsh-ppt-welcome .dsh-ppt-btnrow{margin-top:10px;}
`

export { CSS }
