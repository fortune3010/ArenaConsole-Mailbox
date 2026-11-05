#!/usr/bin/env node
/* GA20_ARENA — Fases 20.2.2 a 20.2.5: Arena Console fechado (fork do PPSSPP) + netplay pela Game Arena.
 *
 * Uso (Termux), com a 20.1 (Arenaapk) e a 20.2.1 (PPSSPP) já aplicadas:
 *   node ~/Kiro-arquivos-/fase20-2-completo/ga20-2-completo.js --ppsspp=~/ppsspp --arenaapk=~/Arenaapk --cert=AA:BB:...
 *   --cert  SHA-256 do certificado que assina a Game Arena (vários separados por vírgula). Sem --cert, o Arena Console
 *           recusa todas as partidas e o ecrã "Abre pela Game Arena" mostra o certificado instalado, para copiares.
 *           Para só atualizar o certificado mais tarde: node ga20-2-completo.js --ppsspp=~/ppsspp --cert=AA:BB:...
 *   Pode correr só um dos repos (--ppsspp ou --arenaapk). Tudo ou nada: se uma âncora falhar, não escreve nada.
 *   Faz .bak dos ficheiros alterados. Idempotente (marcas GA20_ARENA / GA20_ARENA_V2).
 *
 * PPSSPP (fork Arena Console):
 *   android/AndroidManifest.xml   M1 ícone próprio · M2 sem MAIN/LAUNCHER no PpssppActivity · M3 sem filtro VIEW
 *                                 M4 sem atalhos · M5 receiver não exportado · M6 ArenaGateActivity no LAUNCHER · M7 <queries>
 *   PpssppActivity.java           P1 parseIntent com arena.ini · P2 portão no onCreate · P3 onDestroy · P4 onNewIntent
 *                                 P5 Voltar = "Terminar a partida?" · P6 comandos arena_exit/arena_boot_done
 *                                 P7 arena_lock + ponte de rede · P8 ecrã de carregamento · P9 campo arenaRejected
 *   android/res/values/strings.xml S1 nome "Arena Console" · S2 textos do portão e da partida
 *   android/build.gradle.kts      G1 applicationId com.gamearena.console (flavor normal) · G2 socket.io-client
 *   Core/Config.h                 C1 bArenaLocked
 *   Common/System/System.h        C2 SystemNotification::ARENA_EXIT_REQUEST
 *   android/jni/app-android.cpp   C3 mensagem arena_lock · C4 BOOT_DONE/ARENA_EXIT_REQUEST para o Java
 *   UI/EmuScreen.cpp              C5 atalhos bloqueados · C6 pausa → sair · C7 REQUEST_GAME_PAUSE · C8 TV · C9 velocidade analógica
 *   README.md                     R1 atribuição (Arena Console baseado no PPSSPP, GPL 2.0+)
 *   novos: ArenaGuard, ArenaConfig, ArenaNet, ArenaUi, ArenaGateActivity (.java), res/values/arena_config.xml,
 *          ícone (drawable + mipmap), ARENA.md, .github/workflows/arena-android.yml
 * Arenaapk:
 *   backend/services/console-adhoc.js (novo) · console-namespace.js (substituído só se for exatamente o da 20.1)
 *   backend/services/websocket.js  W1 resultado da consola no GA16 (onFinish)
 *   ConsoleLobbyActivity.kt        K1 pacote do Arena Console · K2 PendingIntent arena_auth · K3 função ga20Auth
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const HERE = __dirname;
const FILES = path.join(HERE, 'files');
const TPL = path.join(HERE, 'templates');
const V1_NAMESPACE_SHA256 = 'e19bcf328a876ddfb1fafe7cd31b02cb81d83a0b85eda0340c81b70ff034dd32'; // console-namespace.js da 20.1

const arg = name => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const home = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const PP = home(arg('ppsspp'));
const GA = home(arg('arenaapk'));
const CERT_ARG = arg('cert');
if ((!PP && !GA) || process.argv.includes('--help')) {
  console.log('Uso: node ga20-2-completo.js --ppsspp=<pasta do fork PPSSPP> --arenaapk=<pasta do Arenaapk> [--cert=AA:BB:...]');
  process.exit(PP || GA ? 0 : 1);
}

let fails = 0;
const plan = [];  // { file, body, bak }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rel = (root, p) => path.join(root, p);
function fail(msg) { fails++; console.error('✗ ' + msg); }
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { fail('Não encontro ' + p); return null; } }
function must(src, from, to, label, file) {
  if (src == null) return src;
  const n = src.split(from).length - 1;
  if (n !== 1) {
    fail(label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 160).replace(/\n/g, '⏎') +
      '\n  Mostra-me: grep -nF \'' + from.split('\n').find(l => l.trim()).trim().slice(0, 60).replace(/'/g, "'\\''") + '\' ' + file);
    return src;
  }
  console.log('✓ ' + label);
  return src.replace(from, () => to);
}
function mustRe(src, re, fn, label, hint) {
  if (src == null) return src;
  const all = src.match(new RegExp(re.source, re.flags.replace('g', '') + 'g')) || [];
  if (all.length !== 1) { fail(label + ': âncora encontrada ' + all.length + ' vez(es), esperado 1.\n  Mostra-me: ' + hint); return src; }
  console.log('✓ ' + label);
  return src.replace(re, fn);
}
function edit(file, mark, steps) {
  const s0 = read(file);
  if (s0 == null) return;
  if (s0.includes(mark)) { console.log('= ' + file + ' já tem ' + mark + ' (salto)'); return; }
  const s = steps(s0);
  if (s !== s0) plan.push({ file, body: s, bak: true });
}
function addNew(root, relPath, body) {
  const to = rel(root, relPath);
  if (body == null) body = read(path.join(FILES, relPath));
  if (body == null) return;
  if (fs.existsSync(to)) {
    if (fs.readFileSync(to, 'utf8') === body) { console.log('= ' + relPath + ' já está igual (salto)'); return; }
    fail(relPath + ' já existe e é diferente. Não sobrescrevo. Mostra-me: head -20 ' + to);
    return;
  }
  console.log('✓ novo: ' + relPath);
  plan.push({ file: to, body, bak: false });
}

/* ════════════════════════════════════════ PPSSPP (Arena Console) ════════════════════════════════════════ */
function certItems() {
  if (!CERT_ARG) return null;
  const out = [];
  for (const c of CERT_ARG.split(',')) {
    const h = c.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (h.length !== 64) { fail('--cert inválido: "' + c + '" (precisa de 64 dígitos hexadecimais, SHA-256)'); continue; }
    out.push('        <item>' + h.match(/../g).join(':') + '</item>');
  }
  return out;
}
const CERT_BEGIN = '        <!-- GA20_ARENA_CERTS_BEGIN -->', CERT_END = '        <!-- GA20_ARENA_CERTS_END -->';
function withCerts(xml, items) {
  const a = xml.indexOf(CERT_BEGIN), b = xml.indexOf(CERT_END);
  if (a < 0 || b < a || xml.split(CERT_BEGIN).length !== 2) { fail('arena_config.xml: marcas GA20_ARENA_CERTS não encontradas'); return xml; }
  return xml.slice(0, a + CERT_BEGIN.length) + '\n' + items.map(x => x + '\n').join('') + xml.slice(b);
}

if (PP) {
  console.log('\n── PPSSPP: ' + PP);
  const MF = rel(PP, 'android/AndroidManifest.xml'), ACT = rel(PP, 'android/src/org/ppsspp/ppsspp/PpssppActivity.java');
  const SESSION = rel(PP, 'android/src/org/ppsspp/ppsspp/ArenaSession.java');
  if (!fs.existsSync(SESSION) || !(read(ACT) || '').includes('GA20_ARENA') || !(read(MF) || '').includes('com.gamearena.console.START_GAME')) {
    fail('Falta a Fase 20.2.1 neste clone (ArenaSession.java / GA20_ARENA). Aplica primeiro: node ~/Kiro-arquivos-/fase20-2-1/ga20-2-1.js');
  }
  const items = certItems();

  // ── Manifest ──
  edit(MF, 'GA20_ARENA_V2', m => {
    m = must(m, 'android:icon="@mipmap/ic_launcher"', 'android:icon="@mipmap/arena_ic_launcher"', 'M1 Manifest: ícone próprio do Arena Console', MF);
    m = mustRe(m, /([ \t]*)<intent-filter>\s*<action android:name="android\.intent\.action\.MAIN" \/>\s*<category android:name="android\.intent\.category\.LAUNCHER" \/>\s*<category android:name="android\.intent\.category\.LEANBACK_LAUNCHER" \/>\s*<\/intent-filter>/,
      (all, ind) => ind + '<!-- GA20_ARENA_V2: o ícone (MAIN/LAUNCHER) passou para o ArenaGateActivity ("Abre pela Game Arena"). -->',
      'M2 Manifest: PpssppActivity sem ícone (MAIN/LAUNCHER)', 'grep -n "LAUNCHER\\|intent-filter" ' + MF);
    m = mustRe(m, /([ \t]*)<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW" \/>[\s\S]*?<\/intent-filter>/,
      (all, ind) => ind + '<!-- GA20_ARENA_V2: sem abrir ISOs pelo gestor de ficheiros (só partidas da Game Arena). -->',
      'M3 Manifest: sem filtro VIEW (ficheiros)', 'grep -n "action.VIEW\\|intent-filter" ' + MF);
    m = mustRe(m, /([ \t]*)<activity\s+android:name="\.ShortcutActivity"\s+android:label="@string\/shortcut_name"\s+android:exported="true">\s*<intent-filter>\s*<category android:name="android\.intent\.category\.DEFAULT" \/>\s*<action android:name="android\.intent\.action\.CREATE_SHORTCUT" \/>\s*<\/intent-filter>\s*<\/activity>/,
      (all, ind) => ind + '<!-- GA20_ARENA_V2: sem atalhos para jogos soltos. -->\n' + ind + '<activity android:name=".ShortcutActivity" android:label="@string/shortcut_name" android:exported="false" />',
      'M4 Manifest: ShortcutActivity sem atalhos', 'grep -n "ShortcutActivity" -A8 ' + MF);
    m = mustRe(m, /(android:name="\.AchievementsHostOverrideReceiver"\s+)android:exported="true"/,
      (all, pre) => pre + 'android:exported="false"', 'M5 Manifest: receiver de conquistas não exportado', 'grep -n "AchievementsHostOverrideReceiver" -A2 ' + MF);
    m = must(m, '        <meta-data android:name="isGame" android:value="true" />',
      '        <meta-data android:name="isGame" android:value="true" />\n' +
      '        <!-- GA20_ARENA_V2: o ícone abre o portão "Abre pela Game Arena" (não carrega o emulador). -->\n' +
      '        <activity\n' +
      '            android:name=".ArenaGateActivity"\n' +
      '            android:exported="true"\n' +
      '            android:label="@string/app_name"\n' +
      '            android:launchMode="singleTask"\n' +
      '            android:theme="@android:style/Theme.Material.NoActionBar">\n' +
      '            <intent-filter>\n' +
      '                <action android:name="android.intent.action.MAIN" />\n' +
      '                <category android:name="android.intent.category.LAUNCHER" />\n' +
      '            </intent-filter>\n' +
      '        </activity>', 'M6 Manifest: ArenaGateActivity no ícone', MF);
    m = must(m, '    <supports-screens',
      '    <!-- GA20_ARENA_V2: ver a Game Arena (Android 11+) para verificar a assinatura e abri-la a partir do portão. -->\n' +
      '    <queries>\n' +
      '        <package android:name="com.gamearena" />\n' +
      '    </queries>\n\n' +
      '    <supports-screens', 'M7 Manifest: <queries> com.gamearena', MF);
    return m;
  });

  // ── PpssppActivity.java ──
  edit(ACT, 'GA20_ARENA_V2', a => {
    a = must(a,
      '\t\t\tArenaSession.current = arena;\n' +
      '\t\t\tif (arena.bootTarget != null) {\n' +
      '\t\t\t\treturn "\\"" + arena.bootTarget.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"";\n' +
      '\t\t\t}',
      '\t\t\t// GA20_ARENA_V2: a mesma partida com o jogo já a correr (Activity recriada): não volta a arrancar o jogo.\n' +
      '\t\t\tif (initialized && ArenaConfig.sameMatch(ArenaSession.current, arena)) {\n' +
      '\t\t\t\treturn null;\n' +
      '\t\t\t}\n' +
      '\t\t\tArenaSession.current = arena;\n' +
      '\t\t\tif (arena.bootTarget != null) {\n' +
      '\t\t\t\t// --pause-menu-exit --memstick=<pasta privada> --appendconfig=arena.ini (ArenaConfig.prepare no onCreate)\n' +
      '\t\t\t\tString arenaArgs = ArenaConfig.pendingArgs();\n' +
      '\t\t\t\treturn "\\"" + arena.bootTarget.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"" + (arenaArgs.isEmpty() ? "" : " " + arenaArgs);\n' +
      '\t\t\t}',
      'P1 PpssppActivity.parseIntent: arena.ini e sem reinício na mesma partida', ACT);
    a = must(a, '\t\ttakeOver();\n',
      '\t\t// GA20_ARENA_V2: o Arena Console só arranca com o Intent START_GAME da Game Arena (PendingIntent + certificado).\n' +
      '\t\t// Tudo o resto (outras apps, atalhos, ficheiros) vai para o portão "Abre pela Game Arena", sem tocar no C++.\n' +
      '\t\tArenaGuard.Result arenaCheck = ArenaGuard.check(this, getIntent());\n' +
      '\t\tif (arenaCheck.ok && !ArenaConfig.prepare(this, arenaCheck.session)) {\n' +
      '\t\t\tarenaCheck = new ArenaGuard.Result(false, ArenaGuard.R_STORAGE, arenaCheck.session, arenaCheck.launcherCerts);\n' +
      '\t\t}\n' +
      '\t\tif (!arenaCheck.ok) {\n' +
      '\t\t\tLog.w(TAG, "GameArena: Intent recusado (" + arenaCheck.reason + ")");\n' +
      '\t\t\tarenaRejected = true;\n' +
      '\t\t\tArenaGateActivity.open(this, arenaCheck);\n' +
      '\t\t\tfinish();\n' +
      '\t\t\treturn;\n' +
      '\t\t}\n\n' +
      '\t\ttakeOver();\n', 'P2 PpssppActivity.onCreate: portão antes de tocar no lado nativo', ACT);
    a = must(a, '\t\tLog.i(TAG, "onDestroy begin");',
      '\t\tif (arenaRejected) {\n' +
      '\t\t\treturn;  // GA20_ARENA_V2: recusado no onCreate, nunca tocou no lado nativo\n' +
      '\t\t}\n' +
      '\t\tLog.i(TAG, "onDestroy begin");', 'P3a PpssppActivity.onDestroy: Activity recusada sai logo', ACT);
    a = must(a, 'Log.i(TAG, "in onDestroy, shutting down. Calling NativeApp.shutdown().");',
      'Log.i(TAG, "in onDestroy, shutting down. Calling NativeApp.shutdown().");\n' +
      '\t\t\t\tArenaNet.stop();  // GA20_ARENA_V2: fecha a ponte de rede da partida\n' +
      '\t\t\t\tArenaSession.current = null;', 'P3b PpssppActivity.onDestroy: fecha a partida ao sair', ACT);
    a = must(a, '\t\tLog.i(TAG, "onNewIntent: " + intent.toString());',
      '\t\tLog.i(TAG, "onNewIntent: " + intent.toString());\n\n' +
      '\t\t// GA20_ARENA_V2: com o jogo a correr, outro Intent não arranca nada (só traz a partida para a frente).\n' +
      '\t\tif (!intent.hasExtra("request_id")) {\n' +
      '\t\t\tArenaUi.onNewIntentWhilePlaying(this, intent);\n' +
      '\t\t\treturn;\n' +
      '\t\t}', 'P4 PpssppActivity.onNewIntent: sem trocar de jogo a meio', ACT);
    a = must(a, '\t\t\t\tif (NativeApp.isAtTopLevel()) {',
      '\t\t\t\tif (ArenaSession.current != null) {\n' +
      '\t\t\t\t\t// GA20_ARENA_V2: no Arena Console, Voltar abre "Terminar a partida?" (nunca os menus do PPSSPP).\n' +
      '\t\t\t\t\tArenaUi.showExitDialog(PpssppActivity.this);\n' +
      '\t\t\t\t\treturn;\n' +
      '\t\t\t\t}\n' +
      '\t\t\t\tif (NativeApp.isAtTopLevel()) {', 'P5 PpssppActivity: Voltar = Terminar a partida', ACT);
    a = must(a, '\t\t} else if (command.equals("finish")) {',
      '\t\t} else if (command.equals("arena_exit")) {\n' +
      '\t\t\t// GA20_ARENA_V2: pausa/sair pedidos dentro do jogo (C++ com bArenaLocked).\n' +
      '\t\t\tArenaUi.showExitDialog(this);\n' +
      '\t\t\treturn true;\n' +
      '\t\t} else if (command.equals("arena_boot_done")) {\n' +
      '\t\t\tArenaUi.hideLoading(this);\n' +
      '\t\t\treturn true;\n' +
      '\t\t} else if (command.equals("finish")) {', 'P6 PpssppActivity.processCommand: arena_exit / arena_boot_done', ACT);
    a = must(a, '\t\tif (!initialized) {\n\t\t\tInitialize();\n\t\t\tinitialized = true;\n\t\t}\n',
      '\t\tif (!initialized) {\n\t\t\tInitialize();\n\t\t\tinitialized = true;\n\t\t}\n' +
      '\t\t// GA20_ARENA_V2: tranca menus/atalhos no C++ (depois de carregar a configuração) e liga a ponte de rede.\n' +
      '\t\tNativeApp.sendMessageFromJava("arena_lock", "1");\n' +
      '\t\tArenaNet.start(ArenaSession.current);\n', 'P7 PpssppActivity: arena_lock + ponte de rede', ACT);
    a = must(a, '\t\tsetContentView(mSurfaceView);',
      '\t\tsetContentView(mSurfaceView);\n' +
      '\t\tArenaUi.attach(this);  // GA20_ARENA_V2: ecrã de carregamento + avisos da partida', 'P8 PpssppActivity: ecrã de carregamento', ACT);
    a = must(a, '\tprivate boolean shuttingDown;',
      '\tprivate boolean shuttingDown;\n' +
      '\t// GA20_ARENA_V2: o Intent não era da Game Arena; esta Activity fechou-se no onCreate sem iniciar nada.\n' +
      '\tprivate boolean arenaRejected = false;', 'P9 PpssppActivity: campo arenaRejected', ACT);
    return a;
  });

  // ── strings.xml ──
  const STR = rel(PP, 'android/res/values/strings.xml');
  const block = read(path.join(TPL, 'strings-arena.xml.txt'));
  edit(STR, 'GA20_ARENA', s => {
    s = must(s, '<string name="app_name">PPSSPP</string>', '<string name="app_name">Arena Console</string>', 'S1 strings.xml: nome Arena Console', STR);
    s = must(s, '<string name="shortcut_name">PPSSPP game</string>\n',
      '<string name="shortcut_name">Arena Console</string>\n\n' + (block || ''), 'S2 strings.xml: textos do portão e da partida', STR);
    return s;
  });

  // ── build.gradle.kts ──
  const GR = rel(PP, 'android/build.gradle.kts');
  edit(GR, 'GA20_ARENA', g => {
    g = must(g, '\t\tcreate("normal") {\n\t\t\tisDefault = true\n\t\t\tapplicationId = "org.ppsspp.ppsspp"',
      '\t\tcreate("normal") {\n\t\t\tisDefault = true\n' +
      '\t\t\t// GA20_ARENA: Arena Console instala-se ao lado do PPSSPP oficial. O namespace (org.ppsspp.ppsspp) fica: o JNI depende dele.\n' +
      '\t\t\tapplicationId = "com.gamearena.console"', 'G1 build.gradle.kts: applicationId com.gamearena.console', GR);
    g = must(g, '\timplementation("com.google.protobuf:protobuf-javalite:4.35.1")\n',
      '\timplementation("com.google.protobuf:protobuf-javalite:4.35.1")\n' +
      '\t// GA20_ARENA: ponte de rede do Arena Console (Socket.IO até ao servidor da Game Arena). O Android já traz o org.json.\n' +
      '\timplementation("io.socket:socket.io-client:2.1.2") {\n' +
      '\t\texclude(group = "org.json", module = "json")\n' +
      '\t}\n', 'G2 build.gradle.kts: socket.io-client 2.1.2', GR);
    return g;
  });

  // ── C++ (Fase 20.2.4) ──
  const CH = rel(PP, 'Core/Config.h');
  edit(CH, 'GA20_ARENA', c => must(c, '\tbool bAllowSpeedControlWhileConnected;  // Useful in some games but not recommended.',
    '\tbool bAllowSpeedControlWhileConnected;  // Useful in some games but not recommended.\n' +
    '\tbool bArenaLocked = false;  // GA20_ARENA: Arena Console (só em memória, posto pelo Java com "arena_lock").', 'C1 Config.h: bArenaLocked', CH));
  const SH = rel(PP, 'Common/System/System.h');
  edit(SH, 'GA20_ARENA', c => must(c, '\tEXTERNAL_DISPLAY_CHANGED,  // g_Config.iExternalDisplay changed.\n};',
    '\tEXTERNAL_DISPLAY_CHANGED,  // g_Config.iExternalDisplay changed.\n' +
    '\tARENA_EXIT_REQUEST,  // GA20_ARENA: pausa/sair no Arena Console. O Android mostra o diálogo "Terminar a partida?".\n};', 'C2 System.h: ARENA_EXIT_REQUEST', SH));
  const AA = rel(PP, 'android/jni/app-android.cpp');
  edit(AA, 'GA20_ARENA', c => {
    c = must(c, '\t} else if (msg == "softKeyboardHidden") {',
      '\t} else if (msg == "arena_lock") {\n' +
      '\t\t// GA20_ARENA: Arena Console. Sem menus/atalhos (EmuScreen) e sem opções que mudam o jogo.\n' +
      '\t\tg_Config.bArenaLocked = (prm == "1");\n' +
      '\t\tif (g_Config.bArenaLocked) {\n' +
      '\t\t\tg_Config.bEnableCheats = false;\n' +
      '\t\t\tg_Config.iRewindSnapshotInterval = 0;\n' +
      '\t\t\tg_Config.bEnableStateUndo = false;\n' +
      '\t\t\tg_Config.bAllowSavestateWhileConnected = false;\n' +
      '\t\t\tg_Config.bAllowSpeedControlWhileConnected = false;\n' +
      '\t\t\tg_Config.bEnableNetworkChat = false;\n' +
      '\t\t\tg_Config.bShowDeveloperMenu = false;\n' +
      '\t\t\tg_Config.bShowImDebugger = false;\n' +
      '\t\t\tg_Config.iAdhocSimDelayMs = 0;\n' +
      '\t\t\tg_Config.iAdhocSimJitterMs = 0;\n' +
      '\t\t\tg_Config.iAdhocSimLossPercent = 0;\n' +
      '\t\t}\n' +
      '\t} else if (msg == "softKeyboardHidden") {', 'C3 app-android.cpp: mensagem arena_lock', AA);
    c = must(c, '\tcase SystemNotification::AUDIO_MODE_CHANGED:\n\t\tPushCommand("audio_mode_changed", "");\n\t\tbreak;\n',
      '\tcase SystemNotification::AUDIO_MODE_CHANGED:\n\t\tPushCommand("audio_mode_changed", "");\n\t\tbreak;\n' +
      '\tcase SystemNotification::BOOT_DONE:  // GA20_ARENA: esconde o ecrã de carregamento do Arena Console\n' +
      '\t\tPushCommand("arena_boot_done", "");\n' +
      '\t\tbreak;\n' +
      '\tcase SystemNotification::ARENA_EXIT_REQUEST:  // GA20_ARENA: pausa/sair -> diálogo Java "Terminar a partida?"\n' +
      '\t\tPushCommand("arena_exit", "");\n' +
      '\t\tbreak;\n', 'C4 app-android.cpp: BOOT_DONE / ARENA_EXIT_REQUEST para o Java', AA);
    return c;
  });
  const EM = rel(PP, 'UI/EmuScreen.cpp');
  edit(EM, 'GA20_ARENA', e => {
    e = must(e, 'void EmuScreen::ProcessVKey(VirtKey virtKey, bool down) {\n',
      'void EmuScreen::ProcessVKey(VirtKey virtKey, bool down) {\n' +
      '\t// GA20_ARENA: no Arena Console só passam teclas que não mudam o jogo (sem menus, estados, velocidade, rewind, dev).\n' +
      '\tif (g_Config.bArenaLocked) {\n' +
      '\t\tswitch (virtKey) {\n' +
      '\t\tcase VIRTKEY_SCREENSHOT:\n' +
      '\t\tcase VIRTKEY_TOGGLE_TILT:\n' +
      '\t\tcase VIRTKEY_AXIS_SWAP_TOGGLE:\n' +
      '\t\tcase VIRTKEY_TOGGLE_MOUSE:\n' +
      '\t\tcase VIRTKEY_MUTE_TOGGLE:\n' +
      '\t\tcase VIRTKEY_SCREEN_ROTATION_VERTICAL:\n' +
      '\t\tcase VIRTKEY_SCREEN_ROTATION_VERTICAL180:\n' +
      '\t\tcase VIRTKEY_SCREEN_ROTATION_HORIZONTAL:\n' +
      '\t\tcase VIRTKEY_SCREEN_ROTATION_HORIZONTAL180:\n' +
      '\t\tcase VIRTKEY_TOGGLE_FULLSCREEN:\n' +
      '\t\tcase VIRTKEY_TOGGLE_TOUCH_CONTROLS:\n' +
      '\t\t\tbreak;\n' +
      '\t\tcase VIRTKEY_PAUSE:\n' +
      '\t\tcase VIRTKEY_EXIT_APP:\n' +
      '\t\t\tif (down) {\n' +
      '\t\t\t\tSystem_Notify(SystemNotification::ARENA_EXIT_REQUEST);\n' +
      '\t\t\t}\n' +
      '\t\t\treturn;\n' +
      '\t\tdefault:\n' +
      '\t\t\treturn;\n' +
      '\t\t}\n' +
      '\t}\n', 'C5 EmuScreen.cpp: atalhos bloqueados (save/load/rewind/velocidade/dev/chat)', EM);
    e = must(e, '\tif (pauseTrigger_) {\n\t\tpauseTrigger_ = false;\n\t\tscreenManager()->push(new GamePauseScreen(gamePath_, bootPending_));\n\t}',
      '\tif (pauseTrigger_) {\n\t\tpauseTrigger_ = false;\n' +
      '\t\tif (g_Config.bArenaLocked) {\n' +
      '\t\t\tSystem_Notify(SystemNotification::ARENA_EXIT_REQUEST);  // GA20_ARENA: sem menu de pausa\n' +
      '\t\t} else {\n' +
      '\t\t\tscreenManager()->push(new GamePauseScreen(gamePath_, bootPending_));\n' +
      '\t\t}\n\t}', 'C6 EmuScreen.cpp: botão de pausa -> Terminar a partida', EM);
    e = must(e, '\tif (message == UIMessage::REQUEST_GAME_PAUSE && screenManager()->topScreen() == this) {\n\t\tscreenManager()->push(new GamePauseScreen(gamePath_, bootPending_));\n',
      '\tif (message == UIMessage::REQUEST_GAME_PAUSE && screenManager()->topScreen() == this) {\n' +
      '\t\tif (g_Config.bArenaLocked) {\n' +
      '\t\t\tSystem_Notify(SystemNotification::ARENA_EXIT_REQUEST);  // GA20_ARENA: sem menu de pausa\n' +
      '\t\t\treturn;\n' +
      '\t\t}\n' +
      '\t\tscreenManager()->push(new GamePauseScreen(gamePath_, bootPending_));\n', 'C7 EmuScreen.cpp: REQUEST_GAME_PAUSE sem menu', EM);
    e = must(e, '\t\t\t\tif (!equals(value, "first")) {\n\t\t\t\t\tscreenManager()->push(new GamePauseScreen(gamePath_, bootPending_));',
      '\t\t\t\tif (!equals(value, "first") && !g_Config.bArenaLocked) {  // GA20_ARENA\n\t\t\t\t\tscreenManager()->push(new GamePauseScreen(gamePath_, bootPending_));',
      'C8 EmuScreen.cpp: sem menu de pausa automático na TV', EM);
    e = must(e, '\tif (virtualKeyCode != VIRTKEY_SPEED_ANALOG) {\n\t\treturn;\n\t}\n',
      '\tif (virtualKeyCode != VIRTKEY_SPEED_ANALOG) {\n\t\treturn;\n\t}\n' +
      '\tif (g_Config.bArenaLocked) {\n\t\treturn;  // GA20_ARENA: sem velocidade analógica\n\t}\n', 'C9 EmuScreen.cpp: sem velocidade analógica', EM);
    return e;
  });

  // ── README (GPL) ──
  const RD = rel(PP, 'README.md');
  const readmeHead = read(path.join(TPL, 'README-arena.md.txt'));
  edit(RD, 'GA20_ARENA', r => must(r, 'PPSSPP - a fast and portable PSP emulator\n', (readmeHead || '') + 'PPSSPP - a fast and portable PSP emulator\n', 'R1 README.md: atribuição Arena Console / PPSSPP', RD));

  // ── ficheiros novos ──
  for (const f of ['ArenaGuard', 'ArenaConfig', 'ArenaNet', 'ArenaUi', 'ArenaGateActivity']) addNew(PP, 'android/src/org/ppsspp/ppsspp/' + f + '.java');
  for (const f of ['android/res/drawable/arena_ic_launcher_fg.xml', 'android/res/mipmap-anydpi-v26/arena_ic_launcher.xml', 'android/res/mipmap-anydpi/arena_ic_launcher.xml',
    'ARENA.md', '.github/workflows/arena-android.yml']) addNew(PP, f);
  // arena_config.xml: novo com os certificados, ou só atualizar os certificados
  const CFG = rel(PP, 'android/res/values/arena_config.xml');
  const cfgTpl = read(path.join(FILES, 'android/res/values/arena_config.xml'));
  if (fs.existsSync(CFG)) {
    if (items) {
      const cur = fs.readFileSync(CFG, 'utf8'), upd = withCerts(cur, items);
      if (upd !== cur) { console.log('✓ arena_config.xml: certificados atualizados (' + items.length + ')'); plan.push({ file: CFG, body: upd, bak: true }); }
      else console.log('= arena_config.xml: certificados já iguais');
    } else console.log('= arena_config.xml já existe (sem --cert, não mexo)');
  } else if (cfgTpl != null) {
    addNew(PP, 'android/res/values/arena_config.xml', items ? withCerts(cfgTpl, items) : cfgTpl);
    if (!items) console.log('  ⚠ sem --cert: o Arena Console vai recusar todas as partidas até configurares o certificado da Game Arena.');
  }
}

/* ════════════════════════════════════════ Arenaapk (servidor + Launcher) ════════════════════════════════════════ */
if (GA) {
  console.log('\n── Arenaapk: ' + GA);
  addNew(GA, 'backend/services/console-adhoc.js');
  const NS = rel(GA, 'backend/services/console-namespace.js');
  const nsNew = read(path.join(FILES, 'backend/services/console-namespace.js'));
  const nsCur = read(NS);
  if (nsCur != null && nsNew != null) {
    if (nsCur === nsNew) console.log('= console-namespace.js já é a versão 20.2 (salto)');
    else if (sha(nsCur) === V1_NAMESPACE_SHA256) { console.log('✓ console-namespace.js: 20.1 -> 20.2 (túnel, DNF, resultado)'); plan.push({ file: NS, body: nsNew, bak: true }); }
    else fail('console-namespace.js não é o da 20.1 (foi alterado). Não substituo. Mostra-me: git diff backend/services/console-namespace.js');
  }
  const WS = rel(GA, 'backend/services/websocket.js');
  edit(WS, "hook(supabase, 'console')", w => must(w, "require('./console-namespace')(io);",
    "require('./console-namespace')(io, { onFinish: (() => { try { return require('./ga16MatchReport').hook(supabase, 'console'); } catch (e) { console.warn('[WS-CONSOLE] GA16 hook indisponível:', e.message); return null; } })() });",
    "W1 websocket.js: resultado da consola no GA16 (GA20_ARENA)", WS));
  const KT = rel(GA, 'app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt');
  edit(KT, 'GA20_ARENA', k => {
    k = must(k, '        const val EXTRA_ROM = "rom_path"\n',
      '        const val EXTRA_ROM = "rom_path"\n' +
      '        private const val CONSOLE_PACKAGE = "com.gamearena.console" // GA20_ARENA: só o Arena Console oficial recebe a partida\n', 'K1 ConsoleLobbyActivity: pacote do Arena Console', KT);
    k = must(k, '            addCategory(Intent.CATEGORY_DEFAULT)\n',
      '            addCategory(Intent.CATEGORY_DEFAULT)\n' +
      '            setPackage(CONSOLE_PACKAGE)               // GA20_ARENA: nenhuma outra app recebe o token nem a ISO\n' +
      '            putExtra("arena_auth", ga20Auth())        // GA20_ARENA: prova de que vem da Game Arena (getCreatorPackage)\n', 'K2 ConsoleLobbyActivity: setPackage + arena_auth', KT);
    k = must(k, '    override fun onDestroy() {\n',
      '    /** GA20_ARENA: PendingIntent nunca enviado; o Arena Console lê getCreatorPackage() e verifica a assinatura desta app. */\n' +
      '    private fun ga20Auth(): android.app.PendingIntent {\n' +
      '        val flags = if (android.os.Build.VERSION.SDK_INT >= 23) android.app.PendingIntent.FLAG_IMMUTABLE else 0\n' +
      '        return android.app.PendingIntent.getActivity(this, 2020, Intent(this, ConsoleLobbyActivity::class.java), flags)\n' +
      '    }\n\n' +
      '    override fun onDestroy() {\n', 'K3 ConsoleLobbyActivity: função ga20Auth', KT);
    return k;
  });
}

/* ════════════════════════════════════════ escrever (tudo ou nada) ════════════════════════════════════════ */
if (fails) { console.error('\n✗ ' + fails + ' problema(s). NÃO escrevi nada.'); process.exit(1); }
if (!plan.length) { console.log('\nNada a fazer: já está tudo aplicado.'); process.exit(0); }
for (const w of plan) {
  if (w.bak) fs.copyFileSync(w.file, w.file + '.bak');
  fs.mkdirSync(path.dirname(w.file), { recursive: true });
  fs.writeFileSync(w.file, w.body);
}
console.log('\n✓ Aplicado (' + plan.length + ' ficheiro(s)). Cópias de segurança: *.bak (não as commits).');
for (const [root, name] of [[PP, 'PPSSPP'], [GA, 'Arenaapk']]) {
  if (!root) continue;
  const mine = plan.filter(w => w.file.startsWith(root + path.sep)).map(w => path.relative(root, w.file));
  if (mine.length) console.log('  ' + name + ':  cd ' + root + ' && git add ' + mine.join(' '));
}
