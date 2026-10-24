'use strict';
// Bridge between the page and the main process. The page never touches Node directly.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // calls to main
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  saveAs: (payload) => ipcRenderer.invoke('file:saveAs', payload),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveImage: (payload) => ipcRenderer.invoke('image:save', payload),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  copyHtml: (payload) => ipcRenderer.invoke('clipboard:writeHtml', payload),
  print: (payload) => ipcRenderer.invoke('print', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  exportPng: (payload) => ipcRenderer.invoke('export:png', payload),
  exportHtml: (payload) => ipcRenderer.invoke('export:html', payload),
  exportDocx: (payload) => ipcRenderer.invoke('export:docx', payload),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('window:alwaysOnTop', on),

  // events from main: 'cmd' (name, arg) for menu commands, 'setting' (key, value), 'file:opened'
  on: (channel, handler) => {
    if (!['file:opened', 'cmd', 'setting'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, ...args) => handler(...args));
  },
});
