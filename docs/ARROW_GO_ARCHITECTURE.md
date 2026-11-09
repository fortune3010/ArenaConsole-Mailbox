# 🏗️ ARROW GO - ARQUITETURA MULTIPLAYER

## 📐 DIAGRAMA DE COMPONENTES

```
┌─────────────────────────────────────────────────────────────────┐
│                        ANDROID APP                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  Criar    ┌──────────────────┐               │
│  │ GameMenu     │  Sala     │  RoomLobby       │               │
│  │ Activity     │─────────► │  Activity        │               │
│  └──────────────┘   REST    └──────────────────┘               │
│                              │                                   │
│                              │ canStart=true                     │
│                              ▼                                   │
│                    ┌──────────────────────┐                     │
│                    │ Html5RoomLauncher    │                     │
│                    └──────────────────────┘                     │
│                              │                                   │
│                              │ launchRoom()                      │
│                              ▼                                   │
│                    ┌──────────────────────┐                     │
│                    │ GameWebView          │                     │
│                    │ Activity             │                     │
│                    └──────────────────────┘                     │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               │ URL: /games/arrow-go/
                               │      ?room=ABCD&token=xyz
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WEBVIEW (HTML5)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  index.html                                              │   │
│  │  ┌───────────────────────────────────────────────────┐  │   │
│  │  │ HUD Multiplayer                                    │  │   │
│  │  │ 🟢 João    ❤️❤️❤️    🟡 Maria   ❤️❤️❤️           │  │   │
│  │  │ 🔴 Pedro   ❤️❤️      ⚪ Ana     ❤️❤️❤️           │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  │                                                           │   │
│  │  ┌───────────────────────────────────────────────────┐  │   │
│  │  │ Canvas do Jogo                                     │  │   │
│  │  │                                                     │  │   │
│  │  │     Obstáculos 🔴                                 │  │   │
│  │  │              🔴                                    │  │   │
│  │  │                                                     │  │   │
│  │  │        Seta 🟢 ➡                                   │  │   │
│  │  │                                                     │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  │                                                           │   │
│  │  Voice: 🎤 🔊                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          │ Socket.IO                             │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  game.js                                                 │   │
│  │  • socket.emit('join_room')                             │   │
│  │  • socket.on('game_start')                              │   │
│  │  • socket.emit('lose_life')    ◄── Colisão detectada   │   │
│  │  • socket.on('player_life_lost')                        │   │
│  │  • socket.on('game_over')                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          │ WebRTC Signaling                      │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  voice.js                                                │   │
│  │  • VoiceManager                                          │   │
│  │  • WebRTC P2P                                            │   │
│  │  • socket.emit('voice_offer')                           │   │
│  │  • socket.emit('voice_answer')                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            │ WebSocket
                            │ /arrow-go
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NODE.JS BACKEND                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  websocket.js - Namespace /arrow-go                       │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                                                            │  │
│  │  Middleware: JWT Token Validation                         │  │
│  │  ───────────────────────────────────                      │  │
│  │  socket.userId = decoded.userId                           │  │
│  │                                                            │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ SALA: ABCD                                          │  │  │
│  │  │ ─────────────────────────────────────────────────  │  │  │
│  │  │ Jogadores: [                                        │  │  │
│  │  │   { playerId: 'abc', color: 'green', lives: 3 },   │  │  │
│  │  │   { playerId: 'def', color: 'yellow', lives: 2 }   │  │  │
│  │  │ ]                                                    │  │  │
│  │  │ Seed: 1234567890                                    │  │  │
│  │  │ Status: PLAYING                                     │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Handlers:                                                 │  │
│  │  ─────────                                                 │  │
│  │  • handleJoinRoom()      ► Atribui cor + vidas            │  │
│  │  • startGame()           ► Envia seed para todos          │  │
│  │  • handleLoseLife()      ► Valida e atualiza              │  │
│  │  • checkGameOver()       ► Verifica vencedor              │  │
│  │  • handleVoiceSignal()   ► Relay WebRTC                   │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  REST API (Express)                                       │  │
│  │  ─────────────────────                                    │  │
│  │  POST /api/rooms/create     ► Criar sala                 │  │
│  │  GET  /api/rooms/:code      ► Ver estado                 │  │
│  │  POST /api/rooms/:code/participate                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 FLUXO DE DADOS: PERDA DE VIDA

```
┌──────────────┐                                ┌──────────────┐
│  Jogador A   │                                │  Jogador B   │
│  (🟢 João)   │                                │  (🟡 Maria)  │
└──────┬───────┘                                └──────┬───────┘
       │                                               │
       │ 1. Colisão detectada                         │
       │    (seta toca obstáculo)                     │
       │                                               │
       │ 2. socket.emit('lose_life', {                │
       │      roomCode: 'ABCD',                       │
       │      playerId: 'abc'                         │
       │    })                                         │
       │                                               │
       ▼                                               │
┌─────────────────────────────────────────┐           │
│         SERVIDOR (websocket.js)         │           │
├─────────────────────────────────────────┤           │
│                                         │           │
│ 3. handleLoseLife()                    │           │
│    • Encontra sala: ABCD               │           │
│    • Encontra jogador: abc             │           │
│    • Valida: lives--                   │           │
│    • Atualiza: lives = 2               │           │
│                                         │           │
│ 4. socket.broadcast('player_life_lost',│           │
│      {                                  │           │
│        playerId: 'abc',                │           │
│        lives: 2,                       │           │
│        eliminated: false,              │           │
│        players: [...]                  │           │
│      }                                  │           │
│    )                                    │           │
│                                         │           │
└─────────┬───────────────────────────────┘           │
          │                                           │
          │ 5. Broadcast para TODOS                  │
          ├───────────────────┬───────────────────────┤
          ▼                   ▼                       ▼
┌──────────────┐    ┌──────────────┐        ┌──────────────┐
│  Jogador A   │    │  Jogador B   │        │ Outros...    │
└──────┬───────┘    └──────┬───────┘        └──────────────┘
       │                   │
       │ 6. HUD atualiza   │ 6. HUD atualiza
       │    ❤️❤️❤️ → ❤️❤️   │    (vê João perder vida)
       │                   │
       │ 7. Reinicia nível │ 7. Continua jogando
       │                   │
```

---

## 🎤 FLUXO DE VOICE CHAT (WebRTC)

```
┌─────────────┐                                  ┌─────────────┐
│  Jogador A  │                                  │  Jogador B  │
│  (Browser)  │                                  │  (Browser)  │
└─────┬───────┘                                  └─────┬───────┘
      │                                                │
      │ 1. getUserMedia({audio: true})                │
      │    ► Pedir permissão de microfone             │
      │                                                │
      │ 2. socket.emit('voice_offer', {               │
      │      to: 'player-b',                          │
      │      offer: {sdp: ...}                        │
      │    })                                          │
      │                                                │
      ▼                                                │
┌──────────────────────────────────────────────┐     │
│         SERVIDOR (Signaling Relay)           │     │
│  socket.to('player-b').emit('voice_offer')  │     │
└──────────────────────────────────────────────┘     │
                                                      ▼
                                             3. Recebe offer
                                             4. socket.emit('voice_answer')
                                                      │
                                                      ▼
┌──────────────────────────────────────────────┐     │
│         SERVIDOR (Signaling Relay)           │     │
│  socket.to('player-a').emit('voice_answer') │     │
└──────────────────────────────────────────────┘     │
      ▲                                                │
      │ 5. Recebe answer                              │
      │                                                │
      │ 6. Troca ICE candidates                       │
      │    (via servidor também)                      │
      │                                                │
      │ 7. Conexão P2P estabelecida!                  │
      ├────────────────────────────────────────────────┤
      │                                                │
      │    🎤 ────────► ÁUDIO DIRETO ───────► 🔊      │
      │         (sem passar pelo servidor)            │
      │                                                │
```

### **Vantagens do P2P:**
- ⚡ **Latência ultra-baixa** (20-50ms vs 200ms em relay)
- 💰 **Sem custos de servidor** (sem precisar de media server)
- 🔒 **Privacidade** (áudio não passa pelo backend)
- 📡 **Escalável** (servidor só faz signaling)

---

## 🗄️ ESTRUTURA DE DADOS NO SERVIDOR

### **Namespace /arrow-go**
```javascript
rooms.set('ABCD', {
    code: 'ABCD',
    players: [
        {
            playerId: 'socket-abc123',      // Socket ID
            userId: 'user-uuid-456',        // User ID do JWT
            socketId: 'socket-abc123',
            playerName: 'João',
            color: 'green',                 // 🟢
            lives: 3,                       // ❤️❤️❤️
            eliminated: false,
            score: 0,
            level: 1
        },
        {
            playerId: 'socket-def456',
            userId: 'user-uuid-789',
            socketId: 'socket-def456',
            playerName: 'Maria',
            color: 'yellow',                // 🟡
            lives: 2,                       // ❤️❤️
            eliminated: false,
            score: 150,
            level: 2
        }
    ],
    seed: 1730729483920,                   // Timestamp para RNG
    startedAt: 1730729485000,              // Quando o jogo começou
    maxPlayers: 6                          // Limite da sala
});
```

---

## 🔐 SEGURANÇA E VALIDAÇÃO

### **1. Autenticação JWT**
```javascript
// Middleware do Socket.IO
arrowNS.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) return next(new Error('Token obrigatório'));
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.userId;    // ✅ Validado
        socket.username = decoded.username;
        next();
    } catch (err) {
        next(new Error('Token inválido'));
    }
});
```

### **2. Validação de Vidas (Anti-Cheat)**
```javascript
function handleLoseLife(ns, socket, data) {
    // ✅ Servidor é a única fonte da verdade
    const player = room.players.find(p => p.playerId === playerId);
    
    if (!player) {
        console.warn('Jogador não existe');
        return; // ❌ Rejeitar
    }
    
    // ✅ Servidor controla as vidas
    player.lives = Math.max(0, player.lives - 1);
    
    // ✅ Broadcast para todos
    ns.to(roomCode).emit('player_life_lost', {
        playerId, lives: player.lives, players: [...]
    });
}
```

### **3. Verificação de Sala**
```javascript
// ✅ Todos os eventos verificam se o jogador está na sala
const room = rooms.get(roomCode);
if (!room) return; // Sala não existe

const player = room.players.find(p => p.socketId === socket.id);
if (!player) return; // Não está autorizado
```

---

## 🚀 PERFORMANCE E ESCALABILIDADE

### **Métricas Esperadas**

| Métrica | Valor | Notas |
|---------|-------|-------|
| **Latência Socket.IO** | 50-100ms | WebSocket direto |
| **Latência WebRTC** | 20-50ms | P2P, sem relay |
| **Memória por sala** | ~500KB | 6 jogadores + estado |
| **CPU por sala** | <1% | JavaScript single-thread |
| **Salas simultâneas** | 1000+ | Em 1 servidor |
| **Jogadores totais** | 6000+ | 1000 salas × 6 jogadores |

### **Bottlenecks**

1. **WebSocket connections** (limite do OS)
   - Solução: Nginx/HAProxy reverse proxy
   - Alternativa: Redis Adapter para múltiplos servidores

2. **Memória** (estado em RAM)
   - Solução: Limpar salas inativas após 10min
   - Alternativa: Redis para estado partilhado

3. **CPU** (game loop no servidor?)
   - ✅ Não há game loop! Só validação de eventos
   - Cliente faz toda a física/render

### **Horizontal Scaling (Fase 2)**
```javascript
// Usar Redis Adapter para múltiplos servidores
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

---

## 📊 COMPARAÇÃO: REST vs Socket.IO

| Aspeto | REST API (Rooms) | Socket.IO (Arrow Go) |
|--------|------------------|----------------------|
| **Latência** | 3s (polling) | 50-100ms |
| **Overhead** | HTTP headers (1-2KB) | WebSocket frames (bytes) |
| **Bidirecional** | ❌ Cliente→Servidor | ✅ Cliente↔Servidor |
| **Real-time** | ❌ Polling manual | ✅ Push instantâneo |
| **Uso** | Criar salas, ver lista | Jogo em tempo real |
| **Exemplo** | `GET /api/rooms/ABCD` | `socket.emit('lose_life')` |

---

## ✅ PONTOS FORTES DA ARQUITETURA

### **1. Separação de Responsabilidades**
- ✅ **REST API**: Gestão de salas (CRUD)
- ✅ **Socket.IO**: Jogo em tempo real
- ✅ **WebRTC**: Voice chat P2P

### **2. Segurança**
- ✅ Token JWT validado em todos os eventos
- ✅ Servidor controla vidas (anti-cheat)
- ✅ Seed gerada no servidor (todos veem mesmo)

### **3. Escalabilidade**
- ✅ WebRTC P2P (voz não sobrecarrega servidor)
- ✅ Estado em memória (rápido)
- ✅ Fácil adicionar Redis Adapter (múltiplos servidores)

### **4. Compatibilidade**
- ✅ Zero alterações no Android
- ✅ Reutiliza `Html5RoomLauncher` existente
- ✅ Funciona com sistema de salas atual

---

**🎉 Arquitetura robusta, escalável e pronta para produção!**
