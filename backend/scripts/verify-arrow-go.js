#!/usr/bin/env node

/**
 * Script de Verificação: Arrow Go Multiplayer
 * 
 * Verifica se todos os ficheiros necessários existem e estão corretos
 */

const fs = require('fs');
const path = require('path');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let errors = 0;
let warnings = 0;

function log(message, type = 'info') {
    const colors = {
        error: RED,
        success: GREEN,
        warning: YELLOW,
        info: RESET
    };
    
    console.log(`${colors[type]}${message}${RESET}`);
}

function checkFile(filePath, required = true) {
    const fullPath = path.join(__dirname, '..', filePath);
    
    if (fs.existsSync(fullPath)) {
        log(`✅ ${filePath}`, 'success');
        return true;
    } else {
        if (required) {
            log(`❌ ${filePath} - FALTA`, 'error');
            errors++;
        } else {
            log(`⚠️  ${filePath} - Opcional`, 'warning');
            warnings++;
        }
        return false;
    }
}

function checkFileContent(filePath, searchStrings) {
    const fullPath = path.join(__dirname, '..', filePath);
    
    if (!fs.existsSync(fullPath)) {
        log(`❌ ${filePath} não existe`, 'error');
        errors++;
        return false;
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    const missing = searchStrings.filter(str => !content.includes(str));
    
    if (missing.length === 0) {
        log(`✅ ${filePath} - Conteúdo válido`, 'success');
        return true;
    } else {
        log(`❌ ${filePath} - Falta: ${missing.join(', ')}`, 'error');
        errors++;
        return false;
    }
}

console.log('\n🎮 VERIFICAÇÃO: Arrow Go Multiplayer\n');
console.log('=' .repeat(60));

// ===== FRONTEND FILES =====
console.log('\n📂 Frontend (HTML5):\n');
checkFile('public/games/arrow-go/index.html');
checkFile('public/games/arrow-go/styles.css');
checkFile('public/games/arrow-go/game.js');
checkFile('public/games/arrow-go/voice.js');
checkFile('public/games/arrow-go/README.md');
checkFile('public/games/arrow-go/test-client.html', false);

// ===== BACKEND FILES =====
console.log('\n📂 Backend (Node.js):\n');
checkFile('services/websocket.js');
checkFile('server.js');
checkFile('package.json');

// ===== CONTENT CHECKS =====
console.log('\n🔍 Verificação de Conteúdo:\n');

checkFileContent('public/games/arrow-go/index.html', [
    'gameCanvas',
    'multiplayerHUD',
    'voiceControls',
    'socket.io.js',
    'voice.js',
    'game.js'
]);

checkFileContent('public/games/arrow-go/game.js', [
    'io(\'/arrow-go\'',
    'join_room',
    'lose_life',
    'player_life_lost',
    'game_start',
    'game_over',
    'MAX_LIVES'
]);

checkFileContent('public/games/arrow-go/voice.js', [
    'RTCPeerConnection',
    'getUserMedia',
    'voice_offer',
    'voice_answer',
    'voice_ice_candidate'
]);

checkFileContent('services/websocket.js', [
    'io.of(\'/arrow-go\')',
    'handleJoinRoom',
    'handleLoseLife',
    'handleVoiceSignal',
    'checkGameOver'
]);

checkFileContent('server.js', [
    'initWebSocket',
    'socket.io'
]);

// ===== PACKAGE.JSON DEPENDENCIES =====
console.log('\n📦 Dependências:\n');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = packageJson.dependencies || {};
    
    const required = ['socket.io', 'express', 'jsonwebtoken'];
    
    required.forEach(dep => {
        if (deps[dep]) {
            log(`✅ ${dep} - ${deps[dep]}`, 'success');
        } else {
            log(`❌ ${dep} - NÃO INSTALADO`, 'error');
            errors++;
        }
    });
} else {
    log('❌ package.json não encontrado', 'error');
    errors++;
}

// ===== ENV VARIABLES =====
console.log('\n🔐 Variáveis de Ambiente:\n');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    const requiredVars = ['JWT_SECRET', 'PORT'];
    const optionalVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
    
    requiredVars.forEach(varName => {
        if (envContent.includes(varName)) {
            log(`✅ ${varName}`, 'success');
        } else {
            log(`❌ ${varName} - FALTA`, 'error');
            errors++;
        }
    });
    
    optionalVars.forEach(varName => {
        if (envContent.includes(varName)) {
            log(`✅ ${varName}`, 'success');
        } else {
            log(`⚠️  ${varName} - Opcional`, 'warning');
            warnings++;
        }
    });
} else {
    log('⚠️  .env não encontrado (criar a partir de .env.example)', 'warning');
    warnings++;
}

// ===== RESULTADO FINAL =====
console.log('\n' + '='.repeat(60));
console.log('\n📊 RESUMO:\n');

if (errors === 0 && warnings === 0) {
    log('🎉 TUDO PERFEITO! Sistema pronto para teste!', 'success');
    process.exit(0);
} else if (errors === 0) {
    log(`✅ Sistema funcional (${warnings} avisos)`, 'success');
    log('⚠️  Avisos não impedem o funcionamento básico', 'warning');
    process.exit(0);
} else {
    log(`❌ ${errors} ERRO(S) ENCONTRADO(S)`, 'error');
    if (warnings > 0) {
        log(`⚠️  ${warnings} aviso(s)`, 'warning');
    }
    console.log('\n💡 Corrige os erros acima antes de testar.\n');
    process.exit(1);
}
