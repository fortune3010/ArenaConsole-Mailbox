'use strict';
/**
 * backend/services/console-namespace.js — GA20_CONSOLE (Fase 20.1): matchmaking do Arena Console (PSP 1x1).
 *
 * Uso:  require('./services/console-namespace')(io, { onFinish })   // namespace '/console', path '/ws'
 *
 * LOBBY (Launcher, página /games/console/lobby.html):
 *   cliente → servidor: create_room {code, rom:{name,size,fp,gid}} | join_room {code, rom} | ready {ready} | start {} | leave {}
 *   servidor → cliente: lobby {code, phase, you, players:[{seat,name,rom,ready,online}], sameRom}
 *                       room_error {reason: bad_code|exists|not_found|full|started|bad_rom}
 *                       start_error {reason: not_host|need_2|not_ready|rom_mismatch}
 *                       console_start {code, role, pid, peerPid, startToken, server, ns, protocol}
 *                       room_closed {reason}
 * EMULADOR (Fase 20.2, app Arena Console) — sinalização WebRTC para o netplay:
 *   emu_join {code, pid, startToken} → emu_ready {role, peerPid, iceServers, peerOnline} | emu_error {reason}
 *   emu_signal {sdp?|candidate?}     → reencaminhado ao outro jogador como emu_signal {from, sdp?|candidate?}
 *   emu_peer {online}                → o outro emulador ligou/desligou
 *   emu_result {winnerRole}          → resultado (só aceite se os 2 disserem o mesmo) → opts.onFinish (GA16)
 */
const crypto = require('crypto');

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let iceServers = async () => STUN;
try { const t = require('./cloudflare-turn'); if (t && typeof t.getIceServers === 'function') iceServers = () => t.getIceServers(); }
catch (e) { console.warn('[console] sem cloudflare-turn; netplay só com STUN'); }

const CODE_RE = /^[A-Z0-9]{4,8}$/;
const FP_RE = /^[a-f0-9]{16,64}$/;
const LOBBY_TTL_MS = 30 * 60 * 1000;   // sala parada no lobby
const PLAY_TTL_MS = 6 * 60 * 60 * 1000; // depois do início: os emuladores podem (re)ligar-se durante 6 h
const hex = n => crypto.randomBytes(n).toString('hex');
const clean = (s, n) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);

function setupConsole(io, opts = {}) {
  const nsp = io.of('/console'), rooms = new Map();
  const server = opts.publicUrl || 'https://gamer-fortune.onrender.com';

  const romOf = r => {
    if (!r || typeof r !== 'object') return null;
    const fp = String(r.fp || '').toLowerCase(), size = Number(r.size);
    if (!FP_RE.test(fp) || !Number.isFinite(size) || size <= 0) return null;
    return { name: clean(r.name, 80) || 'Jogo', size: Math.round(size), fp, gid: clean(r.gid, 32) };
  };
  const same = r => r.players.length === 2 && r.players[0].rom.fp === r.players[1].rom.fp && r.players[0].rom.size === r.players[1].rom.size;
  const pub = (r, seat) => ({
    code: r.code, phase: r.phase, you: seat, sameRom: same(r),
    players: r.players.map(p => ({ seat: p.seat, name: p.name, rom: { name: p.rom.name, size: p.rom.size, gid: p.rom.gid }, ready: p.ready, online: !!p.sid })),
  });
  const push = r => r.players.forEach(p => { if (p.sid) nsp.to(p.sid).emit('lobby', pub(r, p.seat)); });
  const kill = (r, reason) => {
    clearTimeout(r.ttl);
    r.players.forEach(p => { if (p.sid) nsp.to(p.sid).emit('room_closed', { reason }); });
    rooms.delete(r.code);
  };
  const arm = (r, ms) => { clearTimeout(r.ttl); r.ttl = setTimeout(() => kill(r, 'expired'), ms); if (r.ttl.unref) r.ttl.unref(); };

  nsp.on('connection', s => {
    const tok = String((s.handshake.auth && s.handshake.auth.token) || '').slice(0, 512);
    let room = null, me = null;      // lugar no lobby (Launcher)
    let emu = null;                  // { room, p } se este socket for um emulador
    const on = (ev, fn) => s.on(ev, d => { try { fn(d && typeof d === 'object' ? d : {}); } catch (e) { console.error('[console]', ev, e); } });

    const seatIn = (r, seat) => { room = r; me = r.players[seat]; me.sid = s.id; s.join('lobby:' + r.code); push(r); };

    on('create_room', d => {
      if (room) return;
      const code = String(d.code || '').toUpperCase(), rom = romOf(d.rom);
      if (!CODE_RE.test(code)) return s.emit('room_error', { reason: 'bad_code' });
      if (!rom) return s.emit('room_error', { reason: 'bad_rom' });
      const old = rooms.get(code);
      if (old) {
        // o mesmo anfitrião a voltar (ex.: WebView recarregado) recupera o lugar
        if (tok && old.phase === 'lobby' && old.players[0] && old.players[0].token === tok) { old.players[0].rom = rom; old.players[0].ready = false; return seatIn(old, 0); }
        return s.emit('room_error', { reason: 'exists' });
      }
      const r = { code, phase: 'lobby', players: [], startToken: null, results: {}, reported: false, ttl: null };
      r.players.push({ seat: 0, sid: null, token: tok, name: 'Jogador 1', rom, ready: false, pid: hex(8), emu: null });
      rooms.set(code, r); arm(r, LOBBY_TTL_MS);
      console.log('[console] sala criada', code, rom.name);
      seatIn(r, 0);
    });

    on('join_room', d => {
      if (room) return;
      const code = String(d.code || '').toUpperCase(), rom = romOf(d.rom), r = rooms.get(code);
      if (!rom) return s.emit('room_error', { reason: 'bad_rom' });
      if (!r) return s.emit('room_error', { reason: 'not_found' });
      const back = tok ? r.players.findIndex(p => p.token === tok) : -1;
      if (back >= 0 && r.phase === 'lobby') { r.players[back].rom = rom; r.players[back].ready = false; return seatIn(r, back); }
      if (r.phase !== 'lobby') return s.emit('room_error', { reason: 'started' });
      if (r.players.length >= 2) return s.emit('room_error', { reason: 'full' });
      r.players.push({ seat: 1, sid: null, token: tok, name: 'Jogador 2', rom, ready: false, pid: hex(8), emu: null });
      seatIn(r, 1);
    });

    on('ready', d => {
      if (!room || room.phase !== 'lobby' || !me) return;
      me.ready = !!d.ready; push(room);
    });

    on('start', () => {
      const r = room;
      if (!r || r.phase !== 'lobby' || !me) return;
      if (me.seat !== 0) return s.emit('start_error', { reason: 'not_host' });
      if (r.players.length < 2 || r.players.some(p => !p.sid)) return s.emit('start_error', { reason: 'need_2' });
      if (r.players.some(p => !p.ready)) return s.emit('start_error', { reason: 'not_ready' });
      if (!same(r)) return s.emit('start_error', { reason: 'rom_mismatch' });
      r.phase = 'playing'; r.startToken = hex(16); arm(r, PLAY_TTL_MS);
      r.players.forEach((p, i) => nsp.to(p.sid).emit('console_start', {
        code: r.code, role: i === 0 ? 'host' : 'guest', pid: p.pid, peerPid: r.players[1 - i].pid,
        startToken: r.startToken, server, ns: '/console', protocol: 1, game: { name: p.rom.name, gid: p.rom.gid, fp: p.rom.fp },
      }));
      console.log('[console] partida iniciada', r.code);
      push(r);
    });

    const leaveLobby = () => {
      const r = room; if (!r || !me) return;
      s.leave('lobby:' + r.code);
      if (r.phase === 'lobby') {
        if (me.seat === 0) kill(r, 'host_left');
        else { r.players.splice(1, 1); push(r); }
      } else { me.sid = null; }
      room = null; me = null;
    };
    on('leave', leaveLobby);

    // ───────── EMULADOR (Fase 20.2) ─────────
    on('emu_join', async d => {
      const r = rooms.get(String(d.code || '').toUpperCase());
      if (!r || r.phase !== 'playing' || !r.startToken) return s.emit('emu_error', { reason: 'no_match' });
      if (String(d.startToken || '') !== r.startToken) return s.emit('emu_error', { reason: 'bad_token' });
      const i = r.players.findIndex(p => p.pid === String(d.pid || ''));
      if (i < 0) return s.emit('emu_error', { reason: 'bad_peer' });
      const p = r.players[i], other = r.players[1 - i];
      if (p.emu && p.emu !== s.id) nsp.to(p.emu).emit('emu_error', { reason: 'replaced' });
      p.emu = s.id; emu = { r, p, other };
      let ice = STUN; try { const v = await iceServers(); if (Array.isArray(v) && v.length) ice = v; } catch (e) { }
      s.emit('emu_ready', { role: i === 0 ? 'host' : 'guest', peerPid: other.pid, iceServers: ice, peerOnline: !!other.emu });
      if (other.emu) nsp.to(other.emu).emit('emu_peer', { online: true });
    });

    on('emu_signal', d => {
      if (!emu || !emu.other.emu) return;
      const out = { from: emu.p.pid }, c = d.candidate;
      if (d.sdp && typeof d.sdp === 'object' && (d.sdp.type === 'offer' || d.sdp.type === 'answer') && typeof d.sdp.sdp === 'string' && d.sdp.sdp.length < 20000) out.sdp = { type: d.sdp.type, sdp: d.sdp.sdp };
      else if (c && typeof c === 'object' && typeof c.candidate === 'string' && c.candidate.length < 2000) out.candidate = { candidate: c.candidate, sdpMid: c.sdpMid == null ? null : String(c.sdpMid).slice(0, 64), sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null };
      else return;
      nsp.to(emu.other.emu).emit('emu_signal', out);
    });

    on('emu_result', d => {
      if (!emu) return;
      const r = emu.r, w = d.winnerRole;
      if (r.reported || !['host', 'guest', 'draw'].includes(w)) return;
      r.results[emu.p.pid] = w;
      const vals = r.players.map(p => r.results[p.pid]);
      if (vals.some(v => !v)) return;            // espera pelos 2
      if (vals[0] !== vals[1]) { console.warn('[console] resultados diferentes', r.code, vals); return; }
      r.reported = true;
      nsp.to('lobby:' + r.code).emit('console_over', { winnerRole: w });
      if (typeof opts.onFinish === 'function') {
        Promise.resolve(opts.onFinish({ code: r.code, winnerSeat: w === 'host' ? 0 : w === 'guest' ? 1 : -1, players: 2, seats: r.players.map(p => p.token || '') }))
          .catch(e => console.error('[console] GA16 onFinish:', e && e.message));
      }
      arm(r, 60 * 1000);
    });

    on('disconnect', () => {
      if (emu) {
        if (emu.p.emu === s.id) { emu.p.emu = null; if (emu.other.emu) nsp.to(emu.other.emu).emit('emu_peer', { online: false }); }
        emu = null;
      }
      leaveLobby();
    });
  });

  return { nsp, rooms };
}

module.exports = setupConsole;
