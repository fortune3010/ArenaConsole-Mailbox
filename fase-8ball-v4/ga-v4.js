#!/usr/bin/env node
/* GA v4 — correção cirúrgica: (1) mesa do 8-Ball fica a do servidor no Guest; (2) fecho automático do Impostor.
 *
 * Uso (na RAIZ do repo Arenaapk):
 *   node ga-v4.js
 *   (ou com caminhos: node ga-v4.js <8ball/index.html> <impostor/index.html>)
 *
 * Regras:
 *  - Cada âncora tem de existir EXATAMENTE 1 vez. Se alguma falhar, NÃO escreve nenhum ficheiro.
 *  - Faz cópia .bak antes de escrever. Valida a sintaxe dos scripts inline; se piorar, não escreve.
 *  - Idempotente (marcas GA8_V4 e GAIMP_V4).
 *  - NÃO toca: Ludo, voice.js, microfone do 8-Ball, fecho do 8-Ball, pool-namespace.js.
 */
'use strict';
const fs = require('fs');

const P8 = process.argv[2] || 'backend/public/games/8ball/index.html';
const PI = process.argv[3] || 'backend/public/games/impostor/index.html';
for (const f of [P8, PI]) if (!fs.existsSync(f)) {
  console.error('✗ Não encontro: ' + f + '\n  Corre na raiz do Arenaapk. Se o Impostor estiver noutra pasta, manda-me: ls backend/public/games');
  process.exit(1);
}

let fails = 0;
function must(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) {
    fails++;
    console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 160) +
      '\n  Mostra-me: grep -nF \'' + from.slice(0, 50).replace(/'/g, "'\\''") + '\' <ficheiro>');
    return src;
  }
  console.log('✓ ' + label);
  return src.replace(from, () => to);
}

/* ============================ 8-Ball: a mesa do servidor manda ============================ */
const b0 = fs.readFileSync(P8, 'utf8'); let b = b0;
if (b.includes('GA8_V4')) console.log('= 8-Ball já tem GA8_V4 (salto)');
else {
  // B1) setScene: depois do match_start (window.__ga16Scn definido), qualquer pedido de outra mesa é trocado pela do servidor.
  //     Apanha código que, depois do onMatch, volte a pôr a mesa local (ex.: lida do localStorage 'p8s').
  b = must(b,
    "function setScene(i,init){lastSig='';SCN=i;",
    "function setScene(i,init){if(window.__ga16Scn!=null&&SC[window.__ga16Scn]&&i!==window.__ga16Scn){console.log('[8Ball] GA16 setScene('+i+') trocado pela mesa do servidor',window.__ga16Scn);i=window.__ga16Scn}/*GA8_V4*/lastSig='';SCN=i;",
    'B1 8-Ball: setScene bloqueado na mesa do servidor');

  // B2) função que repõe a mesa do servidor se SCN tiver sido mudado por fora (sem setScene) — redesenha bgArt()+build().
  b = must(b,
    "window.__ga16Show=function(n){if(n===SCN)return;",
    "window.__ga16Enforce=function(src){try{var n=window.__ga16Scn;if(n==null||!SC[n]||SCN===n)return;console.log('[8Ball] GA16 '+src+': mesa',SCN,'-> servidor',n);window.__ga16Show(n)}catch(e){console.error('[8Ball] GA16 enforce:',e)}};/*GA8_V4*/" +
    "window.__ga16Show=function(n){if(n===SCN)return;",
    'B2 8-Ball: window.__ga16Enforce');

  // B3) match_start: depois do onMatch, verifica já e aos 0,4 s / 1,5 s / 4 s; o Guest vê um aviso com o nome da mesa recebida.
  b = must(b,
    "&&n2!==SCN&&window.__ga16Show){console.log('[8Ball] GA16 onMatch mudou a mesa; repõe',n2);window.__ga16Show(n2)}}catch(e){}return ga8R});",
    "&&window.__ga16Show){if(n2!==SCN)console.log('[8Ball] GA16 onMatch mudou a mesa; repõe',n2);window.__ga16Enforce&&window.__ga16Enforce('match_start');/*GA8_V4*/" +
      "[400,1500,4000].forEach(function(t){setTimeout(function(){window.__ga16Enforce&&window.__ga16Enforce('verificação '+t+'ms')},t)});" +
      "try{if(ROLE!=='host'){var o2=ORD.find(function(x){return x.sc===n2});toast('🎱 '+(o2?o2.n:'Mesa '+(n2+1)))}}catch(e){}}}catch(e){}return ga8R});",
    'B3 8-Ball: match_start verifica a mesa várias vezes + aviso no Guest');

  // B4) cada game_state também confirma a mesa (barato: só redesenha se estiver errada).
  b = must(b,
    "socket.on('game_state',s=>{s.__rx=performance.now();",
    "socket.on('game_state',s=>{try{window.__ga16Enforce&&window.__ga16Enforce('game_state')}catch(e){}/*GA8_V4*/s.__rx=performance.now();",
    'B4 8-Ball: game_state confirma a mesa');
}

/* ============================ Impostor: fecho automático ============================ */
const i0 = fs.readFileSync(PI, 'utf8'); let im = i0;
if (im.includes('GAIMP_V4')) console.log('= Impostor já tem GAIMP_V4 (salto)');
else {
  // I1) O ga16Post (popup + reportMatchResult -> Android fecha e abre o Histórico) era chamado só DEPOIS de
  //     "if(!e||e.ended||e.endAt>0)return;". Se o motor local já tinha acabado o jogo, o return saltava o fecho.
  //     Agora é chamado PRIMEIRO, sempre. Se o ga16-post.js não carregou, reporta direto ao Android (3,9 s, igual ao ga16Post).
  //     O resto do handler fica igual (a 2.ª chamada ao ga16Post é ignorada pelo próprio ga16Post).
  im = must(im,
    "sock.on('game_over',o=>{const e=N.eng;if(!e||e.ended||e.endAt>0)return;",
    "sock.on('game_over',o=>{/*GAIMP_V4: o fecho não depende do motor local*/try{if(!window.__gaImpV4){window.__gaImpV4=1;var oc=(o&&o.winner===sock.id)?'win':'loss';" +
      "if(window.ga16Post)window.ga16Post(o,{outcome:oc,game:'impostor'});" +
      "else setTimeout(function(){try{var A=window.AndroidInterface;if(A&&typeof A.reportMatchResult==='function')A.reportMatchResult('ga16_'+oc,JSON.stringify({outcome:oc,game:'impostor'}))}catch(_){}},3900)}}catch(_){}" +
      "const e=N.eng;if(!e||e.ended||e.endAt>0)return;",
    'I1 Impostor: ga16Post chamado antes do return do motor');

  // I2) ?v=4 fura a cache do WebView (se lá estiver um ga16-post.js antigo).
  im = must(im,
    '<!-- GA16_UNIFY_2 --><script src="/games/shared/ga16-post.js?v=3"></script>',
    '<!-- GA16_UNIFY_2 --><script src="/games/shared/ga16-post.js?v=4"></script><!--GAIMP_V4-->',
    'I2 Impostor: ga16-post.js?v=4');
}

if (fails) { console.error('\n✗ ' + fails + ' âncora(s) falharam. NADA foi escrito. Manda-me o grep indicado acima.'); process.exit(2); }

/* ============================ validação ============================ */
function inlineErrors(h) {
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m, bad = 0;
  while ((m = re.exec(h))) {
    const a = m[1] || '';
    if (/\ssrc\s*=/i.test(a) || /type\s*=\s*["']?(module|application\/json|text\/template|text\/babel)/i.test(a)) continue;
    try { new Function(m[2]); } catch (e) { bad++; }
  }
  return bad;
}
for (const [name, before, after] of [['8-Ball', b0, b], ['Impostor', i0, im]]) {
  const x = inlineErrors(before), y = inlineErrors(after);
  if (y > x) { console.error('✗ ' + name + ' ficaria com erro de sintaxe (' + x + ' -> ' + y + '). NADA foi escrito.'); process.exit(3); }
  console.log('✓ ' + name + ': scripts inline compilam (erros antes/depois: ' + x + '/' + y + ')');
}

const wrote = [];
if (b !== b0) { fs.copyFileSync(P8, P8 + '.bak'); fs.writeFileSync(P8, b); wrote.push(P8); }
if (im !== i0) { fs.copyFileSync(PI, PI + '.bak'); fs.writeFileSync(PI, im); wrote.push(PI); }
if (!wrote.length) { console.log('= Nada a fazer.'); process.exit(0); }
console.log('\nOK. Escritos: ' + wrote.join(', ') + '\nBackups: *.bak (não os adiciones ao git).');
console.log('\ngit add ' + wrote.join(' '));
