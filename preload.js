// The lobby page's bridge to the app: start/stop hosting a LAN game, hear about other LAN games, and make a Wi-Fi
// network for them.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rn', {
  hostStart: info => ipcRenderer.invoke('host-start', info),
  hostUpdate: info => ipcRenderer.invoke('host-update', info),
  hostStop: () => ipcRenderer.invoke('host-stop'),
  localIPs: () => ipcRenderer.invoke('local-ips'),
  netCan: () => ipcRenderer.invoke('net-can'),
  netStart: cfg => ipcRenderer.invoke('net-start', cfg),
  netStop: () => ipcRenderer.invoke('net-stop'),
  netSettings: () => ipcRenderer.invoke('net-settings'),
  onNetDrop: cb => ipcRenderer.on('net-drop', () => cb()),
  toggleFullscreen: () => ipcRenderer.invoke('fullscreen'),
  onLanHost: cb => ipcRenderer.on('lan-host', (e, h) => cb(h)),
  onHostError: cb => ipcRenderer.on('host-error', (e, msg) => cb(msg))
});
