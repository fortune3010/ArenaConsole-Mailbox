'use strict';
/**
 * GA17_VOICE — sinalização WebRTC do chat de voz dentro dos jogos (namespace /voice, path /ws).
 *
 * O servidor NÃO toca no áudio: só reencaminha SDP e candidatos ICE entre os 2 jogadores
 * da mesma sala (áudio P2P, TURN Cloudflare via cloudflare-turn.js).
 *
 * Autenticação (sem JWT no HTML): handshake.auth = { code, token }
 *   code  = rooms.code da sala do jogo
 *   token = room_players.start_token do jogador (o mesmo que o jogo já recebe no URL)
 *   → só entra quem tem um lugar nessa sala. O userId vem SEMPRE da base de dados.
 *
 * Fase 17 = 1x1: no máximo 2 utilizadores por sala de voz (3.º recebe voice-full).
 *
 * Cliente → servidor
 *   voice-ready  {}                              microfone ligado, pronto para ligar
 *   voice-off    {}                              microfone desligado
 *   voice-signal { to, description? , candidate? }
 * Servidor → cliente
 *   voice-config   { iceServers, self }          ao ligar
 *   voice-peers    { peers: [socketId] }         peers prontos (resposta a voice-ready)
 *   voice-peer     { id }                        outro peer ficou pronto
 *   voice-peer-off { id }                        outro peer desligou / saiu
 *   voice-signal   { from, description?, candidate? }
 *   voice-full     {}                            sala de voz cheia (já há 2 pessoas)
 */
const { getIceServers } = require('./cloudflare-turn');

const CODE_RE = /^[A-Za-z0-9_-]{3,16}$/;
const TOKEN_RE = /^[\x21-\x7e]{8,256}$/; // ASCII visível; o valor real é comparado na BD
const MAX_PEERS = 2;
const MAX_SDP = 30000;
const MAX_CANDIDATE = 1500;
const MAX_SIGNALS_PER_MIN = 240;

function attachVoice(io, opts) {
  const o = opts || {};
  const supabase = o.supabase;
  if (!supabase) throw new Error('voice-namespace: supabase em falta');
  const nsp = io.of(o.namespace || '/voice');
  const roomOf = (code) => 'voice:' + code;

  async function authorize(code, token) {
    const { data: room, error } = await supabase.from('rooms').select('id, code').eq('code', code).maybeSingle();
    if (error || !room) return null;
    const { data: p, error: pErr } = await supabase.from('room_players')
      .select('user_id').eq('room_id', room.id).eq('start_token', token).maybeSingle();
    if (pErr || !p || !p.user_id) return null;
    return { userId: String(p.user_id), code: room.code ? String(room.code).toUpperCase() : code };
  }

  nsp.use((socket, next) => {
    const a = (socket.handshake && socket.handshake.auth) || {};
    const code = String(a.code || '').trim().toUpperCase();
    const token = String(a.token || '').trim();
    if (!CODE_RE.test(code) || !TOKEN_RE.test(token)) return next(new Error('voice_auth'));
    authorize(code, token).then((v) => {
      if (!v) return next(new Error('voice_auth'));
      socket.voiceCode = v.code;
      socket.voiceUser = v.userId;
      socket.voiceReady = false;
      next();
    }).catch(() => next(new Error('voice_auth')));
  });

  const peersIn = (code) => {
    const r = nsp.adapter.rooms.get(roomOf(code));
    return r ? [...r].map((sid) => nsp.sockets.get(sid)).filter(Boolean) : [];
  };

  nsp.on('connection', (socket) => {
    const code = socket.voiceCode;
    const uid = socket.voiceUser;

    // o mesmo utilizador noutro socket (reconexão / WebView reaberto) → substitui o antigo
    for (const s of peersIn(code)) {
      if (s.voiceUser === uid && s.id !== socket.id) {
        s.to(roomOf(code)).emit('voice-peer-off', { id: s.id });
        s.disconnect(true);
      }
    }
    const others = peersIn(code).filter((s) => s.voiceUser !== uid);
    if (others.length >= MAX_PEERS) {
      socket.emit('voice-full', {});
      socket.disconnect(true);
      return;
    }
    socket.join(roomOf(code));
    getIceServers().then((iceServers) => socket.emit('voice-config', { iceServers, self: socket.id }))
      .catch(() => socket.emit('voice-config', { iceServers: [], self: socket.id }));

    let win = Date.now(), n = 0;
    const allow = () => {
      const now = Date.now();
      if (now - win > 60000) { win = now; n = 0; }
      return ++n <= MAX_SIGNALS_PER_MIN;
    };
    const peerSocket = (id) => {
      const s = nsp.sockets.get(String(id || ''));
      return s && s.id !== socket.id && s.voiceCode === code ? s : null;
    };

    socket.on('voice-ready', () => {
      socket.voiceReady = true;
      const ready = peersIn(code).filter((s) => s.id !== socket.id && s.voiceReady).map((s) => s.id);
      socket.emit('voice-peers', { peers: ready });
      socket.to(roomOf(code)).emit('voice-peer', { id: socket.id });
    });

    socket.on('voice-off', () => {
      socket.voiceReady = false;
      socket.to(roomOf(code)).emit('voice-peer-off', { id: socket.id });
    });

    socket.on('voice-signal', (p) => {
      if (!p || !allow()) return;
      const dest = peerSocket(p.to);
      if (!dest || !socket.voiceReady) return;
      const out = { from: socket.id };
      const d = p.description;
      if (d && typeof d === 'object') {
        const type = d.type === 'offer' || d.type === 'answer' ? d.type : null;
        if (!type || typeof d.sdp !== 'string' || d.sdp.length > MAX_SDP) return;
        out.description = { type, sdp: d.sdp };
      }
      const c = p.candidate;
      if (c && typeof c === 'object') {
        if (typeof c.candidate !== 'string' || c.candidate.length > MAX_CANDIDATE) return;
        out.candidate = {
          candidate: c.candidate,
          sdpMid: c.sdpMid == null ? null : String(c.sdpMid).slice(0, 32),
          sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : 0
        };
      }
      if (!out.description && !out.candidate) return;
      dest.emit('voice-signal', out);
    });

    socket.on('disconnect', () => {
      socket.to(roomOf(code)).emit('voice-peer-off', { id: socket.id });
    });
  });

  return nsp;
}

module.exports = { attachVoice };
