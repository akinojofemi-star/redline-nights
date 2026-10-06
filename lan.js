// LAN play: a WebSocket relay that friends connect to (port 47800), a UDP beacon so their lobbies find the game
// (port 47801), and a listener for other hosts' beacons. The relay only passes messages between the host's lobby and
// each client; the host's lobby page runs the game logic.
const dgram = require('dgram'), os = require('os');
const { WebSocketServer } = require('ws');
const GAME_PORT = 47800, BEACON_PORT = 47801;
let relay = null, hostSock = null, clients = new Map(), nextId = 1, beacon = null, beaconTimer = null, beaconInfo = null;
const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

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
  relay = new WebSocketServer({ port: GAME_PORT });
  relay.on('error', err => { if (hooks.onError) hooks.onError(String(err.code || err.message)); });
  relay.on('connection', (ws, req) => {
    let id = null, isHost = false;
    ws.on('message', buf => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      if (m.type === 'hello') {
        const addr = req.socket.remoteAddress || '';
        const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
        if (m.role === 'host' && local && !hostSock) { hostSock = ws; isHost = true; send(ws, { type: 'welcome', id: 'H' }); return; }
        if (!hostSock) { send(ws, { type: 'error', msg: 'That game has closed.' }); ws.close(); return; }
        id = 'L' + (nextId++); clients.set(id, ws);
        send(ws, { type: 'welcome', id });
        send(hostSock, { type: 'join', id });
        return;
      }
      if (isHost && m.type === 'send') {
        const out = { type: 'msg', data: m.data };
        if (m.to === '*') clients.forEach(c => send(c, out)); else send(clients.get(m.to), out);
        if (m.kick) { const c = clients.get(m.to); if (c) c.close(); }
      } else if (id && m.type === 'msg') send(hostSock, { type: 'msg', from: id, data: m.data });
    });
    ws.on('close', () => {
      if (isHost) { hostSock = null; clients.forEach(c => c.close()); clients.clear(); }
      else if (id) { clients.delete(id); send(hostSock, { type: 'leave', id }); }
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
  if (relay) { relay.clients.forEach(c => c.terminate()); relay.close(); relay = null; }
  hostSock = null; clients.clear();
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

module.exports = { startRelay, stopRelay, startListener, localIPs, GAME_PORT, BEACON_PORT };
