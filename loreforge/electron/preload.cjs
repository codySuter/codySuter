const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loreforge", {
  isElectron: true,
  platform: process.platform,
  onMenu: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("loreforge:menu", handler);
    return () => ipcRenderer.removeListener("loreforge:menu", handler);
  },
});
