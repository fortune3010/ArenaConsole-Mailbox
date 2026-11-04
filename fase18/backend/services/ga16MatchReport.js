'use strict';
/**
 * GA16_FRUIT — ga16MatchReport: o SERVIDOR do jogo reporta o vencedor à chave T15.
 *   recordWinner({ game, code, winnerSeat, players, seats })
 *     rooms(code).config.ga15_tournament_id / ga15_match_id  (criados pelo ga15SyncFix no all-ready)
 *     lugar vencedor → start_token (seats[i]) → room_players.user_id   (fallback: lugar 0 = host)
 *     t15_submit_claim por cada jogador (vencedor por último) → consenso → afterReport
 *   GET /api/ga16/rooms/:code/link → { ok, tournamentId, matchId }  (JWT; só jogadores da sala)
 * Nunca confia no cliente. Sem config ga15 (sala livre) → não faz nada na chave.
 *
 * GA18_HISTORY: o hook() grava também histórico + XP de TODAS as salas (torneio ou livre)
 *   via services/ga16History.recordRoomResult — independente do T15 (roomLink fica igual).
 * GA18_MAXPLAYERS: o limite de jogadores por partida vem de services/gameRules (max do jogo),
 *   já não é 4 fixo (Impostor 4–10). O SQL aceita capacity até 16.
 */
const jwt = require('jsonwebtoken');
const gameRules = require('./gameRules'); // GA18_MAXPLAYERS

const PREFIX = '/api/ga16/rooms/';
const CODE_RE = /^[A-Za-z0-9_-]{3,16}$/;
const DONE_TTL_MS = 30 * 60 * 1000;
const SQL_MAX_CAPACITY = 16;    // t15_matches_capacity_check: capacity <= 16
let T15 = null;                 // { getTournament, submitClaim } registado pelo tournaments_t15.js
const done = new Map();         // code|matchId -> ts (evita reportar 2x)
const bubbleWinners = new Map(); // winner conhecido, para detetar divergência em chamadas repetidas

function registerT15(api) { T15 = api; }

function cfgOf(room) {
  let c = room && room.config;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === 'object' ? c : {};
}

/** GA18_MAXPLAYERS: máximo de jogadores por partida para o jogo (gameRules), limitado ao SQL. */
function maxPlayersFor(game) {
  const r = gameRules.findRules(game);
  const max = r && Number.isInteger(r.max) ? r.max : 4;
  return Math.max(2, Math.min(SQL_MAX_CAPACITY, max));
}

async function roomLink(supabase, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) return null;
  const { data: room, error } = await supabase.from('rooms').select('id, code, config').eq('code', c).maybeSingle();
  if (error) throw new Error(error.message);
  if (!room) return null;
  const cfg = cfgOf(room);
  const tournamentId = cfg.ga15_tournament_id ? String(cfg.ga15_tournament_id) : '';
  const matchId = cfg.ga15_match_id ? String(cfg.ga15_match_id) : '';
  if (!tournamentId) return null;
  const { data: players, error: pErr } = await supabase.from('room_players').select('user_id, role, start_token').eq('room_id', room.id);
  if (pErr) throw new Error(pErr.message);
  return { roomId: room.id, code: c, tournamentId, matchId, players: players || [] };
}

function pruneDone(now) { for (const [k, ts] of done) if (now - ts > DONE_TTL_MS) done.delete(k); }

// Bubble e Flappy usam uma só transação para validar participantes e registar o resultado.
async function recordBubble(supabase, info) {
  const tag = '[GA16] [' + info.game + '] ' + String(info.code || '?');
  const n = Number(info.players), seat = Number(info.winnerSeat);
  const maxPlayers = maxPlayersFor(info.game); // GA18_MAXPLAYERS (antes: 4 fixo)
  const minSeat = info.game === 'flappy' ? 0 : -1;
  if (!Number.isInteger(n) || n < 2 || n > maxPlayers) return { skipped: 'not_2_to_4', max: maxPlayers }; // nome antigo mantido (testes/logs)
  if (info.winnerSeat === null || info.winnerSeat === undefined || !Number.isInteger(seat) || seat < minSeat || seat >= n) return { skipped: 'no_winner' };
  const link = await roomLink(supabase, info.code);
  if (!link) return { skipped: 'not_tournament' };
  if (!link.matchId) return { skipped: 'no_match' };
  const now = Date.now(); pruneDone(now);
  const key = link.code + '|' + link.matchId;
  for (const cached of bubbleWinners.keys()) if (!done.has(cached)) bubbleWinners.delete(cached);
  if (done.has(key)) {
    if (seat >= 0 && bubbleWinners.has(key)) {
      const token = Array.isArray(info.seats) ? String(info.seats[seat] || '') : '';
      let p = token && link.players.find(x => x && x.start_token && String(x.start_token) === token);
      if (!p && n === 2) p = link.players.find(x => x && String(x.role || '').toLowerCase() === (seat === 0 ? 'host' : 'guest'));
      if (p && p.user_id && bubbleWinners.get(key) !== String(p.user_id)) console.error(tag + ': MISMATCH: match já DONE com winner ' + bubbleWinners.get(key) + ', esperava ' + p.user_id);
    }
    return { skipped: 'already_reported' };
  }
  if (!T15 || typeof T15.getTournament !== 'function') return { skipped: 'no_t15' };
  if (seat === -1) {
    if (typeof T15.markDisputed !== 'function') return { skipped: 'no_t15' };
    done.set(key, now);
    try {
      const t = await T15.getTournament(link.tournamentId);
      const result = await T15.markDisputed(t, link.matchId, 'draw');
      if (!result || !result.ok || !result.disputed) { done.delete(key); return { ok: false, result }; }
      return { ok: true, disputed: true, result };
    } catch (e) { done.delete(key); console.error(tag + ': draw:', e.message); return { ok: false, error: String(e.message || e) }; }
  }
  if (typeof T15.atomicClaims !== 'function') return { skipped: 'no_t15' };
  const tok = Array.isArray(info.seats) ? String(info.seats[seat] || '') : '';
  let winner = tok ? link.players.find(p => p && p.start_token && String(p.start_token) === tok) : null;
  if (!winner && n === 2) winner = link.players.find(p => p && String(p.role || '').toLowerCase() === (seat === 0 ? 'host' : 'guest'));
  if (!winner || !winner.user_id) return { skipped: 'no_winner_user' };
  const ids = link.players.map(p => p && p.user_id ? String(p.user_id) : '');
  if (ids.length !== n || ids.some(id => !id) || new Set(ids).size !== n) return { skipped: 'invalid_players' };
  // Com 3+ jogadores todos os tokens dos lugares têm de identificar jogadores distintos da sala.
  if (n > 2) {
    if (!Array.isArray(info.seats) || info.seats.length !== n) return { skipped: 'invalid_players' };
    const mapped = info.seats.map(token => {
      if (!token) return '';
      const matches = link.players.filter(p => p && p.start_token && String(p.start_token) === String(token));
      return matches.length === 1 && matches[0].user_id ? String(matches[0].user_id) : '';
    });
    if (mapped.some(id => !id) || new Set(mapped).size !== n || mapped.some(id => !ids.includes(id))) return { skipped: 'invalid_players' };
  }
  const winnerId = String(winner.user_id);
  // Leitura prévia apenas como diagnóstico: a verificação decisiva ocorre sob lock SQL.
  let match;
  try {
    const q = await supabase.from('t15_matches').select('status, winner_id, claims, player_ids').eq('id', link.matchId).eq('tournament_id', link.tournamentId).maybeSingle();
    if (q.error || !q.data) return { skipped: 'claims_read_failed' };
    match = q.data;
  } catch (e) { console.error(tag + ': leitura:', e.message); return { skipped: 'claims_read_failed' }; }
  if (match.status === 'DONE' || match.status === 'BYE') {
    if (String(match.winner_id || '') !== winnerId) console.error(tag + ': MISMATCH: match já DONE com winner ' + match.winner_id + ', esperava ' + winnerId);
    return { skipped: 'already_reported', mismatch: String(match.winner_id || '') !== winnerId };
  }
  if (match.status === 'DISPUTED') return { skipped: 'already_disputed' };
  if (match.claims && Object.keys(match.claims).length) return { skipped: 'claims_exist' };
  if (!Array.isArray(match.player_ids) || match.player_ids.length !== n ||
      new Set(match.player_ids.map(String)).size !== n || ids.some(id => !match.player_ids.map(String).includes(id))) return { skipped: 'invalid_players' };
  const claims = Object.fromEntries(ids.map(id => [id, winnerId]));
  done.set(key, now);
  try {
    const t = await T15.getTournament(link.tournamentId);
    const result = await T15.atomicClaims(t, link.matchId, winnerId, claims);
    if (!result || !result.ok) {
      done.delete(key);
      const reasons = { CLAIMS_EXIST: 'claims_exist', INVALID_PLAYERS: 'invalid_players', ALREADY_DISPUTED: 'already_disputed' };
      return { skipped: reasons[result && result.error] || 'atomic_failed', result };
    }
    if (!result.accepted) {
      done.delete(key);
      if (result.idempotent) { console.error(tag + ': MISMATCH: match já DONE com winner ' + result.winnerId + ', esperava ' + winnerId); return { skipped: 'already_reported', mismatch: true, result }; }
      return { ok: false, error: 'winner_conflict', result };
    }
    bubbleWinners.set(key, winnerId);
    return { ok: true, tournamentId: link.tournamentId, matchId: link.matchId, winnerId, result };
  } catch (e) { done.delete(key); console.error(tag + ': falhou T15:', e.message); return { ok: false, error: String(e.message || e) }; }
}

async function recordWinner(supabase, info) {
  if (info && (info.game === 'bubble' || info.game === 'flappy' || info.game === 'ludo' || info.game === 'impostor' || info.game === 'galinhas' || info.game === 'neonrush' || info.game === 'hockey')) return recordBubble(supabase, info);
  const tag = '[GA16] ' + ((info && info.game) || 'game') + ' ' + ((info && info.code) || '?');
  const seat = info ? Number(info.winnerSeat) : -1;
  if (!info || !Number.isInteger(seat) || seat < 0) return { skipped: 'no_winner' };
  if (Number(info.players) !== 2) return { skipped: 'not_1v1' };
  const link = await roomLink(supabase, info.code);
  if (!link) return { skipped: 'not_tournament' };
  if (!link.matchId) { console.warn(tag + ': sala de torneio sem ga15_match_id'); return { skipped: 'no_match' }; }
  const now = Date.now(); pruneDone(now);
  const key = link.code + '|' + link.matchId;
  if (done.has(key)) return { skipped: 'already_reported' };
  if (!T15 || typeof T15.submitClaim !== 'function') { console.warn(tag + ': helper T15 não registado'); return { skipped: 'no_t15' }; }
  const tok = Array.isArray(info.seats) ? String(info.seats[seat] || '') : '';
  let w = tok ? link.players.find(p => p && p.start_token && String(p.start_token) === tok) : null;
  if (!w) w = link.players.find(p => p && String(p.role || '').toLowerCase() === (seat === 0 ? 'host' : 'guest'));
  if (!w || !w.user_id) { console.warn(tag + ': vencedor (lugar ' + seat + ') sem user_id'); return { skipped: 'no_winner_user' }; }
  const winnerId = String(w.user_id);
  const ids = link.players.map(p => String(p.user_id)).filter(Boolean);
  const order = ids.filter(id => id !== winnerId).concat(winnerId);  // vencedor por último → consenso no fim
  done.set(key, now);
  let last = null;
  try {
    const t = await T15.getTournament(link.tournamentId);
    for (const uid of order) last = await T15.submitClaim(t, link.matchId, uid, winnerId);
    console.log(tag + ': T15 ' + link.matchId + ' vencedor=' + winnerId + ' → ' + JSON.stringify({ accepted: !!(last && last.accepted), idempotent: !!(last && last.idempotent), disputed: !!(last && last.disputed) }));
    return { ok: true, tournamentId: link.tournamentId, matchId: link.matchId, winnerId, result: last };
  } catch (e) {
    done.delete(key);              // deixa repetir (ex.: claim manual depois)
    console.error(tag + ': falhou T15 ' + link.matchId + ': ' + (e && (e.message || e)));
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// hook para os namespaces: attachX(io, { onFinish: hook(supabase, 'fruit') })
// GA18_HISTORY: chave T15 (só torneios) + histórico/XP (todas as salas), em paralelo e independentes.
function hook(supabase, game) {
  return (info) => {
    const full = Object.assign({ game }, info);
    const t15 = recordWinner(supabase, full).catch(e => console.error('[GA16] [' + game + '] hook:', e && e.message));
    let hist;
    try { hist = require('./ga16History').recordRoomResult(supabase, full).catch(e => console.error('[GA18] [' + game + '] histórico:', e && e.message)); }
    catch (e) { console.error('[GA18] ga16History indisponível:', e.message); hist = Promise.resolve(null); }
    return Promise.all([t15, hist]).then(r => r[0]);
  };
}

function send(res, status, obj) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function authUserId(req) {
  let h = String(req.headers['authorization'] || '').trim();
  while (/^bearer\s+/i.test(h)) h = h.replace(/^bearer\s+/i, '').trim();
  if (!h) return null;
  try {
    const u = jwt.verify(h, process.env.JWT_SECRET);
    const id = u && (u.userId || u.id || u.sub);
    return id ? String(id) : null;
  } catch (e) { return null; }
}

async function handle(supabase, req, res) {
  const m = String(req.url || '').split('?')[0].match(/^\/api\/ga16\/rooms\/([^/]+)\/link\/?$/);
  if (!m || req.method !== 'GET') return send(res, 404, { ok: false, error: 'not_found' });
  const uid = authUserId(req);
  if (!uid) return send(res, 401, { ok: false, error: 'unauthorized' });
  const link = await roomLink(supabase, decodeURIComponent(m[1]));
  if (!link) return send(res, 404, { ok: false, error: 'not_tournament_room' });
  if (!link.players.some(p => String(p.user_id) === uid)) return send(res, 403, { ok: false, error: 'not_in_room' });
  return send(res, 200, { ok: true, code: link.code, tournamentId: link.tournamentId, matchId: link.matchId || null });
}

function attach(httpServer, supabase) {
  if (!httpServer || typeof httpServer.listeners !== 'function') { console.warn('[GA16] httpServer inválido — /api/ga16 NÃO activo'); return; }
  if (httpServer.__ga16MatchReport) return;
  httpServer.__ga16MatchReport = true;
  const previous = httpServer.listeners('request').slice();
  httpServer.removeAllListeners('request');
  httpServer.on('request', (req, res) => {
    if (String(req.url || '').startsWith(PREFIX)) {
      handle(supabase, req, res).catch(e => { console.error('[GA16] erro:', e && (e.message || e)); send(res, 500, { ok: false, error: 'server_error' }); });
      return;
    }
    for (const l of previous) l.call(httpServer, req, res);
  });
  console.log('[GA16] activo: ' + PREFIX + ':code/link');
}

module.exports = { registerT15, recordWinner, hook, attach, roomLink, maxPlayersFor, PREFIX, _done: done };
