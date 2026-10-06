// Quick check of the LAN relay and beacon without the app: a host and a client exchange messages through the relay,
// and the listener hears the host's beacon.
const lan = require('../lan'); const WebSocket = require('ws');
const log = []; let heard = null;
lan.startListener(h => { heard = h; });
const r = lan.startRelay({ v: '1.0', name: "Test's game", players: 1, map: 'city' });
const host = new WebSocket('ws://127.0.0.1:' + r.port);
host.on('open', () => host.send(JSON.stringify({ type: 'hello', role: 'host' })));
host.on('message', b => { const m = JSON.parse(b); log.push('host<-' + m.type + (m.data ? ':' + m.data.t : '') + (m.from ? ' from ' + m.from : ''));
  if (m.type === 'msg' && m.data.t === 'hello') host.send(JSON.stringify({ type: 'send', to: m.from, data: { t: 'lobby', you: m.from } })); });
setTimeout(() => {
  const ip = r.ips[0] || '127.0.0.1';
  const c = new WebSocket('ws://' + ip + ':' + r.port);
  c.on('open', () => c.send(JSON.stringify({ type: 'hello', role: 'client' })));
  c.on('message', b => { const m = JSON.parse(b); log.push('client<-' + m.type + (m.data ? ':' + m.data.t : '') + (m.id ? ' id ' + m.id : ''));
    if (m.type === 'welcome') c.send(JSON.stringify({ type: 'msg', data: { t: 'hello', name: 'Friend' } })); });
  setTimeout(() => { c.close(); setTimeout(() => { console.log(log.join('\n')); console.log('beacon heard:', heard ? JSON.stringify(heard) : 'NO'); console.log('ips', r.ips); lan.stopRelay(); process.exit(0); }, 300); }, 1500);
}, 300);
