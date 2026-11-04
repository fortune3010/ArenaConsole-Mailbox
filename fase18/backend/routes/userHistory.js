/**
 * Rotas de histórico de partidas.
 *
 *   POST /api/history/register  → registar uma jogada
 *   GET  /api/history/recent    → últimas jogadas do utilizador
 *   GET  /api/history/me        → histórico do utilizador (cards)
 *   POST /api/history/record    → registar resultado (+ XP — GA18_HISTORY)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const ga18 = require('../services/ga16History'); // GA18_HISTORY: XP + deduplicação por sala

const JWT_SECRET = process.env.JWT_SECRET || 'gamearena-secret-change-me-2026';

module.exports = function () {
  const router = express.Router();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');

    if (!token) return res.status(401).json({ error: 'Token obrigatório' });

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Token inválido' });
    }
  }

  // Registar partida
  router.post('/register', requireAuth, async (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId obrigatório' });

    const { error } = await supabase
      .from('user_game_history')
      .insert({ user_id: req.user.userId, game_id: gameId });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Jogos recentes (últimos 10 únicos)
  router.get('/recent', requireAuth, async (req, res) => {
    const { data, error } = await supabase
      .from('user_game_history')
      .select('game_id, played_at')
      .eq('user_id', req.user.userId)
      .order('played_at', { ascending: false })
      .limit(30);

    if (error) return res.status(500).json({ error: error.message });

    // Deduplica por game_id, mantendo mais recente
    const seen = new Set();
    const unique = [];
    (data || []).forEach(row => {
      if (!seen.has(row.game_id)) {
        seen.add(row.game_id);
        unique.push(row);
      }
    });

    res.json({ recent: unique.slice(0, 10) });
  });

  // ============================================================
  // GET /api/history/me — histórico do user autenticado
  // ============================================================
  router.get('/me', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);

      const { data: rows, error } = await supabase
        .from('user_game_history')
        .select('id, game_id, result, mode, opponents, room_code, opponent_id, played_at')
        .eq('user_id', req.user.userId)
        .order('played_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Buscar info dos jogos referenciados
      const gameIds = Array.from(new Set((rows || []).map(r => r.game_id).filter(Boolean)));
      const gameMap = {};
      if (gameIds.length) {
        const { data: games } = await supabase
          .from('games')
          .select('id, displayName, coverUrl')
          .in('id', gameIds);
        (games || []).forEach(g => { gameMap[g.id] = g; });
      }

      // GA16_HISTORY: enriquece com nomes e avatares
      const oppIds = Array.from(new Set((rows || []).map(r => r.opponent_id).filter(Boolean)));
      const oppMap = {};
      if (oppIds.length) {
        const { data: opps } = await supabase.from('users').select('id, username, avatar_url').in('id', oppIds);
        (opps || []).forEach(o => { oppMap[o.id] = o; });
      }
      const myId = req.user.userId;
      const { data: myUser } = await supabase.from('users').select('id, username, avatar_url').eq('id', myId).maybeSingle();

      const history = (rows || []).map(r => ({
        id: r.id,
        gameId: r.game_id,
        gameName: (gameMap[r.game_id] && gameMap[r.game_id].displayName) || r.game_id,
        gameCover: (gameMap[r.game_id] && gameMap[r.game_id].coverUrl) || null,
        result: r.result,
        mode: r.mode,
        opponents: r.opponents || 0,
        roomCode: r.room_code,
        opponentId: r.opponent_id,
        opponentName: (oppMap[r.opponent_id] && oppMap[r.opponent_id].username) || null,
        opponentAvatar: (oppMap[r.opponent_id] && oppMap[r.opponent_id].avatar_url) || null,
        myName: (myUser && myUser.username) || null,
        myAvatar: (myUser && myUser.avatar_url) || null,
        playedAt: r.played_at
      }));

      res.json({ history, total: history.length });
    } catch (e) {
      console.error('[HISTORY/ME] erro:', e.message || e);
      res.status(500).json({ error: 'Erro ao carregar histórico', detail: e.message });
    }
  });

  // ============================================================
  // POST /api/history/record — registar resultado de partida
  //
  // Body:
  //   {
  //     gameId: "ludo_html5",         // obrigatório
  //     result: "win"|"loss"|"draw",  // opcional (default null)
  //     mode:   "multiplayer"|"singleplayer"|"tournament",
  //     opponents: 1,
  //     roomCode: "ABCD",             // opcional — se vier, grava para ambos
  //     winnerRole: "host"|"guest"    // usado com roomCode
  //   }
  //
  // GA18_HISTORY:
  //   - XP: vitória 100, derrota 25, empate 50, treino (singleplayer) 15. level = 1 + floor(xp/100).
  //   - Com roomCode: se a sala já foi gravada nos últimos 15 min (pelo servidor do jogo ou por
  //     outro cliente) responde { saved: 0, duplicate: true } e não dá XP outra vez.
  //   - Sala de torneio (rooms.config.ga15_tournament_id) grava mode = 'tournament'.
  // ============================================================
  router.post('/record', requireAuth, async (req, res) => {
    try {
      const {
        gameId,
        result = null,
        mode = null,
        opponents = 0,
        roomCode = null,
        winnerRole = null
      } = req.body || {};

      if (!gameId) {
        return res.status(400).json({ error: 'gameId obrigatório' });
      }

      // Caso 1: sem roomCode — grava só para o user autenticado
      if (!roomCode) {
        const { error } = await supabase
          .from('user_game_history')
          .insert({
            user_id: req.user.userId,
            game_id: gameId,
            result,
            mode,
            opponents,
            room_code: null,
            opponent_id: null
          });
        if (error) throw error;
        const kind = mode === 'singleplayer' ? 'training' : result; // GA18_HISTORY
        const xp = await ga18.awardXp(supabase, req.user.userId, kind).catch(() => null);
        return res.json({ success: true, saved: 1, xp });
      }

      // Caso 2: com roomCode — grava para ambos (host + guest)
      const code = String(roomCode).toUpperCase().trim();

      // GA18_HISTORY: a sala já foi gravada (servidor do jogo ou outro cliente)?
      if (await ga18.roomAlreadyRecorded(supabase, code)) {
        return res.json({ success: true, saved: 0, duplicate: true });
      }

      const { data: room, error: roomErr } = await supabase
        .from('rooms')
        .select('id, game_id, creator_id, config')
        .eq('code', code)
        .maybeSingle();

      if (roomErr) throw roomErr;
      if (!room) return res.status(404).json({ error: 'Sala não encontrada' });

      let cfg = room.config;
      if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (e) { cfg = null; } }
      const roomMode = cfg && cfg.ga15_tournament_id ? 'tournament' : 'multiplayer';

      const { data: players, error: pErr } = await supabase
        .from('room_players')
        .select('user_id, role')
        .eq('room_id', room.id);

      if (pErr) throw pErr;
      if (!players || players.length < 2) {
        return res.status(400).json({ error: 'Sala sem 2 jogadores' });
      }

      const host = players.find(p => p.role === 'host');
      const guest = players.find(p => p.role === 'guest');

      if (!host || !guest) {
        return res.status(400).json({ error: 'Sala inválida (sem host ou guest)' });
      }

      // Determina vencedor/perdedor pelo winnerRole
      let winnerId = null;
      let loserId = null;
      if (winnerRole === 'host') { winnerId = host.user_id; loserId = guest.user_id; }
      else if (winnerRole === 'guest') { winnerId = guest.user_id; loserId = host.user_id; }
      else if (winnerRole === 'draw') { winnerId = null; loserId = null; }

      const inserts = [];

      if (winnerRole === 'draw') {
        inserts.push({
          user_id: host.user_id, game_id: room.game_id,
          result: 'draw', mode: roomMode, opponents: 1,
          room_code: code, opponent_id: guest.user_id
        });
        inserts.push({
          user_id: guest.user_id, game_id: room.game_id,
          result: 'draw', mode: roomMode, opponents: 1,
          room_code: code, opponent_id: host.user_id
        });
      } else if (winnerId && loserId) {
        inserts.push({
          user_id: winnerId, game_id: room.game_id,
          result: 'win', mode: roomMode, opponents: 1,
          room_code: code, opponent_id: loserId
        });
        inserts.push({
          user_id: loserId, game_id: room.game_id,
          result: 'loss', mode: roomMode, opponents: 1,
          room_code: code, opponent_id: winnerId
        });
      } else {
        // Sem resultado definido — só regista "jogado" para ambos
        inserts.push({
          user_id: host.user_id, game_id: room.game_id,
          result: null, mode: roomMode, opponents: 1,
          room_code: code, opponent_id: guest.user_id
        });
        inserts.push({
          user_id: guest.user_id, game_id: room.game_id,
          result: null, mode: roomMode, opponents: 1,
          room_code: code, opponent_id: host.user_id
        });
      }

      const { error: insErr } = await supabase
        .from('user_game_history')
        .insert(inserts);

      if (insErr) throw insErr;

      const xp = [];
      for (const r of inserts) if (r.result) xp.push(await ga18.awardXp(supabase, r.user_id, r.result).catch(() => null));

      res.json({ success: true, saved: inserts.length, xp });
    } catch (e) {
      console.error('[HISTORY/RECORD] erro:', e.message || e);
      res.status(500).json({ error: 'Erro ao registar resultado', detail: e.message });
    }
  });

  return router;
};
