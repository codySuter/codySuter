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
});
