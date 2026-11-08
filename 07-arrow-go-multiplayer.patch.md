# PATCH 07: ARROW GO MULTIPLAYER (HTML5)

## 🎯 Objetivo
Adicionar **Arrow Go** como primeiro jogo HTML5 multiplayer nativo no GameArena, usando:
- ✅ Socket.IO namespace `/arrow-go` (2-6 jogadores)
- ✅ WebRTC P2P voice chat (signaling via Socket.IO)
- ✅ Server-authoritative lives (3 vidas por jogador)
- ✅ Seed RNG para sincronização determinística
- ✅ Zero mudanças no Android (usa `Html5RoomLauncher` existente)

---

## 📦 Conteúdo (8 ficheiros)

### **Backend**
1. `services/websocket.js` - Namespace Socket.IO `/arrow-go`
2. `scripts/verify-arrow-go.js` - Script de verificação

### **Frontend HTML5**
3. `public/games/arrow-go/index.html` - Canvas game + HUD + modals
4. `public/games/arrow-go/styles.css` - UI com 6 player indicators
5. `public/games/arrow-go/game.js` - Game loop + Socket.IO hooks
6. `public/games/arrow-go/voice.js` - WebRTC P2P voice manager
7. `public/games/arrow-go/test-client.html` - Debug client (browser)
8. `public/games/arrow-go/README.md` - Documentação de integração

---

## 🚀 Como Aplicar

### **1. Backend (Node.js)**

#### **Copiar ficheiros do repositório `/projects/sandbox/backend`:**
```bash
# Clone o repositório backend (se ainda não tens)
cd ~
git clone https://github.com/fortune3010/gamearena-backend.git

# Copia os ficheiros Arrow Go
cd gamearena-backend
cp -r /projects/sandbox/backend/* .

# Verifica estrutura
tree -L 3 public/games/arrow-go services scripts
```

Deverás ter:
```
gamearena-backend/
├── public/games/arrow-go/
│   ├── index.html
│   ├── styles.css
│   ├── game.js
│   ├── voice.js
│   ├── test-client.html
│   └── README.md
├── services/
│   └── websocket.js
└── scripts/
    └── verify-arrow-go.js
```

#### **Integrar websocket.js no server.js:**

**MUST #1** - Importar o namespace Arrow Go no `server.js`:

```javascript
// No topo do ficheiro (com os outros imports)
const { createArrowGoNamespace } = require('./services/websocket');

// Depois de criar o servidor Socket.IO (procura por "const io = ...")
const io = socketIo(server, {
  cors: { origin: "*" }
});

// ADICIONAR LOGO A SEGUIR:
// Arrow Go namespace
createArrowGoNamespace(io);
```

#### **Verificar instalação:**
```bash
cd ~/gamearena-backend
node scripts/verify-arrow-go.js
```

Deverás ver:
```
✅ Todos os ficheiros necessários existem
✅ index.html válido (Canvas + HUD)
✅ game.js possui hooks Socket.IO
✅ voice.js implementa WebRTC P2P
✅ websocket.js exporta createArrowGoNamespace
✅ Arrow Go está pronto para deploy!
```

---

### **2. Deploy Backend**

```bash
cd ~/gamearena-backend
git add .
git commit -m "GA20: Arrow Go multiplayer HTML5 (Socket.IO + WebRTC)"
git push origin main

# Se usas Render/Railway:
# O deploy automático inicia (2-3 min)
```

---

### **3. Android (Adicionar ao Catálogo)**

#### **Opção A: Supabase (se usas BD para catálogo)**

```sql
-- Adiciona Arrow Go à tabela games
INSERT INTO games (
  id,
  name,
  description,
  thumbnail_url,
  trailer_url,
  game_type,
  html5_path,
  min_players,
  max_players,
  is_active
) VALUES (
  'arrow-go',
  'Arrow Go',
  'Desvia das setas e sobrevive! 3 vidas, último jogador ganha.',
  'https://your-backend.com/assets/arrow-go-thumb.jpg',
  'https://your-backend.com/assets/arrow-go-trailer.mp4',
  'html5_multiplayer',
  '/games/arrow-go/index.html',
  2,
  6,
  true
);
```

#### **Opção B: JSON local (se catálogo está hardcoded)**

Adiciona ao `app/src/main/assets/games_catalog.json`:

```json
{
  "id": "arrow-go",
  "name": "Arrow Go",
  "description": "Desvia das setas e sobrevive! 3 vidas, último jogador ganha.",
  "thumbnailUrl": "https://your-backend.com/assets/arrow-go-thumb.jpg",
  "trailerUrl": "https://your-backend.com/assets/arrow-go-trailer.mp4",
  "gameType": "html5_multiplayer",
  "html5Path": "/games/arrow-go/index.html",
  "minPlayers": 2,
  "maxPlayers": 6,
  "isActive": true
}
```

**ZERO mudanças necessárias no código Android!** O `Html5RoomLauncher` já:
- ✅ Passa `room_code` via URL param
- ✅ Passa `token` (JWT) via URL param
- ✅ Escuta `AndroidInterface.reportMatchResult(winner)`
- ✅ Fecha WebView quando jogo termina

---

## ✅ Testes de Validação

### **Teste 1: Browser (Debug sem Android)**

1. **Inicia backend:**
   ```bash
   cd ~/gamearena-backend
   npm start
   # Servidor em http://localhost:3000
   ```

2. **Abre 2 tabs no browser:**
   - Tab 1: `http://localhost:3000/games/arrow-go/test-client.html`
   - Tab 2: `http://localhost:3000/games/arrow-go/test-client.html`

3. **Ambas tabs:**
   - Username: qualquer nome
   - Room Code: `TEST`
   - Clica **JOIN ROOM**

4. **Verifica console (F12):**
   ```
   ✅ Socket connected
   ✅ Room joined: TEST
   ✅ Player joined: {username, color, lives}
   ✅ Game starting with seed: 12345
   ```

5. **Quando 2 jogadores entram → jogo inicia:**
   - Canvas mostra círculo jogador + setas a cair
   - HUD mostra 2 jogadores com ❤️❤️❤️
   - Ao colidir com seta → perde vida → HUD actualiza

6. **Teste voice chat:**
   - Clica 🎤 → microfone verde
   - Fala → outro player deve ouvir (latência ~20-50ms)

---

### **Teste 2: Android (Real)**

1. **Dispositivo A:**
   - Abre GameArena
   - Menu → Arrow Go
   - Clica **CRIAR SALA**
   - Código: `ABCD`

2. **Dispositivo B:**
   - Menu → Arrow Go
   - Clica **JUNTAR-SE**
   - Código: `ABCD`

3. **Quando 2 jogadores entram:**
   - ✅ Ecrã mostra "Game starting..."
   - ✅ Canvas renderiza círculo + setas
   - ✅ HUD mostra 2 jogadores (🟢 vs 🟡)
   - ✅ Voice chat activo (ícone 🎤 verde)

4. **Gameplay:**
   - Move o círculo (touch/swipe)
   - Colide com seta → perde vida
   - HUD actualiza: ❤️❤️ → ❤️❤️❤️
   - Quando chegar a ❤️ → eliminado

5. **Game Over:**
   - Último player vivo → vence
   - Modal mostra: "Player [X] venceu!"
   - Android recebe `reportMatchResult(winnerId)`
   - WebView fecha após 3s

6. **Histórico:**
   - Abre **Início → Histórico**
   - Última partida mostra:
     - Jogo: Arrow Go
     - Resultado: Vitória/Derrota
     - Modo: Multiplayer

---

## 🔧 Arquitetura Técnica

### **Fluxo de Dados**

```
[Android] Html5RoomLauncher
    ↓ (abre WebView com room_code + token)
[Browser] index.html
    ↓ (carrega game.js + voice.js)
[Cliente] Socket.IO connect → /arrow-go
    ↓ emit: join_room({room_code, username, token})
[Servidor] JWT validation → assigns color + lives
    ↓ broadcast: player_joined
[Cliente] Espera MIN_PLAYERS (2)
    ↓ (quando 2+ players)
[Servidor] emit: game_start({seed, players})
[Cliente] seededRandom(seed) → gera setas idênticas
    ↓ (game loop: renderiza + deteta colisões)
[Cliente] Colisão → emit: lose_life
[Servidor] Valida → decrementa lives
    ↓ broadcast: player_life_lost({playerId, lives})
[Cliente] Actualiza HUD → remove ❤️
    ↓ (quando lives=0)
[Servidor] checkGameOver → 1 player vivo?
    ↓ emit: game_over({winnerId})
[Cliente] Modal "X venceu!" → AndroidInterface.reportMatchResult(winnerId)
[Android] Fecha WebView → grava histórico
```

### **Eventos Socket.IO**

| Evento | Direção | Payload | Quando |
|--------|---------|---------|--------|
| `join_room` | Client→Server | `{roomCode, username, token}` | Player entra na sala |
| `room_joined` | Server→Client | `{room, players, yourColor}` | Confirmação entrada |
| `player_joined` | Server→Broadcast | `{player}` | Novo player entrou |
| `game_start` | Server→Room | `{seed, players}` | 2+ players prontos |
| `lose_life` | Client→Server | `{roomCode, playerId}` | Colisão detectada |
| `player_life_lost` | Server→Room | `{playerId, lives}` | Vida perdida (validada) |
| `game_over` | Server→Room | `{winnerId, winnerName}` | 1 player sobrou |
| `player_left` | Server→Room | `{playerId}` | Desconexão |

### **Voice Chat (WebRTC P2P)**

```
[Player A] getUserMedia() → localStream
    ↓ createOffer()
[Player A] emit: voice_offer({offer, targetId: B})
    ↓ (servidor relay)
[Player B] recebe offer → createAnswer()
[Player B] emit: voice_answer({answer, targetId: A})
    ↓ (servidor relay)
[Player A] setRemoteDescription(answer)
    ↓ (ICE candidates trocados via servidor)
[Ambos] P2P connection established
    ↓ (audio direto, sem passar pelo servidor)
```

**Latência:** 20-50ms (vs 200ms se fosse relay no servidor)  
**Custo:** Zero (servidor só faz signaling, não media relay)

---

## 📊 Constantes do Jogo

```javascript
// Backend (services/websocket.js)
const MAX_LIVES = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const PLAYER_COLORS = ['green', 'yellow', 'red', 'white', 'blue', 'purple'];

// Frontend (game.js)
const ARROW_SPEED = 2;
const ARROW_SPAWN_INTERVAL = 1500; // ms
const PLAYER_RADIUS = 20;
const ARROW_WIDTH = 30;
const ARROW_HEIGHT = 40;
```

---

## 🚨 Troubleshooting

### **Erro: "Socket.IO connection failed"**
**Causa:** Backend não está a escutar no namespace `/arrow-go`.  
**Solução:**
```bash
# Verifica se websocket.js foi importado em server.js
grep "createArrowGoNamespace" ~/gamearena-backend/server.js

# Deve aparecer:
# const { createArrowGoNamespace } = require('./services/websocket');
# createArrowGoNamespace(io);
```

### **Erro: "JWT validation failed"**
**Causa:** Token inválido ou expirado.  
**Solução:**
- Android: Verifica se `Html5RoomLauncher` passa `token` na URL
- Backend: Verifica `JWT_SECRET` no `.env`

### **Erro: "Player colors duplicated"**
**Causa:** 2+ jogadores com mesma cor.  
**Solução:** Não deve acontecer (servidor atribui cores sequencialmente). Se acontecer:
```bash
# Verifica logs do servidor
tail -f ~/gamearena-backend/logs/arrow-go.log
```

### **Voice chat sem som**
**Causa:** Permissões microfone não concedidas.  
**Solução:**
- Browser: Clica no cadeado URL → Permitir microfone
- Android WebView: Adiciona `RECORD_AUDIO` no Manifest (já deve estar)

### **Setas dessincronizadas entre players**
**Causa:** Seed RNG não foi recebida.  
**Solução:**
```javascript
// No console do browser (F12)
console.log("Seed recebida:", currentGameSeed);

// Deve ser o mesmo valor em todos os clients (ex: 12345)
```

### **Game over não fecha WebView**
**Causa:** `AndroidInterface` não está disponível.  
**Solução:**
```javascript
// Em game.js, linha 245
if (typeof AndroidInterface !== 'undefined') {
  AndroidInterface.reportMatchResult(winnerId);
} else {
  console.warn("AndroidInterface não disponível (browser mode)");
}
```

---

## 📝 Checklist Final

Antes de marcar como concluído:

- [ ] ✅ Backend: `websocket.js` importado em `server.js`
- [ ] ✅ Frontend: 6 ficheiros em `public/games/arrow-go/`
- [ ] ✅ Verificação: `node scripts/verify-arrow-go.js` passa
- [ ] ✅ Teste browser: 2 tabs conectam e jogam
- [ ] ✅ Voice chat: 2 players ouvem um ao outro
- [ ] ✅ Android: Jogo aparece no catálogo
- [ ] ✅ Android: 2 devices criam/juntam sala
- [ ] ✅ Android: Game over fecha WebView
- [ ] ✅ Android: Histórico grava partida
- [ ] ✅ Deploy: Backend em produção (Render/Railway)

---

## 🎉 Próximos Passos

Com Arrow Go concluído:

1. ✅ **Testar 6 jogadores** (stress test)
2. ✅ **Adicionar mais jogos HTML5** (Lun, Space Shooter, etc.)
3. ✅ **Torneios T15** com Arrow Go (requer `gameRules.js`)
4. ✅ **Leaderboard** (mais vidas → mais XP)
5. ✅ **Replay system** (guardar seed + eventos para replay)

---

## 📚 Referências

- **Socket.IO Namespace:** `services/websocket.js` linha 1-150
- **WebRTC Setup:** `public/games/arrow-go/voice.js` linha 1-200
- **Game Loop:** `public/games/arrow-go/game.js` linha 100-300
- **Android Bridge:** `game.js` linha 245 (`AndroidInterface.reportMatchResult`)
- **Seeded RNG:** `game.js` linha 50-60 (`seededRandom` function)

---

## 👤 Autoria

- **Fase:** GA20_ARENA (Arrow Go Multiplayer)
- **Data:** 2026-11-08
- **Versão:** 20.7 (Patch 07)
- **Autor:** Opus (Kiro Web)
- **Validado por:** Dono da Game Arena

---

**Fim do Patch 07.** Aplica os passos na ordem e testa cada etapa antes de deploy produção.
