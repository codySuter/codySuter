const { clipboard, contextBridge, ipcRenderer } = require('electron');

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
  exportPng: (id, title) => ipcRenderer.invoke('doc:export-png', { id, title }),
  compilePdf: (ids, title, toc) => ipcRenderer.invoke('compile:export-pdf', { ids, title, toc }),
  printDoc: (id) => ipcRenderer.invoke('doc:print', { id }),
  printReady: (info) => ipcRenderer.send('print:ready', info),
  onMenu: on('menu'),
  onUpdate: on('update'),
  importDocs: () => ipcRenderer.invoke('docs:import'),
  exportDocJson: (doc) => ipcRenderer.invoke('doc:export-json', doc),
  backupLibrary: () => ipcRenderer.invoke('library:backup'),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  saveTemplate: (name, doc) => ipcRenderer.invoke('templates:save', { name, doc }),
  deleteTemplate: (id) => ipcRenderer.invoke('templates:delete', id),
  listHistory: (id) => ipcRenderer.invoke('history:list', id),
  readHistory: (id, file) => ipcRenderer.invoke('history:read', { id, file }),
  snapshotHistory: (id) => ipcRenderer.invoke('history:snapshot', id),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (file) => ipcRenderer.invoke('backups:restore', file),
  readClipboardText: async () => clipboard.readText(),
  writeClipboardText: async (text) => clipboard.writeText(String(text)),
  syncGetSettings: () => ipcRenderer.invoke('sync:settings-get'),
  syncSetSettings: (next) => ipcRenderer.invoke('sync:settings-set', next),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  onSync: on('sync'),
});
