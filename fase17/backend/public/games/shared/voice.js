/* GA17_VOICE v1 — chat de voz 1x1 dentro dos jogos HTML (WebRTC P2P + TURN Cloudflare).
 *
 * Botão flutuante (canto inferior direito):
 *   cinzento = microfone desligado · verde = microfone ligado (à espera) · verde + anel = a falar com o adversário
 * Só aparece em salas multiplayer (precisa de code + start_token). Treino/setup: não aparece.
 * O servidor (/voice) só reencaminha a sinalização; o áudio vai direto entre telemóveis.
 *
 * Os jogos podem passar a sala explicitamente:  window.gaVoice && gaVoice.setRoom(code, token)
 * Sem isso, o script lê ?room=&token= do URL ou as variáveis globais conhecidas (ROOM/TOKEN, NET.room/NET.token).
 */
(function () {
  if (window.gaVoice) return;
  var SERVER = 'https://gamer-fortune.onrender.com';
  var NSP = '/voice';
  var SIO_FALLBACK = SERVER + '/ws/socket.io.js';

  var S = {
    code: '', token: '', on: false, sock: null, stream: null, pc: null, peer: null, self: null,
    ice: [], pendingIce: [], makingOffer: false, btn: null, audio: null, state: 'off', disabled: false
  };

  function q(name) { try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; } }
  function isMultiplayer() {
    var m = (q('mode') || '').toLowerCase();
    return m !== 'training' && m !== 'setup';
  }
  function probeRoom() {
    var code = q('room') || q('code'), token = q('token') || q('start_token');
    try { /* eslint-disable no-undef */
      if (!code && typeof ROOM !== 'undefined' && ROOM) code = String(ROOM);
      if (!token && typeof TOKEN !== 'undefined' && TOKEN) token = String(TOKEN);
      if ((!code || !token) && typeof NET !== 'undefined' && NET) { code = code || String(NET.room || ''); token = token || String(NET.token || ''); }
    } catch (e) {}
    return { code: String(code || '').trim().toUpperCase(), token: String(token || '').trim() };
  }

  // ---------------------------------------------------------------- UI
  var CSS =
    '#gaVoiceBtn{position:fixed;right:calc(14px + env(safe-area-inset-right));bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483000;' +
    'width:54px;height:54px;border-radius:50%;border:2px solid rgba(255,255,255,.35);display:grid;place-items:center;cursor:pointer;' +
    'background:radial-gradient(circle at 35% 30%,#6b7386,#2c3140);box-shadow:0 6px 16px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent;' +
    'transition:transform .15s,background .25s,border-color .25s;touch-action:manipulation;padding:0}' +
    '#gaVoiceBtn:active{transform:scale(.9)}' +
    '#gaVoiceBtn svg{width:24px;height:24px;fill:#fff}' +
    '#gaVoiceBtn .sl{stroke:#ff6b6b;stroke-width:2.6;stroke-linecap:round}' +
    '#gaVoiceBtn.on{background:radial-gradient(circle at 35% 30%,#4be38a,#14934c);border-color:#bfffd6}' +
    '#gaVoiceBtn.on .sl{display:none}' +
    '#gaVoiceBtn.on.wait{animation:gaVw 1.4s ease-in-out infinite}' +
    '@keyframes gaVw{50%{box-shadow:0 0 0 7px rgba(75,227,138,.25),0 6px 16px rgba(0,0,0,.5)}}' +
    '#gaVoiceBtn.live{box-shadow:0 0 0 4px rgba(75,227,138,.55),0 0 22px rgba(75,227,138,.8),0 6px 16px rgba(0,0,0,.5)}' +
    '#gaVoiceBtn.dis{opacity:.45}' +
    '#gaVoiceTip{position:fixed;right:calc(76px + env(safe-area-inset-right));bottom:calc(28px + env(safe-area-inset-bottom));z-index:2147483000;' +
    'max-width:60vw;padding:7px 12px;border-radius:14px;background:rgba(8,12,24,.88);color:#fff;font:600 12px system-ui,sans-serif;' +
    'opacity:0;transform:translateX(8px);transition:opacity .25s,transform .25s;pointer-events:none}' +
    '#gaVoiceTip.show{opacity:1;transform:none}' +
    '@media (prefers-reduced-motion:reduce){#gaVoiceBtn.on.wait{animation:none}}';
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>' +
    '<line class="sl" x1="4" y1="4" x2="20" y2="20"/></svg>';

  var tipT = 0;
  function tip(t, ms) {
    var e = document.getElementById('gaVoiceTip');
    if (!e) { e = document.createElement('div'); e.id = 'gaVoiceTip'; document.body.appendChild(e); }
    e.textContent = t; e.classList.add('show');
    clearTimeout(tipT); tipT = setTimeout(function () { e.classList.remove('show'); }, ms || 2200);
  }

  function paint() {
    var b = S.btn; if (!b) return;
    b.classList.toggle('on', S.on);
    b.classList.toggle('wait', S.on && S.state !== 'live');
    b.classList.toggle('live', S.on && S.state === 'live');
    b.classList.toggle('dis', S.disabled);
    b.setAttribute('aria-pressed', S.on ? 'true' : 'false');
    b.setAttribute('aria-label', S.on ? 'Desligar microfone' : 'Ligar microfone');
  }

  function mountButton() {
    if (S.btn || !document.body) return;
    var st = document.createElement('style'); st.textContent = CSS; (document.head || document.documentElement).appendChild(st);
    var b = document.createElement('button');
    b.id = 'gaVoiceBtn'; b.type = 'button'; b.innerHTML = ICON;
    // não deixar o toque chegar ao jogo (canvas com listeners globais)
    ['pointerdown', 'touchstart', 'mousedown'].forEach(function (t) { b.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggle(); });
    document.body.appendChild(b);
    S.btn = b;
    S.audio = document.createElement('audio');
    S.audio.autoplay = true; S.audio.setAttribute('playsinline', ''); S.audio.style.display = 'none';
    document.body.appendChild(S.audio);
    paint();
  }

  // ---------------------------------------------------------------- socket
  function loadIo(cb) {
    if (window.io) return cb();
    var s = document.createElement('script'); s.src = SIO_FALLBACK;
    s.onload = function () { cb(); }; s.onerror = function () { cb(); };
    document.head.appendChild(s);
  }

  function connect() {
    if (S.sock || !window.io) return;
    var sock = window.io(SERVER + NSP, { path: '/ws', transports: ['websocket'], auth: { code: S.code, token: S.token }, reconnectionDelayMax: 8000 });
    S.sock = sock;
    sock.on('voice-config', function (c) {
      S.ice = (c && Array.isArray(c.iceServers)) ? c.iceServers : [];
      S.self = c && c.self;
      if (S.on) sock.emit('voice-ready', {});
    });
    sock.on('voice-peers', function (d) { var p = d && d.peers && d.peers[0]; if (p) startWith(p); });
    sock.on('voice-peer', function (d) { if (d && d.id && S.on) startWith(d.id); });
    sock.on('voice-peer-off', function (d) { if (d && d.id === S.peer) { closePc(); if (S.on) { S.state = 'wait'; paint(); tip('O adversário desligou o microfone'); } } });
    sock.on('voice-signal', onSignal);
    sock.on('voice-full', function () { S.disabled = true; stopLocal(); paint(); tip('Voz disponível só para 2 jogadores'); });
    sock.on('connect_error', function (e) {
      if (e && String(e.message) === 'voice_auth') { S.disabled = true; stopLocal(); paint(); tip('Voz indisponível nesta sala'); try { sock.close(); } catch (x) {} S.sock = null; }
    });
    sock.on('disconnect', function () { closePc(); if (S.on) { S.state = 'wait'; paint(); } });
  }

  // ---------------------------------------------------------------- WebRTC (1x1)
  // Quem tem o socket id "menor" faz a oferta → nunca há ofertas cruzadas.
  function startWith(peerId) {
    if (!S.on || !S.stream || !S.self) return;
    if (S.pc && S.peer === peerId) return;
    closePc();
    S.peer = peerId;
    makePc();
    if (String(S.self) < String(peerId)) offer();
  }

  function makePc() {
    var pc = new RTCPeerConnection({ iceServers: S.ice });
    S.pc = pc; S.pendingIce = [];
    S.stream.getTracks().forEach(function (t) { pc.addTrack(t, S.stream); });
    pc.onicecandidate = function (e) {
      if (e.candidate && S.sock) S.sock.emit('voice-signal', { to: S.peer, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    };
    pc.ontrack = function (e) {
      if (S.audio) { S.audio.srcObject = e.streams[0]; var p = S.audio.play(); if (p && p.catch) p.catch(function () {}); }
    };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === 'connected') { S.state = 'live'; paint(); tip('🎙 A falar com o adversário'); }
      else if (st === 'failed') { closePc(); if (S.on) { S.state = 'wait'; paint(); tip('Ligação de voz falhou'); } }
      else if (st === 'disconnected' || st === 'closed') { if (S.on) { S.state = 'wait'; paint(); } }
    };
    return pc;
  }

  function offer() {
    var pc = S.pc; if (!pc) return;
    S.makingOffer = true;
    pc.createOffer({ offerToReceiveAudio: true }).then(function (d) { return pc.setLocalDescription(d); })
      .then(function () { if (S.sock) S.sock.emit('voice-signal', { to: S.peer, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); })
      .catch(function (e) { console.warn('[voice] offer', e); })
      .then(function () { S.makingOffer = false; });
  }

  function onSignal(m) {
    if (!m || !S.on || !S.stream) return;
    if (m.from !== S.peer) { if (m.description && m.description.type === 'offer') { closePc(); S.peer = m.from; makePc(); } else return; }
    var pc = S.pc || makePc();
    if (m.description) {
      var d = m.description;
      pc.setRemoteDescription(d).then(function () {
        S.pendingIce.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
        if (d.type === 'offer') {
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); }).then(function () {
            if (S.sock) S.sock.emit('voice-signal', { to: S.peer, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          });
        }
      }).catch(function (e) { console.warn('[voice] sdp', e); });
    } else if (m.candidate) {
      if (pc.remoteDescription) pc.addIceCandidate(m.candidate).catch(function () {});
      else S.pendingIce.push(m.candidate);
    }
  }

  function closePc() {
    if (S.pc) { try { S.pc.ontrack = null; S.pc.onicecandidate = null; S.pc.close(); } catch (e) {} }
    S.pc = null; S.peer = null; S.pendingIce = [];
    if (S.audio) S.audio.srcObject = null;
  }

  function stopLocal() {
    closePc();
    if (S.stream) { S.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); }
    S.stream = null; S.on = false; S.state = 'off';
  }

  // ---------------------------------------------------------------- liga / desliga
  function toggle() {
    if (S.disabled) { tip('Voz indisponível nesta sala'); return; }
    if (S.on) {
      stopLocal(); paint();
      if (S.sock) S.sock.emit('voice-off', {});
      tip('Microfone desligado');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) { tip('Este dispositivo não suporta voz'); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .then(function (stream) {
        S.stream = stream; S.on = true; S.state = 'wait'; paint();
        tip('Microfone ligado — à espera do adversário');
        loadIo(function () {
          if (!window.io) { tip('Sem ligação ao servidor de voz'); stopLocal(); paint(); return; }
          if (!S.sock) connect();
          else if (S.sock.connected) S.sock.emit('voice-ready', {});
        });
      })
      .catch(function () { tip('Permissão do microfone recusada'); paint(); });
  }

  function cleanup() {
    stopLocal();
    try { if (S.sock) S.sock.close(); } catch (e) {}
    S.sock = null;
  }
  addEventListener('pagehide', cleanup);
  addEventListener('beforeunload', cleanup);

  // ---------------------------------------------------------------- arranque
  function setRoom(code, token) {
    var c = String(code || '').trim().toUpperCase(), t = String(token || '').trim();
    if (!c || !t) return;
    if (S.code === c && S.token === t) return;
    if (S.sock) cleanup();
    S.code = c; S.token = t; S.disabled = false;
    mountButton();
  }

  var tries = 0;
  function boot() {
    if (!isMultiplayer()) return;
    var r = probeRoom();
    if (r.code && r.token) { setRoom(r.code, r.token); return; }
    if (++tries < 40) setTimeout(boot, 1500); // jogos pré-aquecidos só recebem a sala depois (__gaLaunch)
  }

  window.gaVoice = { v: 1, setRoom: setRoom, stop: cleanup, toggle: toggle };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
