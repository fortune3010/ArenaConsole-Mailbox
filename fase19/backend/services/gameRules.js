'use strict';
// GA_FASE15V3_RULES — regras por jogo para o modo torneio (partilhadas pelo backend).
// playersPerMatch = default; min/max = o que o jogo aceita numa partida.
// GA19_RULES: neonrush passa a 8 por partida (o namespace já aceitava até 8).
//   flappy mantém 4 em torneio (12 só em sala livre — decidido no HTML).
//   O SQL aceita capacity até 16 (t15_matches_capacity_check). Espelho: CreateTournamentActivity.GAME_RULES.

const GAME_RULES = {
  'dama':      { playersPerMatch: 2, mode: 'elimination', min: 2, max: 2 },
  'airhockey': { playersPerMatch: 2, mode: 'elimination', min: 2, max: 2 },
  'ludo':      { playersPerMatch: 4, mode: 'points',      min: 2, max: 4 },
  'pool':      { playersPerMatch: 2, mode: 'elimination', min: 2, max: 2 },
  'fruit':     { playersPerMatch: 2, mode: 'score',       min: 2, max: 4 },
  'flappy':    { playersPerMatch: 2, mode: 'score',       min: 2, max: 4 },
  'galinhas':  { playersPerMatch: 2, mode: 'score',       min: 2, max: 4 },
  'bubble':    { playersPerMatch: 4, mode: 'elimination', min: 2, max: 4 },
  'impostor':  { playersPerMatch: 8, mode: 'elimination', min: 4, max: 10 },
  'neonrush':  { playersPerMatch: 2, mode: 'score',       min: 2, max: 8 },
  'hockey':    { playersPerMatch: 2, mode: 'elimination', min: 2, max: 2 }
};

const DEFAULT_RULES = { playersPerMatch: 2, mode: 'elimination', min: 2, max: 16 };

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Procura as regras por id/slug/nome ("fruit-arena", "Air Hockey", "dama_v2"...). null se o jogo não é conhecido. */
function findRules(candidates) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).map(norm).filter(Boolean);
  for (const c of list) if (GAME_RULES[c]) return Object.assign({ key: c }, GAME_RULES[c]);
  // chaves mais longas primeiro: "airhockey" antes de "hockey"
  const keys = Object.keys(GAME_RULES).sort((a, b) => b.length - a.length);
  for (const c of list) {
    const k = keys.find(key => c.includes(key));
    if (k) return Object.assign({ key: k }, GAME_RULES[k]);
  }
  return null;
}

function rulesFor(gameId) {
  return findRules(gameId) || Object.assign({ key: null }, DEFAULT_RULES);
}

module.exports = { GAME_RULES, DEFAULT_RULES, rulesFor, findRules };
