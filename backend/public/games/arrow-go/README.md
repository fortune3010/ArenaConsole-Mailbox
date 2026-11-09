# 🎮 ARROW GO! - MULTIPLAYER

Sistema multiplayer completo para 2-6 jogadores simultâneos com:
- ✅ Sincronização de vidas via Socket.IO
- ✅ Chat de voz WebRTC P2P
- ✅ Seed aleatória (todos veem o mesmo tabuleiro)
- ✅ Sistema de eliminação e ranking
- ✅ UI com ponteiros coloridos 🟢🟡🔴⚪🔵🟣

---

## 📂 ESTRUTURA DOS FICHEIROS

```
backend/public/games/arrow-go/
├── index.html       - UI principal (canvas + HUD + modals)
├── styles.css       - Estilos do HUD multiplayer
├── game.js          - Lógica do jogo + hooks Socket.IO
├── voice.js         - Chat de voz WebRTC
└── README.md        - Este ficheiro

backend/services/
└── websocket.js     - Namespace /arrow-go (servidor Socket.IO)
```

---

## 🚀 COMO TESTAR

### 1. **Iniciar o Backend**
```bash
cd backend
npm install
node server.js
```

O servidor vai estar disponível em:
- **HTTP**: http://localhost:3000
- **WebSocket**: ws://localhost:3000/arrow-go

### 2. **Abrir o Jogo via App Android**

O jogo é aberto automaticamente pelo `Html5RoomLauncher` quando uma sala HTML5 é criada:

```kotlin
// No RoomLobbyActivity, quando canStart=true:
Html5RoomLauncher.launchRoom(
    context = this,
    game = game, // GameProfile do Arrow Go
    roomCode = "ABCD",
    role = "host", // ou "guest"
    startToken = "xyz123",
    maxPlayers = 6
)
```

### 3. **URL do Jogo**

O jogo é aberto com parâmetros na URL:
```
http://localhost:3000/games/arrow-go/?room=ABCD&role=host&token=xyz123&start=1
```

Parâmetros:
- `room` - Código da sala (ex: ABCD)
- `role` - host ou guest
- `token` - Start token JWT da API REST
- `start=1` - Flag de início imediato

---

## 🎯 FLUXO DO JOGO

### **Fase 1: Lobby**
1. Jogadores entram na sala via `socket.emit('join_room')`
2. Servidor atribui cores: 🟢🟡🔴⚪🔵🟣
3. Cada jogador recebe 3 vidas: ❤️❤️❤️
4. Servidor gera uma **seed aleatória** (todos verão o mesmo tabuleiro)

### **Fase 2: Início do Jogo**
- Quando há 2+ jogadores, o servidor emite `game_start` com a seed
- Modal de espera desaparece
- Todos os jogadores começam ao mesmo tempo

### **Fase 3: Gameplay**
- Jogador arrasta a seta e solta para atirar
- Obstáculos vermelhos movem-se aleatoriamente (mesma seed = mesmos movimentos)
- **Perder vida**:
  - Seta colide com obstáculo → `socket.emit('lose_life')`
  - Servidor valida e atualiza vidas
  - Todos os jogadores veem a vida perdida no HUD
- **Eliminação**:
  - Quando vidas chegam a 0, jogador é eliminado
  - Jogo continua a correr mas não pode jogar mais

### **Fase 4: Fim de Jogo**
- Quando só resta 1 jogador vivo (ou todos eliminados):
  - Servidor emite `game_over` com ranking
  - Jogo mostra ecrã de vitória/derrota
  - Resultado é reportado ao Android via `AndroidInterface.reportMatchResult()`

---

## 🎤 VOICE CHAT

O sistema de voz é **P2P via WebRTC**:

1. Cada jogador pede permissão de microfone
2. Servidor faz **signaling** (relay de offers/answers/ICE candidates)
3. Conexões diretas peer-to-peer são estabelecidas
4. Áudio flui diretamente entre jogadores (sem passar pelo servidor)

**Controles**:
- 🎤 **Microfone**: Liga/desliga o teu áudio
- 🔊 **Alto-falante**: Silencia todos os outros jogadores

---

## 🔧 INTEGRAÇÃO COM O ANDROID

### **Lançamento do Jogo**
O `GameWebViewActivity` carrega o jogo e injeta o token JWT:

```kotlin
val intent = Intent(this, GameWebViewActivity::class.java).apply {
    putExtra(GameWebViewActivity.EXTRA_GAME, Gson().toJson(game))
    putExtra(GameWebViewActivity.EXTRA_ROOM_CODE, roomCode)
    putExtra(GameWebViewActivity.EXTRA_ROLE, role)
    putExtra(GameWebViewActivity.EXTRA_START_TOKEN, startToken)
    putExtra(GameWebViewActivity.EXTRA_START, "1")
}
startActivity(intent)
```

### **Reporte de Resultado**
Quando o jogo termina, chama a ponte JavaScript:

```javascript
window.AndroidInterface.reportMatchResult(winnerRole, scoresJson);
```

Isso fecha o WebView e grava o resultado no histórico.

---

## 📊 DADOS QUE O SERVIDOR SINCRONIZA

### **Por Jogador**:
```javascript
{
    playerId: "socket-id-123",
    userId: "user-uuid",
    playerName: "João",
    color: "green",      // 🟢
    lives: 2,            // de 0 a 3
    eliminated: false,
    score: 450,
    level: 3
}
```

### **Estado da Sala**:
```javascript
{
    code: "ABCD",
    players: [...],      // Array de jogadores
    seed: 1234567890,    // Seed para RNG
    startedAt: 1700000000,
    maxPlayers: 6
}
```

---

## 🐛 DEBUG

### **Ver logs do servidor**:
```bash
node server.js
```

Procura por:
- `[WebSocket] Namespace /arrow-go pronto`
- `[Arrow-Go] Cliente conectado: xyz`
- `[Arrow-Go] João entrou na sala ABCD (2/6)`
- `[Arrow-Go] Jogo iniciado na sala ABCD com 2 jogadores`

### **Ver logs do cliente** (Chrome DevTools):
1. Abrir a WebView no Android Studio (chrome://inspect)
2. Console do navegador mostrará:
   - `[Socket] Conectado: xyz`
   - `[Room] Entrei na sala: {...}`
   - `[Life] Perdi uma vida!`
   - `[Voice] Stream local obtido`

---

## ✅ PRÓXIMOS PASSOS

1. **Testar com 2 jogadores** (2 telemóveis ou 1 telemóvel + 1 browser)
2. **Verificar sincronização de vidas** (quando um perde, todos veem)
3. **Testar voice chat** (pedir permissão de microfone)
4. **Ajustar dificuldade** (velocidade dos obstáculos, número de vidas)
5. **Adicionar power-ups** (vida extra, slow-motion, etc)

---

## 🎨 PERSONALIZAÇÃO

### **Alterar número de vidas**:
Em `game.js` e `websocket.js`:
```javascript
const MAX_LIVES = 5; // Alterar de 3 para 5
```

### **Alterar número de jogadores**:
Em `websocket.js`:
```javascript
maxPlayers: 4 // Em vez de 6
```

### **Alterar cores**:
Em `game.js`:
```javascript
const PLAYER_COLORS = ['pink', 'orange', 'cyan', 'lime'];
const PLAYER_ICONS = ['🩷', '🧡', '💙', '💚'];
```

E em `styles.css`, adicionar as classes:
```css
.player-indicator.color-pink { 
    color: #FF69B4; 
    border-color: #FF69B4; 
}
```

---

## 📝 NOTAS TÉCNICAS

### **Por que usar Socket.IO em vez de REST polling?**
- ⚡ **Latência**: 50-100ms vs 3000ms
- 🔄 **Bidirecional**: Servidor pode notificar clientes instantaneamente
- 📡 **Menos tráfego**: Só envia quando há mudanças

### **Por que WebRTC P2P em vez de servidor de áudio?**
- 💰 **Sem custos**: Sem precisar de servidor de media
- ⚡ **Baixa latência**: Conexão direta entre jogadores
- 🔒 **Privacidade**: Áudio não passa pelo servidor

### **Segurança**
- ✅ Token JWT validado no middleware do Socket.IO
- ✅ Todos os eventos verificam se o jogador está na sala
- ✅ Servidor valida todas as perdas de vida (anti-cheat)

---

**Criado por**: Opus (Claude 3.5 Sonnet)  
**Data**: 2026-11-04  
**Versão**: 1.0 - Arrow Go Multiplayer MVP
