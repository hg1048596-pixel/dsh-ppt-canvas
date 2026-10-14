/**
 * PPT 独立窗口 — preload
 *
 * 渲染层是 contextIsolation + sandbox，拿不到 ipcRenderer，所以这里只把三个窗口动作
 * 包成一个最小的桥：window.dshPptWindow。除此之外什么都不暴露。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshPptWindow', {
  /** @param {'minimize'|'maximize'|'close'|'always-on-top'} action */
  action: (action) => ipcRenderer.invoke('dsh-ppt:window-action', String(action)),
  state: () => ipcRenderer.invoke('dsh-ppt:window-state'),
})
