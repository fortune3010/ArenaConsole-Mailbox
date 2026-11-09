/**
 * Arrow Go Namespace - Socket.IO multiplayer (2-6 players)
 * Integração GA16: lives tracking, game over detection, match reporting
 * WebRTC: P2P voice chat signaling relay
 */

const MAX_LIVES = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const PLAYER_COLORS = ['green', 'yellow', 'red', 'white', 'blue', 'purple'];
const PLAYER_ICONS = ['🟢', '🟡', '🔴', '⚪', '🔵', '🟣'];

// Room state storage
const rooms = new Map();

/**
 * Setup Arrow Go namespace following GameArena modular pattern
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {Object} options - { onFinish: ga16Hook, persist: snapshotPersist }
 */
function setupArrowGoNamespace(io, options = {}) {
  const arrowGoNamespace = io.of('/arrow-go');
  const { onFinish, persist } = options;

  console.log('[ARROW-GO] Namespace /arrow-go inicializado');

  // JWT middleware validation (se disponível)
  arrowGoNamespace.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        console.warn('[ARROW-GO] Socket sem token:', socket.id);
        // Permite conexão mesmo sem token (modo debug)
        return next();
      }

      // JWT validation (adaptar ao vosso sistema)
      // const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // socket.userId = decoded.userId;
      // socket.username = decoded.username;
      
      next();
    } catch (error) {
      console.error('[ARROW-GO] JWT validation error:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  arrowGoNamespace.on('connection', (socket) => {
    console.log('[ARROW-GO] Cliente conectado:', socket.id);

    // JOIN ROOM
    socket.on('join_room', (data) => {
      try {
        const { roomCode, username, token } = data;

        if (!roomCode || !username) {
          return socket.emit('error', { message: 'roomCode e username obrigatórios' });
        }

        // Normaliza room code
        const normalizedRoomCode = roomCode.toUpperCase().trim();

        // Cria ou obtém sala
        if (!rooms.has(normalizedRoomCode)) {
          rooms.set(normalizedRoomCode, {
            code: normalizedRoomCode,
            players: new Map(),
            gameStarted: false,
            seed: null,
            createdAt: Date.now()
          });
          console.log('[ARROW-GO] Sala criada:', normalizedRoomCode);
        }

        const room = rooms.get(normalizedRoomCode);

        // Verifica limite de jogadores
        if (room.players.size >= MAX_PLAYERS) {
          return socket.emit('error', { message: 'Sala cheia (máx 6 jogadores)' });
        }

        // Verifica se jogo já começou
        if (room.gameStarted) {
          return socket.emit('error', { message: 'Jogo já iniciado' });
        }

        // Atribui cor disponível
        const usedColors = Array.from(room.players.values()).map(p => p.color);
        const availableColor = PLAYER_COLORS.find(c => !usedColors.includes(c));

        if (!availableColor) {
          return socket.emit('error', { message: 'Todas as cores ocupadas' });
        }

        const colorIndex = PLAYER_COLORS.indexOf(availableColor);

        // Cria jogador
        const player = {
          id: socket.id,
          username: username,
          color: availableColor,
          icon: PLAYER_ICONS[colorIndex],
          lives: MAX_LIVES,
          isAlive: true,
          joinedAt: Date.now()
        };

        // Adiciona à sala
        room.players.set(socket.id, player);
        socket.join(normalizedRoomCode);
        socket.roomCode = normalizedRoomCode;

        console.log(`[ARROW-GO] ${username} entrou na sala ${normalizedRoomCode} (${room.players.size}/${MAX_PLAYERS})`);

        // Confirma entrada ao cliente
        socket.emit('room_joined', {
          room: {
            code: normalizedRoomCode,
            playerCount: room.players.size,
            gameStarted: room.gameStarted
          },
          players: Array.from(room.players.values()),
          yourColor: availableColor,
          yourId: socket.id
        });

        // Notifica outros jogadores
        socket.to(normalizedRoomCode).emit('player_joined', { player });

        // Inicia jogo se atingir MIN_PLAYERS
        if (room.players.size >= MIN_PLAYERS && !room.gameStarted) {
          setTimeout(() => startGame(arrowGoNamespace, normalizedRoomCode), 1000);
        }

      } catch (error) {
        console.error('[ARROW-GO] Erro em join_room:', error);
        socket.emit('error', { message: 'Erro ao entrar na sala' });
      }
    });

    // LOSE LIFE (player colide com obstáculo)
    socket.on('lose_life', (data) => {
      try {
        const { roomCode } = data;
        const normalizedRoomCode = roomCode?.toUpperCase().trim();

        if (!normalizedRoomCode || !rooms.has(normalizedRoomCode)) {
          return socket.emit('error', { message: 'Sala não encontrada' });
        }

        const room = rooms.get(normalizedRoomCode);
        const player = room.players.get(socket.id);

        if (!player) {
          return socket.emit('error', { message: 'Jogador não encontrado' });
        }

        if (!player.isAlive) {
          return; // Já eliminado
        }

        // Decrementa vida (server-authoritative)
        player.lives = Math.max(0, player.lives - 1);

        console.log(`[ARROW-GO] ${player.username} perdeu vida (${player.lives}/${MAX_LIVES})`);

        // Broadcast atualização
        arrowGoNamespace.to(normalizedRoomCode).emit('player_life_lost', {
          playerId: socket.id,
          username: player.username,
          lives: player.lives
        });

        // Verifica eliminação
        if (player.lives === 0) {
          player.isAlive = false;
          console.log(`[ARROW-GO] ${player.username} foi eliminado`);

          arrowGoNamespace.to(normalizedRoomCode).emit('player_eliminated', {
            playerId: socket.id,
            username: player.username
          });

          // Verifica game over
          checkGameOver(arrowGoNamespace, normalizedRoomCode, onFinish);
        }

      } catch (error) {
        console.error('[ARROW-GO] Erro em lose_life:', error);
      }
    });

    // LEVEL COMPLETE (player terminou nível/fase)
    socket.on('level_complete', (data) => {
      try {
        const { roomCode, level } = data;
        const normalizedRoomCode = roomCode?.toUpperCase().trim();

        if (!normalizedRoomCode || !rooms.has(normalizedRoomCode)) {
          return;
        }

        const room = rooms.get(normalizedRoomCode);
        const player = room.players.get(socket.id);

        if (player) {
          console.log(`[ARROW-GO] ${player.username} completou nível ${level}`);
          
          // Broadcast conquista (opcional)
          arrowGoNamespace.to(normalizedRoomCode).emit('player_achievement', {
            playerId: socket.id,
            username: player.username,
            achievement: `level_${level}_complete`
          });
        }

      } catch (error) {
        console.error('[ARROW-GO] Erro em level_complete:', error);
      }
    });

    // VOICE SIGNALING (WebRTC P2P)
    socket.on('voice_offer', (data) => {
      try {
        const { offer, targetId } = data;
        arrowGoNamespace.to(targetId).emit('voice_offer', {
          offer,
          senderId: socket.id
        });
      } catch (error) {
        console.error('[ARROW-GO] Erro em voice_offer:', error);
      }
    });

    socket.on('voice_answer', (data) => {
      try {
        const { answer, targetId } = data;
        arrowGoNamespace.to(targetId).emit('voice_answer', {
          answer,
          senderId: socket.id
        });
      } catch (error) {
        console.error('[ARROW-GO] Erro em voice_answer:', error);
      }
    });

    socket.on('voice_ice_candidate', (data) => {
      try {
        const { candidate, targetId } = data;
        arrowGoNamespace.to(targetId).emit('voice_ice_candidate', {
          candidate,
          senderId: socket.id
        });
      } catch (error) {
        console.error('[ARROW-GO] Erro em voice_ice_candidate:', error);
      }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
      try {
        console.log('[ARROW-GO] Cliente desconectado:', socket.id);

        const roomCode = socket.roomCode;
        if (!roomCode || !rooms.has(roomCode)) {
          return;
        }

        const room = rooms.get(roomCode);
        const player = room.players.get(socket.id);

        if (player) {
          console.log(`[ARROW-GO] ${player.username} saiu da sala ${roomCode}`);

          // Remove jogador
          room.players.delete(socket.id);

          // Notifica outros
          socket.to(roomCode).emit('player_left', {
            playerId: socket.id,
            username: player.username
          });

          // Verifica game over (se jogo iniciado)
          if (room.gameStarted) {
            checkGameOver(arrowGoNamespace, roomCode, onFinish);
          }

          // Remove sala vazia
          if (room.players.size === 0) {
            rooms.delete(roomCode);
            console.log(`[ARROW-GO] Sala ${roomCode} removida (vazia)`);
          }
        }

      } catch (error) {
        console.error('[ARROW-GO] Erro em disconnect:', error);
      }
    });
  });

  // Cleanup salas antigas (30 min sem atividade)
  setInterval(() => {
    const now = Date.now();
    const ROOM_TIMEOUT = 30 * 60 * 1000; // 30 min

    for (const [code, room] of rooms.entries()) {
      if (now - room.createdAt > ROOM_TIMEOUT && room.players.size === 0) {
        rooms.delete(code);
        console.log(`[ARROW-GO] Sala ${code} removida (timeout)`);
      }
    }
  }, 5 * 60 * 1000); // Check a cada 5 min

  return arrowGoNamespace;
}

/**
 * Inicia jogo (envia seed para sincronização RNG)
 */
function startGame(namespace, roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.gameStarted) {
    return;
  }

  room.gameStarted = true;
  room.seed = Math.floor(Math.random() * 1000000);

  console.log(`[ARROW-GO] Jogo iniciado na sala ${roomCode} (${room.players.size} players, seed: ${room.seed})`);

  namespace.to(roomCode).emit('game_start', {
    seed: room.seed,
    players: Array.from(room.players.values()),
    startedAt: Date.now()
  });
}

/**
 * Verifica game over (1 jogador vivo ou todos mortos)
 */
function checkGameOver(namespace, roomCode, onFinish) {
  const room = rooms.get(roomCode);
  if (!room || !room.gameStarted) {
    return;
  }

  const alivePlayers = Array.from(room.players.values()).filter(p => p.isAlive);

  // Game over: 1 vencedor ou todos eliminados
  if (alivePlayers.length <= 1) {
    const winner = alivePlayers[0] || null;

    console.log(`[ARROW-GO] Game over na sala ${roomCode}. Vencedor: ${winner?.username || 'nenhum'}`);

    namespace.to(roomCode).emit('game_over', {
      winnerId: winner?.id || null,
      winnerName: winner?.username || null,
      winnerColor: winner?.color || null,
      players: Array.from(room.players.values()),
      endedAt: Date.now()
    });

    // Hook GA16 (se disponível)
    if (onFinish && typeof onFinish === 'function') {
      try {
        const matchResult = {
          roomCode: roomCode,
          gameKey: 'arrow-go',
          winnerId: winner?.id || null,
          winnerUsername: winner?.username || null,
          players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            username: p.username,
            lives: p.lives,
            isAlive: p.isAlive,
            placement: p.isAlive ? 1 : 0
          })),
          duration: Date.now() - room.createdAt,
          seed: room.seed
        };

        onFinish(matchResult);
        console.log('[ARROW-GO] GA16 hook chamado:', matchResult.roomCode);
      } catch (error) {
        console.error('[ARROW-GO] Erro no GA16 hook:', error);
      }
    }

    // Limpa sala após 10s
    setTimeout(() => {
      rooms.delete(roomCode);
      console.log(`[ARROW-GO] Sala ${roomCode} removida (game over)`);
    }, 10000);
  }
}

module.exports = { setupArrowGoNamespace };
