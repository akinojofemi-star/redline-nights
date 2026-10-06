// Builds the browser version into web/: the same lobby and game the desktop app serves, with the lobby as index.html.
// LAN hosting needs the desktop app; everything else (solo, online room codes) works in any modern browser.
const fs = require('fs'), path = require('path');
require('./prepare');
const root = path.join(__dirname, '..'), app = path.join(root, 'app'), web = path.join(root, 'web');
fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(app, web, { recursive: true, filter: src => path.basename(src) !== 'duo.html' });
fs.copyFileSync(path.join(app, 'shell.html'), path.join(web, 'index.html'));
fs.writeFileSync(path.join(web, '.nojekyll'), '');
console.log('web/ ready');
