const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aps', {
  isElectron: true,
  listDocs: () => ipcRenderer.invoke('docs:list'),
  saveDoc: (doc) => ipcRenderer.invoke('docs:save', doc),
  deleteDoc: (id) => ipcRenderer.invoke('docs:delete', id),
  exportPdf: (id, title) => ipcRenderer.invoke('doc:export-pdf', { id, title }),
  printDoc: (id) => ipcRenderer.invoke('doc:print', { id }),
  printReady: () => ipcRenderer.send('print:ready'),
  onMenu: (cb) => {
    const handler = (_e, cmd) => cb(cmd);
    ipcRenderer.on('menu', handler);
    return () => ipcRenderer.removeListener('menu', handler);
  },
  onUpdateStatus: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  supportTicket: (ticket) => ipcRenderer.invoke('support:ticket', ticket),
  logError: (text) => ipcRenderer.send('log:renderer', text),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseLibraryFolder: () => ipcRenderer.invoke('settings:choose-dir'),
  useDefaultFolder: () => ipcRenderer.invoke('settings:use-default'),
  onDocsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('docs-changed', handler);
    return () => ipcRenderer.removeListener('docs-changed', handler);
  },
});
