# Fase 20.1: Arena Console (PSP) no Launcher

## Aplicar (Termux)
```
cd ~/Kiro-arquivos- && git pull
cd ~/Arenaapk
node ~/Kiro-arquivos-/fase20-1/ga20-1.js
```
O script corre na raiz do Arenaapk e lê os ficheiros novos de `~/Kiro-arquivos-/fase20-1/files/`. No fim imprime a linha `git add` exata. Com o ficheiro de entrada do servidor em `backend/server.js`, fica assim:
```
git add app/src/main/java/com/gamearena/ui/GamesActivity.kt app/src/main/AndroidManifest.xml backend/server.js \
  app/src/main/java/com/gamearena/ui/Ga20Console.kt app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt \
  app/src/main/res/xml/console_file_paths.xml backend/services/console-namespace.js backend/public/games/console/lobby.html
git commit -m "Fase 20.1: Arena Console - upload ISO, sala Host/Guest e Intent START_GAME"
git push arena rooms-client-validation:rooms-client-validation
```
Se alguma âncora falhar, o script não escreve nada e mostra o `grep` que deves mandar-me.
Se não encontrar o ficheiro de entrada do servidor, manda-me:
`grep -rn "neonrush-namespace\|attachHockeyP2P" backend --include=*.js | grep -v node_modules`

## O que muda
**Ficheiros novos**
- `Ga20Console.kt`: painel da aba Console, biblioteca de jogos e `Ga20ConsoleFileProvider`.
- `ConsoleLobbyActivity.kt`: a sala numa WebView e o Intent para o emulador.
- `res/xml/console_file_paths.xml`: só a pasta `roms/` fica partilhada.
- `backend/services/console-namespace.js`: Socket.IO `/console`, com sala 1x1 e sinalização do emulador.
- `backend/public/games/console/lobby.html`: o ecrã da sala.

**Edições com âncora**
- `GamesActivity.kt`, 3 edições:
  - o seletor `OpenDocument`;
  - "🔒 Console" passa a "🎮 Console";
  - uma linha antes de `if (currentFilter == Filter.CONSOLE) {`. Se o painel novo falhar, o cadeado antigo (`ga3RenderConsoleLocked`) continua a aparecer. A lista Mobile e os jogos HTML não são tocados.
- `AndroidManifest.xml`: a `ConsoleLobbyActivity` e o provider `${applicationId}.console.fileprovider`. O provider do OTA fica como está.
- Entrada do servidor: `require('./services/console-namespace')(io)` na linha antes do NeonRush.

## Fluxo
1. Na aba **Console**, carregas em **Carregar jogo (ISO)** e escolhes o ficheiro (`.iso`, `.cso` ou `.pbp`).
2. O ficheiro é copiado para `Android/data/<app>/files/Documents/roms/`:
   - primeiro para um ficheiro `.part`, com barra de progresso;
   - antes de copiar, verifica se há espaço livre;
   - confirma que é mesmo um jogo PSP: "CD001" na ISO, "CISO"/"ZISO" no CSO, "\0PBP" no PBP;
   - calcula a impressão digital.
3. Na biblioteca, um toque abre a sala e um toque longo apaga o jogo.
4. Na sala:
   - o Host carrega em **Criar sala** e partilha o código de 6 caracteres;
   - o Guest escreve o código e carrega em **Entrar**;
   - os dois carregam em **Estou pronto**;
   - só o Host vê **Iniciar partida**. O botão só fica ativo com os 2 prontos e a mesma ISO (o servidor também bloqueia com `rom_mismatch`).
5. O servidor envia `console_start` aos dois. O Launcher abre `com.gamearena.console.START_GAME` com os dados descritos em `CONTRATO-ARENA-CONSOLE.md`. Se o emulador ainda não estiver instalado, aparece "Arena Console não instalado" e o botão **Tentar outra vez**.

## Porquê assim
- **`iso_uri` além do `iso_path`:** no Android 11+, outra app não consegue ler `/Android/data/...` só com o caminho. Por isso a ISO vai também por `content://`, com permissão de leitura temporária. O `iso_path` vai na mesma, como pediste.
- **Sala em HTML:** usa o mesmo Socket.IO (`path: '/ws'`) dos outros jogos e não precisa de nenhuma biblioteca nova no Android.
- **`peer_id` aleatório gerado pelo servidor** (16 hex), com `start_token` secreto: o emulador só entra na partida certa.

## Testado
- **Script** num repo de teste:
  - aplica as 3 + 1 + 1 edições e os 5 ficheiros novos;
  - na 2.ª vez não faz nada;
  - com uma âncora em falta não escreve nada.
- **Servidor** com sockets simulados:
  - criar e entrar na sala, `bad_code`, `bad_rom`, `not_found`, `full`, `started`, `not_ready`, `not_host`, `rom_mismatch`;
  - `console_start` com os ids cruzados certos;
  - `emu_join` (`bad_token`, `bad_peer`), `emu_signal` (sinal inválido bloqueado), `emu_peer`;
  - `emu_result`: só conta quando os dois coincidem;
  - o Host sair fecha a sala.
- **Sala no Chrome** (2 páginas + servidor simulado):
  - ISOs diferentes mostram o aviso e bloqueiam o início;
  - o Guest sai e volta com a ISO certa;
  - Partilhar funciona;
  - Iniciar envia ao Android, nos dois lados, dados que passam a validação do Kotlin;
  - "não instalado" mostra Tentar outra vez.

## Limitações
- **Kotlin não compilado:** aqui não há Android SDK. Revi à mão os imports e o equilíbrio de chavetas e parênteses. Se o build no Actions falhar, manda-me o erro.
- **Token:** o servidor não verifica o token no `/console`, tal como no NeonRush. O resultado ainda não chega ao GA16, porque o `onFinish` só vai ser ligado na Fase 20.2.
- **Ainda não incluído:** abrir a sala por link (deep link) com o código.
