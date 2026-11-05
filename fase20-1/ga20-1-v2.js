#!/usr/bin/env node
/* GA20_CONSOLE — Fase 20.1: Arena Console (PSP) no Launcher.
 *
 * Uso (na RAIZ do repo Arenaapk, com a pasta fase20-1 copiada do Kiro-arquivos-):
 *   node ~/Kiro-arquivos-/fase20-1/ga20-1-v2.js
 *   (v2: a S1 ancora na linha do attachHockeyP2P em backend/services/websocket.js; outro ficheiro: --servidor=<ficheiro>)
 *
 * Ficheiros NOVOS (copiados de fase20-1/files/, nunca sobrescreve um ficheiro diferente):
 *   app/src/main/java/com/gamearena/ui/Ga20Console.kt          painel da aba Console + biblioteca + FileProvider
 *   app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt sala (WebView) + Intent com.gamearena.console.START_GAME
 *   app/src/main/res/xml/console_file_paths.xml                pasta roms/ partilhada com o emulador
 *   backend/services/console-namespace.js                      Socket.IO /console (sala 1x1 + sinalização do emulador)
 *   backend/public/games/console/lobby.html                    ecrã da sala (Criar / Entrar / Pronto / Iniciar Partida)
 * Ficheiros EXISTENTES (edições com âncora):
 *   GamesActivity.kt     C1 seletor OpenDocument + painel · C2 "🔒 Console" -> "🎮 Console" · C3 painel novo na aba Console
 *   AndroidManifest.xml  M1 ConsoleLobbyActivity + Ga20ConsoleFileProvider
 *   websocket.js         S1 regista o namespace /console a seguir à linha do Hockey P2P
 * NÃO toca: lista Mobile / jogos HTML, GameWebViewActivity, Hockey, NeonRush, FileProvider do OTA.
 * Cada âncora tem de existir exatamente 1 vez; se alguma falhar NÃO escreve nada. Faz .bak. Idempotente (GA20_CONSOLE).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MARK = 'GA20_CONSOLE';
const GA = 'app/src/main/java/com/gamearena/ui/GamesActivity.kt';
const MF = 'app/src/main/AndroidManifest.xml';
const SRC = path.join(__dirname, 'files');
const argServer = (process.argv.find(a => a.startsWith('--servidor=')) || '').slice('--servidor='.length);

for (const f of [GA, MF, 'backend']) if (!fs.existsSync(f)) {
  console.error('✗ Não encontro ' + f + '\n  Corre o script na RAIZ do repo Arenaapk (onde estão as pastas app/ e backend/).');
  process.exit(1);
}
if (!fs.existsSync(SRC)) { console.error('✗ Não encontro ' + SRC + '\n  O script tem de ficar dentro da pasta fase20-1 (ao lado da pasta files/).'); process.exit(1); }

let fails = 0;
const writes = [];   // [ficheiro, conteúdo, fazerBak]
function must(src, from, to, label, file) {
  const n = src.split(from).length - 1;
  if (n !== 1) {
    fails++;
    console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 160) +
      '\n  Mostra-me: grep -nF \'' + from.slice(0, 45).replace(/'/g, "'\\''") + '\' ' + file);
    return src;
  }
  console.log('✓ ' + label);
  return src.replace(from, () => to);
}
const indentOf = (src, from) => { const i = src.indexOf(from); if (i < 0) return ''; const s = src.lastIndexOf('\n', i) + 1; return src.slice(s, i).match(/^[ \t]*/)[0]; };

/* ============================ GamesActivity.kt ============================ */
{
  const g0 = fs.readFileSync(GA, 'utf8'); let g = g0;
  if (g.includes(MARK)) console.log('= GamesActivity já tem ' + MARK + ' (salto)');
  else {
    const a1 = 'private var searchQuery: String = ""', i1 = indentOf(g, a1);
    g = must(g, a1, a1 + '\n' +
      i1 + '// GA20_CONSOLE: aba Console (Arena Console / PSP). Seletor de ISO (OpenDocument) + painel em Ga20Console.kt\n' +
      i1 + 'private val ga20Picker: androidx.activity.result.ActivityResultLauncher<Array<String>> =\n' +
      i1 + '    registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri -> ga20Console.onPicked(uri) }\n' +
      i1 + 'private val ga20Console: Ga20ConsolePanel by lazy { Ga20ConsolePanel(this, { currentFilter == Filter.CONSOLE }) { ga20Picker.launch(arrayOf("*/*")) } }',
      'C1 GamesActivity: seletor OpenDocument + painel', GA);

    g = must(g, 'findViewById<TextView>(R.id.segConsole)?.text = "🔒 Console"',
      'findViewById<TextView>(R.id.segConsole)?.text = "🎮 Console" // GA20_CONSOLE',
      'C2 GamesActivity: aba Console desbloqueada', GA);

    const a3 = 'if (currentFilter == Filter.CONSOLE) {', i3 = indentOf(g, a3);
    g = must(g, a3,
      'if (currentFilter == Filter.CONSOLE && ga20Console.render(catalogContainer)) return // GA20_CONSOLE: se o painel novo falhar, fica o antigo\n' + i3 + a3,
      'C3 GamesActivity: painel Arena Console na aba Console', GA);
    if (g !== g0) writes.push([GA, g, true]);
  }
}

/* ============================ AndroidManifest.xml ============================ */
{
  const m0 = fs.readFileSync(MF, 'utf8'); let m = m0;
  if (m.includes(MARK)) console.log('= Manifest já tem ' + MARK + ' (salto)');
  else {
    if (m.includes('Ga20ConsoleFileProvider') || m.includes('.console.fileprovider')) { fails++; console.error('✗ M1 Manifest: já existe um provider da consola sem a marca ' + MARK + '. Mostra-me: grep -n "console" ' + MF); }
    const a = '<activity android:name="com.gamearena.ui.TournamentRankingActivity" android:exported="false" />', i = indentOf(m, a);
    m = must(m, a, a + '\n' +
      i + '<!-- GA20_CONSOLE: sala do Arena Console + partilha da ISO com o emulador (content://, só leitura) -->\n' +
      i + '<activity android:name="com.gamearena.ui.ConsoleLobbyActivity" android:exported="false" android:configChanges="orientation|screenSize|screenLayout|keyboardHidden" android:parentActivityName="com.gamearena.ui.GamesActivity" />\n' +
      i + '<provider android:name="com.gamearena.ui.Ga20ConsoleFileProvider" android:authorities="${applicationId}.console.fileprovider" android:exported="false" android:grantUriPermissions="true">\n' +
      i + '    <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/console_file_paths" />\n' +
      i + '</provider>',
      'M1 Manifest: ConsoleLobbyActivity + Ga20ConsoleFileProvider', MF);
    if (m !== m0) writes.push([MF, m, true]);
  }
}

/* ============================ Servidor: registo do /console ============================ */
// v2: âncora no fim da linha do Hockey P2P em backend/services/websocket.js (L672), que é uma linha única com try/catch.
// O /console fica numa linha nova logo a seguir, também dentro de try/catch (se falhar, o resto do servidor arranca na mesma).
const WS = argServer || 'backend/services/websocket.js';
const consoleNsTarget = path.join(path.dirname(WS), 'console-namespace.js'); // require('./console-namespace') ao lado do websocket.js
{
  const ask = '  Mostra-me: grep -n "attachHockeyP2P\\|WS-HOCKEY-P2P" ' + WS;
  if (!fs.existsSync(WS)) { fails++; console.error('✗ S1 servidor: não encontro ' + WS + '\n' + ask); }
  else {
    const s0 = fs.readFileSync(WS, 'utf8');
    if (s0.includes(MARK)) console.log('= ' + WS + ' já tem ' + MARK + ' (salto)');
    else {
      const a = "console.error('[WS-HOCKEY-P2P] falhou:', e.message); }";
      const i = s0.indexOf(a), ls = s0.lastIndexOf('\n', i) + 1, le = s0.indexOf('\n', i);
      const line = i < 0 ? '' : s0.slice(ls, le < 0 ? s0.length : le);
      if (i >= 0 && s0.split(a).length === 2 && !line.includes('attachHockeyP2P(io')) {
        fails++; console.error('✗ S1 servidor: a âncora existe mas não está na linha do attachHockeyP2P(io.\n' + ask);
      } else {
        const ind = line.match(/^[ \t]*/)[0];
        const reg = '\n' + ind + "try { require('./console-namespace')(io); } catch (e) { console.error('[WS-CONSOLE] falhou:', e.message); } // GA20_CONSOLE: Arena Console (sala 1x1 + sinalização do emulador)";
        const s = must(s0, a, a + reg, 'S1 servidor: /console registado a seguir ao Hockey P2P em ' + WS, WS);
        if (s !== s0) writes.push([WS, s, true]);
      }
    }
  }
}

/* ============================ Ficheiros novos ============================ */
const NEW = [
  ['app/src/main/java/com/gamearena/ui/Ga20Console.kt'],
  ['app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt'],
  ['app/src/main/res/xml/console_file_paths.xml'],
  ['backend/services/console-namespace.js', () => consoleNsTarget],
  ['backend/public/games/console/lobby.html'],
];
for (const [rel, dest] of NEW) {
  const from = path.join(SRC, rel);
  const to = dest ? path.relative(process.cwd(), dest()) : rel;
  if (!fs.existsSync(from)) { fails++; console.error('✗ falta ' + from + ' (copia a pasta fase20-1 inteira)'); continue; }
  const body = fs.readFileSync(from, 'utf8');
  if (fs.existsSync(to)) {
    if (fs.readFileSync(to, 'utf8') === body) { console.log('= ' + to + ' já está igual (salto)'); continue; }
    fails++; console.error('✗ ' + to + ' já existe e é diferente. Não sobrescrevo. Mostra-me: head -20 ' + to);
    continue;
  }
  const parent = path.dirname(to);
  if (rel.startsWith('backend/public/games/') && !fs.existsSync(path.dirname(parent))) { fails++; console.error('✗ não encontro ' + path.dirname(parent) + ' (pasta dos jogos HTML). Mostra-me: ls backend/public'); continue; }
  console.log('✓ novo: ' + to);
  writes.push([to, body, false]);
}

/* ============================ Escrever (tudo ou nada) ============================ */
if (fails) { console.error('\n✗ ' + fails + ' problema(s). NÃO escrevi nada.'); process.exit(1); }
if (!writes.length) { console.log('\nNada a fazer: a Fase 20.1 já está aplicada.'); process.exit(0); }
for (const [f, body, bak] of writes) {
  if (bak) fs.copyFileSync(f, f + '.bak');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}
console.log('\n✓ Fase 20.1 aplicada (' + writes.length + ' ficheiro(s)). Cópias de segurança: *.bak');
console.log('  git add ' + writes.map(w => w[0]).join(' '));
