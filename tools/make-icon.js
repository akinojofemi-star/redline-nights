// Renders build/icon.svg to build/icon.png (1024x1024) with Electron's Chromium; electron-builder turns that PNG into
// the Mac .icns, Windows .ico and Linux icons. Run: npx electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const build = path.join(__dirname, '..', 'build');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true } });
  const svg = fs.readFileSync(path.join(build, 'icon.svg'), 'utf8');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>' + svg));
  await new Promise(r => setTimeout(r, 300));
  const img = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  fs.writeFileSync(path.join(build, 'icon.png'), img.toPNG());
  console.log('build/icon.png written', img.getSize());
  app.quit();
});
