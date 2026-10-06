// The lobby page's bridge to the app: start/stop hosting a LAN game and hear about other LAN games.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rn', {
  hostStart: info => ipcRenderer.invoke('host-start', info),
  hostUpdate: info => ipcRenderer.invoke('host-update', info),
  hostStop: () => ipcRenderer.invoke('host-stop'),
  localIPs: () => ipcRenderer.invoke('local-ips'),
  toggleFullscreen: () => ipcRenderer.invoke('fullscreen'),
  onLanHost: cb => ipcRenderer.on('lan-host', (e, h) => cb(h)),
  onHostError: cb => ipcRenderer.on('host-error', (e, msg) => cb(msg))
});
