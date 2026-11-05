# Fases 20.2.2 a 20.2.5: Arena Console fechado + netplay pela Game Arena

Um único script aplica tudo nos dois repositórios: o fork do PPSSPP e o Arenaapk. É tudo ou nada: se uma âncora falhar, não escreve nada e mostra o `grep` que deves mandar-me.

## 0. Antes
- A 20.1 tem de estar aplicada no Arenaapk e a 20.2.1 no clone do PPSSPP. O script confirma.
- **Certificado da Game Arena (SHA-256):** é a forma de o Arena Console saber que a partida vem da tua Game Arena.
  - Se o souberes, passa-o em `--cert=`.
  - Se não o souberes, aplica sem `--cert` e compila. Depois abre uma partida na Game Arena: o Arena Console recusa-a e o ecrã "Abre pela Game Arena" mostra o certificado, com o botão **Copiar certificado**. A seguir corre só:
    `node ~/Kiro-arquivos-/fase20-2-completo/ga20-2-completo.js --ppsspp=~/ppsspp --cert=<colado>`
  - Alternativa no Termux: `pkg install openjdk-17` e depois `keytool -printcert -jarfile GameArena.apk | grep SHA256`.
- ⚠ **A Game Arena tem de ser assinada sempre com a mesma chave.** Se o GitHub Actions do Arenaapk gerar uma chave de debug nova em cada build, o certificado muda e o Arena Console recusa as partidas. Usa uma keystore fixa nos secrets, como no ponto 4.

## 1. Aplicar (Termux)
```
cd ~/Kiro-arquivos- && git pull
node ~/Kiro-arquivos-/fase20-2-completo/ga20-2-completo.js --ppsspp=~/ppsspp --arenaapk=~/Arenaapk --cert=AA:BB:...
```
No fim, o script imprime as duas linhas `git add` exatas.

**Arenaapk:**
```
cd ~/Arenaapk
git add backend/services/console-adhoc.js backend/services/console-namespace.js backend/services/websocket.js app/src/main/java/com/gamearena/ui/ConsoleLobbyActivity.kt
git commit -m "Arena Console 20.2: tunel ad hoc, DNF e resultado no GA16, Intent verificado"
git push arena rooms-client-validation:rooms-client-validation
```

**PPSSPP:** usa a lista do script, que inclui os ficheiros C++, `ARENA.md` e `.github/workflows/arena-android.yml`. O push vai para o fork (ponto 4).

Não faças commit dos `*.bak`.

## 2. O que faz cada parte

### 20.2.2: app fechada
- **Ícone:** abre o `ArenaGateActivity`, com "Abre pela Game Arena" e os botões Abrir a Game Arena, Voltar à partida (se houver uma a decorrer) e Fechar. Mostra também a atribuição GPL e o link para o código fonte. Este ecrã não carrega o emulador.
- **`PpssppActivity`:** perdeu o ícone, o filtro de ficheiros (VIEW) e os atalhos. Só arranca com `START_GAME` da `com.gamearena`. Como o Arena Console sabe que o Intent vem da Game Arena:
  - o Launcher junta ao Intent um `PendingIntent` (`arena_auth`);
  - `getCreatorPackage()` dá o pacote que o criou, e o Android não deixa outra app falsificar este valor;
  - o Arena Console verifica o certificado SHA-256 da app instalada com esse pacote.

  Isto funciona em todas as versões do Android. Qualquer outro Intent vai para o portão antes de o C++ arrancar.
- **No jogo:**
  - Voltar, o botão de pausa e a tecla de pausa do comando abrem **"Terminar a partida?"**, com as opções Ganhei, Perdi/Desistir e Continuar;
  - os menus do PPSSPP nunca aparecem;
  - ao arrancar, mostra um ecrã de carregamento "Arena Console" até o jogo começar.
- **Configuração automática** (`arena.ini` por partida, passado com `--appendconfig`):
  - desliga cheats, rewind, desfazer save, depurador remoto, chat e simulação de rede;
  - liga o ad hoc com relay em `127.0.0.1`, com um MAC único por jogador e partida;
  - `--memstick` aponta para a pasta privada da app (sem o ecrã de escolha de pasta);
  - `--pause-menu-exit` fecha a app se o jogo terminar.
- **Nome e pacote:** "Arena Console" com ícone próprio, `applicationId com.gamearena.console`. O `namespace` `org.ppsspp.ppsspp` fica igual, porque o JNI depende dele.

### 20.2.3: netplay (opção C)
- **Ponte no telemóvel (`ArenaNet`):** abre `127.0.0.1:27312` (adhocctl) e `127.0.0.1:27313` (aemu_postoffice). Passa cada ligação do PPSSPP por Socket.IO (`/console`, `tun_*`) depois de `emu_join` com o `start_token`.
- **Servidor (`console-adhoc.js`):** faz de servidor adhocctl + relay postoffice, uma instância por sala, só com os 2 jogadores.
- **Resultado:**
  - "Perdi / Desistir" conta logo;
  - "Ganhei" só conta quando o adversário confirmar;
  - quem sai a meio e não volta em 120 s perde (DNF);
  - o resultado vai para o GA16 (`onFinish`), como no NeonRush.

  Contrato em `CONTRATO-ARENA-CONSOLE-v2.md`.

### 20.2.4: patch C++ (4 ficheiros)
Eram 3 no plano. Ficaram 4 porque o Java precisa de um evento novo.
- **`Core/Config.h`:** `bArenaLocked` (só em memória).
- **`Common/System/System.h`:** `SystemNotification::ARENA_EXIT_REQUEST`.
- **`android/jni/app-android.cpp`:**
  - mensagem `arena_lock`, que liga o bloqueio e volta a forçar as opções de integridade;
  - `BOOT_DONE` e `ARENA_EXIT_REQUEST` passam a ser enviados ao Java.
- **`UI/EmuScreen.cpp`:**
  - com o bloqueio ativo, só passam teclas inofensivas (captura de ecrã, rotação, som, controlos no ecrã);
  - save/load, slots, rewind, avanço rápido, velocidade (também a analógica), reset, frame advance, gravação, menu de programador, chat e Wi-Fi ficam bloqueados;
  - a pausa vira "Terminar a partida?".

  O `UI/PauseScreen.cpp` não precisa de alterações, porque o menu de pausa nunca é aberto.

### 20.2.5: fork GPL
- **`LICENSE.TXT`:** fica igual (GPL 2.0+, sem alterações).
- **`README.md`:** ganha no topo a secção "Arena Console", com a atribuição a Henrik Rydgård e contribuidores (GPL 2.0+). O README original continua por baixo.
- **`ARENA.md`:** lista tudo o que mudou e as licenças. Nota: o PPSSPP já inclui o `aemu_postoffice` (GPL 3.0), por isso o APK segue também a GPL 3.0.
- **Ficheiros alterados:** levam a marca `GA20_ARENA`. Os novos levam o cabeçalho GPL.

## 3. Testado
- **Servidor ad hoc com os testes oficiais do aemu:** compilei os clientes C do `aemu_postoffice`, a mesma biblioteca que o PPSSPP usa para o relay. Os testes passaram contra o `console-adhoc.js`, com os dados partidos em pedaços aleatórios:
  - PDP: substituir sessão, a→b, b→c, a→c, c→a, pacote de 0 bytes;
  - PTP: listen, connect, accept nos dois sentidos, dados e fecho;
  - adhocctl: login, grupo, BSSID, scan, chat.
- **Ponta a ponta com a ponte Java verdadeira** (compilei o socket.io-client 2.1.2, o OkHttp 3.12.12 e o okio a partir do código fonte), passando pelo `console-namespace.js` real:
  - testes C do aemu → `ArenaNet` (127.0.0.1:27312/27313) → Socket.IO com binário → servidor → hub: os dois testes passaram;
  - "Perdi" chega ao GA16 como `winnerSeat 1`;
  - um token errado dá `emu_error bad_token`.
- **Namespace com sockets simulados:**
  - adhocctl entre os 2 jogadores;
  - PDP host→guest;
  - isolamento entre salas;
  - desistência imediata;
  - vitória contestada não conta;
  - DNF;
  - voltar a tempo não dá DNF;
  - regressão da 20.1.
- **Java:** todo o pacote `org.ppsspp.ppsspp` (com o `PpssppActivity` alterado) compila com `javac` e o `android.jar` API 37, com 0 erros e 0 avisos nos ficheiros Arena. Só o androidx e as classes geradas (R, BuildConfig, protobuf) usaram stubs.
- **C++:** o `EmuScreen.cpp` alterado compila com `clang++ -fsyntax-only` e os headers reais do PPSSPP. No `app-android.cpp`, o meu código compila sem erros. Os únicos erros vêm de headers do NDK que não existem aqui. Confirmei que o compilador analisa mesmo o código novo: injetei erros de propósito e foram todos detetados.
- **Script:**
  - aplica as 35 edições e os 12 ficheiros novos, e substitui o `console-namespace.js`;
  - na 2.ª vez não faz nada;
  - com `--cert` sozinho atualiza só o certificado;
  - com uma âncora em falta não escreve nada;
  - sem a 20.2.1 recusa.

## 4. Fork no GitHub e branch `arena`
1. **Criar o fork:** no GitHub, **Fork** de `hrydgard/ppsspp` para `fortune3010`. Muda o nome para `arena-console`, que é o link já em `arena_config.xml`; se usares outro nome, muda esse valor.
2. **No Termux:**
   ```
   cd ~/ppsspp
   git remote rename origin upstream
   git remote add origin https://github.com/fortune3010/arena-console.git
   git checkout -b arena
   git add <lista do script> && git commit -m "Arena Console: app fechada, netplay Game Arena, patch C++ (GA20_ARENA)"
   git push -u origin arena
   ```
3. **Chave do Arena Console**, só uma vez, e guarda-a bem: sem ela não consegues publicar atualizações.
   ```
   pkg install openjdk-17
   keytool -genkeypair -v -keystore arena.jks -alias arena -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 arena.jks > arena.jks.b64
   ```
   Em Settings → Secrets → Actions, cria `ARENA_KEYSTORE_BASE64` (conteúdo do `.b64`), `ARENA_KEYSTORE_PASSWORD`, `ARENA_KEY_ALIAS` (`arena`) e `ARENA_KEY_PASSWORD`.
4. **Workflows:** em Settings → Actions, desliga os workflows do upstream (`Build`, `Manual Generate *`, `tarball`, `appimage`, `generateDockerLayer`). Fica só o **Arena Console APK**, que corre em cada push para `arena` e em tags `arena-v*`.
5. **Proteger o branch:** em Settings → Branches → Add rule `arena`:
   - Block force pushes;
   - Restrict deletions;
   - opcional: Require status checks → "Arena Console APK".

   Não ative "Require a pull request" se fazes push direto do Termux.
6. **Cada versão publicada:** `git tag arena-v1.0.0 && git push origin arena-v1.0.0`. O código de cada APK fica assim disponível, como a GPL exige.

## 5. Limitações e o que preciso de ti
- **Sem build Android completo aqui** (Gradle + NDK). O Java e o C++ foram verificados como descrevi acima, e o Kotlin (3 linhas no `ConsoleLobbyActivity.kt`) foi revisto à mão. Se o build no Actions falhar, manda-me o erro.
- **Nome do jogo no GA16:** o `onFinish` usa `hook(supabase, 'console')`. Confirma que o GA16 aceita esse nome:
  `grep -n "neonrush\|hockey\|gameId\|game ===" backend/services/ga16MatchReport.js | head -20`
- **Latência:** todo o tráfego ad hoc passa pelo Render (opção C). Para o Dragon Ball tem de ser testado em 2 telemóveis reais. Se houver lag, o passo seguinte é a opção A (relay numa VPS perto dos jogadores).
- **Ligação perdida:** se o Socket.IO cair, a ponte fecha as ligações do PPSSPP e volta a ligar. O jogo pode perder a sessão ad hoc. Nesse caso conta o DNF: 120 s para voltar.
- **"Ganhei" sem confirmação:** se o adversário nunca confirmar, a partida fica em análise, sem resultado.
- **O que isto não impede:** o código é público (GPL), por isso quem compilar uma versão alterada e assinar com outra chave pode fazer batota no próprio telemóvel. O certificado só garante que a Game Arena oficial é que abre a partida. A defesa real está no servidor: token por partida, resultado confirmado pelos dois e DNF.
