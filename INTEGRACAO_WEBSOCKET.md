# 🔌 INTEGRAÇÃO ARROW GO - WEBSOCKET.JS

## 📋 Linha de Integração

Adiciona esta linha no teu `backend/services/websocket.js` (seguindo o padrão modular):

```javascript
// Arrow Go (2-6 players, lives tracking, WebRTC voice)
try { 
  require('./arrowgo-namespace').setupArrowGoNamespace(io, { 
    onFinish: (() => { 
      try { 
        return require('./ga16MatchReport').hook(supabase, 'arrow-go'); 
      } catch (e) { 
        return null; 
      } 
    })(), 
    persist: snapshotPersist('arrow-go') 
  }); 
} catch (e) { 
  console.error('[WS-ARROW-GO] falhou:', e.message); 
}
```

---

## 📂 Ficheiro Criado

**Localização:** `backend/services/arrowgo-namespace.js`

**Exports:**
```javascript
module.exports = { setupArrowGoNamespace };
```

**Função:**
```javascript
setupArrowGoNamespace(io, options)
```

**Parâmetros:**
- `io` - Instância Socket.IO server
- `options.onFinish` - Hook GA16 para match reporting (opcional)
- `options.persist` - Snapshot persistence (opcional)

---

## 🎯 O que o Namespace Faz

### **Eventos Recebidos (Client → Server):**

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `join_room` | `{roomCode, username, token}` | Player entra na sala |
| `lose_life` | `{roomCode}` | Player colide com obstáculo |
| `level_complete` | `{roomCode, level}` | Player completa nível |
| `voice_offer` | `{offer, targetId}` | WebRTC offer (P2P signaling) |
| `voice_answer` | `{answer, targetId}` | WebRTC answer (P2P signaling) |
| `voice_ice_candidate` | `{candidate, targetId}` | ICE candidate (P2P signaling) |

### **Eventos Enviados (Server → Client):**

| Evento | Payload | Quando |
|--------|---------|--------|
| `room_joined` | `{room, players, yourColor, yourId}` | Confirmação entrada |
| `player_joined` | `{player}` | Novo player entrou (broadcast) |
| `game_start` | `{seed, players, startedAt}` | Jogo inicia (MIN_PLAYERS) |
| `player_life_lost` | `{playerId, username, lives}` | Player perdeu vida (broadcast) |
| `player_eliminated` | `{playerId, username}` | Player eliminado (lives=0) |
| `player_achievement` | `{playerId, username, achievement}` | Player conquista (opcional) |
| `game_over` | `{winnerId, winnerName, players, endedAt}` | Jogo terminou |
| `player_left` | `{playerId, username}` | Player desconectou |
| `error` | `{message}` | Erro (sala cheia, etc) |

---

## 🔧 Constantes do Namespace

```javascript
const MAX_LIVES = 3;           // 3 vidas por jogador
const MIN_PLAYERS = 2;         // Mínimo para iniciar
const MAX_PLAYERS = 6;         // Máximo na sala
const PLAYER_COLORS = ['green', 'yellow', 'red', 'white', 'blue', 'purple'];
const PLAYER_ICONS = ['🟢', '🟡', '🔴', '⚪', '🔵', '🟣'];
```

---

## 🎮 Fluxo do Jogo

### **1. Entrada na Sala**
```
Player → emit: join_room({roomCode, username})
Server → Cria/obtém sala
Server → Atribui cor disponível (green/yellow/red/white/blue/purple)
Server → emit: room_joined({room, players, yourColor})
Server → broadcast: player_joined({player})
```

### **2. Início do Jogo**
```
Server → Detecta MIN_PLAYERS (2)
Server → Gera seed aleatória (1-1000000)
Server → emit: game_start({seed, players})
Clients → Iniciam game loop com seededRandom(seed)
```

### **3. Gameplay (Lives Tracking)**
```
Client → Deteta colisão com obstáculo
Client → emit: lose_life({roomCode})
Server → Valida player exists (server-authoritative)
Server → Decrementa player.lives (3 → 2 → 1 → 0)
Server → broadcast: player_life_lost({playerId, lives})
Clients → Atualizam HUD (remove ❤️)

Se lives = 0:
  Server → player.isAlive = false
  Server → broadcast: player_eliminated({playerId})
  Server → checkGameOver()
```

### **4. Game Over**
```
Server → Conta players vivos (alivePlayers)
Se alivePlayers <= 1:
  Server → winner = último vivo (ou null se todos mortos)
  Server → emit: game_over({winnerId, winnerName, players})
  
  Se onFinish hook disponível:
    Server → onFinish({roomCode, gameKey, winnerId, players, duration})
    Server → GA16 grava histórico match
  
  Server → setTimeout(10s) → remove sala
```

---

## 🔒 JWT Middleware

O namespace tem middleware JWT **opcional**:

```javascript
arrowGoNamespace.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  
  if (!token) {
    console.warn('Socket sem token:', socket.id);
    return next(); // Permite conexão (modo debug)
  }
  
  // JWT validation (adaptar ao vosso sistema)
  // const decoded = jwt.verify(token, process.env.JWT_SECRET);
  // socket.userId = decoded.userId;
  
  next();
});
```

**Como adaptar:**
1. Se tens JWT validation no teu `websocket.js`, remove o bloco `jwt.verify` do `arrowgo-namespace.js`
2. Ou substitui por: `const decoded = yourJwtValidationFunction(token);`

---

## 📦 Hook GA16 (Match Reporting)

O namespace chama `onFinish` hook quando jogo termina:

```javascript
const matchResult = {
  roomCode: 'ABCD',
  gameKey: 'arrow-go',
  winnerId: 'socket-id-123',
  winnerUsername: 'Player1',
  players: [
    { id: 'socket-id-123', username: 'Player1', lives: 2, isAlive: true, placement: 1 },
    { id: 'socket-id-456', username: 'Player2', lives: 0, isAlive: false, placement: 0 }
  ],
  duration: 120000, // ms
  seed: 123456
};

onFinish(matchResult);
```

**Formato compatível com GA16:**
- `roomCode` - Código da sala
- `gameKey` - `'arrow-go'` (identifier)
- `winnerId` - Socket ID do vencedor (ou null)
- `players` - Array com stats de todos jogadores
- `duration` - Duração partida (ms)
- `seed` - Seed RNG usada

Se o teu `ga16MatchReport.hook()` espera formato diferente, adapta na função `checkGameOver()`.

---

## 🧹 Cleanup Automático

O namespace remove salas automaticamente:

**1. Sala vazia após disconnect:**
```javascript
if (room.players.size === 0) {
  rooms.delete(roomCode);
}
```

**2. Sala após game over:**
```javascript
setTimeout(() => {
  rooms.delete(roomCode);
}, 10000); // 10 segundos
```

**3. Salas antigas (timeout):**
```javascript
setInterval(() => {
  const ROOM_TIMEOUT = 30 * 60 * 1000; // 30 min
  // Remove salas criadas há mais de 30 min sem players
}, 5 * 60 * 1000); // Check a cada 5 min
```

---

## ✅ Verificação

Depois de adicionar a linha no `websocket.js`:

**1. Verifica logs do servidor:**
```bash
npm start

# Deve aparecer:
# [ARROW-GO] Namespace /arrow-go inicializado
```

**2. Testa conexão:**
```bash
# Abre test-client.html no browser
http://localhost:3000/games/arrow-go/test-client.html

# Console deve mostrar:
# Socket connected
# Room joined: TEST
```

**3. Valida eventos:**
```javascript
// No console do browser (F12)
socket.on('game_start', (data) => {
  console.log('Game started with seed:', data.seed);
});
```

---

## 🚨 Troubleshooting

### **Erro: "Cannot find module './arrowgo-namespace'"**
**Solução:** Verifica se ficheiro está em `backend/services/arrowgo-namespace.js`

### **Erro: "setupArrowGoNamespace is not a function"**
**Solução:** Verifica se `module.exports = { setupArrowGoNamespace }` existe no final do ficheiro

### **Namespace não inicializa (sem log)**
**Solução:** Verifica se linha de `require()` está no `websocket.js` e não tem typo

### **GA16 hook não chama**
**Solução:** Verifica se `ga16MatchReport.hook()` existe. Se não, remove o bloco `onFinish` do require:
```javascript
try { 
  require('./arrowgo-namespace').setupArrowGoNamespace(io, {}); 
} catch (e) { 
  console.error('[WS-ARROW-GO] falhou:', e.message); 
}
```

### **Players não sincronizam (setas diferentes)**
**Solução:** Verifica se `game_start` emitiu `seed`. No client, verifica `seededRandom(seed)` está implementado.

---

## 📄 Linha Completa (Copy-Paste)

```javascript
// Arrow Go (2-6 players, lives tracking, WebRTC voice)
try { require('./arrowgo-namespace').setupArrowGoNamespace(io, { onFinish: (() => { try { return require('./ga16MatchReport').hook(supabase, 'arrow-go'); } catch (e) { return null; } })(), persist: snapshotPersist('arrow-go') }); } catch (e) { console.error('[WS-ARROW-GO] falhou:', e.message); }
```

**Onde adicionar:**
No teu `backend/services/websocket.js`, procura o bloco de requires dos outros jogos (Ludo, etc) e adiciona esta linha junto deles.

---

## 🎉 Tudo Pronto!

Depois de adicionar a linha:
1. ✅ Restart backend (`npm restart`)
2. ✅ Verifica logs: `[ARROW-GO] Namespace /arrow-go inicializado`
3. ✅ Testa com test-client.html (2 tabs)
4. ✅ Deploy produção

**Arrow Go 100% integrado no padrão modular!** 🚀
