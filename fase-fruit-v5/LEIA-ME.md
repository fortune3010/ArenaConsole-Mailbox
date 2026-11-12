# Fruit Arena v5

Entrega para Arenaapk: substitui `backend/public/games/fruit/index.html`. É um ficheiro único; não exige alterações no servidor, no Kotlin nem variáveis novas.

## O que muda

- **Oito cenários com identidade própria**, escolhidos pelo mesmo índice `scenario` de sempre: Floresta, Praia Tropical, Templo Antigo, Cyberpunk, Doces, Ilhas do Céu, Japão Sakura e Galáxia. Cada um tem tabuleiro (madeira, bambu, pedra, vidro néon, chocolate, mármore, laca, casco metálico), seis objetos vetoriais, partículas, frases de combo, som de rebentamento e música sintetizada próprios. Os índices 0, 1, 4, 5 e 6 mantêm o fundo original; 2, 3 e 7 passam a Templo Antigo, Cyberpunk e Galáxia.
- **Cor viva:** as casas do tabuleiro usam tons de joia brilhantes por tema, com brilho interior e aro de luz. As peças têm cores saturadas e halo colorido, e as partículas usam cores vivas. Os brilhos brancos das peças ficam intactos.
- **Cenário vivo:** partículas de ambiente em três profundidades, câmara com deriva lenta e paralaxe (segue a inclinação do telemóvel quando disponível) e luz animada no tabuleiro.
- **Arrasto e encaixe:** a peça acompanha o dedo, a vizinha cede e a troca encaixa com anel de luz, compressão e som.
- **Combos:** efeitos por tema, frases para 4 em linha, L/T e 5+, e a música ganha intensidade com os combos.
- **HUD de vidro** na cor do tema, botões de música e de pausa (pausa só no treino) e cartão de pausa com música, efeitos e sair.
- **Fim de partida:** maior combo, maior golpe, tempo e jogadas, com recordes guardados no dispositivo (treino e online em separado) e aviso de novo recorde.
- **Desempenho:** brilhos das partículas em sprites, raios sem `shadowBlur` e orçamento de partículas; a música já não recomeça quando a qualidade adaptativa muda a resolução.

## Compatibilidade

- Socket.IO, salas, GA16 e `voice.js` intactos. Na zona de rede só mudou a limpeza visual no início da partida (`mpOnMatchStart`).
- IDs e classes originais mantidos. Novos IDs: `gbt`, `bPz`, `bMu5`, `pzv`, `pzGo`, `pzMu`, `pzSx`, `pzEx`.
- 2 a 4 jogadores; regras, dano e duração das partidas inalterados. Online, a vida e a vitória continuam a ser decididas pelo servidor.
- **Sem variável nova no servidor:** o `scenario` já enviado em `match_start` define tema, tabuleiro, objetos e música.

## Aplicação

Copiar `backend/public/games/fruit/index.html` para o mesmo caminho no Arenaapk, fazer commit e push.

## Testes e limitações

Testado no Chrome em 390×844 e 360×640: menu, oito cenários, jogadas, combos, arrasto, pausa, fim de partida e quatro jogadores. Multijogador com dois browsers ligados a um servidor Socket.IO simulado: cenário recebido do servidor, ataques, `game_over` e ecrã final nos dois clientes. Sem erros de JavaScript.

Custo por quadro face ao original, com a mesma resolução e qualidade em renderização por software: 13,1 ms vs 11,0 ms sem combo, 31 ms vs 108 ms em combo e pior quadro de 105 ms vs 502 ms. Partidas simuladas com bots mantêm a duração anterior, dentro da variação aleatória.

Não testados: WebView Android real, som num dispositivo e servidor real.
