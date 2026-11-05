#!/usr/bin/env node
/* GA 8-Ball v3 — correção cirúrgica (microfone à esquerda para Host+Guest, mesa do Host sincronizada).
 *
 * Uso (na RAIZ do repo Arenaapk):
 *   node ga-8ball-v3.js
 *   (ou com caminhos: node ga-8ball-v3.js <8ball/index.html> <pool-namespace.js>)
 *
 * Regras:
 *  - Cada âncora tem de existir EXATAMENTE 1 vez. Se alguma falhar, NÃO escreve nada (nenhum ficheiro).
 *  - Faz cópia .bak de cada ficheiro antes de escrever.
 *  - Depois de escrever, valida a sintaxe (pool-namespace.js com node --check; scripts inline do index.html
 *    compilados um a um). Se a validação piorar, repõe o .bak automaticamente.
 *  - Idempotente: se já foi aplicado, avisa e não muda nada.
 *  - NÃO toca no Ludo nem no voice.js partilhado.
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

const htmlPath = process.argv[2] || 'backend/public/games/8ball/index.html';
const nsPath = process.argv[3] || 'backend/services/pool-namespace.js';
for (const f of [htmlPath, nsPath]) if (!fs.existsSync(f)) { console.error('✗ Não encontro: ' + f + '\n  Corre na raiz do Arenaapk.'); process.exit(1); }

const MARK = 'GA8_V3';
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

let html = fs.readFileSync(htmlPath, 'utf8');
let ns = fs.readFileSync(nsPath, 'utf8');
const htmlDone = html.includes(MARK), nsDone = ns.includes(MARK);
if (htmlDone && nsDone) { console.log('= Já aplicado nos dois ficheiros. Nada a fazer.'); process.exit(0); }
const html0 = html, ns0 = ns;

/* ============================ 8ball/index.html ============================ */
if (htmlDone) console.log('= index.html já tinha ' + MARK + ' (salto)');
else {
  // H1) Microfone à ESQUERDA para Host e Guest.
  //     O voice.js atual (v2) ainda não lê GA_VOICE_LEFT; por isso o lado esquerdo é garantido por CSS desta página,
  //     com especificidade dupla (#id#id) que ganha ao !important do voice.js. A flag fica para o voice.js futuro.
  //     ?v=7 fura a cache do WebView.
  html = must(html,
    '<!-- GA17_VOICE --><script src="/games/shared/voice.js?v=5"></script>',
    '<!-- GA17_VOICE --><style id="ga8VoiceLeft">/*' + MARK + '*/' +
      '#gaVoiceBtn#gaVoiceBtn{right:auto!important;left:14px!important;left:calc(14px + env(safe-area-inset-left, 0px))!important}' +
      '#gaVoiceTip#gaVoiceTip{right:auto!important;left:76px!important;left:calc(76px + env(safe-area-inset-left, 0px))!important}' +
    '</style><script>window.GA_VOICE_LEFT=true;</script><script src="/games/shared/voice.js?v=7"></script>',
    'H1 html: microfone à esquerda + GA_VOICE_LEFT + voice.js?v=7');

  // H2) Clique numa mesa (antes do jogo): o Host avisa o servidor; o Guest não pode mudar (manda o Host).
  html = must(html,
    'AC();ping(880,.07,.16);setScene(o.sc)};',
    'if(window.__ga16Pick&&window.__ga16Pick(o.sc)===false)return;/*' + MARK + '*/AC();ping(880,.07,.16);setScene(o.sc)};',
    'H2 html: clique na mesa -> __ga16Pick');

  // H3) Guest ouve a mesa no lobby (room_update.scene e scene_update). onLobby fica igual.
  html = must(html,
    "socket.on('room_update',onLobby);",
    "socket.on('room_update',onLobby);/*" + MARK + "*/" +
      "socket.on('room_update',function(u){try{window.__ga16Room&&window.__ga16Room(u&&u.scene,'room_update')}catch(e){}});" +
      "socket.on('scene_update',function(u){try{window.__ga16Room&&window.__ga16Room(u&&u.scene,'scene_update')}catch(e){}});",
    'H3 html: ouvir room_update.scene + scene_update');

  // H4) match_start: se o onMatch() mudar a mesa depois do nosso setScene, volta a pôr a do servidor.
  html = must(html,
    "}catch(e){console.error('[8Ball] GA16 scene:',e)}return onMatch.apply(this,arguments)});",
    "}catch(e){console.error('[8Ball] GA16 scene:',e)}var ga8R=onMatch.apply(this,arguments);/*" + MARK + "*/" +
      "try{var n2=m&&m.scene;if(typeof n2==='number'&&n2%1===0&&n2>=0&&SC[n2]&&n2!==SCN&&window.__ga16Show){console.log('[8Ball] GA16 onMatch mudou a mesa; repõe',n2);window.__ga16Show(n2)}}catch(e){}return ga8R});",
    'H4 html: match_start repõe a mesa do servidor depois do onMatch');

  // H5) join(): lógica do Ludo — o Host recebe um anonToken para o servidor de voz o aceitar,
  //     e gaVoice.setRoom(ROOM, token) para Host e Guest. O payload do create_room/join_room NÃO muda.
  html = must(html,
    "const join=()=>{const my=++gaJoinSeq;gaLaunch.then(()=>{if(my===gaJoinSeq&&socket&&socket.connected)socket.emit(ROLE==='host'?'create_room':'join_room',{code:ROOM,players:NP,scene:SCN/*GA16_POOL_CLIENT*/,token:Q.get('token')||TOKEN,name:MYNAME});});};",
    "/*" + MARK + ": anonToken como no Ludo (só para a voz)*/" +
    "function ga8AnonTok(){const k='p8Tok:'+ROOM+':'+ROLE,mk=()=>'anon-'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);try{let t=sessionStorage.getItem(k);if(!t){t=mk();sessionStorage.setItem(k,t)}return t}catch(e){return mk()}}" +
    "const GA8_VOICE_TOK=TOKEN||ga8AnonTok();" +
    // mostra uma mesa vinda do servidor sem estragar a preferência local guardada em 'p8s'
    "window.__ga16Show=function(n){if(n===SCN)return;var ls=null;try{ls=localStorage.getItem('p8s')}catch(e){}setScene(n,1);try{if(ls===null)localStorage.removeItem('p8s');else localStorage.setItem('p8s',ls)}catch(e){}};" +
    // clique numa mesa: Host -> set_scene ; Guest em sala -> bloqueado
    "window.__ga16Pick=function(n){if(!ROOM)return true;if(ROLE!=='host'){try{toast('🎱 A mesa é escolhida pelo anfitrião')}catch(e){}return false}" +
      "try{if(socket&&socket.connected){socket.emit('set_scene',{code:ROOM,scene:n,token:Q.get('token')||TOKEN});console.log('[8Ball] GA16 set_scene',n)}}catch(e){}return true};" +
    // room_update/scene_update: Guest aplica; Host corrige o servidor se ele tiver outra mesa (ex.: clicou antes de a sala existir)
    "window.__ga16Room=function(n,src){try{if(window.__ga16Scn!=null)return;if(typeof n!=='number'||n%1!==0||n<0||!SC[n])return;" +
      "if(ROLE==='host'){if(n!==SCN&&socket&&socket.connected){socket.emit('set_scene',{code:ROOM,scene:SCN,token:Q.get('token')||TOKEN});console.log('[8Ball] GA16 servidor tinha mesa',n,'-> envio',SCN)}return}" +
      "if(n!==SCN){console.log('[8Ball] GA16 '+src+' mesa',n);window.__ga16Show(n);try{toast('🎱 Mesa escolhida pelo anfitrião')}catch(e){}}}catch(e){console.error('[8Ball] GA16 room:',e)}};" +
    "const join=()=>{const my=++gaJoinSeq;gaLaunch.then(()=>{if(my===gaJoinSeq&&socket&&socket.connected){socket.emit(ROLE==='host'?'create_room':'join_room',{code:ROOM,players:NP,scene:SCN/*GA16_POOL_CLIENT*/,token:Q.get('token')||TOKEN,name:MYNAME});" +
      "try{if(window.gaVoice&&window.gaVoice.setRoom)window.gaVoice.setRoom(ROOM,GA8_VOICE_TOK);}catch(e){}}});};",
    'H5 html: join() com anonToken + gaVoice.setRoom (Host e Guest)');
}

/* ============================ pool-namespace.js ============================ */
if (nsDone) console.log('= pool-namespace.js já tinha ' + MARK + ' (salto)');
else {
  // S1) room_update leva a mesa (o Guest que já está na sala vê-a mudar)
  ns = must(ns,
    'joined: room.seats.length, seats: room.seats.map((s, i) => ({ seat: i, name: s.name, connected: s.connected }))',
    'joined: room.seats.length, scene: ga16Scene(room), seats: room.seats.map((s, i) => ({ seat: i, name: s.name, connected: s.connected }))',
    'S1 servidor: room_update com scene');

  // S2) log da mesa no início da partida (aparece no Render)
  ns = must(ns,
    "room.seats.forEach((s, i) => nsp.to(s.sid).emit('match_start', matchPayload(room, i)));",
    "console.log('[pool] GA16 match_start', room.code, 'scene', ga16Scene(room), room.scene == null ? '(hash)' : '(anfitrião)'); /* " + MARK + " */\n" +
    "    room.seats.forEach((s, i) => nsp.to(s.sid).emit('match_start', matchPayload(room, i)));",
    'S2 servidor: log no match_start');

  // S3) set_scene: só o Host (lugar 0) e só antes de começar. Guarda e avisa a sala.
  ns = must(ns,
    "socket.on('join_room', safe(p => enter(socket, p, 'guest')));",
    "socket.on('join_room', safe(p => enter(socket, p, 'guest')));\n" +
    "    // " + MARK + ": o anfitrião muda de mesa no lobby -> servidor guarda (vai no match_start) e avisa a sala.\n" +
    "    socket.on('set_scene', safe(p => {\n" +
    "      const v = ga16ValidScene(p && (p.scene != null ? p.scene : p.scenario));\n" +
    "      if (v === null) return;\n" +
    "      let room = rooms.get(String((p && p.code) || '').toUpperCase());\n" +
    "      if (!room || !room.seats.some(s => s.sid === socket.id)) { room = null; for (const r of rooms.values()) if (r.seats.some(s => s.sid === socket.id)) { room = r; break; } }\n" +
    "      if (!room) { console.log('[pool] GA16 set_scene sem sala (ainda)', v); return; }\n" +
    "      if (room.started) return;\n" +
    "      const s0 = room.seats[0], tk = String((p && p.token) || '');\n" +
    "      if (!s0 || !(s0.sid === socket.id || (s0.token && s0.token === tk))) { console.log('[pool] GA16 set_scene recusado (não é o anfitrião)', room.code); return; }\n" +
    "      room.scene = v;\n" +
    "      nsp.to(room.code).emit('scene_update', { code: room.code, scene: v });\n" +
    "      lobbyUpdate(room);\n" +
    "      console.log('[pool] GA16 set_scene', room.code, v);\n" +
    "    }));",
    'S3 servidor: evento set_scene');
}

if (fails) { console.error('\n✗ ' + fails + ' âncora(s) falharam. NADA foi escrito. Manda-me o grep indicado acima.'); process.exit(2); }

/* ============================ validação de sintaxe ============================ */
function inlineScriptErrors(h) {
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m, bad = 0;
  while ((m = re.exec(h))) {
    const attrs = m[1] || '';
    if (/\ssrc\s*=/i.test(attrs) || /type\s*=\s*["']?(module|application\/json|text\/template)/i.test(attrs)) continue;
    try { new Function(m[2]); } catch (e) { bad++; }
  }
  return bad;
}
const badBefore = inlineScriptErrors(html0), badAfter = inlineScriptErrors(html);
if (badAfter > badBefore) { console.error('✗ O index.html ficaria com erro de sintaxe (' + badBefore + ' -> ' + badAfter + '). NADA foi escrito.'); process.exit(3); }

const wrote = [];
if (html !== html0) { fs.copyFileSync(htmlPath, htmlPath + '.bak'); fs.writeFileSync(htmlPath, html); wrote.push(htmlPath); }
if (ns !== ns0) {
  fs.copyFileSync(nsPath, nsPath + '.bak'); fs.writeFileSync(nsPath, ns); wrote.push(nsPath);
  try { execFileSync(process.execPath, ['--check', nsPath], { stdio: 'pipe' }); console.log('✓ node --check ' + nsPath); }
  catch (e) {
    fs.copyFileSync(nsPath + '.bak', nsPath);
    if (html !== html0) fs.copyFileSync(htmlPath + '.bak', htmlPath);
    console.error('✗ node --check falhou; reposto o original dos dois ficheiros.\n' + String(e.stderr || e.message));
    process.exit(4);
  }
}
console.log('✓ scripts inline do index.html compilam (erros antes/depois: ' + badBefore + '/' + badAfter + ')');
console.log('\nOK. Escritos: ' + wrote.join(', ') + '\nBackups: *.bak (não os adiciones ao git).');
console.log('\ngit add ' + wrote.join(' '));
