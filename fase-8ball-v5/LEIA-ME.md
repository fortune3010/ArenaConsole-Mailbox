# 8-Ball v5: Treino contra a CPU, mesas premium, som, música e mesa do anfitrião sincronizada

Ficheiros desta entrega (os caminhos são os do Arenaapk):

| Ficheiro | O que é |
|---|---|
| `backend/public/games/8ball/index.html` | Jogo completo, a substituir o atual |
| `backend/services/pool-scene-sync.js` | Novo módulo do servidor: `change_scene` → `scene_changed` |
| `ga-8ball-v5-servidor.js` | Script que liga o módulo ao `pool-namespace.js` |

Não toca no `voice.js`, no `ga16-post.js`/GA16, na autenticação nem na lógica de salas e jogadas do Socket.IO. Os IDs e as classes do HTML original continuam todos lá. Os elementos novos têm IDs novos.

## Aplicar (Termux, na raiz do Arenaapk)

```
M=~/ArenaConsole-Mailbox/fase-8ball-v5   # ajusta ao sítio onde tens esta pasta
cp $M/backend/public/games/8ball/index.html backend/public/games/8ball/index.html
node $M/ga-8ball-v5-servidor.js
git add backend/public/games/8ball/index.html backend/services/pool-namespace.js backend/services/pool-scene-sync.js
git commit -m "8-Ball v5: treino vs CPU, mesas premium, som/música, mesa do anfitrião sincronizada"
git push   # para o ramo habitual do deploy no Render
```

O script copia o módulo e insere uma linha logo a seguir a `socket.on('join_room', safe(p => enter(socket, p, 'guest')));`:

```js
require('./pool-scene-sync').attach({ nsp, socket, rooms });
```

A âncora tem de existir exatamente uma vez. Se não existir, o script não altera nada e diz qual é o grep que precisa. Faz `.bak`, corre `node --check` e repõe o original se a verificação falhar. Pode ser corrido mais do que uma vez sem duplicar a linha.

## 1. Bug da mesa no multiplayer

**Causa.** O cliente já enviava a mesa do anfitrião no `create_room` e no `set_scene`. O convidado só via a mesa que o servidor lhe mandava no `match_start`, `room_update` ou `scene_update`. Quando o servidor não manda a mesa, ou a troca pela do convidado no `join_room`, o convidado fica com a mesa padrão. Reproduzi exatamente isto com um servidor de teste: o anfitrião ficou na mesa 4 e o convidado na 0.

**Correção.**
- **Anfitrião:** é a fonte da verdade. Emite `change_scene {code, scene, token}` a cada `room_update`, no `match_start` e quando muda de mesa durante o jogo. Para isso há um botão novo, 🎨, que só aparece ao anfitrião quando o servidor confirma que suporta `change_scene`.
- **Servidor:** guarda `room.scene` e retransmite `scene_changed {code, scene, by}` ao convidado e aos espectadores. Recusa quem não é o lugar 0 e aceita `scene_request {code}` para reenviar a mesa.
- **Convidado e espectador:** aplicam `scene_changed`, que tem prioridade sobre uma mesa desatualizada no `match_start`. A preferência local `p8s` do convidado não é apagada.
- **Servidor antigo:** se o servidor ainda não tiver o módulo e não responder em 2,5 s, o anfitrião passa para a mesa do servidor. Assim os dois veem a mesma mesa em vez de mesas diferentes.

## 2. Modo Treino (CPU)

**Como se ativa:**
- No menu inicial (`?mode=setup`, o ecrã de escolher o cenário) há agora dois botões: **TREINO** (contra a CPU) e **MULTIPLAYER** (sala 1×1, o fluxo atual com `saveSetup`). O TREINO pede a dificuldade (Fácil, Normal ou Difícil) e começa logo, na mesa escolhida.
- Por URL: `?mode=training`, `?mode=ai` ou `?mode=cpu`, com `&difficulty=easy|normal|hard` opcional (também aceita `facil`, `dificil`, `0`, `1` e `2`). É o mesmo URL que o `GameWebViewActivity` já monta para treinos: `mode=training&players=…&difficulty=…&start=1`.
- Aberto sem parâmetros, o jogo mostra o mesmo menu em vez do erro "Abra o jogo pelo Launcher". Com `prewarm=1` o comportamento original mantém-se.

**Comportamento da CPU:**
- Para cada bola legal e cada caçapa, calcula a bola fantasma: o ângulo branca → alvo e o ângulo alvo → caçapa. Rejeita cortes impossíveis e caminhos tapados e escolhe a força a partir das distâncias, com variação aleatória.
- No Normal e no Difícil, simula as melhores tacadas no motor de física antes de tacar. Evita faltas, branca na caçapa e a 8 antes do tempo. No Difícil escolhe também puxada ou seguimento e pensa na posição para a tacada seguinte.
- Joga o turno inteiro sozinha, com 1,5 s entre tacadas. O taco roda até ao alvo e a barra de força enche à vista do jogador. Com bola na mão, coloca a branca sozinha.

**Regras locais do 8-ball:** grupos (lisas/riscadas), faltas (branca na caçapa, não tocar em nenhuma bola, tocar primeiro na bola errada, nenhuma bola bater na tabela), bola na mão e a 8 no fim. A abertura alterna entre partidas. O ecrã final tem "Jogar de novo" e "Voltar ao menu".

O Treino é offline e não envia resultados para o histórico nem para o XP, porque vitórias contra a CPU não devem contar. O `ga16Post` só continua a ser chamado no multiplayer.

## 3. Android (Kotlin)

Não é preciso alterar o Kotlin:
- O botão Treino está dentro do próprio HTML, no menu de setup.
- O `?mode=training&difficulty=…` que o `GameWebViewActivity` já envia funciona agora no 8-Ball.

Se também quiserem o botão "Treino" no menu nativo, esse menu deve depender do perfil do jogo no backend (no perfil do Arrow Go são os campos `hasAi`/`aiLevels`). Não vi o código do menu nativo, por isso confirmem lá.

## 4. Visual, física e som

- **Mesas:** madeira com veios e esquadrias, laca, mármore com veios, obsidiana com veios incandescentes, gelo e neon com fitas LED. Todas têm sombra projetada, verniz e reflexos das lâmpadas, duas poças de luz no pano, caçapas com aro metálico e diamantes de madrepérola ou LED. O taco tem sombra e anel na cor do tema, e as bolas têm um segundo reflexo. Tudo é desenhado uma vez por cenário, por isso não custa nada por frame.
- **Física (motor local do Treino):** tem escorregamento → rolamento e efeito com seguimento, puxada e lateral, escolhido no botão da bola branca no HUD. As tabelas de borracha têm restituição 0,8 e atrito, por isso o efeito lateral abre ou fecha o ângulo. Os choques entre bolas encostadas são resolvidos como simultâneos, e é por isso que o triângulo se espalha na abertura. As caçapas têm "jaws".
- **Som:** "clack" das bolas sintetizado com Web Audio (transiente e modos ressonantes da resina, mais abafado nos toques fracos), baque das tabelas, caçapa e taco. As amostras são geradas uma única vez e tocadas com limite de polifonia.
- **Música:** uma batida Rap/Hip-Hop por cenário: drill (Londres), dark trap (Las Vegas), trap oriental (Dubai), G-funk (Pôr do Sol), boom bap, lo-fi, cloud rap… Tem bombo, tarola/palmas, pratos, 808 saturado e teclas/pads. O botão 🎵 (no jogo e no canto do menu) liga e desliga a música e a escolha fica guardada. A música para quando a app vai para segundo plano.

**Limite importante:** no multiplayer a física é calculada no servidor (o cliente só reproduz as trajetórias), por isso o atrito, as tabelas e o efeito novos aplicam-se ao Treino. Para os ter também online, o motor `phSim` do HTML, que produz frames e eventos no mesmo formato, pode ser levado para a simulação do `pool-namespace.js` num passo à parte.

## Testes feitos no sandbox

- **Motor (Node):** 98% das tacadas geométricas da IA entram sem erro humano. Em 300 aberturas, uma média de 0,73 bolas embolsadas; 16% das aberturas embolsam 2 ou mais e 11% metem a branca. Duração média de 5,9 s, sem bolas fora da mesa nem sobrepostas. Jogos CPU contra CPU terminam sempre: Difícil ganhou 14–2 ao Fácil e 15–1 ao Normal; Normal ganhou 13–3 ao Fácil.
- **Chrome em retrato (390×844, toque):** menu → Treino → Normal → partida inteira até ao fim (33 tacadas, 4 com bola na mão), "Jogar de novo", 🏠 → menu, sem erros de JS. `?mode=training&difficulty=hard`, `?mode=ai`, sem parâmetros e `prewarm=1` também testados.
- **Multiplayer (dois browsers e servidor de teste):**

  | Servidor | Resultado |
  |---|---|
  | Antigo, sem mesa | Reproduz o bug |
  | Novo | O convidado recebe a mesa do anfitrião em menos de 1,2 s. A troca com 🎨 a meio do jogo chega ao convidado. Um convidado que tente forçar a mesa é recusado (`{"ok":false,"error":"host"}`) |
  | Antigo que troca a mesa pela do convidado | Os dois ficam na mesma mesa |

- **CPU 4× mais lento:** desenhar a mesa leva 6–15 ms, simular uma abertura 36 ms e a IA Difícil ≤ 0,5 s.

**Por confirmar no dispositivo real:** o som e a música só foram medidos por analisador (sem clipping), não ouvidos. O WebView Android também não foi testado.
