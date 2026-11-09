/**
 * WebSocket Service - Socket.IO Namespaces
 * Suporta múltiplos jogos multiplayer
 */

const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const MAX_LIVES = 3;

// Estado das salas por namespace
const rooms = {
    '/arrow-go': new Map() // roomCode -> { players: [], seed, startedAt, gameState }
};

let io = null;

/**
 * Inicializa o WebSocket (chamado do server.js)
 */
function initWebSocket(server) {
    io = socketIO(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        transports: ['websocket', 'polling']
    });

    console.log('[WebSocket] Inicializando namespaces...');
    
    // Namespace: Arrow Go!
    setupArrowGoNamespace();
    
    return io;
}

/**
 * Arrow Go! - Namespace /arrow-go
 */
function setupArrowGoNamespace() {
    const arrowNS = io.of('/arrow-go');
    
    // Middleware de autenticação
    arrowNS.use((socket, next) => {
        const token = socket.handshake.auth.token;
        
        if (!token) {
            return next(new Error('Token obrigatório'));
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.userId = decoded.userId || decoded.id;
            socket.username = decoded.username || 'Jogador';
            next();
        } catch (err) {
            console.error('[Arrow-Go] Token inválido:', err.message);
            next(new Error('Token inválido'));
        }
    });
    
    arrowNS.on('connection', (socket) => {
        console.log('[Arrow-Go] Cliente conectado:', socket.id);
        
        socket.on('join_room', (data) => handleJoinRoom(arrowNS, socket, data));
        socket.on('lose_life', (data) => handleLoseLife(arrowNS, socket, data));
        socket.on('level_complete', (data) => handleLevelComplete(arrowNS, socket, data));
        
        // Voice chat signaling
        socket.on('voice_offer', (data) => handleVoiceSignal(arrowNS, socket, 'voice_offer', data));
        socket.on('voice_answer', (data) => handleVoiceSignal(arrowNS, socket, 'voice_answer', data));
        socket.on('voice_ice_candidate', (data) => handleVoiceSignal(arrowNS, socket, 'voice_ice_candidate', data));
        
        socket.on('disconnect', () => handleDisconnect(arrowNS, socket));
    });
    
    console.log('[WebSocket] Namespace /arrow-go pronto');
}

/**
 * Jogador entra na sala
 */
function handleJoinRoom(ns, socket, data) {
    const { roomCode, role, playerName } = data;
    
    if (!roomCode) {
        socket.emit('error', { message: 'Código da sala obrigatório' });
        return;
    }
    
    socket.roomCode = roomCode.toUpperCase();
    socket.join(socket.roomCode);
    
    // Obter ou criar sala
    let room = rooms[ns.name].get(socket.roomCode);
    
    if (!room) {
        room = {
            code: socket.roomCode,
            players: [],
            seed: Date.now(), // Seed para RNG sincronizado
            startedAt: null,
            maxPlayers: 6
        };
        rooms[ns.name].set(socket.roomCode, room);
    }
    
    // Verificar se o jogador já está na sala
    let player = room.players.find(p => p.userId === socket.userId);
    
    if (!player) {
        // Novo jogador
        const colors = ['green', 'yellow', 'red', 'white', 'blue', 'purple'];
        const usedColors = room.players.map(p => p.color);
        const availableColors = colors.filter(c => !usedColors.includes(c));
        
        if (availableColors.length === 0) {
            socket.emit('error', { message: 'Sala cheia (6 jogadores)' });
            return;
        }
        
        player = {
            playerId: socket.id,
            userId: socket.userId,
            socketId: socket.id,
            playerName: playerName || socket.username || 'Jogador',
            color: availableColors[0],
            lives: MAX_LIVES,
            eliminated: false,
            score: 0,
            level: 1
        };
        
        room.players.push(player);
    } else {
        // Jogador reconectou
        player.socketId = socket.id;
        player.playerId = socket.id;
    }
    
    console.log(`[Arrow-Go] ${player.playerName} entrou na sala ${socket.roomCode} (${room.players.length}/${room.maxPlayers})`);
    
    // Notificar o jogador que entrou
    socket.emit('room_joined', {
        roomCode: socket.roomCode,
        playerId: player.playerId,
        color: player.color,
        players: room.players.map(serializePlayer),
        waitingFor: room.maxPlayers - room.players.length
    });
    
    // Notificar outros jogadores
    socket.to(socket.roomCode).emit('player_joined', {
        roomCode: socket.roomCode,
        playerId: player.playerId,
        playerName: player.playerName,
        players: room.players.map(serializePlayer),
        waitingFor: room.maxPlayers - room.players.length
    });
    
    // Notificar novos peers para voice chat
    socket.to(socket.roomCode).emit('voice_peer_joined', {
        peerId: socket.id
    });
    
    // Iniciar jogo se tiver 2+ jogadores
    if (room.players.length >= 2 && !room.startedAt) {
        setTimeout(() => startGame(ns, socket.roomCode), 2000);
    }
}

/**
 * Iniciar o jogo
 */
function startGame(ns, roomCode) {
    const room = rooms[ns.name].get(roomCode);
    if (!room || room.startedAt) return;
    
    room.startedAt = Date.now();
    
    console.log(`[Arrow-Go] Jogo iniciado na sala ${roomCode} com ${room.players.length} jogadores`);
    
    ns.to(roomCode).emit('game_start', {
        seed: room.seed,
        players: room.players.map(serializePlayer),
        startedAt: room.startedAt
    });
}

/**
 * Jogador perdeu uma vida
 */
function handleLoseLife(ns, socket, data) {
    const { roomCode, playerId } = data;
    const room = rooms[ns.name].get(roomCode);
    
    if (!room) {
        console.warn('[Arrow-Go] Sala não encontrada:', roomCode);
        return;
    }
    
    const player = room.players.find(p => p.playerId === playerId);
    
    if (!player) {
        console.warn('[Arrow-Go] Jogador não encontrado:', playerId);
        return;
    }
    
    // Remover vida
    player.lives = Math.max(0, player.lives - 1);
    
    console.log(`[Arrow-Go] ${player.playerName} perdeu vida (${player.lives}/${MAX_LIVES})`);
    
    // Verificar se foi eliminado
    if (player.lives === 0) {
        player.eliminated = true;
        console.log(`[Arrow-Go] ${player.playerName} ELIMINADO!`);
    }
    
    // Notificar todos os jogadores
    ns.to(roomCode).emit('player_life_lost', {
        playerId: player.playerId,
        playerName: player.playerName,
        lives: player.lives,
        eliminated: player.eliminated,
        players: room.players.map(serializePlayer)
    });
    
    // Verificar fim de jogo
    checkGameOver(ns, roomCode);
}

/**
 * Jogador completou um nível
 */
function handleLevelComplete(ns, socket, data) {
    const { roomCode, playerId, level, score } = data;
    const room = rooms[ns.name].get(roomCode);
    
    if (!room) return;
    
    const player = room.players.find(p => p.playerId === playerId);
    if (!player) return;
    
    player.level = level;
    player.score = score;
    
    console.log(`[Arrow-Go] ${player.playerName} completou nível ${level} (score: ${score})`);
}

/**
 * Verificar se o jogo acabou
 */
function checkGameOver(ns, roomCode) {
    const room = rooms[ns.name].get(roomCode);
    if (!room) return;
    
    const activePlayers = room.players.filter(p => !p.eliminated);
    
    if (activePlayers.length <= 1) {
        const winner = activePlayers[0] || room.players[0];
        
        // Criar ranking
        const rankings = room.players
            .sort((a, b) => {
                if (a.eliminated && !b.eliminated) return 1;
                if (!a.eliminated && b.eliminated) return -1;
                return b.score - a.score;
            })
            .map((p, index) => ({
                rank: index + 1,
                playerId: p.playerId,
                playerName: p.playerName,
                score: p.score,
                eliminated: p.eliminated
            }));
        
        console.log(`[Arrow-Go] Fim de jogo na sala ${roomCode}. Vencedor: ${winner.playerName}`);
        
        ns.to(roomCode).emit('game_over', {
            winner: winner.playerId,
            winnerName: winner.playerName,
            rankings
        });
        
        // Limpar sala após 10s
        setTimeout(() => {
            rooms[ns.name].delete(roomCode);
            console.log(`[Arrow-Go] Sala ${roomCode} removida`);
        }, 10000);
    }
}

/**
 * Voice chat signaling (relay)
 */
function handleVoiceSignal(ns, socket, eventName, data) {
    const { roomCode, to, offer, answer, candidate } = data;
    
    if (!to) return;
    
    // Relay para o peer específico
    socket.to(to).emit(eventName, {
        from: socket.id,
        offer,
        answer,
        candidate
    });
}

/**
 * Jogador desconectou
 */
function handleDisconnect(ns, socket) {
    console.log('[Arrow-Go] Cliente desconectado:', socket.id);
    
    if (!socket.roomCode) return;
    
    const room = rooms[ns.name].get(socket.roomCode);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
    
    if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        
        // Se o jogo ainda não começou, remover o jogador
        if (!room.startedAt) {
            room.players.splice(playerIndex, 1);
            console.log(`[Arrow-Go] ${player.playerName} saiu antes do início`);
            
            socket.to(socket.roomCode).emit('player_left', {
                playerId: player.playerId,
                playerName: player.playerName,
                players: room.players.map(serializePlayer)
            });
            
            // Se a sala ficou vazia, remover
            if (room.players.length === 0) {
                rooms[ns.name].delete(socket.roomCode);
                console.log(`[Arrow-Go] Sala ${socket.roomCode} removida (vazia)`);
            }
        } else {
            // Jogo já começou - marcar como eliminado
            player.eliminated = true;
            player.lives = 0;
            
            ns.to(socket.roomCode).emit('player_life_lost', {
                playerId: player.playerId,
                playerName: player.playerName,
                lives: 0,
                eliminated: true,
                players: room.players.map(serializePlayer)
            });
            
            // Notificar peers de voice chat
            socket.to(socket.roomCode).emit('voice_peer_left', {
                peerId: socket.id
            });
            
            checkGameOver(ns, socket.roomCode);
        }
    }
}

/**
 * Serializar jogador para enviar ao cliente
 */
function serializePlayer(player) {
    return {
        playerId: player.playerId,
        userId: player.userId,
        playerName: player.playerName,
        color: player.color,
        lives: player.lives,
        eliminated: player.eliminated,
        score: player.score,
        level: player.level
    };
}

/**
 * Health check
 */
function health() {
    const namespaces = {};
    
    if (io) {
        ['/', '/arrow-go'].forEach(name => {
            const ns = io.of(name);
            const roomsCount = rooms[name] ? rooms[name].size : 0;
            
            namespaces[name] = {
                connected: ns.sockets.size,
                rooms: roomsCount,
                recentErrors: false
            };
        });
    }
    
    return {
        up: !!io,
        missing: [],
        namespaces
    };
}

module.exports = {
    initWebSocket,
    health
};
