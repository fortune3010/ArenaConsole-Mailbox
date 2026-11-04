'use strict';
/**
 * GA18_HISTORY — histórico + XP de TODAS as partidas (torneio, sala livre, treino).
 *
 *   recordRoomResult(supabase, { game, code, winnerSeat, players, seats, draw })
 *     Chamado pelo SERVIDOR do jogo (hook onFinish de cada namespace, via ga16MatchReport.hook).
 *     lugar → start_token (seats[i]) → room_players.user_id   (fallback 1x1: lugar 0 = host, 1 = guest)
 *     grava 1 linha por jogador em user_game_history + dá XP.
 *     mode = 'tournament' se rooms.config.ga15_tournament_id existir, senão 'multiplayer'.
 *
 *   awardXp(supabase, userId, kind)   kind: 'win' | 'loss' | 'draw' | 'training'
 *     users.xp += XP[kind];  users.level = 1 + floor(xp / 100)
 *
 *   roomAlreadyRecorded(supabase, code)
 *     Deduplicação: a mesma sala só é gravada uma vez em DEDUPE_MS (servidor OU cliente,
 *     o que chegar primeiro). Usado também por POST /api/history/record.
 */

const XP = { win: 100, loss: 25, draw: 50, training: 15 };
const XP_PER_LEVEL = 100; // GA18_XP_TO_NEXT: users.xp_to_next = 100 (era 1000 por omissão no Android)
const DEDUPE_MS = 15 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{3,16}$/;
const inFlight = new Set(); // code → evita corrida entre 2 chamadas no mesmo processo

function levelFor(xp) { return 1 + Math.floor(Math.max(0, xp) / XP_PER_LEVEL); }

function cfgOf(room) {
  let c = room && room.config;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === 'object' ? c : {};
}

/** Soma XP e recalcula o nível. Ler-modificar-escrever: suficiente para 1 fim de partida por jogador de cada vez. */
async function awardXp(supabase, userId, kind) {
  const add = XP[kind];
  if (!userId || !add) return null;
  const { data: u, error } = await supabase.from('users').select('id, xp').eq('id', userId).maybeSingle();
  if (error || !u) { if (error) console.warn('[GA18] xp read', userId, error.message); return null; }
  const xp = (Number(u.xp) || 0) + add;
  const level = levelFor(xp);
  const { error: upErr } = await supabase.from('users').update({ xp, level }).eq('id', userId);
  if (upErr) { console.warn('[GA18] xp update', userId, upErr.message); return null; }
  // GA18_XP_TO_NEXT: cada nível = XP_PER_LEVEL. Update separado: se a coluna não existir, o XP já ficou gravado.
  const { error: nxErr } = await supabase.from('users').update({ xp_to_next: XP_PER_LEVEL }).eq('id', userId);
  if (nxErr) console.warn('[GA18] xp_to_next', userId, nxErr.message);
  return { userId, xp, level, xpToNext: XP_PER_LEVEL, added: add };
}

async function roomAlreadyRecorded(supabase, code) {
  const since = new Date(Date.now() - DEDUPE_MS).toISOString();
  const { data, error } = await supabase.from('user_game_history').select('id')
    .eq('room_code', code).gte('played_at', since).limit(1);
  if (error) throw new Error(error.message);
  return !!(data && data.length);
}

async function recordRoomResult(supabase, info) {
  const tag = '[GA18] ' + ((info && info.game) || 'game') + ' ' + ((info && info.code) || '?');
  if (!info) return { skipped: 'no_info' };
  const code = String(info.code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { skipped: 'bad_code' };
  const n = Number(info.players);
  if (!Number.isInteger(n) || n < 2 || n > 16) return { skipped: 'bad_players' };
  const seat = Number(info.winnerSeat);
  const draw = !!info.draw || (Number.isInteger(seat) && seat < 0);
  if (!draw && (!Number.isInteger(seat) || seat >= n)) return { skipped: 'no_winner' };
  if (inFlight.has(code)) return { skipped: 'in_flight' };
  inFlight.add(code);
  try {
    if (await roomAlreadyRecorded(supabase, code)) return { skipped: 'already_recorded' };

    const { data: room, error: rErr } = await supabase.from('rooms').select('id, game_id, config').eq('code', code).maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!room) return { skipped: 'room_not_found' };
    const { data: rp, error: pErr } = await supabase.from('room_players').select('user_id, role, start_token').eq('room_id', room.id);
    if (pErr) throw new Error(pErr.message);
    const players = (rp || []).filter(p => p && p.user_id);

    // lugar → user_id
    const seats = Array.isArray(info.seats) ? info.seats : [];
    const bySeat = [];
    for (let i = 0; i < n; i++) {
      const tok = seats[i] ? String(seats[i]) : '';
      let p = tok ? players.filter(x => x.start_token && String(x.start_token) === tok) : [];
      p = p.length === 1 ? p[0] : null;
      if (!p && n === 2) p = players.find(x => String(x.role || '').toLowerCase() === (i === 0 ? 'host' : 'guest')) || null;
      bySeat.push(p ? String(p.user_id) : '');
    }
    if (bySeat.some(id => !id) || new Set(bySeat).size !== n) {
      console.warn(tag + ': não foi possível mapear todos os lugares (' + bySeat.filter(Boolean).length + '/' + n + ')');
      return { skipped: 'unmapped_seats' };
    }

    const cfg = cfgOf(room);
    const mode = cfg.ga15_tournament_id ? 'tournament' : 'multiplayer';
    const winnerId = draw ? null : bySeat[seat];
    const rows = bySeat.map((uid, i) => {
      const result = draw ? 'draw' : (uid === winnerId ? 'win' : 'loss');
      // 1x1: o outro; 3+: quem perdeu vê o vencedor, o vencedor vê o 1.º derrotado
      const opp = n === 2 ? bySeat[1 - i] : (uid === winnerId ? bySeat.find(x => x !== uid) : (winnerId || bySeat.find(x => x !== uid)));
      return { user_id: uid, game_id: room.game_id, result, mode, opponents: n - 1, room_code: code, opponent_id: opp || null };
    });
    const { error: insErr } = await supabase.from('user_game_history').insert(rows);
    if (insErr) throw new Error(insErr.message);

    const xp = [];
    for (const r of rows) xp.push(await awardXp(supabase, r.user_id, r.result));
    console.log(tag + ': histórico ' + rows.length + ' linhas (' + mode + '), vencedor=' + (winnerId || 'empate'));
    return { ok: true, saved: rows.length, mode, winnerId, xp };
  } catch (e) {
    console.error(tag + ': falhou:', e && (e.message || e));
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    inFlight.delete(code);
  }
}

module.exports = { recordRoomResult, awardXp, roomAlreadyRecorded, levelFor, XP, XP_PER_LEVEL, DEDUPE_MS };
