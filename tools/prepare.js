// Builds app/game.html from src/redline-nights.html for the desktop app: the CDN scripts become local copies so the
// game runs without internet (LAN play); they're copied into app/lib.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), lib = path.join(root, 'app', 'lib');
fs.rmSync(lib, { recursive: true, force: true });
fs.mkdirSync(lib, { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(root, 'node_modules', from), path.join(lib, to));
copy('three/build/three.min.js', 'three.min.js');
copy('three/examples/js/loaders/GLTFLoader.js', 'GLTFLoader.js');

let html = fs.readFileSync(path.join(root, 'src', 'redline-nights.html'), 'utf8');
const swaps = [
  ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'lib/three.min.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', 'lib/GLTFLoader.js']
];
for (const [a, b] of swaps) {
  if (!html.includes(a)) throw new Error('Expected script not found in the game: ' + a);
  html = html.replace(a, b);
}
if (!/^<!doctype/i.test(html)) html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + html;
fs.writeFileSync(path.join(root, 'app', 'game.html'), html);
console.log('app/game.html written (' + Math.round(html.length / 1024) + ' KB)');
