# Fase 20.2.2: plano do Arena Console fechado (sem código)

**Base analisada:** PPSSPP oficial, commit `f82a875`. O `PpssppActivity.java` (86 781 bytes) e o `NativeApp.java` (8 742 bytes) têm o mesmo tamanho exato dos ficheiros do clone do dono. Os números de linha abaixo referem-se a essa versão.

## Conclusão principal
No PPSSPP, todos os menus são desenhados em C++. Não há menus em Java: não existe `onCreateOptionsMenu` nem pasta `res/menu`.

Só com Java consegue-se:
- o bloqueio de abertura direta;
- o botão Voltar;
- o ecrã de carregamento;
- a configuração automática.

Para fechar o menu de pausa, os atalhos de save state e as cheats, é preciso um patch pequeno em C++, em 2 ou 3 ficheiros.

"Não há forma de burlar" não é possível só no telemóvel. O código do fork é público por causa da GPL, e qualquer pessoa pode compilar uma versão alterada. A integridade dos torneios tem de ser garantida no servidor e pela verificação cruzada entre os dois jogadores.

## 1. Bloqueio de abertura direta: opção (c)
- **Opção (a) sozinha não chega.** No Android 10+, uma app sem Activity LAUNCHER que peça permissões continua a ter um ícone. Esse ícone abre as Informações da app.
- **Opção (b) é arriscada.** O `PpssppActivity` carrega a biblioteca nativa e inicia o C++ logo no arranque (`takeOver`, `Initialize`). Também é `singleInstance`.
- **Recomendação (c):**
  - criar uma `ArenaGateActivity` nova, leve, sem C++, que fica com o ícone. Mostra "Abre pela Game Arena", o aviso da licença e um botão para abrir a Game Arena;
  - no `PpssppActivity`, remover os filtros MAIN/LAUNCHER/LEANBACK e VIEW (abrir ISOs pelo gestor de ficheiros). Fica só o filtro `START_GAME`;
  - remover o `ShortcutActivity` (atalhos no ecrã inicial);
  - deixar o `AchievementsHostOverrideReceiver` com `exported=false`;
  - no `onCreate` e no `onNewIntent`, recusar qualquer Intent sem `ArenaSession` válida. Nesse caso abre o portão e chama `finish()` antes do `takeOver()`.

## 2. Menus nativos
Não há menus em Java. Os menus em C++ são:
- **`MainScreen`:** a lista de jogos.
- **`GamePauseScreen`** (`UI/PauseScreen.cpp`):
  - Continuar;
  - Save State, Load State, Desfazer, Rewind;
  - Settings, Game Settings, Create/Delete Game Config;
  - Achievements, Display layout & effects, Edit touch control layout;
  - Cheats;
  - Exit / Exit to menu.
- Menu de programador (`VIRTKEY_DEVMENU`) e chat (`VIRTKEY_OPENCHAT`).

O menu de pausa abre por estes caminhos:
- **Botão Voltar do Android:** o `OnBackPressedCallback` (L822–832) envia `KEYCODE_BACK` ao C++. Isto pode ser intercetado em Java: na partida mostra um diálogo nativo "Sair da partida?".
- **Botão de pausa no ecrã e tecla de pausa do comando:** só no C++. O `EmuScreen.cpp` faz `push(new GamePauseScreen…)` em 3 sítios (L554, L687, L1522).
- **Sair:** a opção `--pause-menu-exit` (`CmdLine.cpp` L222) fecha a app quando o jogo termina, em vez de voltar ao menu. Isto não precisa de C++.

## 3. Save state, cheats e simulação
- **Não há bots no PPSSPP.** "Simulação" deve ser o `iAdhocSimDelayMs/JitterMs/LossPercent` (atraso e perda de rede simulados).
- **Cheats:** o menu `Cheats` só aparece com `g_Config.bEnableCheats`.
- **Proteção que o PPSSPP já tem:** com a rede ligada, esconde os save states (`PauseScreen.cpp` L658) e bloqueia o controlo de velocidade (`NetworkAllowSpeedControl`). Isto só vale enquanto `bAllowSavestateWhileConnected` e `bAllowSpeedControlWhileConnected` forem `false`.
- **Atalhos que escapam ao menu** (`EmuScreen.cpp`):
  - `VIRTKEY_SAVE_STATE` / `LOAD_STATE` (L1046/1053);
  - `REWIND` (L940), `FASTFORWARD` (L1086), `SPEED_TOGGLE` (L1001);
  - `RESET_EMULATION` (L1018);
  - `DEVMENU` (L828).
  
  Podem estar ligados a teclas de comando ou a botões personalizados no ecrã.
- **Depurador remoto e Lua:** o depurador remoto (`bRemoteDebuggerOnStartup`) e o Lua permitem mexer na memória.

Plano em camadas:
1. **Java, sem C++:** passar `--appendconfig=<arena.ini>` no Intent interno. O `arena.ini` força:
   - cheats desligadas;
   - rewind a 0 e sem desfazer save;
   - os 2 "Allow…WhileConnected" a `false`;
   - depurador remoto e partilha desligados;
   - simulação de rede a 0;
   - sair do menu fecha a app.
2. **C++ mínimo:** ler uma mensagem `arena_lock` vinda do Java. As mensagens desconhecidas já são ignoradas sem erro (`app-android.cpp` L1527), por isso o Java pode enviá-la antes de o C++ a conhecer. Com o bloqueio ativo:
   - os 3 `push(GamePauseScreen)` passam a pedir ao Java o diálogo "Sair da partida?";
   - os atalhos acima ficam ignorados;
   - a configuração é reposta depois de cada carregamento.
3. **Servidor:** resultado só aceite se os dois jogadores enviarem o mesmo (já feito na 20.1). Possivelmente também verificação da assinatura da app (ponto 6).

## 4. Ecrã de carregamento
- Com um jogo no arranque, o PPSSPP já salta o logótipo (`skipLogo = true`, `NativeApp.cpp` L815/L917) e vai direto ao `EmuScreen`.
- **Primeiro arranque:** com armazenamento limitado (Android 11+), o PPSSPP abre o ecrã de escolha da pasta (L892–894). Isto tem de ser resolvido em Java antes do `NativeApp.init`: escrever o `memstick_dir.txt` ou passar `--memstick=<pasta privada>`.
- **Marca, só em Java e recursos:**
  - tema com `windowBackground` da Arena e SplashScreen do Android 12+ (`values-v31`);
  - um `FrameLayout` por cima do `SurfaceView` com logo, cores e "A carregar…" e o aviso "Baseado no PPSSPP · GPL 2.0".
- **Quando esconder o ecrã:** o sinal ideal é o C++ avisar que o jogo começou. Um candidato sem C++ é o comando `set_keep_screen_bright`, mas falta confirmar. Se não servir, basta 1 linha no C++.

## 5. Netplay (20.2.3)
Não existe `NativeApp.setNetplayParam`. A rede do PPSSPP emula o modo ad hoc do PSP:
- servidor PRO Adhoc (TCP 27312) para juntar os jogadores;
- transporte em `Core/HLE/AdhocTransport*.cpp`: direto (P2P) ou por relay `aemu_postoffice` (TCP 27313, `iAdhocServerRelayMode`).

Por isso o `ArenaSession` não é usado pelo C++ diretamente. O Java traduz a sessão em configuração (`bEnableWlan`, servidor, relay, MAC único).

Opções:

| | Como | C++ | Infra | Risco |
|---|---|---|---|---|
| **A** | Servidor PRO + postoffice nossos numa VPS (ex.: Fly.io), com isolamento por sala | 0 | VPS com TCP (o Render não aceita TCP público) | baixo |
| **C** | Ponte em Java: o PPSSPP liga-se a `127.0.0.1`, e o Java passa o tráfego por WebSocket ao Render | 0 | o Render atual | latência pelo servidor, Render gratuito |
| **B** | Transporte WebRTC novo em C++ (`AdhocTransport`), com o nosso TURN | grande | o atual | alto |

**Recomendação:** começar pela A ou pela C e deixar a B para o fim. Antes, é preciso confirmar que os jogos escolhidos usam ad hoc.

## 6. Fork GPLv2
- **Repositório:** fork no GitHub de `hrydgard/ppsspp` (ex.: `fortune3010/arena-console`), com o `upstream` como remoto.
  - Branch `arena` a partir de uma versão fixa.
  - Tem 23 submódulos: `git submodule update --init --recursive`.
  - Desligar no fork os workflows do upstream (`build.yml`, `manual_generate_*`).
- **`LICENSE.TXT`:** fica na raiz, sem alterações. Ficheiros novos levam o cabeçalho "GPL 2.0 or later", como os do PPSSPP.
- **Ficheiros alterados:** a GPLv2 §2(a) obriga a avisar dentro de cada ficheiro alterado: quem alterou e quando. As marcas `GA20_ARENA` servem, com a data.
- **`README.md` + `ARENA.md` na raiz:**
  - o que é o Arena Console;
  - "Baseado no PPSSPP de Henrik Rydgård e contribuidores, GPL 2.0+", com link;
  - lista das alterações e instruções de build.
- **Nome e ícone:** usar "Arena Console" e um ícone próprio. Não usar o nome nem o logo do PPSSPP como marca. A atribuição aparece no portão e no ecrã de carregamento.
- **Código fonte:** cada APK distribuído tem de ter o código exato publicado (tag por versão). O Launcher Kotlin e o backend são programas separados que comunicam por Intent e rede, por isso podem continuar fechados.
- **Estrutura:**
  - nada de `fase*/` no fork. Os scripts de entrega continuam no Kiro-arquivos-;
  - código novo em `android/src/org/ppsspp/ppsspp/` (`ArenaSession`, `ArenaGateActivity`, …);
  - recursos em `android/res/`;
  - um workflow próprio `.github/workflows/arena-android.yml`.
- **applicationId:**
  - mudar em `android/build.gradle.kts`, no flavor `normal` (L193), porque esse valor substitui o da L118;
  - o `namespace = "org.ppsspp.ppsspp"` (L87) e o pacote Java ficam iguais, porque o JNI usa `Java_org_ppsspp_ppsspp_*`;
  - o FileProvider já usa `${applicationId}` e `getPackageName()`, por isso não precisa de alterações.
- **Integridade (permitida pela GPLv2):** o Launcher pode verificar o certificado de assinatura da app que vai receber o `START_GAME`. O servidor só aceita `emu_join` com `start_token` válido.
