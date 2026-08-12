const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('afs', {
  isElectron: true,
  loadDoc: () => ipcRenderer.invoke('doc:load'),
  saveDoc: (doc) => ipcRenderer.invoke('doc:save', doc),
  pickFile: (kind) => ipcRenderer.invoke('file:pick', kind),
  saveFile: (defaultName, text, kind) => ipcRenderer.invoke('file:save', { defaultName, text, kind }),
  onMenu: on('menu'),
  onUpdate: on('update'),
  openSupport: (kind) => ipcRenderer.send('app:support', kind),
});
