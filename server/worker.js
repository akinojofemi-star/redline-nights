// Racing Heritage online game server (Cloudflare Worker + one Durable Object per room).
// Every player in a room keeps a WebSocket to the room; the room passes messages between them. It speaks the same
// small protocol as the desktop app's LAN relay (lan.js), so the lobby uses one code path for both:
//   member -> room   {type:'hello', role:'host'|'client'}           first message; host gets id 'H', clients 'N1', 'N2'…
//                    {type:'send', to:'host'|'*'|id, except?, data}   '*' is everyone else in the room
//                    {type:'ping', c}                                 clock sync: answered with the room's clock
//   room -> member   {type:'welcome', id} {type:'msg', from, data} {type:'pong', c, s}
//                    {type:'join', id} {type:'leave', id}            (to the host)
//                    {type:'closed', why} {type:'error', msg}
// Game logic stays in the host's lobby; the room only routes, so it never needs updating when the game changes.
const MAX_MEMBERS = 8;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{5})$/);
    if (!m) return new Response('Racing Heritage game server\n', { headers: { 'content-type': 'text/plain' } });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
    return room.fetch(req);
  }
};

export class Room {
  constructor(state) { this.state = state; this.members = new Map(); this.n = 0; }

  async fetch() {
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    let id = null;
    const send = (sock, m) => { try { sock.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch (e) {} };
    const refuse = msg => { send(ws, { type: 'error', msg }); try { ws.close(1000, 'refused'); } catch (e) {} };

    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'ping') return send(ws, { type: 'pong', c: m.c, s: Date.now() });
      if (!id) {
        if (m.type !== 'hello') return;
        if (m.role === 'host') {
          if (this.members.has('H')) return refuse('taken');
          id = 'H';
        } else {
          if (!this.members.has('H')) return refuse('no-room');
          if (this.members.size >= MAX_MEMBERS) return refuse('That game is full.');
          id = 'N' + (++this.n);
        }
        this.members.set(id, ws);
        send(ws, { type: 'welcome', id });
        if (id !== 'H') send(this.members.get('H'), { type: 'join', id });
        return;
      }
      if (m.type === 'send') {
        const out = JSON.stringify({ type: 'msg', from: id, data: m.data });
        if (m.to === '*') { for (const [k, s] of this.members) if (k !== id && k !== m.except) send(s, out); }
        else { const s = this.members.get(m.to === 'host' ? 'H' : m.to); if (s) send(s, out); }
      }
    });
    const gone = () => {
      if (!id || this.members.get(id) !== ws) return;
      this.members.delete(id);
      if (id === 'H') {                                 // the host left: the room is over
        for (const s of this.members.values()) { send(s, { type: 'closed', why: 'The host closed the game.' }); try { s.close(1000, 'closed'); } catch (e) {} }
        this.members.clear(); this.n = 0;
      } else send(this.members.get('H'), { type: 'leave', id });
      id = null;
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
