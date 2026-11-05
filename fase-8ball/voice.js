/* GA17_VOICE v3 — chat de voz 1x1 dentro dos jogos HTML (WebRTC P2P + TURN Cloudflare).
 *
 * v3: flag global window.GA_VOICE_LEFT. Se for verdadeira (definida ANTES de carregar este script, ou
 *     mesmo depois: o CSS é reavaliado em cada keepAlive), o botão e a dica vão para o canto inferior ESQUERDO.
 *     Usado no 8-Ball, onde o botão da direita tapava o botão "Jogar/Bater".
 * v2: botão "invencível" — vive dentro de um overlay próprio (#gaVoiceOverlay) anexado ao <html>
 * (nunca ao <body>), com position:fixed + translateZ(0) + z-index máximo + direction:ltr.
 * Assim, transform:scale() no body/ecrã do jogo, stacking contexts e idiomas RTL não o afetam.
 *
 * Botão flutuante (canto inferior direito, ou esquerdo com GA_VOICE_LEFT):
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
  var GA_L = String((document.documentElement.lang || navigator.language || 'pt')).slice(0, 2).toLowerCase();
  var I18N = { // GA195_I18N
    pt: { on: 'Microfone ligado — à espera do adversário', off: 'Microfone desligado', live: '🎙 A falar com o adversário', peerOff: 'O adversário desligou o microfone', failed: 'Ligação de voz falhou', full: 'Voz disponível só para 2 jogadores', unavail: 'Voz indisponível nesta sala', noSup: 'Este dispositivo não suporta voz', denied: 'Permissão do microfone recusada', noSrv: 'Sem ligação ao servidor de voz', ariaOn: 'Desligar microfone', ariaOff: 'Ligar microfone' },
    en: { on: 'Microphone on — waiting for opponent', off: 'Microphone off', live: '🎙 Talking with your opponent', peerOff: 'Your opponent turned off the microphone', failed: 'Voice connection failed', full: 'Voice is only available for 2 players', unavail: 'Voice unavailable in this room', noSup: 'This device does not support voice', denied: 'Microphone permission denied', noSrv: 'No connection to the voice server', ariaOn: 'Turn microphone off', ariaOff: 'Turn microphone on' },
    ru: { on: 'Микрофон включён — ждём соперника', off: 'Микрофон выключен', live: '🎙 Разговор с соперником', peerOff: 'Соперник выключил микрофон', failed: 'Голосовая связь не удалась', full: 'Голос доступен только для 2 игроков', unavail: 'Голос недоступен в этой комнате', noSup: 'Устройство не поддерживает голос', denied: 'Нет доступа к микрофону', noSrv: 'Нет связи с голосовым сервером', ariaOn: 'Выключить микрофон', ariaOff: 'Включить микрофон' },
    ar: { on: 'الميكروفون يعمل — بانتظار الخصم', off: 'الميكروفون متوقف', live: '🎙 تتحدث مع الخصم', peerOff: 'أوقف الخصم الميكروفون', failed: 'فشل الاتصال الصوتي', full: 'الصوت متاح للاعبين اثنين فقط', unavail: 'الصوت غير متاح في هذه الغرفة', noSup: 'هذا الجهاز لا يدعم الصوت', denied: 'تم رفض إذن الميكروفون', noSrv: 'لا يوجد اتصال بخادم الصوت', ariaOn: 'إيقاف الميكروفون', ariaOff: 'تشغيل الميكروفون' },
    zh: { on: '麦克风已开启 — 等待对手', off: '麦克风已关闭', live: '🎙 正在与对手通话', peerOff: '对手关闭了麦克风', failed: '语音连接失败', full: '语音仅支持 2 名玩家', unavail: '此房间无法使用语音', noSup: '此设备不支持语音', denied: '麦克风权限被拒绝', noSrv: '无法连接语音服务器', ariaOn: '关闭麦克风', ariaOff: '开启麦克风' },
    tr: { on: 'Mikrofon açık — rakip bekleniyor', off: 'Mikrofon kapalı', live: '🎙 Rakiple konuşuyorsun', peerOff: 'Rakip mikrofonu kapattı', failed: 'Sesli bağlantı başarısız', full: 'Ses yalnızca 2 oyuncu için', unavail: 'Bu odada ses kullanılamıyor', noSup: 'Bu cihaz sesi desteklemiyor', denied: 'Mikrofon izni reddedildi', noSrv: 'Ses sunucusuna bağlantı yok', ariaOn: 'Mikrofonu kapat', ariaOff: 'Mikrofonu aç' }
  };
  var TX = I18N[GA_L] || I18N.pt;

  var S = {
    code: '', token: '', on: false, sock: null, stream: null, pc: null, peer: null, self: null,
    ice: [], pendingIce: [], makingOffer: false, btn: null, audio: null, overlay: null, state: 'off', disabled: false
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
  // Nota: cada propriedade que usa env()/calc() tem ANTES uma versão simples (fallback). Em WebViews
  // antigos (ex.: Redmi A5), uma declaração inválida seria descartada e o botão perdia a posição.
  var OVERLAY_CSS =
    'position:fixed !important;top:0 !important;left:0 !important;' +
    'width:100vw !important;height:100vh !important;' +
    'pointer-events:none !important;z-index:2147483647 !important;' +
    '-webkit-transform:translateZ(0) !important;transform:translateZ(0) !important;' +
    'direction:ltr !important;unicode-bidi:isolate !important;' +
    'display:block !important;visibility:visible !important;opacity:1 !important;' +
    'overflow:visible !important;margin:0 !important;padding:0 !important;border:0 !important;' +
    'background:none !important;filter:none !important;contain:none !important;';

  // O lado é lido em cada chamada: a flag pode ser definida pelo jogo antes OU depois deste script carregar.
  function isLeft() { return !!window.GA_VOICE_LEFT; }

  function buildCss() {
    var side = isLeft() ? 'left' : 'right';     // lado onde o botão fica encostado
    var opp = isLeft() ? 'right' : 'left';      // lado que fica 'auto'
    var tipShift = isLeft() ? '-8px' : '8px';   // a dica desliza a partir do botão
    return '#gaVoiceOverlay{height:100vh;height:100dvh}' +
      '#gaVoiceBtn{position:absolute !important;' + opp + ':auto !important;top:auto !important;' +
      side + ':14px !important;bottom:16px !important;' +
      side + ':calc(14px + env(safe-area-inset-' + side + ', 0px)) !important;bottom:calc(16px + env(safe-area-inset-bottom, 0px)) !important;' +
      'z-index:2147483647 !important;pointer-events:auto !important;display:flex !important;visibility:visible !important;opacity:1;' +
      'align-items:center;justify-content:center;margin:0 !important;' +
      'width:54px;height:54px;min-width:54px;min-height:54px;border-radius:50%;border:2px solid rgba(255,255,255,.35);cursor:pointer;' +
      'background:#3c4252;background:radial-gradient(circle at 35% 30%,#6b7386,#2c3140);box-shadow:0 6px 16px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent;' +
      'transition:transform .15s,background .25s,border-color .25s;touch-action:manipulation;padding:0;box-sizing:border-box;' +
      '-webkit-appearance:none;appearance:none;outline:none;direction:ltr}' +
      '#gaVoiceBtn:active{transform:scale(.9)}' +
      '#gaVoiceBtn svg{width:24px;height:24px;fill:#fff;pointer-events:none;display:block}' +
      '#gaVoiceBtn .sl{stroke:#ff6b6b;stroke-width:2.6;stroke-linecap:round}' +
      '#gaVoiceBtn.on{background:#14934c;background:radial-gradient(circle at 35% 30%,#4be38a,#14934c);border-color:#bfffd6}' +
      '#gaVoiceBtn.on .sl{display:none}' +
      '#gaVoiceBtn.on.wait{animation:gaVw 1.4s ease-in-out infinite}' +
      '@keyframes gaVw{50%{box-shadow:0 0 0 7px rgba(75,227,138,.25),0 6px 16px rgba(0,0,0,.5)}}' +
      '#gaVoiceBtn.live{box-shadow:0 0 0 4px rgba(75,227,138,.55),0 0 22px rgba(75,227,138,.8),0 6px 16px rgba(0,0,0,.5)}' +
      '#gaVoiceBtn.dis{opacity:.45}' +
      '#gaVoiceTip{position:absolute !important;' + opp + ':auto !important;top:auto !important;' +
      side + ':76px !important;bottom:28px !important;' +
      side + ':calc(76px + env(safe-area-inset-' + side + ', 0px)) !important;bottom:calc(28px + env(safe-area-inset-bottom, 0px)) !important;' +
      'z-index:2147483646;max-width:60vw;padding:7px 12px;border-radius:14px;background:rgba(8,12,24,.88);color:#fff;' +
      'font:600 12px system-ui,sans-serif;direction:ltr;text-align:center;box-sizing:border-box;' +
      'opacity:0;-webkit-transform:translateX(' + tipShift + ');transform:translateX(' + tipShift + ');transition:opacity .25s,transform .25s;pointer-events:none !important}' +
      '#gaVoiceTip.show{opacity:1;-webkit-transform:none;transform:none}' +
      '@media (prefers-reduced-motion:reduce){#gaVoiceBtn.on.wait{animation:none}}';
  }
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>' +
    '<line class="sl" x1="4" y1="4" x2="20" y2="20"/></svg>';

  // Cria (ou recupera) o overlay global. Anexado ao <html>, nunca ao <body>.
  function ensureOverlay() {
    var o = document.getElementById('gaVoiceOverlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'gaVoiceOverlay';
      o.setAttribute('dir', 'ltr');
      o.style.cssText = OVERLAY_CSS;
    }
    if (o.parentNode !== document.documentElement) document.documentElement.appendChild(o);
    S.overlay = o;
    return o;
  }

  var tipT = 0;
  function tip(t, ms) {
    var o = ensureOverlay();
    var e = document.getElementById('gaVoiceTip');
    if (!e) { e = document.createElement('div'); e.id = 'gaVoiceTip'; o.appendChild(e); }
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
    b.setAttribute('aria-label', S.on ? TX.ariaOn : TX.ariaOff);
  }

  // Garante que o overlay + botão continuam no DOM (o jogo pode limpar/recriar elementos).
  // Também reaplica o CSS se a flag GA_VOICE_LEFT mudou entretanto.
  function keepAlive() {
    if (!S.btn) return;
    var o = ensureOverlay();
    if (S.btn.parentNode !== o) o.appendChild(S.btn);
    if (S.audio && S.audio.parentNode !== o) o.appendChild(S.audio);
    var css = buildCss();
    var st = document.getElementById('gaVoiceStyle');
    if (!st) { st = document.createElement('style'); st.id = 'gaVoiceStyle'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
    else if (st.textContent !== css) st.textContent = css;
  }

  function mountButton() {
    if (S.btn) { keepAlive(); return; }
    var root = document.documentElement;
    if (!root) { setTimeout(mountButton, 50); return; }

    var st = document.createElement('style'); st.id = 'gaVoiceStyle'; st.textContent = buildCss();
    (document.head || root).appendChild(st);

    var overlay = ensureOverlay();

    var b = document.createElement('button');
    b.id = 'gaVoiceBtn'; b.type = 'button'; b.innerHTML = ICON;
    b.style.pointerEvents = 'auto';
    // não deixar o toque chegar ao jogo (canvas com listeners globais)
    ['pointerdown', 'touchstart', 'mousedown'].forEach(function (t) { b.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggle(); });
    overlay.appendChild(b);

    S.btn = b;
    S.audio = document.createElement('audio');
    S.audio.autoplay = true; S.audio.setAttribute('playsinline', ''); S.audio.style.display = 'none';
    overlay.appendChild(S.audio);
    paint();

    // vigia: se o jogo remover o overlay/botão, volta a injetar
    try {
      new MutationObserver(function () {
        if (!S.overlay || !S.overlay.isConnected || S.btn.parentNode !== S.overlay || document.documentElement.lastElementChild !== S.overlay) keepAlive();
      }).observe(document.documentElement, { childList: true });
    } catch (e) {}
    setInterval(keepAlive, 2500);

    console.log('[Voice] Botão injetado com sucesso!' + (isLeft() ? ' (canto esquerdo)' : ''));
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
    sock.on('voice-peer-off', function (d) { if (d && d.id === S.peer) { closePc(); if (S.on) { S.state = 'wait'; paint(); tip(TX.peerOff); } } });
    sock.on('voice-signal', onSignal);
    sock.on('voice-full', function () { S.disabled = true; stopLocal(); paint(); tip(TX.full); });
    sock.on('connect_error', function (e) {
      if (e && String(e.message) === 'voice_auth') { S.disabled = true; stopLocal(); paint(); tip(TX.unavail); try { sock.close(); } catch (x) {} S.sock = null; }
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
      if (st === 'connected') { S.state = 'live'; paint(); tip(TX.live); }
      else if (st === 'failed') { closePc(); if (S.on) { S.state = 'wait'; paint(); tip(TX.failed); } }
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
    if (S.disabled) { tip(TX.unavail); return; }
    if (S.on) {
      stopLocal(); paint();
      if (S.sock) S.sock.emit('voice-off', {});
      tip(TX.off);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) { tip(TX.noSup); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .then(function (stream) {
        S.stream = stream; S.on = true; S.state = 'wait'; paint();
        tip(TX.on);
        loadIo(function () {
          if (!window.io) { tip(TX.noSrv); stopLocal(); paint(); return; }
          if (!S.sock) connect();
          else if (S.sock.connected) S.sock.emit('voice-ready', {});
        });
      })
      .catch(function () { tip(TX.denied); paint(); });
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
    if (S.code === c && S.token === t) { mountButton(); return; }
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

  window.gaVoice = { v: 3, setRoom: setRoom, stop: cleanup, toggle: toggle };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
