#!/usr/bin/env node
'use strict';
/**
 * GA16_UNIFY — Dama e Fruit passam a usar window.ga16Post (ga16-post.js v3).
 *   - carrega /games/shared/ga16-post.js?v=3
 *   - Dama: ga16DamaPost deixa de reportar ao Android (o v3 faz o report único aos 3,5 s)
 *   - Fruit: a função local ga16Post (colidia com window.ga16Post) passa a ga16FruitEnd;
 *            mpReport deixa de chamar reportMatchResult('host'|'guest')
 * Idempotente: se o marcador GA16_UNIFY já existir, o ficheiro é ignorado.
 * Uso (na raiz do repo):  node scripts/ga16-unify-html.js
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

const ROOT = process.cwd();
const POST_TAG = '<script src="/games/shared/ga16-post.js?v=3"></script>';
const NET_TAG = '<script src="/games/shared/ga-net.js?v=2"></script>';

// ---------------------------------------------------------------- DAMA
(function dama() {
  const f = path.join(ROOT, 'backend/public/games/dama/index.html');
  must(fs.existsSync(f), 'não existe ' + f);
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes('GA16_UNIFY')) { console.log('= dama: já aplicado'); return; }
  must(!s.includes('ga16-post.js'), 'dama: já carrega ga16-post.js (verificar à mão)');

  s = replaceOnce(s, NET_TAG, NET_TAG + '\n' + POST_TAG, 'dama <script ga-net>');

  s = replaceBlock(s,
    '  /*GA16_DAMA: fim (game_over do servidor) → histórico',
    'JSON.stringify({winner:nm}))}catch(e){}},5000)}',
    "  /*GA16_UNIFY: fim → popup premium + report único via window.ga16Post (ga16-post.js v3)*/\n" +
    "  function ga16DamaPost(o){if(!o)return;try{window.ga16Post&&window.ga16Post(o,{mySeat:mySeat,names:Array.isArray(o.names)?o.names:names,players:2,game:'dama'})}catch(e){console.error('[Dama] ga16Post:',e)}}",
    'dama ga16DamaPost');

  must(!s.includes("A.reportMatchResult(w===0?'host':'guest'"), 'dama: ainda chama reportMatchResult host/guest');
  fs.writeFileSync(f, s);
  console.log('✅ dama: ' + f);
})();

// ---------------------------------------------------------------- FRUIT
(function fruit() {
  const f = path.join(ROOT, 'backend/public/games/fruit/index.html');
  must(fs.existsSync(f), 'não existe ' + f);
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes('GA16_UNIFY')) { console.log('= fruit: já aplicado'); return; }
  must(!s.includes('ga16-post.js'), 'fruit: já carrega ga16-post.js (verificar à mão)');

  s = replaceOnce(s, NET_TAG, NET_TAG + '\n' + POST_TAG, 'fruit <script ga-net>');

  s = replaceOnce(s,
    "s.on('room_closed',()=>{if(!N.done&&!N.over)ga16Post(-1,'closed')});",
    "s.on('room_closed',()=>{if(!N.done&&!N.over)ga16FruitEnd(-1,'closed')});",
    'fruit room_closed');

  s = replaceOnce(s,
    'NET.ga16Ws=ws;/*GA16_FRUIT*/ga16Post(ws);/*GA16_POSTGAME*/',
    'NET.ga16Ws=ws;/*GA16_FRUIT*/ga16FruitEnd(ws);/*GA16_UNIFY*/',
    'fruit mpOnOver');

  s = replaceBlock(s,
    '/*GA16_POSTGAME: fim (game_over do servidor) ou sala fechada',
    "},o==='closed'?1500:4000)}",
    "/*GA16_UNIFY: fim → popup premium + report único via window.ga16Post (ga16-post.js v3)*/\n" +
    "function ga16FruitEnd(ws,why){try{var nms=[];for(var k=0;k<NP;k++)nms.push(mpName(k));window.ga16Post&&window.ga16Post({winnerSeat:ws,draw:ws<0&&why!=='closed',reason:why||''},{mySeat:mySeat,names:nms,players:NP,outcome:why==='closed'?'closed':undefined,game:'fruit'})}catch(e){console.error('[Fruit Arena] ga16Post:',e)}}",
    'fruit ga16Post local');

  s = replaceOnce(s,
    "try{const a=window.AndroidInterface;a&&a.reportMatchResult&&a.reportMatchResult((NP==2&&(NET.ga16Ws===0||NET.ga16Ws===1))?(NET.ga16Ws===0?'host':'guest'):(w?'win':'loss'),JSON.stringify(/*GA16_FRUIT: 1v1 -> host|guest (lugar 0 = host)*/{room:NET.room,seat:mySeat,players:NP,place:rank.indexOf(0)+1,hp:P[0]?+P[0].hp.toFixed(2):0,seed:NET.seed}))}catch(e){}",
    '/*GA16_UNIFY: o report ao Android é feito só pelo window.ga16Post*/void w;',
    'fruit mpReport');

  must(!/function ga16Post\s*\(/.test(s), 'fruit: ainda existe function ga16Post local');
  must(!/[^.\w]ga16Post\(/.test(s.replace(/window\.ga16Post\(/g, '')), 'fruit: ainda há chamadas a ga16Post( local');
  fs.writeFileSync(f, s);
  console.log('✅ fruit: ' + f);
})();

console.log('GA16_UNIFY concluído.');
