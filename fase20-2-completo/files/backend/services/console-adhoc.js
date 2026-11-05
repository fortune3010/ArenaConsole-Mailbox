'use strict';
/**
 * backend/services/console-adhoc.js — GA20_ARENA (Fase 20.2.3): servidor ad hoc do Arena Console, uma instância por sala.
 *
 * O PPSSPP (Arena Console) liga-se a 127.0.0.1:27312 (servidor PRO adhocctl) e 127.0.0.1:27313 (relay aemu_postoffice).
 * Uma ponte Java no telemóvel passa cada ligação TCP por Socket.IO (/console: tun_open / tun_data / tun_close) até aqui.
 * Este módulo faz o papel dos dois servidores, só para os 2 jogadores da sala (isolamento total entre salas).
 *
 * Protocolos (re-implementação a partir das estruturas públicas):
 *  - adhocctl v1 (PRO online): LOGIN 144 B, CONNECT 9, DISCONNECT 1, SCAN 1, CHAT 65, PING 1 (cliente -> servidor);
 *    CONNECT 139, DISCONNECT 5, SCAN 15, SCAN_COMPLETE 1, CONNECT_BSSID 7, CHAT 193 (servidor -> cliente).
 *  - aemu_postoffice (TCP): init 24 B {int32 type, mac[8], u16 sport, mac[8], u16 dport}, little endian;
 *    PDP {mac[8], u16 port, u32 size} + dados; PTP connect {mac[8], u16 port}; PTP dados {u32 size} + dados.
 *
 * API:  const hub = createAdhocHub({ log });
 *       const h = hub.open(port, send(buf), end());   // port 27312 | 27313; devolve null se a porta não for suportada
 *       h.data(buf); h.close();                        // dados que chegam do telemóvel / o telemóvel fechou
 *       hub.closeAll();
 */

const ADHOCCTL_PORT = 27312;
const POSTOFFICE_PORT = 27313;

// adhocctl v1
const OP_PING = 0, OP_LOGIN = 1, OP_CONNECT = 2, OP_DISCONNECT = 3, OP_SCAN = 4, OP_SCAN_COMPLETE = 5, OP_CONNECT_BSSID = 6, OP_CHAT = 7;
const C2S_SIZE = { [OP_PING]: 1, [OP_LOGIN]: 144, [OP_CONNECT]: 9, [OP_DISCONNECT]: 1, [OP_SCAN]: 1, [OP_CHAT]: 65 };
const DEFAULT_CHANNEL = 11;
const CTL_LOGIN_TIMEOUT_MS = 5000;
const CTL_IDLE_TIMEOUT_MS = 30000;

// aemu_postoffice
const PO_INIT_PDP = 0, PO_INIT_PTP_LISTEN = 1, PO_INIT_PTP_CONNECT = 2, PO_INIT_PTP_ACCEPT = 3, PO_INIT_PDP_UNRELIABLE = 4;
const PO_INIT_SIZE = 24, PO_PDP_HDR = 14, PO_PTP_CONNECT = 10, PO_PTP_HDR = 4;
const PDP_MAX = 10 * 1024 * 2, PTP_MAX = 50 * 1024 * 2;
const PO_INIT_TIMEOUT_MS = 5000;     // session_init_time_limit_ms do servidor original
const PO_CONNECT_TIMEOUT_MS = 5000;  // connect_time_limit_ms

const MAX_STREAMS = 64;
const MAX_BUFFER = 512 * 1024;

const macHex = (b, off) => b.subarray(off, off + 6).toString('hex');
const macBuf = hex => { const m = Buffer.alloc(8); Buffer.from(hex, 'hex').copy(m, 0, 0, 6); return m; };
const cstr = (b, off, len) => { const s = b.subarray(off, off + len); const z = s.indexOf(0); return (z < 0 ? s : s.subarray(0, z)).toString('latin1'); };

function createAdhocHub(opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const streams = new Set();

  /* ======================= adhocctl ======================= */
  const clients = new Map();   // mac -> client
  const games = new Map();     // gameCode -> Map(groupKey -> {channel, name, leader, members: Map(mac -> client)})
  let nextId = 1;

  const ctlSend = (c, buf) => { if (!c.closed) c.send(buf); };
  const pktConnect = peer => {
    const b = Buffer.alloc(139); b[0] = OP_CONNECT;
    Buffer.from(peer.nick, 'latin1').copy(b, 1, 0, 127);
    Buffer.from(peer.mac, 'hex').copy(b, 129);
    b.writeUInt32LE(peer.id >>> 0, 135);
    return b;
  };
  const pktDisconnect = peer => { const b = Buffer.alloc(5); b[0] = OP_DISCONNECT; b.writeUInt32LE(peer.id >>> 0, 1); return b; };
  const pktBssid = mac => { const b = Buffer.alloc(7); b[0] = OP_CONNECT_BSSID; Buffer.from(mac, 'hex').copy(b, 1); return b; };
  const pktScan = g => { const b = Buffer.alloc(15); b[0] = OP_SCAN; Buffer.from(g.name, 'latin1').copy(b, 1, 0, 8); Buffer.from(g.leader, 'hex').copy(b, 9); return b; };
  const pktChat = (nick, msg) => { const b = Buffer.alloc(193); b[0] = OP_CHAT; msg.copy(b, 1, 0, 63); Buffer.from(nick, 'latin1').copy(b, 65, 0, 127); return b; };

  function groupOf(c) {
    if (!c.groupKey) return null;
    const g = games.get(c.game);
    return g ? g.get(c.groupKey) || null : null;
  }
  function leaveGroup(c) {
    const g = groupOf(c), key = c.groupKey;
    c.groupKey = null;
    if (!g) return;
    g.members.delete(c.mac);
    if (g.channel >= 1) for (const m of g.members.values()) ctlSend(m, pktDisconnect(c));
    if (g.members.size === 0) {
      const gm = games.get(c.game);
      gm.delete(key);
      if (gm.size === 0) games.delete(c.game);
    }
  }
  function joinGroup(c, name, groupless) {
    leaveGroup(c);
    const channel = groupless ? -DEFAULT_CHANNEL : DEFAULT_CHANNEL;
    const key = channel + ':' + name;
    if (!games.has(c.game)) games.set(c.game, new Map());
    const gm = games.get(c.game);
    let g = gm.get(key);
    if (!g) { g = { channel, name, leader: c.mac, members: new Map() }; gm.set(key, g); }
    if (!groupless) {
      for (const m of g.members.values()) { ctlSend(m, pktConnect(c)); ctlSend(c, pktConnect(m)); }
      ctlSend(c, pktBssid(g.leader));
    }
    g.members.set(c.mac, c);
    c.groupKey = key;
  }
  function removeClient(c) {
    if (c.mac && clients.get(c.mac) === c) { leaveGroup(c); clients.delete(c.mac); }
  }
  function ctlPacket(c, op, p) {
    switch (op) {
      case OP_LOGIN: {
        if (c.mac) return false;     // um login por ligação
        const mac = macHex(p, 1);
        if (/^..0{10}$/.test(mac)) return false;               // MAC vazio (o 1.º byte não conta)
        const game = cstr(p, 135, 9);
        if (!/^[A-Z0-9]{9}$/.test(game)) return false;
        c.nick = cstr(p, 7, 128).slice(0, 127);
        c.game = game;
        const old = clients.get(mac);
        if (old && old !== c) { removeClient(old); old.end(); }
        c.mac = mac; c.id = nextId++;
        clients.set(mac, c);
        joinGroup(c, '', true);
        log('adhocctl login', mac, game);
        return true;
      }
      case OP_PING: return true;
      case OP_CONNECT: {
        if (!c.mac) return false;
        joinGroup(c, cstr(p, 1, 8), false);
        return true;
      }
      case OP_DISCONNECT: {
        if (!c.mac) return false;
        joinGroup(c, '', true);
        return true;
      }
      case OP_SCAN: {
        if (!c.mac) return false;
        const gm = games.get(c.game);
        if (gm) for (const g of gm.values()) if (g.channel >= 0) ctlSend(c, pktScan(g));
        const done = Buffer.alloc(1); done[0] = OP_SCAN_COMPLETE; ctlSend(c, done);
        return true;
      }
      case OP_CHAT: {
        if (!c.mac) return false;
        const g = groupOf(c);
        if (g && g.channel >= 0) for (const m of g.members.values()) if (m !== c) ctlSend(m, pktChat(c.nick, p.subarray(1, 65)));
        return true;
      }
      default: return false;
    }
  }
  function openCtl(send, end) {
    const c = { kind: 'ctl', send, end: () => { if (!c.closed) { c.closed = true; clearInterval(c.timer); removeClient(c); end(); } },
      buf: Buffer.alloc(0), mac: null, nick: '', game: '', groupKey: null, id: 0, closed: false, created: Date.now(), seen: Date.now(), timer: null };
    c.timer = setInterval(() => {
      const now = Date.now();
      if ((!c.mac && now - c.created > CTL_LOGIN_TIMEOUT_MS) || now - c.seen > CTL_IDLE_TIMEOUT_MS) c.end();
    }, 1000);
    if (c.timer.unref) c.timer.unref();
    c.data = chunk => {
      if (c.closed) return;
      c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
      if (c.buf.length > MAX_BUFFER) return c.end();
      let any = false;
      while (c.buf.length >= 1) {
        const op = c.buf[0], size = C2S_SIZE[op];
        if (!size || ((op !== OP_LOGIN && op !== OP_PING) && !c.mac)) return c.end();
        if (c.buf.length < size) break;
        const p = c.buf.subarray(0, size);
        c.buf = c.buf.subarray(size);
        if (!ctlPacket(c, op, p)) return c.end();
        any = true;
      }
      if (any) c.seen = Date.now();
    };
    c.close = () => c.end();
    return c;
  }

  /* ======================= aemu_postoffice ======================= */
  const sessions = new Map();  // nome -> sessão
  const pending = new Set();
  let poTimer = null;

  const pdpName = (mac, port) => 'PDP ' + mac + ' ' + port;
  const listenName = (mac, port) => 'PTP_LISTEN ' + mac + ' ' + port;
  const connectName = (a, ap, b, bp) => 'PTP_CONNECT ' + a + ' ' + ap + ' ' + b + ' ' + bp;
  const acceptName = (a, ap, b, bp) => 'PTP_ACCEPT ' + a + ' ' + ap + ' ' + b + ' ' + bp;

  function sessName(s) {
    switch (s.mode) {
      case 'pdp': return pdpName(s.from, s.fport);
      case 'listen': return listenName(s.from, s.fport);
      case 'connect': return connectName(s.from, s.fport, s.to, s.tport);
      default: return acceptName(s.from, s.fport, s.to, s.tport);
    }
  }
  function peerName(s) {
    if (s.mode === 'connect') return acceptName(s.to, s.tport, s.from, s.fport);
    if (s.mode === 'accept') return connectName(s.to, s.tport, s.from, s.fport);
    return '';
  }
  function killSession(s) {
    if (s.dead) return;
    s.dead = true;
    if (sessions.get(s.name) === s) sessions.delete(s.name);
    s.end();
    const peer = s.peer && sessions.get(s.peer);
    if (peer && peer.peer === s.name) killSession(peer);
  }
  const ptpConnectPkt = (mac, port) => { const b = Buffer.alloc(PO_PTP_CONNECT); macBuf(mac).copy(b, 0); b.writeUInt16LE(port, 8); return b; };

  function pumpSession(s) {
    // dados do telemóvel -> outras sessões
    while (!s.dead && s.mode !== 'listen' && !s.connecting) {
      if (s.need < 0) {
        const hdr = s.mode === 'pdp' ? PO_PDP_HDR : PO_PTP_HDR;
        if (s.buf.length < hdr) break;
        if (s.mode === 'pdp') {
          s.target = pdpName(macHex(s.buf, 0), s.buf.readUInt16LE(8));
          s.need = s.buf.readUInt32LE(10);
          if (s.need > PDP_MAX) return killSession(s);
        } else {
          s.need = s.buf.readUInt32LE(0);
          if (s.need > PTP_MAX) return killSession(s);
        }
        s.buf = s.buf.subarray(hdr);
      }
      if (s.buf.length < s.need) break;
      const body = s.buf.subarray(0, s.need);
      s.buf = s.buf.subarray(s.need);
      if (s.mode === 'pdp') {
        const t = sessions.get(s.target);
        if (t && t.mode === 'pdp' && !t.dead) {
          const out = Buffer.alloc(PO_PDP_HDR + body.length);
          macBuf(s.from).copy(out, 0); out.writeUInt16LE(s.fport, 8); out.writeUInt32LE(body.length, 10); body.copy(out, PO_PDP_HDR);
          t.send(out);
        }
      } else {
        const t = sessions.get(s.peer);
        if (t && !t.dead) {
          const out = Buffer.alloc(PO_PTP_HDR + body.length);
          out.writeUInt32LE(body.length, 0); body.copy(out, PO_PTP_HDR);
          t.send(out);
        }
      }
      s.need = -1;
    }
  }

  function createSession(st, init) {
    const type = init.readInt32LE(0), src = macHex(init, 4), sport = init.readUInt16LE(12), dst = macHex(init, 14), dport = init.readUInt16LE(22);
    const mode = type === PO_INIT_PDP || type === PO_INIT_PDP_UNRELIABLE ? 'pdp' : type === PO_INIT_PTP_LISTEN ? 'listen' : type === PO_INIT_PTP_CONNECT ? 'connect' : 'accept';
    const s = { kind: 'po', mode, from: src, fport: sport, to: mode === 'connect' || mode === 'accept' ? dst : '', tport: mode === 'connect' || mode === 'accept' ? dport : 0,
      send: st.send, end: st.end, buf: mode === 'listen' ? Buffer.alloc(0) : st.buf, need: -1, target: '', dead: false, connecting: false, created: Date.now(), peer: '' };
    s.name = sessName(s);
    s.peer = peerName(s);
    const old = sessions.get(s.name);
    if (old) killSession(old);  // a sessão nova com o mesmo nome substitui a antiga (como no servidor original)
    sessions.set(s.name, s);
    st.session = s;
    if (mode === 'connect') {
      s.connecting = true;
      const l = sessions.get(listenName(dst, dport));
      if (l && !l.dead) l.send(ptpConnectPkt(src, sport));
    } else if (mode === 'accept') {
      const c = sessions.get(s.peer);  // = connectName(dst, dport, src, sport)
      c.send(ptpConnectPkt(src, sport));
      s.send(ptpConnectPkt(c.from, c.fport));
      c.connecting = false;
      pumpSession(c);
    }
    log('postoffice', s.name);
    pumpSession(s);
    return s;
  }

  // Uma ligação nova espera pelos 24 bytes de init; um connect espera (até 5 s) que o listen exista.
  function tryPending(st) {
    if (st.closed || st.session) { pending.delete(st); return; }
    if (Date.now() - st.created > PO_INIT_TIMEOUT_MS) { pending.delete(st); return st.close(); }
    if (st.buf.length < PO_INIT_SIZE) return;
    const init = st.buf.subarray(0, PO_INIT_SIZE), type = init.readInt32LE(0);
    if (type < 0 || type > 4) { pending.delete(st); return st.close(); }
    if (type === PO_INIT_PTP_CONNECT) {
      const l = sessions.get(listenName(macHex(init, 14), init.readUInt16LE(22)));
      if (!l || l.dead) return;   // ainda não há listen: espera
    }
    if (type === PO_INIT_PTP_ACCEPT) {
      const c = sessions.get(connectName(macHex(init, 14), init.readUInt16LE(22), macHex(init, 4), init.readUInt16LE(12)));
      if (!c || c.dead || !c.connecting) { pending.delete(st); return st.close(); }
    }
    pending.delete(st);
    st.buf = st.buf.subarray(PO_INIT_SIZE);
    createSession(st, Buffer.from(init));
    st.buf = null;
  }
  function poTick() {
    for (const st of [...pending]) tryPending(st);
    const now = Date.now();
    for (const s of [...sessions.values()]) if (s.mode === 'connect' && s.connecting && now - s.created > PO_CONNECT_TIMEOUT_MS) killSession(s);
    if (!pending.size && ![...sessions.values()].some(s => s.connecting)) { clearInterval(poTimer); poTimer = null; }
  }
  const armPo = () => { if (!poTimer) { poTimer = setInterval(poTick, 20); if (poTimer.unref) poTimer.unref(); } };

  function openPo(send, end) {
    const st = { kind: 'po-stream', send, end: () => { if (!st.closed) { st.closed = true; end(); } }, buf: Buffer.alloc(0), session: null, closed: false, created: Date.now() };
    st.data = chunk => {
      if (st.closed) return;
      const s = st.session;
      if (s) {
        if (s.dead || s.mode === 'listen') return;   // o listen não manda dados
        s.buf = s.buf.length ? Buffer.concat([s.buf, chunk]) : chunk;
        if (s.buf.length > MAX_BUFFER) return killSession(s);
        return pumpSession(s);
      }
      st.buf = st.buf.length ? Buffer.concat([st.buf, chunk]) : chunk;
      if (st.buf.length > MAX_BUFFER) return st.close();
      tryPending(st);
      for (const o of [...pending]) if (o !== st) tryPending(o);   // um listen novo pode desbloquear connects
    };
    st.close = () => {
      pending.delete(st);
      if (st.session) killSession(st.session); else st.end();
    };
    pending.add(st);
    armPo();
    return st;
  }

  return {
    open(port, send, end) {
      if (streams.size >= MAX_STREAMS) return null;
      let h = null;
      const done = () => { streams.delete(h); end(); };
      if (port === ADHOCCTL_PORT) h = openCtl(send, done);
      else if (port === POSTOFFICE_PORT) h = openPo(send, done);
      else return null;
      streams.add(h);
      return { data: b => h.data(b), close: () => { if (h.kind === 'ctl') h.end(); else h.close(); } };
    },
    closeAll() {
      for (const h of [...streams]) { if (h.kind === 'ctl') h.end(); else h.close(); }
      clearInterval(poTimer); poTimer = null;
    },
    stats: () => ({ streams: streams.size, clients: clients.size, sessions: sessions.size, pending: pending.size }),
  };
}

module.exports = { createAdhocHub, ADHOCCTL_PORT, POSTOFFICE_PORT };
