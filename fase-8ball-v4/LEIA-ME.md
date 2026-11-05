# v4: mesa do 8-Ball no Guest e fecho automático do Impostor

O script altera dois ficheiros:
- `backend/public/games/8ball/index.html`
- `backend/public/games/impostor/index.html`

Não toca no Ludo, no `voice.js`, no microfone do 8-Ball, no fecho do 8-Ball nem no `pool-namespace.js`.

## Aplicar (Termux, na raiz do Arenaapk)
```
cp ~/Kiro-arquivos-/fase-8ball-v4/ga-v4.js .
node ga-v4.js
git add backend/public/games/8ball/index.html backend/public/games/impostor/index.html
git commit -m "v4: mesa do servidor no Guest do 8-Ball + fecho automatico do Impostor"
git push arena rooms-client-validation:rooms-client-validation
rm ga-v4.js
```

## 8-Ball (4 âncoras)
O servidor já envia a mesa para os dois jogadores (`scene_update`, `room_update`, `match_start`), por isso não precisa de alterações. O cliente já aplicava a mesa no `match_start`. O problema era que outro código podia voltar a pôr a mesa local do Guest depois disso. Isto não aparecia nos greps.

- `setScene`: depois do `match_start`, qualquer pedido para outra mesa é trocado pela mesa do servidor.
- `match_start` verifica a mesa logo a seguir e aos 0,4 s, 1,5 s e 4 s. No Guest aparece o aviso "🎱 Mesa N".
- Cada `game_state` também verifica a mesa. Se estiver errada, redesenha com `bgArt()` e `build()`.
- Efeito secundário: se algum código tentar mudar a mesa durante a partida, a preferência local do Guest (`p8s`) fica com a mesa do Host.

## Impostor (2 âncoras)
O `ga16-post.js` estava incluído e o `game_over` chamava o `ga16Post`. Mas essa chamada vinha depois de `if(!e||e.ended||e.endAt>0)return;`. Quando o motor local acabava o jogo antes de chegar o `game_over` do servidor, o `return` saltava o `ga16Post`. Aparecia o popup do próprio jogo, mas o Android nunca era avisado.

- O `ga16Post(o,{outcome,game:'impostor'})` passa a ser chamado antes desse `return`, uma única vez. Se o `ga16-post.js` não carregar, o jogo chama diretamente o `AndroidInterface.reportMatchResult('ga16_win|loss')` aos 3,9 s.
- A tag passa a `ga16-post.js?v=4` para o WebView não usar a versão em cache.
