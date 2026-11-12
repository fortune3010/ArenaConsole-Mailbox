'use strict';
/**
 * 8-Ball (namespace /pool) — GA8_V5: a mesa (cenário) escolhida pelo anfitrião chega ao convidado.
 *
 * Cliente → servidor
 *   change_scene  { code, scene, token }  só o anfitrião (lugar 0); aceite antes e durante a partida.
 *                                         Responde por ack: { ok: true, scene } ou { ok: false, error }.
 *   scene_request { code }                qualquer jogador/espectador pede a mesa atual.
 * Servidor → clientes
 *   scene_changed { code, scene, by }     para o resto da sala (convidado e espectadores) e para quem pediu.
 *
 * Guarda room.scene, por isso tudo o que já lê room.scene (match_start, room_update, espectadores)
 * passa a usar a mesa do anfitrião.
 *
 * Integração (uma linha em backend/services/pool-namespace.js, dentro do nsp.on('connection', socket => { ... })):
 *   require('./pool-scene-sync').attach({ nsp, socket, rooms });
 * O script ga-8ball-v5-servidor.js faz esta inserção automaticamente.
 */

const SCENES = 12; // SC.length no 8ball/index.html

function validScene(v, max = SCENES) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n < max ? n : null;
}

function roomList(rooms) {
  if (!rooms) return [];
  if (typeof rooms.values === 'function') return Array.from(rooms.values());
  return Object.values(rooms);
}

function getRoom(rooms, code) {
  if (!rooms || !code) return null;
  const key = String(code).trim().toUpperCase();
  if (typeof rooms.get === 'function') return rooms.get(key) || rooms.get(String(code)) || null;
  return rooms[key] || rooms[String(code)] || null;
}

function seatsOf(room) {
  return Array.isArray(room && room.seats) ? room.seats : [];
}

// Sala do pedido: pelo código, desde que este socket esteja sentado nela; senão, a sala onde o socket está sentado.
function findRoom(rooms, socket, code) {
  const byCode = getRoom(rooms, code);
  if (byCode && seatsOf(byCode).some(s => s && s.sid === socket.id)) return byCode;
  for (const r of roomList(rooms)) if (seatsOf(r).some(s => s && s.sid === socket.id)) return r;
  return null;
}

function isHost(room, socket, token) {
  const s0 = seatsOf(room)[0];
  if (!s0) return false;
  const tk = String(token || '');
  return s0.sid === socket.id || (!!s0.token && !!tk && s0.token === tk);
}

// Envia para a sala Socket.IO (exceto o remetente) e, por segurança, diretamente a cada lugar que não esteja nela.
function relay(nsp, socket, room, payload) {
  const code = room.code;
  const members = nsp.adapter && nsp.adapter.rooms && code ? nsp.adapter.rooms.get(code) : null;
  if (code) socket.to(code).emit('scene_changed', payload);
  for (const s of seatsOf(room)) {
    if (!s || !s.sid || s.sid === socket.id) continue;
    if (members && members.has(s.sid)) continue;
    nsp.to(s.sid).emit('scene_changed', payload);
  }
}

function attach({ nsp, socket, rooms, scenes = SCENES, log = console.log } = {}) {
  if (!nsp || !socket || !rooms) throw new Error('pool-scene-sync: attach({ nsp, socket, rooms }) incompleto');
  let win = 0, count = 0; // limite suave: no máximo 30 mudanças por 10 s por socket

  socket.on('change_scene', (p, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const now = Date.now();
      if (now - win > 10000) { win = now; count = 0; }
      if (++count > 30) return reply({ ok: false, error: 'rate' });
      const v = validScene(p && (p.scene != null ? p.scene : p.scenario), scenes);
      if (v === null) return reply({ ok: false, error: 'scene' });
      const room = findRoom(rooms, socket, p && p.code);
      if (!room) return reply({ ok: false, error: 'room' });
      if (!isHost(room, socket, p && p.token)) {
        log('[pool] GA8_V5 change_scene recusado (não é o anfitrião)', room.code);
        return reply({ ok: false, error: 'host' });
      }
      const changed = room.scene !== v;
      room.scene = v;
      // repete sempre a mesa ao resto da sala: o anfitrião reenvia-a no room_update e no match_start
      // para cobrir um convidado que tenha acabado de entrar ou reconectado
      relay(nsp, socket, room, { code: room.code, scene: v, by: 0 });
      if (changed) log('[pool] GA8_V5 change_scene', room.code, v, p && p.src ? '(' + p.src + ')' : '');
      reply({ ok: true, scene: v });
    } catch (e) {
      log('[pool] GA8_V5 change_scene erro', e && e.message);
      reply({ ok: false, error: 'server' });
    }
  });

  socket.on('scene_request', (p, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const room = findRoom(rooms, socket, p && p.code) || getRoom(rooms, p && p.code);
      const v = room ? validScene(room.scene, scenes) : null;
      if (v === null) return reply({ ok: false });
      socket.emit('scene_changed', { code: room.code, scene: v, by: 'server' });
      reply({ ok: true, scene: v });
    } catch (e) {
      reply({ ok: false, error: 'server' });
    }
  });
}

module.exports = { attach, validScene };
