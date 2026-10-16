// LAN play: a WebSocket relay that friends connect to (port 47800), a UDP beacon so their lobbies find the game
// (port 47801), and a listener for other hosts' beacons. The relay only passes messages between the players; the
// host's lobby page runs the game logic.
// While hosting, the same port also serves the game itself over plain HTTP, so a friend on the network can play in a
// browser: they open http://<host address>:47800 and the lobby there joins this game. (A browser can't host, hear the
// beacon or reach the relay from the https website, which may only open secure connections; a page served from here
// can.) They get exactly the host's version of the game. It speaks the same protocol as the online game server (server/worker.js):
//   member -> relay  {type:'hello', role:'host'|'client'}  {type:'send', to:'host'|'*'|id, except?, data}  {type:'ping', c}
//   relay -> member  {type:'welcome', id}  {type:'msg', from, data}  {type:'pong', c, s}  {type:'join'|'leave', id}
//                    {type:'closed', why}  {type:'error', msg}
const dgram = require('dgram'), os = require('os'), http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const GAME_PORT = 47800, BEACON_PORT = 47801, MAX_MEMBERS = 8;
let relay = null, members = new Map(), nextId = 1, beacon = null, beaconTimer = null, beaconInfo = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json', '.webmanifest': 'application/manifest+json' };
// a read-only file server for the game's folder (the app's own window and LAN browsers both use it)
function serveDir(dir) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    if (p === '/') p = '/shell.html';
    const file = path.join(dir, path.normalize(p));
    if (!file.startsWith(dir + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  };
}
let gameDir = null;
const setGameDir = dir => { gameDir = dir; };
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };

function localIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ address: a.address, netmask: a.netmask });
  return out;
}
function broadcastAddrs() {
  const out = new Set(['255.255.255.255']);
  for (const { address, netmask } of localIPs()) {
    const ip = address.split('.').map(Number), m = netmask.split('.').map(Number);
    out.add(ip.map((b, i) => (b & m[i]) | (~m[i] & 255)).join('.'));
  }
  return [...out];
}

function startRelay(info, hooks = {}) {
  beaconInfo = info;
  if (relay) return { port: GAME_PORT, ips: localIPs().map(a => a.address) };
  const web = http.createServer(gameDir ? serveDir(gameDir) : (q, r) => { r.writeHead(404); r.end(); });
  web.on('error', err => { if (hooks.onError) hooks.onError(String(err.code || err.message)); });
  web.listen(GAME_PORT);
  relay = new WebSocketServer({ server: web });relay.web = web;
  relay.on('connection', (ws, req) => {
    let id = null;
    const refuse = msg => { send(ws, { type: 'error', msg }); ws.close(); };
    ws.on('message', buf => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      if (m.type === 'ping') return send(ws, { type: 'pong', c: m.c, s: Date.now() });
      if (!id) {
        if (m.type !== 'hello') return;
        const addr = req.socket.remoteAddress || '';
        const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
        if (m.role === 'host') {
          if (!local || members.has('H')) return refuse('taken');
          id = 'H';
        } else {
          if (!members.has('H')) return refuse('no-room');
          if (members.size >= MAX_MEMBERS) return refuse('That game is full.');
          id = 'L' + (nextId++);
        }
        members.set(id, ws);
        send(ws, { type: 'welcome', id });
        if (id !== 'H') send(members.get('H'), { type: 'join', id });
        return;
      }
      if (m.type === 'send') {
        const out = JSON.stringify({ type: 'msg', from: id, data: m.data });
        if (m.to === '*') { for (const [k, s] of members) if (k !== id && k !== m.except) send(s, out); }
        else send(members.get(m.to === 'host' ? 'H' : m.to), out);
      }
    });
    ws.on('close', () => {
      if (!id || members.get(id) !== ws) return;
      members.delete(id);
      if (id === 'H') { for (const s of members.values()) { send(s, { type: 'closed', why: 'The host closed the game.' }); s.close(); } members.clear(); }
      else send(members.get('H'), { type: 'leave', id });
    });
  });
  // the beacon: a small JSON packet to every broadcast address once a second
  beacon = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  beacon.bind(() => {
    beacon.setBroadcast(true);
    beaconTimer = setInterval(() => {
      const pkt = Buffer.from(JSON.stringify({ rn: 'redline', port: GAME_PORT, ...beaconInfo }));
      for (const a of broadcastAddrs()) beacon.send(pkt, BEACON_PORT, a, () => {});
    }, 1000);
  });
  return { port: GAME_PORT, ips: localIPs().map(a => a.address) };
}
function stopRelay() {
  clearInterval(beaconTimer); beaconTimer = null;
  if (beacon) { try { beacon.close(); } catch {} beacon = null; }
  if (relay) { relay.clients.forEach(c => c.terminate()); relay.close(); if (relay.web) relay.web.close(); relay = null; }
  members.clear();
}

// ---------------------------------------------------------------- LAN discovery: hear other hosts' beacons
function startListener(onHost) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => {});
  sock.on('message', (buf, rinfo) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.rn !== 'redline') return;
    onHost({ ...m, ip: rinfo.address, mine: localIPs().some(a => a.address === rinfo.address) });
  });
  sock.bind(BEACON_PORT);
}

module.exports = { startRelay, stopRelay, startListener, localIPs, serveDir, setGameDir, GAME_PORT, BEACON_PORT };
