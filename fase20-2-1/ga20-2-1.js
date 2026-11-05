#!/usr/bin/env node
/* GA20_ARENA — Fase 20.2.1: o fork do PPSSPP (Arena Console) recebe o Intent do Launcher GameArena.
 *
 * Uso (na RAIZ do clone do PPSSPP, onde está a pasta android/):
 *   node ~/Kiro-arquivos-/fase20-2-1/ga20-2-1.js
 *
 * No PPSSPP não existe MainActivity: a Activity principal é android/src/org/ppsspp/ppsspp/PpssppActivity.java
 * e o Manifest é android/AndroidManifest.xml. O PPSSPP já sabe arrancar um jogo direto sem menu: é o que faz
 * com os atalhos (parseIntent -> shortcutParam -> NativeApp.init, ou a mensagem "shortcutParam" se já estiver aberto).
 * Por isso não há NativeApp.launchGame: a ISO do Launcher entra por esse mesmo caminho.
 *
 * Ficheiro NOVO (copiado de fase20-2-1/files/, nunca sobrescreve um ficheiro diferente):
 *   android/src/org/ppsspp/ppsspp/ArenaSession.java   lê e valida o Intent (ISO + dados de rede para a 20.2.2)
 * Ficheiros EXISTENTES (edições com âncora):
 *   android/AndroidManifest.xml   M1 intent-filter com.gamearena.console.START_GAME no PpssppActivity
 *   PpssppActivity.java           P1 parseIntent(): Intent da GameArena -> arranca a ISO (sem ISO -> menu normal)
 * NÃO toca: o filtro VIEW de ficheiros, atalhos, C++, build.gradle.kts.
 * Cada âncora tem de existir exatamente 1 vez; se alguma falhar NÃO escreve nada. Faz .bak. Idempotente (GA20_ARENA).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MARK = 'GA20_ARENA';
const MF = 'android/AndroidManifest.xml';
const ACT = 'android/src/org/ppsspp/ppsspp/PpssppActivity.java';
const SRC = path.join(__dirname, 'files');

for (const f of [MF, ACT]) if (!fs.existsSync(f)) {
  console.error('✗ Não encontro ' + f + '\n  Corre o script na RAIZ do clone do PPSSPP (onde estão as pastas android/, Core/, UI/).' +
    '\n  Se o teu fork tiver outra estrutura, mostra-me: find . -name AndroidManifest.xml -not -path "*/build/*"; find . -name "PpssppActivity.java"');
  process.exit(1);
}
if (!fs.existsSync(SRC)) { console.error('✗ Não encontro ' + SRC + '\n  O script tem de ficar dentro da pasta fase20-2-1 (ao lado da pasta files/).'); process.exit(1); }

let fails = 0;
const writes = [];
function must(src, from, to, label, file) {
  const n = src.split(from).length - 1;
  if (n !== 1) {
    fails++;
    console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 160) +
      '\n  Mostra-me: grep -nF \'' + from.slice(0, 50).replace(/'/g, "'\\''") + '\' ' + file);
    return src;
  }
  console.log('✓ ' + label);
  return src.replace(from, () => to);
}
function mustRe(src, re, fn, label, file, hint) {
  const all = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
  if (all.length !== 1) {
    fails++;
    console.error('✗ ' + label + ': âncora encontrada ' + all.length + ' vez(es), esperado 1.\n  Mostra-me: ' + hint);
    return src;
  }
  console.log('✓ ' + label);
  return src.replace(re, fn);
}
const lineIndent = (src, idx) => src.slice(src.lastIndexOf('\n', idx) + 1, idx).match(/^[ \t]*/)[0];

/* ============================ AndroidManifest.xml ============================ */
{
  const m0 = fs.readFileSync(MF, 'utf8'); let m = m0;
  if (m.includes(MARK)) console.log('= Manifest já tem ' + MARK + ' (salto)');
  else {
    if (m.includes('com.gamearena.console.START_GAME')) { fails++; console.error('✗ M1 Manifest: já existe um filtro START_GAME sem a marca ' + MARK + '. Mostra-me: grep -n "gamearena" ' + MF); }
    // Fecha o filtro MAIN/LAUNCHER do PpssppActivity; o filtro novo entra logo a seguir, dentro da mesma <activity>.
    m = mustRe(m, /<category android:name="android\.intent\.category\.LEANBACK_LAUNCHER" \/>(\s*)<\/intent-filter>/,
      (all, ws, off) => {
        const close = off + all.lastIndexOf('</intent-filter>'), ind = lineIndent(m, close);
        return all + '\n' +
          ind + '<!-- GA20_ARENA: Launcher GameArena (Arena Console). A ISO vem por content:// no ClipData, sem data. -->\n' +
          ind + '<intent-filter>\n' +
          ind + '    <action android:name="com.gamearena.console.START_GAME" />\n' +
          ind + '    <category android:name="android.intent.category.DEFAULT" />\n' +
          ind + '</intent-filter>';
      },
      'M1 Manifest: intent-filter com.gamearena.console.START_GAME no PpssppActivity', MF,
      'grep -n "LEANBACK_LAUNCHER\\|intent-filter\\|PpssppActivity" ' + MF);
    if (m !== m0) writes.push([MF, m, true]);
  }
}

/* ============================ PpssppActivity.java ============================ */
{
  const a0 = fs.readFileSync(ACT, 'utf8'); let a = a0;
  if (a.includes(MARK)) console.log('= PpssppActivity já tem ' + MARK + ' (salto)');
  else {
    const sig = 'private static String parseIntent(Intent intent) {';
    const i = a.indexOf(sig), ind = (i >= 0 ? lineIndent(a, i) : '\t') + '\t';
    a = must(a, sig, sig + '\n' +
      ind + '// GA20_ARENA: Intent do Launcher GameArena (com.gamearena.console.START_GAME). A ISO arranca direto,\n' +
      ind + '// pelo mesmo caminho dos atalhos. Os dados de rede ficam em ArenaSession.current (netplay: Fase 20.2.2).\n' +
      ind + 'ArenaSession arena = ArenaSession.fromIntent(intent);\n' +
      ind + 'if (arena != null) {\n' +
      ind + '\tArenaSession.current = arena;\n' +
      ind + '\tif (arena.bootTarget != null) {\n' +
      ind + '\t\treturn "\\"" + arena.bootTarget.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"";\n' +
      ind + '\t}\n' +
      ind + '\tLog.w(TAG, "GameArena: Intent sem ISO legível, a abrir o menu normal.");\n' +
      ind + '}',
      'P1 PpssppActivity.parseIntent: Intent da GameArena arranca a ISO', ACT);
    if (a !== a0) writes.push([ACT, a, true]);
  }
}

/* ============================ Ficheiro novo ============================ */
for (const rel of ['android/src/org/ppsspp/ppsspp/ArenaSession.java']) {
  const from = path.join(SRC, rel);
  if (!fs.existsSync(from)) { fails++; console.error('✗ falta ' + from + ' (copia a pasta fase20-2-1 inteira)'); continue; }
  const body = fs.readFileSync(from, 'utf8');
  if (fs.existsSync(rel)) {
    if (fs.readFileSync(rel, 'utf8') === body) { console.log('= ' + rel + ' já está igual (salto)'); continue; }
    fails++; console.error('✗ ' + rel + ' já existe e é diferente. Não sobrescrevo. Mostra-me: head -30 ' + rel);
    continue;
  }
  console.log('✓ novo: ' + rel);
  writes.push([rel, body, false]);
}

/* ============================ Escrever (tudo ou nada) ============================ */
if (fails) { console.error('\n✗ ' + fails + ' problema(s). NÃO escrevi nada.'); process.exit(1); }
if (!writes.length) { console.log('\nNada a fazer: a Fase 20.2.1 já está aplicada.'); process.exit(0); }
for (const [f, body, bak] of writes) {
  if (bak) fs.copyFileSync(f, f + '.bak');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}
console.log('\n✓ Fase 20.2.1 aplicada (' + writes.length + ' ficheiro(s)). Cópias de segurança: *.bak (não as commits)');
console.log('  git add ' + writes.map(w => w[0]).join(' '));
