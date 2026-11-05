# NeonRush: multijogador real até 12 pilotos

## Aplicar (Termux, na raiz do Arenaapk)
```
cp ~/Kiro-arquivos-/fase-neonrush-p2p/ga-neonrush-p2p.js .
node ga-neonrush-p2p.js
git add backend/services/neonrush-namespace.js backend/public/games/neonrush/index.html
git commit -m "NeonRush: multijogador real ate 12 (WebRTC em estrela + reserva pelo servidor)"
git push arena rooms-client-validation:rooms-client-validation
rm ga-neonrush-p2p.js
```
Se a pasta do jogo não for `neonrush`, passa os dois caminhos ao script:
`node ga-neonrush-p2p.js backend/services/neonrush-namespace.js backend/public/games/<pasta>/index.html`

## Arquitetura
- Cada telemóvel simula só o seu carro. A condução não tem latência de rede.
- **Estrela WebRTC:** o Host abre um DataChannel (não ordenado, sem retransmissões) com cada convidado. O convidado envia a sua posição 12×/s ao Host, e o Host envia a todos o pacote com todos os pilotos.
- **Reserva:** se o WebRTC não ligar para algum jogador, ou se o Host sair, as posições passam pelo servidor (`nr_state`, máximo 30 mensagens/s por socket).
- **Vencedor:** quem decide é o servidor, pelo tempo de cada piloto (`player_finished` → `game_over` → GA16 `onFinish`). Esta parte não foi alterada.
- **Grelha:** 4 filas de 3. A meta de cada piloto fica à mesma distância da sua posição de partida.

## Correções incluídas
- O `player_finished` nunca chegava ao servidor: o `done()` usava `sock`, que não existe nesse âmbito.
- No fim aparecia sempre o 1.º lugar como se fosse o teu. Agora aparece o teu lugar, e o `ga16Post` recebe `win`/`loss`.

## Testado (Chrome sem ecrã, WebRTC real, servidor do documento a correr no browser)
- **4 pilotos:** o Host ficou com 2 canais abertos. Um convidado sem WebRTC passou pela reserva e todos viram os 3 carros dos outros. O `game_over` chegou por ordem de tempo e o GA16 recebeu `winnerSeat: 0` com os 4 tokens.
- **12 pilotos:** o Host ficou com 11 canais abertos, cada piloto viu os outros 11 e os 12 lugares finais saíram certos.
