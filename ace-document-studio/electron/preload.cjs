const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// The bridge keeps its pre-rename "aps" name so the renderer contract and
// the smoke test stay stable across the Ace Document Studio rename.
contextBridge.exposeInMainWorld('aps', {
  isElectron: true,
  listDocs: () => ipcRenderer.invoke('docs:list'),
  saveDoc: (doc) => ipcRenderer.invoke('docs:save', doc),
  deleteDoc: (id) => ipcRenderer.invoke('docs:delete', id),
  exportPdf: (id, title) => ipcRenderer.invoke('doc:export-pdf', { id, title }),
  printDoc: (id) => ipcRenderer.invoke('doc:print', { id }),
  printReady: (info) => ipcRenderer.send('print:ready', info),
  onMenu: on('menu'),
  onUpdate: on('update'),
  openSupport: (kind) => ipcRenderer.send('app:support', kind),
  importDocs: () => ipcRenderer.invoke('docs:import'),
  exportDocJson: (doc) => ipcRenderer.invoke('doc:export-json', doc),
  backupLibrary: () => ipcRenderer.invoke('library:backup'),
});
