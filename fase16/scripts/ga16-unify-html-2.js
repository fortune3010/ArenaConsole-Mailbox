#!/usr/bin/env node
'use strict';
/**
 * GA16_UNIFY_2 — restantes jogos (corre DEPOIS de scripts/ga16-unify-html.js).
 *   - 8ball:     ga16PoolPost deixa de reportar host/guest e de criar overlay próprio → window.ga16Post
 *                + carrega ga16-post.js?v=3 (não carregava)
 *   - airhockey, bubble: carregam ga16-post.js?v=3 (chamavam window.ga16Post mas o ficheiro não estava incluído)
 *   - impostor:  passa o resultado (o servidor manda o vencedor por socket id, não por lugar)
 *   - flappy, galinhas, impostor, ludo, neonrush: ga16-post.js → ga16-post.js?v=3 (cache)
 * Idempotente (marcador GA16_UNIFY_2).  Uso na raiz do repo:  node scripts/ga16-unify-html-2.js
 */
const fs = require('fs');
const path = require('path');

function must(cond, msg) { if (!cond) { console.error('❌ ' + msg); process.exit(1); } }
function once(src, needle, label) {
  const a = src.indexOf(needle);
  must(a >= 0, label + ': âncora não encontrada');
  must(src.indexOf(needle, a + 1) < 0, label + ': âncora aparece mais de uma vez');
  return a;
}
function replaceOnce(src, needle, repl, label) {
  const a = once(src, needle, label);
  return src.slice(0, a) + repl + src.slice(a + needle.length);
}
function replaceBlock(src, startNeedle, endNeedle, repl, label) {
  const a = once(src, startNeedle, label + ' (início)');
  const b = src.indexOf(endNeedle, a);
  must(b > a, label + ' (fim): âncora não encontrada depois do início');
  return src.slice(0, a) + repl + src.slice(b + endNeedle.length);
}
function beforeLastBody(src, tag, label) {
  const i = src.lastIndexOf('</body>');
  must(i >= 0, label + ': </body> não encontrado');
  return src.slice(0, i) + tag + '\n' + src.slice(i);
}

const ROOT = process.cwd();
const OLD_TAG = '<script src="/games/shared/ga16-post.js"></script>';
const NEW_TAG = '<script src="/games/shared/ga16-post.js?v=3"></script>';
const MARK = '<!-- GA16_UNIFY_2 -->';

function edit(game, fn) {
  const f = path.join(ROOT, 'backend/public/games', game, 'index.html');
  must(fs.existsSync(f), 'não existe ' + f);
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes('GA16_UNIFY_2')) { console.log('= ' + game + ': já aplicado'); return; }
  s = fn(s);
  must(s.includes('ga16-post.js?v=3'), game + ': ga16-post.js?v=3 em falta no resultado');
  fs.writeFileSync(f, s);
  console.log('✅ ' + game);
}

// cache: os 5 que já carregam o ficheiro
for (const g of ['flappy', 'galinhas', 'ludo', 'neonrush']) {
  edit(g, s => replaceOnce(s, OLD_TAG, MARK + NEW_TAG, g + ' <script ga16-post>'));
}

edit('impostor', s => {
  s = replaceOnce(s, OLD_TAG, MARK + NEW_TAG, 'impostor <script ga16-post>');
  return replaceOnce(s,
    'try{window.ga16Post&&window.ga16Post(o)}catch(_){}',
    "try{window.ga16Post&&window.ga16Post(o,{outcome:e.victory?'win':'loss',game:'impostor'})}catch(_){}",
    'impostor game_over');
});

// airhockey e bubble chamam window.ga16Post mas não incluíam o ficheiro
for (const g of ['airhockey', 'bubble']) {
  edit(g, s => {
    must(!s.includes('ga16-post.js'), g + ': já carrega ga16-post.js (verificar à mão)');
    return beforeLastBody(s, MARK + NEW_TAG, g);
  });
}

edit('8ball', s => {
  must(!s.includes('ga16-post.js'), '8ball: já carrega ga16-post.js (verificar à mão)');
  s = replaceBlock(s,
    'function ga16PoolPost(o){if(window.__ga16Done||!o)return;window.__ga16Done=1;',
    'JSON.stringify({winner:nm}))}catch(e){}},5000)}',
    "function ga16PoolPost(o){if(!o)return;/*GA16_UNIFY_2: popup premium + report único via window.ga16Post*/try{window.ga16Post&&window.ga16Post(o,{mySeat:mySeat,names:Array.isArray(o.names)?o.names:undefined,players:2,game:'pool'})}catch(e){console.error('[Pool] ga16Post:',e)}}",
    '8ball ga16PoolPost');
  must(!s.includes("reportMatchResult(w===0?'host':'guest'"), '8ball: ainda reporta host/guest');
  return beforeLastBody(s, MARK + NEW_TAG, '8ball');
});

console.log('GA16_UNIFY_2 concluído.');
