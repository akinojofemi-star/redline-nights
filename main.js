// Redline Nights desktop app.
// - Serves the game from a small local web server (the game loads its car models over HTTP).
// - Hosting on the LAN: a WebSocket relay on port 47800 that friends connect to, plus a UDP beacon on port 47801 so
//   their lobby lists your game automatically. The relay is dumb: it passes messages between the host's lobby and
//   each client; all game logic lives in the host's lobby (app/shell.html).
// - Listens for other hosts' beacons and passes them to the lobby.
// Online play (room codes) runs entirely in the lobby page over WebRTC, so it needs nothing from here.
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
const lan = require('./lan');

const APP_DIR = path.join(__dirname, 'app');
const WEB_PORT = 47820;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json' };
let win = null;

// ---------------------------------------------------------------- local web server for the game files
function startStatic() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/shell.html';
      const file = path.join(APP_DIR, path.normalize(p));
      if (!file.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    });
    // a fixed port keeps saved settings (they belong to the page's address); fall back to any free port
    srv.once('error', () => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
    srv.listen(WEB_PORT, '127.0.0.1', () => resolve(WEB_PORT));
  });
}

// ---------------------------------------------------------------- window
async function createWindow() {
  const port = await startStatic();
  win = new BrowserWindow({
    width: 1360, height: 820, minWidth: 900, minHeight: 600, backgroundColor: '#0e0a16', autoHideMenuBar: true,
    title: 'Redline Nights', icon: path.join(APP_DIR, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.loadURL(`http://127.0.0.1:${port}/shell.html`);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'f' && input.control && input.meta))) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.on('closed', () => { win = null; });
}

ipcMain.handle('host-start', (e, info) => lan.startRelay(info, { onError: msg => win && win.webContents.send('host-error', msg) }));
ipcMain.handle('host-update', (e, info) => { lan.startRelay(info); return true; });
ipcMain.handle('host-stop', () => { lan.stopRelay(); return true; });
ipcMain.handle('local-ips', () => lan.localIPs().map(a => a.address));
ipcMain.handle('fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

// races start from the lobby, not from a click inside the game, so let the game's sound start on its own
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => { lan.startListener(h => win && win.webContents.send('lan-host', h)); createWindow(); });
app.on('window-all-closed', () => { lan.stopRelay(); app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
