# Fase 20.2.1: o fork do PPSSPP recebe o Intent da GameArena

## Aviso: o contexto chegou vazio
O `opus_ppsspp_contexto.txt` só tinha os 3 títulos, sem conteúdo. Os caminhos que lá estavam também não existem no PPSSPP:

| Pedido | No PPSSPP real |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | `android/AndroidManifest.xml` |
| `MainActivity.java` | `android/src/org/ppsspp/ppsspp/PpssppActivity.java` (2363 linhas) |
| `NativeApp.launchGame(...)` | não existe. O PPSSPP arranca jogos pelo `shortcutParam` |

Por isso trabalhei sobre o PPSSPP oficial (`hrydgard/ppsspp`, commit `f82a875`, de 5/11/2026). As âncoras saíram desse código, não foram escritas de memória. Se o teu clone for diferente, o script falha sem escrever nada e mostra o `grep` que deves mandar-me.

## Aplicar (Termux, na raiz do clone do PPSSPP)
```
cd ~/Kiro-arquivos- && git pull
cd ~/ppsspp                      # a pasta do teu clone, onde está android/
git log -1 --format='%h %cd'     # manda-me isto se o script falhar
node ~/Kiro-arquivos-/fase20-2-1/ga20-2-1.js
git add android/AndroidManifest.xml android/src/org/ppsspp/ppsspp/PpssppActivity.java android/src/org/ppsspp/ppsspp/ArenaSession.java
git commit -m "Arena Console: receber o Intent com.gamearena.console.START_GAME"
```
Não faças commit dos `*.bak`.

A pasta `completos/` tem os 3 ficheiros inteiros, já com as alterações aplicadas sobre o `f82a875`. Servem só para leres ou compares. Não os copies por cima dos teus se o teu clone for de outra versão: usa o script.

## O que muda
- **`AndroidManifest.xml` (M1):** um `intent-filter` novo no `PpssppActivity`, com a action `com.gamearena.console.START_GAME` e a categoria `DEFAULT`. O filtro VIEW de ficheiros continua igual.
- **`PpssppActivity.java` (P1):** 10 linhas no início do `parseIntent()`.
  - Se o Intent vier da GameArena e trouxer a ISO, devolve-a como `shortcutParam`.
  - É o mesmo caminho que os atalhos do PPSSPP já usam. Com o PPSSPP fechado, vai para o `NativeApp.init(...)`. Com o PPSSPP aberto (`singleInstance`), o `onNewIntent` envia a mensagem `shortcutParam` ao C++.
  - O jogo arranca direto, sem passar pelo menu.
  - Sem ISO legível, segue o caminho normal e abre o menu.
- **`ArenaSession.java` (novo):**
  - lê os extras soltos e, se faltarem, o `arena_bundle`;
  - a ISO vem primeiro do `ClipData`, onde vai a permissão de leitura, depois do `iso_uri`, e por fim do `iso_path`, só se o ficheiro for legível;
  - valida os dados de rede: `protocol_version` 1, `role`, `peer_id`, `remote_peer_id`, `room_code`, `start_token`, `/console`, e `server_url` em https e só `gamer-fortune.onrender.com`;
  - guarda tudo em `ArenaSession.current` para a Fase 20.2.2. Nada aqui abre ligações de rede.

**Porquê a lista de servidores autorizados:** o `PpssppActivity` é `exported`, por isso qualquer app pode enviar este Intent. Com um servidor estranho, o jogo arranca na mesma, mas com `netplayReady = false` e sem o `start_token`. O `start_token` nunca vai para o log.

## Testado
- **Script, no PPSSPP oficial:** aplica as 2 edições e o ficheiro novo. Na 2.ª vez não faz nada.
- **Java (`javac` com classes Android simuladas):** compilei o `ArenaSession` e o `parseIntent` já alterado, e testei:
  - ISO no `ClipData` passa a `shortcutParam`, com as aspas escapadas como o PPSSPP faz;
  - um Intent só com o `arena_bundle` também funciona;
  - com um servidor estranho, o jogo arranca sem netplay e sem token;
  - sem ISO, abre o menu;
  - o Intent VIEW normal e o ícone do PPSSPP funcionam como antes.

O `PpssppActivity` completo não foi compilado, porque aqui não há Android SDK. Se o build falhar, manda-me o erro.

## Antes de instalar: applicationId
O fork continua com `applicationId = "org.ppsspp.ppsspp"`, em `android/build.gradle.kts`, linha 118 no `f82a875`. Num telemóvel que já tenha o PPSSPP oficial, o Arena Console não instala, porque o pacote é o mesmo e a assinatura é diferente.
- Recomendo mudar só o `applicationId`, por exemplo para `com.gamearena.console`.
- O `namespace = "org.ppsspp.ppsspp"` tem de ficar igual, porque o C++ (JNI) depende dele.
- Não está no script porque não o pediste. Diz-me se o queres.

## Ainda não incluído
- **Netplay:** fica para a Fase 20.2.2. Os dados já estão em `ArenaSession.current`.
- **Voltar à GameArena:** quando o jogo termina, o PPSSPP vai para o menu dele, não volta ao Launcher.
- **Jogos recentes:** a permissão da ISO é temporária. Se o jogo aparecer na lista de recentes do PPSSPP, pode não abrir mais tarde fora da GameArena.
