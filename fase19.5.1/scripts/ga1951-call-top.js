#!/usr/bin/env node
'use strict';
/**
 * GA1951_CALL_UI — no CallActivity.setPhase(), muda o título do topo:
 *   a receber → "Chamada recebida"; a ligar/em curso → "Chamada de voz" | "Chamada de vídeo".
 * Uma única inserção; o resto do CallActivity.kt fica igual. Idempotente (marcador GA1951).
 * Uso na raiz do repo:  node scripts/ga1951-call-top.js
 */
const fs = require('fs');
const path = require('path');
function must(c, m) { if (!c) { console.error('❌ ' + m); process.exit(1); } }

const f = path.join(process.cwd(), 'app/src/main/java/com/gamearena/ui/social/CallActivity.kt');
must(fs.existsSync(f), 'não existe ' + f);
let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
if (s.includes('GA1951')) { console.log('= CallActivity.kt: já aplicado'); process.exit(0); }

const ANCHOR = '        if (p == Phase.CONNECTED) {\n            main.removeCallbacks(tick)\n            main.post(tick)\n        }';
const a = s.indexOf(ANCHOR);
must(a >= 0, 'âncora de setPhase() não encontrada — corre: grep -n "main.post(tick)" ' + f);
must(s.indexOf(ANCHOR, a + 1) < 0, 'âncora aparece mais de uma vez');
const ADD =
  '        if (p != Phase.ENDED) findViewById<TextView>(R.id.ga1951CallTop)?.setText( // GA1951_CALL_UI\n' +
  '            if (p == Phase.INCOMING) R.string.ga1951_call_incoming else if (video) R.string.ga1951_call_video else R.string.ga1951_call_voice)\n';
fs.writeFileSync(f, s.slice(0, a) + ADD + s.slice(a));
console.log('✅ CallActivity.kt: título do topo por fase');
