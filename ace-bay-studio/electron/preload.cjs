const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('abs', {
  isElectron: true,
  loadMap: () => ipcRenderer.invoke('map:load'),
  saveMap: (map) => ipcRenderer.invoke('map:save', map),
  pickFile: (kind) => ipcRenderer.invoke('file:pick', kind),
  saveFile: (defaultName, text, kind) => ipcRenderer.invoke('file:save', { defaultName, text, kind }),
  onMenu: on('menu'),
  onUpdate: on('update'),
  openSupport: (kind) => ipcRenderer.send('app:support', kind),
});
