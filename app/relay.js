// Relay connection for online play, used when a direct WebRTC link can't be made: players on different networks
// behind strict NATs (mobile data, carrier-grade NAT), where the free TURN servers PeerJS points at are offline.
// Messages go through public MQTT brokers over secure WebSockets, which pass through practically any network.
// A minimal MQTT 3.1.1 client: QoS 0 publish/subscribe, keepalive pings and a last-will message.
(function () {
'use strict';
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const PREFIX = 'redline-nights/r1/';
const enc = new TextEncoder(), dec = new TextDecoder();
const u16 = n => [n >> 8 & 255, n & 255];
const mstr = s => { const b = enc.encode(s); return [...u16(b.length), ...b]; };

function packet(type, parts) {
  let size = 0; for (const p of parts) size += p.length;
  const len = []; let n = size;
  do { let d = n & 127; n >>>= 7; if (n) d |= 128; len.push(d); } while (n);
  const out = new Uint8Array(1 + len.length + size); out[0] = type; out.set(len, 1);
  let o = 1 + len.length; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Resolves with a connection once the broker accepts us; rejects on failure or after `timeout` ms.
function connect(url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    let ws; try { ws = new WebSocket(url, 'mqtt'); } catch (e) { return reject(e); }
    ws.binaryType = 'arraybuffer';
    let buf = new Uint8Array(0), ready = false, pid = 1, pinger = null; const subbed = new Map();
    const conn = { url, onmsg: null, onclose: null, closed: false };
    const send = p => { if (ws.readyState === 1) ws.send(p); };
    const timer = setTimeout(() => { if (!ready) { try { ws.close(); } catch (e) {} reject(new Error('timeout')); } }, opts.timeout || 6000);
    conn.sub = (topic, done) => { pid = pid % 65535 + 1; if (done) subbed.set(pid, done); send(packet(0x82, [u16(pid), mstr(topic), [0]])); };
    conn.pub = (topic, text) => send(packet(0x30, [mstr(topic), enc.encode(text)]));
    conn.close = () => { if (conn.closed) return; conn.closed = true; clearInterval(pinger); send(new Uint8Array([0xE0, 0])); setTimeout(() => { try { ws.close(); } catch (e) {} }, 50); };
    ws.onopen = () => {
      const id = 'rn' + Math.random().toString(36).slice(2, 12);
      const will = opts.will, flags = 0x02 | (will ? 0x04 : 0);
      const body = [mstr('MQTT'), [4, flags], u16(30), mstr(id)];
      if (will) { const w = enc.encode(will.text); body.push(mstr(will.topic), u16(w.length), w); }
      send(packet(0x10, body));
    };
    ws.onmessage = e => {
      const chunk = new Uint8Array(e.data), joined = new Uint8Array(buf.length + chunk.length);
      joined.set(buf); joined.set(chunk, buf.length); buf = joined;
      for (;;) {                                          // a frame may hold several packets, or part of one
        let i = 1, len = 0, mul = 1, d;
        do { if (i >= buf.length) return; d = buf[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, qos = buf[0] >> 1 & 3, body = buf.subarray(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) {                                 // CONNACK
          clearTimeout(timer);
          if (body[1] !== 0) { try { ws.close(); } catch (e) {} return reject(new Error('refused ' + body[1])); }
          ready = true; pinger = setInterval(() => send(new Uint8Array([0xC0, 0])), 20000); resolve(conn);
        } else if (type === 9) {                          // SUBACK
          const id = body[0] << 8 | body[1], done = subbed.get(id); subbed.delete(id); if (done) done();
        } else if (type === 3 && conn.onmsg) {            // PUBLISH
          const tl = body[0] << 8 | body[1], topic = dec.decode(body.subarray(2, 2 + tl));
          conn.onmsg(topic, dec.decode(body.subarray(2 + tl + (qos ? 2 : 0))));
        }
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(timer); clearInterval(pinger);
      if (!ready) return reject(new Error('closed'));
      const was = conn.closed; conn.closed = true; if (!was && conn.onclose) conn.onclose();
    };
  });
}

window.RN_RELAY = {
  BROKERS, connect,
  hostTopic: code => PREFIX + code + '/h',
  clientTopic: (code, rid) => PREFIX + code + '/c/' + rid
};
})();
