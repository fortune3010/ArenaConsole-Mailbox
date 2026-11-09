/**
 * ARROW GO! - MULTIPLAYER VERSION
 * Sistema de vidas compartilhado com sincronização via Socket.IO
 */

// ========== CONFIGURAÇÃO ==========
const MAX_LIVES = 3;
const PLAYER_COLORS = ['green', 'yellow', 'red', 'white', 'blue', 'purple'];
const PLAYER_ICONS = ['🟢', '🟡', '🔴', '⚪', '🔵', '🟣'];

// ========== ESTADO DO JOGO ==========
let canvas, ctx;
let socket;
let voiceManager;
let myPlayerId = null;
let myColor = null;
let roomCode = null;
let gameStarted = false;
let gameSeed = null;

// Estado dos jogadores (sincronizado)
let players = {}; // { playerId: { name, color, lives, eliminated, icon } }

// Estado do jogo local
let arrow = { x: 0, y: 0, dx: 0, dy: 0, angle: 0, speed: 0 };
let obstacles = [];
let score = 0;
let level = 1;
let gameOver = false;
let pausedByElimination = false;

// Controles
let touchStartX = 0;
let touchStartY = 0;
let isTouching = false;

// ========== INICIALIZAÇÃO ==========
window.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    connectToRoom();
    setupControls();
    setupVoiceChat();
});

function initCanvas() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// ========== SOCKET.IO CONNECTION ==========
function connectToRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    roomCode = urlParams.get('room');
    const role = urlParams.get('role') || 'guest';
    const startToken = urlParams.get('token');

    if (!roomCode || !startToken) {
        showError('Parâmetros inválidos. Abre o jogo pelo lobby.');
        return;
    }

    updateRoomCode(roomCode);
    updateStatus('Conectando...');

    // Conectar ao namespace /arrow-go
    socket = io('/arrow-go', {
        auth: { token: startToken },
        transports: ['websocket']
    });

    socket.on('connect', () => {
        console.log('[Socket] Conectado:', socket.id);
        socket.emit('join_room', { 
            roomCode, 
            role,
            playerName: 'Jogador' // TODO: pegar do Android via AndroidInterface
        });
    });

    socket.on('room_joined', (data) => {
        console.log('[Room] Entrei na sala:', data);
        myPlayerId = data.playerId;
        myColor = data.color;
        updatePlayers(data.players);
        updateStatus(`Aguardando ${data.waitingFor} jogador(es)...`);
    });

    socket.on('player_joined', (data) => {
        console.log('[Room] Novo jogador:', data);
        updatePlayers(data.players);
        updateStatus(`Aguardando ${data.waitingFor} jogador(es)...`);
    });

    socket.on('game_start', (data) => {
        console.log('[Game] Início!', data);
        gameSeed = data.seed;
        updatePlayers(data.players);
        startGame();
    });

    socket.on('player_life_lost', (data) => {
        console.log('[Life] Jogador perdeu vida:', data);
        updatePlayers(data.players);
        
        if (data.playerId === myPlayerId && !gameOver) {
            // Eu perdi uma vida - reiniciar nível
            resetLevel();
        }
        
        if (data.eliminated) {
            console.log('[Eliminated]', data.playerId);
            if (data.playerId === myPlayerId) {
                eliminateMe();
            }
        }
    });

    socket.on('game_over', (data) => {
        console.log('[Game] Fim de jogo:', data);
        endGame(data.winner, data.rankings);
    });

    socket.on('player_left', (data) => {
        console.log('[Room] Jogador saiu:', data);
        updatePlayers(data.players);
    });

    socket.on('connect_error', (error) => {
        console.error('[Socket] Erro:', error);
        showError('Erro de conexão. Tenta reabrir a sala.');
    });

    socket.on('disconnect', () => {
        console.log('[Socket] Desconectado');
        if (!gameOver) {
            showError('Conexão perdida. Verifica a internet.');
        }
    });
}

// ========== ATUALIZAÇÃO DA UI ==========
function updateRoomCode(code) {
    document.getElementById('roomCode').textContent = `Sala: ${code}`;
}

function updateStatus(text) {
    document.getElementById('gameStatus').textContent = text;
    document.getElementById('waitingText').textContent = text;
}

function updatePlayers(playersData) {
    players = {};
    playersData.forEach(p => {
        players[p.playerId] = {
            name: p.playerName,
            color: p.color,
            lives: p.lives,
            eliminated: p.eliminated,
            icon: PLAYER_ICONS[PLAYER_COLORS.indexOf(p.color)]
        };
    });
    renderPlayersHUD();
}

function renderPlayersHUD() {
    const container = document.getElementById('playersStatus');
    container.innerHTML = '';
    
    Object.entries(players).forEach(([playerId, player]) => {
        const isMe = playerId === myPlayerId;
        const slot = document.createElement('div');
        slot.className = 'player-slot';
        
        const indicator = document.createElement('div');
        indicator.className = `player-indicator color-${player.color} ${isMe ? 'active' : ''}`;
        indicator.textContent = player.icon;
        
        const livesContainer = document.createElement('div');
        livesContainer.className = 'player-lives';
        for (let i = 0; i < MAX_LIVES; i++) {
            const life = document.createElement('div');
            life.className = `life-icon ${i >= player.lives ? 'lost' : ''}`;
            livesContainer.appendChild(life);
        }
        
        const name = document.createElement('div');
        name.className = 'player-name';
        name.textContent = isMe ? 'TU' : player.name;
        
        slot.appendChild(indicator);
        slot.appendChild(livesContainer);
        slot.appendChild(name);
        container.appendChild(slot);
    });
}

function showError(message) {
    updateStatus(message);
    setTimeout(() => {
        if (window.AndroidInterface && window.AndroidInterface.close) {
            window.AndroidInterface.close();
        }
    }, 3000);
}

// ========== CONTROLES ==========
function setupControls() {
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
}

function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isTouching = true;
}

function handleTouchMove(e) {
    e.preventDefault();
    if (!isTouching || !gameStarted || gameOver || pausedByElimination) return;
    
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    
    arrow.angle = Math.atan2(dy, dx);
}

function handleTouchEnd(e) {
    e.preventDefault();
    if (!isTouching || !gameStarted || gameOver || pausedByElimination) return;
    
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 20) {
        launchArrow(dx, dy);
    }
    
    isTouching = false;
}

function handleMouseDown(e) {
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    isTouching = true;
}

function handleMouseMove(e) {
    if (!isTouching || !gameStarted || gameOver || pausedByElimination) return;
    
    const dx = e.clientX - touchStartX;
    const dy = e.clientY - touchStartY;
    arrow.angle = Math.atan2(dy, dx);
}

function handleMouseUp(e) {
    if (!isTouching || !gameStarted || gameOver || pausedByElimination) return;
    
    const dx = e.clientX - touchStartX;
    const dy = e.clientY - touchStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 20) {
        launchArrow(dx, dy);
    }
    
    isTouching = false;
}

// ========== LÓGICA DO JOGO ==========
function startGame() {
    gameStarted = true;
    gameOver = false;
    pausedByElimination = false;
    score = 0;
    level = 1;
    
    // Esconder modal
    document.getElementById('waitingModal').classList.add('hidden');
    updateStatus('JOGO EM ANDAMENTO');
    
    // Inicializar jogo com seed
    initLevel();
    gameLoop();
}

function initLevel() {
    // Usar gameSeed para gerar obstáculos (todos veem o mesmo)
    const rng = seededRandom(gameSeed + level);
    
    obstacles = [];
    const numObstacles = 5 + level * 2;
    
    for (let i = 0; i < numObstacles; i++) {
        obstacles.push({
            x: rng() * canvas.width,
            y: rng() * canvas.height,
            radius: 20 + rng() * 30,
            vx: (rng() - 0.5) * 2,
            vy: (rng() - 0.5) * 2
        });
    }
    
    // Reset arrow
    arrow.x = canvas.width / 2;
    arrow.y = canvas.height - 100;
    arrow.dx = 0;
    arrow.dy = 0;
    arrow.speed = 0;
}

function resetLevel() {
    // Reiniciar nível após perder vida
    initLevel();
}

function launchArrow(dx, dy) {
    const speed = Math.min(Math.sqrt(dx * dx + dy * dy) / 10, 15);
    arrow.dx = Math.cos(arrow.angle) * speed;
    arrow.dy = Math.sin(arrow.angle) * speed;
    arrow.speed = speed;
}

function gameLoop() {
    if (!gameStarted) return;
    
    update();
    render();
    requestAnimationFrame(gameLoop);
}

function update() {
    if (gameOver || pausedByElimination) return;
    
    // Mover seta
    arrow.x += arrow.dx;
    arrow.y += arrow.dy;
    arrow.speed *= 0.98; // Fricção
    arrow.dx *= 0.98;
    arrow.dy *= 0.98;
    
    // Colisão com bordas
    if (arrow.x < 0 || arrow.x > canvas.width || arrow.y < 0 || arrow.y > canvas.height) {
        loseLife();
        return;
    }
    
    // Mover obstáculos
    obstacles.forEach(obs => {
        obs.x += obs.vx;
        obs.y += obs.vy;
        
        // Bounce nas bordas
        if (obs.x < obs.radius || obs.x > canvas.width - obs.radius) obs.vx *= -1;
        if (obs.y < obs.radius || obs.y > canvas.height - obs.radius) obs.vy *= -1;
        
        // Colisão com seta
        const dist = Math.sqrt((arrow.x - obs.x) ** 2 + (arrow.y - obs.y) ** 2);
        if (dist < obs.radius + 10) {
            loseLife();
        }
    });
    
    // Completar nível
    if (arrow.speed < 0.1 && score > 0) {
        levelComplete();
    }
}

function render() {
    // Limpar canvas
    ctx.fillStyle = '#0B0F1A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!gameStarted) return;
    
    // Desenhar obstáculos
    obstacles.forEach(obs => {
        ctx.fillStyle = '#FF4757';
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Desenhar seta
    ctx.save();
    ctx.translate(arrow.x, arrow.y);
    ctx.rotate(arrow.angle);
    ctx.fillStyle = myColor ? getColorHex(myColor) : '#22FF88';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, -8);
    ctx.lineTo(-10, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    
    // Linha de mira
    if (isTouching && !pausedByElimination) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(arrow.x, arrow.y);
        ctx.lineTo(arrow.x + Math.cos(arrow.angle) * 100, arrow.y + Math.sin(arrow.angle) * 100);
        ctx.stroke();
    }
    
    // Score
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Nível ${level} • Score ${score}`, canvas.width / 2, 40);
    
    // Mensagem de eliminação
    if (pausedByElimination) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FF4757';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ELIMINADO!', canvas.width / 2, canvas.height / 2);
        ctx.fillStyle = '#FFF';
        ctx.font = '18px sans-serif';
        ctx.fillText('A aguardar outros jogadores...', canvas.width / 2, canvas.height / 2 + 40);
    }
}

function getColorHex(colorName) {
    const colors = {
        green: '#22FF88',
        yellow: '#FFD700',
        red: '#FF4757',
        white: '#FFFFFF',
        blue: '#00C8FF',
        purple: '#A855F7'
    };
    return colors[colorName] || '#22FF88';
}

// ========== EVENTOS DE VIDA ==========
function loseLife() {
    if (gameOver || pausedByElimination) return;
    
    console.log('[Life] Perdi uma vida!');
    
    // Emitir para o servidor
    socket.emit('lose_life', {
        roomCode,
        playerId: myPlayerId
    });
    
    // Não fazer nada localmente - esperar resposta do servidor
}

function eliminateMe() {
    pausedByElimination = true;
    console.log('[Eliminated] Fui eliminado!');
}

function levelComplete() {
    level++;
    score += 100 * level;
    
    // Emitir progresso
    socket.emit('level_complete', {
        roomCode,
        playerId: myPlayerId,
        level,
        score
    });
    
    initLevel();
}

function endGame(winner, rankings) {
    gameOver = true;
    pausedByElimination = false;
    
    // Mostrar resultado
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#22FF88';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FIM DE JOGO!', canvas.width / 2, canvas.height / 2 - 60);
    
    if (winner === myPlayerId) {
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('🏆 VENCESTE! 🏆', canvas.width / 2, canvas.height / 2 - 20);
    } else {
        const winnerData = players[winner];
        ctx.fillStyle = '#FFF';
        ctx.font = '20px sans-serif';
        ctx.fillText(`Vencedor: ${winnerData ? winnerData.name : 'Desconhecido'}`, canvas.width / 2, canvas.height / 2 - 20);
    }
    
    // Reportar resultado ao Android
    setTimeout(() => {
        reportMatchResult(winner === myPlayerId ? 'win' : 'loss');
    }, 2000);
}

function reportMatchResult(result) {
    try {
        if (window.AndroidInterface && window.AndroidInterface.reportMatchResult) {
            const winnerRole = result === 'win' ? 'host' : 'guest'; // Simplificado
            const scoresJson = JSON.stringify({
                scores: Object.entries(players).map(([id, p]) => ({
                    playerId: id,
                    name: p.name,
                    lives: p.lives,
                    eliminated: p.eliminated
                }))
            });
            window.AndroidInterface.reportMatchResult(winnerRole, scoresJson);
        }
    } catch (e) {
        console.error('[Android] Erro ao reportar:', e);
    }
}

// ========== VOICE CHAT ==========
function setupVoiceChat() {
    try {
        voiceManager = new VoiceManager(roomCode);
        
        document.getElementById('toggleMic').addEventListener('click', () => {
            voiceManager.toggleMic();
            updateVoiceUI();
        });
        
        document.getElementById('toggleSpeaker').addEventListener('click', () => {
            voiceManager.toggleSpeaker();
            updateVoiceUI();
        });
    } catch (e) {
        console.warn('[Voice] Chat de voz não disponível:', e);
        document.getElementById('voiceControls').style.display = 'none';
    }
}

function updateVoiceUI() {
    const micBtn = document.getElementById('toggleMic');
    const speakerBtn = document.getElementById('toggleSpeaker');
    
    if (voiceManager) {
        micBtn.classList.toggle('muted', !voiceManager.micEnabled);
        micBtn.classList.toggle('active', voiceManager.micEnabled);
        
        speakerBtn.classList.toggle('muted', !voiceManager.speakerEnabled);
        speakerBtn.classList.toggle('active', voiceManager.speakerEnabled);
    }
}

// ========== UTILITIES ==========
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = Math.sin(s) * 10000;
        return s - Math.floor(s);
    };
}
