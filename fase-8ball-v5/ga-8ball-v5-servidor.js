#!/usr/bin/env node
/* GA 8-Ball v5 — liga a sincronização de mesa (change_scene → scene_changed) ao namespace /pool.
 *
 * Uso (na RAIZ do repo Arenaapk):
 *   node ga-8ball-v5-servidor.js
 *   (ou com caminho: node ga-8ball-v5-servidor.js <backend/services/pool-namespace.js>)
 *
 * O que faz:
 *  1. Copia pool-scene-sync.js (que está ao lado deste script em backend/services/) para backend/services/.
 *  2. Em pool-namespace.js, logo a seguir a  socket.on('join_room', safe(p => enter(socket, p, 'guest')));
 *     acrescenta:  require('./pool-scene-sync').attach({ nsp, socket, rooms });
 * Regras: a âncora tem de existir exatamente 1 vez (senão não escreve nada); faz .bak; valida com node --check
 * e repõe o original se falhar; idempotente (marca GA8_V5).
 */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const nsPath = process.argv[2] || 'backend/services/pool-namespace.js';
const modSrc = path.join(__dirname, 'backend', 'services', 'pool-scene-sync.js');
const modDst = path.join(path.dirname(nsPath), 'pool-scene-sync.js');
const ANCHOR = "socket.on('join_room', safe(p => enter(socket, p, 'guest')));";
const LINE = "\n    require('./pool-scene-sync').attach({ nsp, socket, rooms }); // GA8_V5: mesa do anfitrião (change_scene → scene_changed)";

if (!fs.existsSync(nsPath)) { console.error('✗ Não encontro ' + nsPath + '\n  Corre na raiz do Arenaapk.'); process.exit(1); }
if (!fs.existsSync(modSrc)) { console.error('✗ Falta ' + modSrc); process.exit(1); }
const ns0 = fs.readFileSync(nsPath, 'utf8');
const done = ns0.includes('GA8_V5'), n = ns0.split(ANCHOR).length - 1;
if (!done && n !== 1) {
  console.error('✗ Âncora encontrada ' + n + ' vez(es), esperado 1. NADA foi alterado.\n  Manda-me: grep -n "join_room" ' + nsPath);
  process.exit(2);
}

if (!fs.existsSync(modDst) || fs.readFileSync(modDst, 'utf8') !== fs.readFileSync(modSrc, 'utf8')) {
  if (fs.existsSync(modDst)) fs.copyFileSync(modDst, modDst + '.bak');
  fs.copyFileSync(modSrc, modDst); console.log('✓ ' + modDst + ' copiado');
} else console.log('= ' + modDst + ' já está atualizado');

if (done) { console.log('= ' + nsPath + ' já tem GA8_V5 (nada a fazer)'); process.exit(0); }
const ns = ns0.replace(ANCHOR, () => ANCHOR + LINE);
fs.copyFileSync(nsPath, nsPath + '.bak'); fs.writeFileSync(nsPath, ns);
try {
  execFileSync(process.execPath, ['--check', nsPath], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', modDst], { stdio: 'pipe' });
  console.log('✓ ' + nsPath + ': attach() inserido; node --check OK');
} catch (e) {
  fs.copyFileSync(nsPath + '.bak', nsPath);
  console.error('✗ node --check falhou; ' + nsPath + ' reposto.\n' + String(e.stderr || e.message));
  process.exit(4);
}
console.log('\nOK. Backup: ' + nsPath + '.bak (não o adiciones ao git).\n\ngit add ' + nsPath + ' ' + modDst);
