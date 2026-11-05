#!/usr/bin/env node
/* GA 8-Ball fix — aplica 3 edições no 8ball/index.html e 1 no pool-namespace.js.
 * Uso (na raiz do repo Arenaapk):
 *   node ga-8ball-fix.js backend/public/games/8ball/index.html backend/services/pool-namespace.js
 * Cada âncora tem de existir EXATAMENTE 1 vez; se não, aborta sem escrever nada.
 * Faz cópia .bak de cada ficheiro. Idempotente (se já aplicado, avisa e salta).
 */
const fs = require('fs');
const [htmlPath, nsPath] = process.argv.slice(2);
if (!htmlPath || !nsPath) { console.error('Uso: node ga-8ball-fix.js <8ball/index.html> <pool-namespace.js>'); process.exit(1); }

function must(src, from, to, label, doneMark) {
  if (doneMark && src.includes(doneMark)) { console.log('= já aplicado: ' + label); return src; }
  const n = src.split(from).length - 1;
  if (n !== 1) { console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from + '\n  Mostra-me: grep -n "' + from.slice(0, 40).replace(/"/g, '\\"') + '" <ficheiro>'); process.exit(2); }
  console.log('✓ ' + label);
  return src.replace(from, () => to);
}

// ---------- 8ball/index.html ----------
let html = fs.readFileSync(htmlPath, 'utf8');

// 1) flag do microfone à esquerda ANTES do voice.js (+ v=6 para furar a cache do WebView)
html = must(html,
  '<!-- GA17_VOICE --><script src="/games/shared/voice.js?v=5"></script>',
  '<!-- GA17_VOICE --><script>window.GA_VOICE_LEFT=true;</script><script src="/games/shared/voice.js?v=6"></script>',
  'html: GA_VOICE_LEFT + voice.js?v=6', 'window.GA_VOICE_LEFT=true');

// 2) clique numa mesa (antes do match_start) avisa o servidor
html = must(html,
  'AC();ping(880,.07,.16);setScene(o.sc)};',
  'AC();ping(880,.07,.16);setScene(o.sc);try{window.__ga16SceneSync&&window.__ga16SceneSync(o.sc)}catch(e){}};',
  'html: clique na mesa -> __ga16SceneSync', '__ga16SceneSync(o.sc)');

// 3) define __ga16SceneSync onde socket e ROLE existem (junto do join)
html = must(html,
  'const join=()=>{const my=++gaJoinSeq;',
  "window.__ga16SceneSync=function(n){try{if(ROLE==='host'&&socket&&socket.connected&&window.__ga16Scn==null)socket.emit('set_scene',{scene:n})}catch(e){}};/*GA16_SCENE_SYNC*/const join=()=>{const my=++gaJoinSeq;",
  'html: window.__ga16SceneSync', 'GA16_SCENE_SYNC');

// ---------- pool-namespace.js ----------
let ns = fs.readFileSync(nsPath, 'utf8');

ns = must(ns,
  "socket.on('join_room', safe(p => enter(socket, p, 'guest')));",
  "socket.on('join_room', safe(p => enter(socket, p, 'guest')));\n" +
  "    // GA16_SCENE_SYNC: o anfitrião pode mudar de mesa enquanto espera o adversário (antes do match_start).\n" +
  "    socket.on('set_scene', safe(p => {\n" +
  "      const v = ga16ValidScene(p && (p.scene != null ? p.scene : p.scenario));\n" +
  "      if (v === null) return;\n" +
  "      for (const room of rooms.values()) {\n" +
  "        if (room.started) continue;\n" +
  "        const idx = room.seats.findIndex(s => s.sid === socket.id);\n" +
  "        if (idx === 0) { room.scene = v; return; } // só o lugar 0 (anfitrião) decide\n" +
  "      }\n" +
  "    }));",
  'servidor: evento set_scene', 'GA16_SCENE_SYNC');

fs.copyFileSync(htmlPath, htmlPath + '.bak');
fs.copyFileSync(nsPath, nsPath + '.bak');
fs.writeFileSync(htmlPath, html);
fs.writeFileSync(nsPath, ns);
console.log('\nOK. Backups: ' + htmlPath + '.bak, ' + nsPath + '.bak');
