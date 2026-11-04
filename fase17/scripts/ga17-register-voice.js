#!/usr/bin/env node
'use strict';
/**
 * GA17_VOICE — regista o namespace /voice em backend/services/websocket.js.
 * Insere UMA linha antes do GA-GUARD (para o /voice ficar protegido como os outros).
 * Fica fora do EXPECTED_NS (como o /call): se falhar, o /api/health não passa a 503.
 * Idempotente (marcador GA17_VOICE).  Uso na raiz do repo:  node scripts/ga17-register-voice.js
 */
const fs = require('fs');
const path = require('path');

function must(cond, msg) { if (!cond) { console.error('❌ ' + msg); process.exit(1); } }

const f = path.join(process.cwd(), 'backend/services/websocket.js');
must(fs.existsSync(f), 'não existe ' + f);
let s = fs.readFileSync(f, 'utf8');
if (s.includes('GA17_VOICE')) { console.log('= websocket.js: já aplicado'); process.exit(0); }

const ANCHOR = '  // GA-GUARD: protege handlers de todos os namespaces (depois de montados)';
const a = s.indexOf(ANCHOR);
must(a >= 0, 'âncora GA-GUARD não encontrada em websocket.js');
must(s.indexOf(ANCHOR, a + 1) < 0, 'âncora GA-GUARD aparece mais de uma vez');
must(s.includes("require('./call-namespace').attachCall"), 'websocket.js: bloco /call não encontrado (ficheiro diferente do esperado)');

const LINE =
  "  // GA17_VOICE — chat de voz dentro dos jogos (WebRTC 1x1). Só sinalização; auth = code + start_token.\n" +
  "  try { require('./voice-namespace').attachVoice(io, { namespace: '/voice', supabase }); console.log('[WS-VOICE] namespace /voice montado'); }\n" +
  "  catch (e) { console.error('[WS-VOICE] falhou:', e.message); }\n\n";

s = s.slice(0, a) + LINE + s.slice(a);
fs.writeFileSync(f, s);
console.log('✅ websocket.js: /voice registado');
