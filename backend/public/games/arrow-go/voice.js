/**
 * VOICE CHAT - WebRTC P2P via Socket.IO
 * Sistema de voz peer-to-peer para 2-6 jogadores
 */

class VoiceManager {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.peers = new Map(); // peerId -> { pc: RTCPeerConnection, stream: MediaStream }
        this.localStream = null;
        this.micEnabled = true;
        this.speakerEnabled = true;
        
        this.init();
    }
    
    async init() {
        try {
            // Pedir permissão de microfone
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            console.log('[Voice] Stream local obtido');
            
            // Escutar eventos de signaling
            this.setupSignaling();
            
        } catch (error) {
            console.error('[Voice] Erro ao obter microfone:', error);
            this.micEnabled = false;
        }
    }
    
    setupSignaling() {
        if (!socket) {
            console.warn('[Voice] Socket não está pronto');
            return;
        }
        
        // Quando um novo jogador entra
        socket.on('voice_peer_joined', async (data) => {
            console.log('[Voice] Novo peer:', data.peerId);
            await this.createOffer(data.peerId);
        });
        
        // Receber offer de outro peer
        socket.on('voice_offer', async (data) => {
            console.log('[Voice] Offer recebido de:', data.from);
            await this.handleOffer(data.from, data.offer);
        });
        
        // Receber answer
        socket.on('voice_answer', async (data) => {
            console.log('[Voice] Answer recebido de:', data.from);
            await this.handleAnswer(data.from, data.answer);
        });
        
        // Receber ICE candidate
        socket.on('voice_ice_candidate', async (data) => {
            console.log('[Voice] ICE candidate de:', data.from);
            await this.handleIceCandidate(data.from, data.candidate);
        });
        
        // Peer desconectou
        socket.on('voice_peer_left', (data) => {
            console.log('[Voice] Peer saiu:', data.peerId);
            this.removePeer(data.peerId);
        });
    }
    
    async createOffer(peerId) {
        const pc = this.createPeerConnection(peerId);
        
        // Adicionar stream local
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socket.emit('voice_offer', {
                roomCode: this.roomCode,
                to: peerId,
                offer: offer
            });
        } catch (error) {
            console.error('[Voice] Erro ao criar offer:', error);
        }
    }
    
    async handleOffer(peerId, offer) {
        const pc = this.createPeerConnection(peerId);
        
        // Adicionar stream local
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            socket.emit('voice_answer', {
                roomCode: this.roomCode,
                to: peerId,
                answer: answer
            });
        } catch (error) {
            console.error('[Voice] Erro ao processar offer:', error);
        }
    }
    
    async handleAnswer(peerId, answer) {
        const peer = this.peers.get(peerId);
        if (!peer) {
            console.warn('[Voice] Peer não encontrado:', peerId);
            return;
        }
        
        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            console.error('[Voice] Erro ao processar answer:', error);
        }
    }
    
    async handleIceCandidate(peerId, candidate) {
        const peer = this.peers.get(peerId);
        if (!peer) {
            console.warn('[Voice] Peer não encontrado para ICE:', peerId);
            return;
        }
        
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('[Voice] Erro ao adicionar ICE candidate:', error);
        }
    }
    
    createPeerConnection(peerId) {
        // Configuração com STUN servers públicos
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        const pc = new RTCPeerConnection(configuration);
        
        // ICE candidate
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('voice_ice_candidate', {
                    roomCode: this.roomCode,
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };
        
        // Receber stream remoto
        pc.ontrack = (event) => {
            console.log('[Voice] Stream remoto recebido de:', peerId);
            this.playRemoteStream(peerId, event.streams[0]);
        };
        
        // Connection state
        pc.onconnectionstatechange = () => {
            console.log('[Voice] Estado da conexão com', peerId, ':', pc.connectionState);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                this.removePeer(peerId);
            }
        };
        
        this.peers.set(peerId, { pc, stream: null });
        return pc;
    }
    
    playRemoteStream(peerId, stream) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        
        peer.stream = stream;
        
        // Criar elemento de áudio oculto
        let audio = document.getElementById(`voice-${peerId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `voice-${peerId}`;
            audio.autoplay = true;
            audio.style.display = 'none';
            document.body.appendChild(audio);
        }
        
        audio.srcObject = stream;
        audio.volume = this.speakerEnabled ? 1.0 : 0.0;
    }
    
    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.pc.close();
            this.peers.delete(peerId);
            
            const audio = document.getElementById(`voice-${peerId}`);
            if (audio) {
                audio.remove();
            }
        }
    }
    
    toggleMic() {
        this.micEnabled = !this.micEnabled;
        
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = this.micEnabled;
            });
        }
        
        console.log('[Voice] Microfone:', this.micEnabled ? 'ON' : 'OFF');
    }
    
    toggleSpeaker() {
        this.speakerEnabled = !this.speakerEnabled;
        
        // Atualizar volume de todos os áudios remotos
        this.peers.forEach((peer, peerId) => {
            const audio = document.getElementById(`voice-${peerId}`);
            if (audio) {
                audio.volume = this.speakerEnabled ? 1.0 : 0.0;
            }
        });
        
        console.log('[Voice] Alto-falante:', this.speakerEnabled ? 'ON' : 'OFF');
    }
    
    destroy() {
        // Parar stream local
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        // Fechar todas as conexões
        this.peers.forEach((peer, peerId) => {
            this.removePeer(peerId);
        });
        
        this.peers.clear();
    }
}

// Cleanup ao sair
window.addEventListener('beforeunload', () => {
    if (window.voiceManager) {
        window.voiceManager.destroy();
    }
});
