#!/usr/bin/env node
'use strict';
/**
 * GA17_VOICE — injeta <script src="/games/shared/voice.js?v=1"> nos 10 jogos HTML (antes do último </body>).
 * Idempotente: se o jogo já carrega voice.js, é ignorado.
 * Uso na raiz do repo:  node scripts/ga17-voice-inject.js
 */
const fs = require('fs');
const path = require('path');

function must(cond, msg) { if (!cond) { console.error('❌ ' + msg); process.exit(1); } }

const GAMES = ['dama', 'ludo', '8ball', 'fruit', 'bubble', 'flappy', 'impostor', 'neonrush', 'galinhas', 'airhockey'];
const TAG = '<!-- GA17_VOICE --><script src="/games/shared/voice.js?v=1"></script>';

// valida tudo primeiro: ou aplica nos 10, ou em nenhum
const plan = GAMES.map(g => {
  const f = path.join(process.cwd(), 'backend/public/games', g, 'index.html');
  must(fs.existsSync(f), 'não existe ' + f);
  const s = fs.readFileSync(f, 'utf8');
  if (s.includes('/games/shared/voice.js')) return { g, f, skip: true };
  const i = s.lastIndexOf('</body>');
  must(i >= 0, g + ': </body> não encontrado');
  return { g, f, s, i };
});

for (const p of plan) {
  if (p.skip) { console.log('= ' + p.g + ': já carrega voice.js'); continue; }
  fs.writeFileSync(p.f, p.s.slice(0, p.i) + TAG + '\n' + p.s.slice(p.i));
  console.log('✅ ' + p.g);
}
console.log('GA17_VOICE: injecção concluída.');
