/* GA16_POST v3 — fim de jogo universal (popup premium + report único ao Android).
 *
 * Uso (no handler de game_over de cada jogo):
 *   window.ga16Post(o)                      // o = payload do game_over do servidor
 *   window.ga16Post(o, { mySeat, names, players, outcome, game })   // contexto opcional
 *
 * Fluxo:
 *   1. bloqueia toques no jogo e esconde botões "Jogar de novo"
 *   2. mostra o popup premium (resultado, avatares, nomes, placar se existir)
 *   3. passados 3,5 s chama AndroidInterface.reportMatchResult('ga16_<outcome>', json) UMA vez
 *      outcome ∈ win | loss | draw | closed | end  (end = não foi possível saber o meu lugar)
 *   4. o Android grava o histórico (1×) e fecha o WebView → Histórico
 *
 * O jogo NÃO deve chamar reportMatchResult por conta própria quando usa este ficheiro.
 */
(function () {
  if (window.ga16Post && window.ga16Post.v >= 3) return;

  var SHOW_MS = 400;     // deixa o jogo terminar a última animação
  var REPORT_MS = 3500;  // tempo do popup antes de o Android fechar
  var CLOSED_MS = 1500;

  function num(v) { var n = Number(v); return Number.isInteger(n) ? n : null; }
  function str(v) { return v == null ? '' : String(v); }

  function probeSeat(o, c) {
    var cands = [c && c.mySeat, o && o.mySeat, o && o.you, o && o.seat];
    for (var i = 0; i < cands.length; i++) { var n = num(cands[i]); if (n !== null && n >= 0) return n; }
    try { /* jogos com `let mySeat` no topo do script (Dama, Fruit, …) */
      // eslint-disable-next-line no-undef
      if (typeof mySeat !== 'undefined') { var g = num(mySeat); if (g !== null && g >= 0) return g; }
    } catch (e) {}
    return null;
  }

  function probeNames(o, c) {
    var src = (c && c.names) || (o && o.names) || null;
    if (!src && o && Array.isArray(o.players)) src = o.players.map(function (p) { return p && (p.name || p.username || p.nick); });
    if (!src && o && Array.isArray(o.seats)) src = o.seats.map(function (p) { return p && (p.name || p.username || p.nick); });
    return Array.isArray(src) ? src.map(function (n) { return str(n).slice(0, 24); }) : [];
  }

  function probeScores(o) {
    var s = o && o.scores;
    if (Array.isArray(s) && s.length >= 2 && s.every(function (v) { return Number.isFinite(Number(v)); })) return s.map(Number);
    return null;
  }

  function initials(n) {
    var t = str(n).trim();
    if (!t) return '?';
    var p = t.split(/\s+/);
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  var CSS =
    '#ga16Post{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'background:radial-gradient(120% 90% at 50% 40%,rgba(10,14,32,.78),rgba(3,4,12,.94));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;opacity:0;transition:opacity .35s ease;pointer-events:auto}' +
    '#ga16Post.on{opacity:1}' +
    '#ga16Post .gc{--a:#9aa4b8;--a2:#5a6478;position:relative;width:min(380px,100%);padding:26px 20px 18px;border-radius:24px;text-align:center;overflow:hidden;' +
    'background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.03) 55%,rgba(255,255,255,.08));border:1px solid rgba(255,255,255,.22);' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.4),0 24px 60px rgba(0,0,0,.6),0 0 46px var(--a2);transform:translateY(18px) scale(.94);transition:transform .5s cubic-bezier(.2,1.3,.4,1)}' +
    '#ga16Post.on .gc{transform:none}' +
    '#ga16Post .gc.win{--a:#ffd45a;--a2:rgba(255,196,60,.45)}#ga16Post .gc.loss{--a:#ff5c6c;--a2:rgba(255,70,90,.35)}' +
    '#ga16Post .gc.draw{--a:#b7c2d8;--a2:rgba(170,185,215,.3)}#ga16Post .gc.end,#ga16Post .gc.closed{--a:#7cc8ff;--a2:rgba(90,170,255,.32)}' +
    '#ga16Post .gc::before{content:"";position:absolute;inset:0;border-radius:24px;padding:2px;pointer-events:none;' +
    'background:linear-gradient(135deg,var(--a),transparent 40%,transparent 60%,var(--a));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}' +
    '#ga16Post .gc::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;pointer-events:none;' +
    'background:linear-gradient(100deg,transparent,rgba(255,255,255,.18),transparent);animation:ga16sh 2.6s ease-in-out .5s infinite}' +
    '@keyframes ga16sh{0%{left:-60%}55%,100%{left:130%}}' +
    '#ga16Post .ic{font-size:46px;line-height:1;filter:drop-shadow(0 4px 10px var(--a2));animation:ga16pop .7s cubic-bezier(.2,1.6,.4,1) both}' +
    '#ga16Post h2{margin:8px 0 0;font-size:30px;font-weight:900;letter-spacing:.08em;color:var(--a);text-shadow:0 2px 0 rgba(0,0,0,.45),0 0 22px var(--a2);animation:ga16pop .7s cubic-bezier(.2,1.6,.4,1) .08s both}' +
    '@keyframes ga16pop{0%{opacity:0;transform:scale(.3)}60%{opacity:1;transform:scale(1.12)}100%{transform:none}}' +
    '#ga16Post .sb{margin-top:4px;font-size:13px;opacity:.8}' +
    '#ga16Post .vs{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:20px}' +
    '#ga16Post .pl{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:7px;animation:ga16in .6s ease-out .25s both}' +
    '#ga16Post .pl.r{animation-delay:.35s}@keyframes ga16in{from{opacity:0;transform:translateY(12px)}}' +
    '#ga16Post .av{position:relative;width:66px;height:66px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:22px;' +
    'background:linear-gradient(145deg,#3a4c8a,#1a2246);border:2px solid rgba(255,255,255,.35);box-shadow:0 6px 16px rgba(0,0,0,.5)}' +
    '#ga16Post .pl.me .av{background:linear-gradient(145deg,#2a9a6a,#0e4a34)}' +
    '#ga16Post .pl.w .av{border-color:#ffd45a;box-shadow:0 0 0 3px rgba(255,212,90,.25),0 0 22px rgba(255,200,70,.7)}' +
    '#ga16Post .pl.l .av{filter:grayscale(.55) brightness(.8)}' +
    '#ga16Post .bd{position:absolute;right:-6px;bottom:-4px;font-size:20px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.6))}' +
    '#ga16Post .nm{max-width:100%;font-size:14px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#ga16Post .sc{flex:none;min-width:64px;font-size:28px;font-weight:900;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 0 14px var(--a2)}' +
    '#ga16Post .sc.vsx{font-size:16px;opacity:.7;letter-spacing:.2em}' +
    '#ga16Post .ft{margin-top:20px;font-size:12px;opacity:.75}' +
    '#ga16Post .pb{margin-top:8px;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}' +
    '#ga16Post .pb i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--a),#fff);border-radius:3px}' +
    '#ga16Post .cf{position:absolute;top:-12px;width:7px;height:12px;border-radius:2px;opacity:.95;animation:ga16cf linear forwards}' +
    '@keyframes ga16cf{to{transform:translate(var(--dx),115vh) rotate(var(--r));opacity:.85}}' +
    '@media (prefers-reduced-motion:reduce){#ga16Post .gc::after,#ga16Post .cf{animation:none;display:none}#ga16Post .ic,#ga16Post h2,#ga16Post .pl{animation:none}}';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function playerBox(name, isMe, state, side) {
    var b = el('div', 'pl ' + side + (isMe ? ' me' : '') + (state ? ' ' + state : ''));
    var av = el('div', 'av', initials(name));
    if (state === 'w') av.appendChild(el('span', 'bd', '🏆'));
    else if (state === 'l') av.appendChild(el('span', 'bd', '❌'));
    b.appendChild(av);
    b.appendChild(el('div', 'nm', name));
    return b;
  }

  function confetti(root) {
    var cols = ['#ffd45a', '#ff6fa8', '#5fe3ff', '#8dff7a', '#ffffff'];
    for (var i = 0; i < 26; i++) {
      var c = el('i', 'cf');
      c.style.left = (Math.random() * 100) + '%';
      c.style.background = cols[i % cols.length];
      c.style.setProperty('--dx', ((Math.random() - .5) * 140).toFixed(0) + 'px');
      c.style.setProperty('--r', ((Math.random() - .5) * 900).toFixed(0) + 'deg');
      c.style.animationDuration = (2.2 + Math.random() * 1.6).toFixed(2) + 's';
      c.style.animationDelay = (Math.random() * .6).toFixed(2) + 's';
      root.appendChild(c);
    }
  }

  function render(info) {
    var old = document.getElementById('ga16Post');
    if (old && old.getAttribute('data-v') === '3') return;
    if (old) old.remove(); // overlay antigo (v2 / código próprio do jogo) → substituído pelo premium
    if (!document.getElementById('ga16PostCss')) {
      var st = el('style'); st.id = 'ga16PostCss'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st);
    }
    var T = {
      win: ['🏆', 'VITÓRIA!', 'Parabéns, ganhaste a partida'],
      loss: ['😞', 'DERROTA', 'Fica para a próxima'],
      draw: ['🤝', 'EMPATE', 'Ninguém venceu desta vez'],
      end: ['🏁', 'FIM DE PARTIDA', info.winnerName ? info.winnerName + ' venceu' : 'Partida terminada'],
      closed: ['⏳', 'SALA FECHADA', 'A sala expirou ou foi fechada']
    }[info.outcome] || ['🏁', 'FIM DE PARTIDA', ''];

    var root = el('div'); root.id = 'ga16Post'; root.setAttribute('data-v', '3');
    var card = el('div', 'gc ' + info.outcome);
    card.appendChild(el('div', 'ic', T[0]));
    card.appendChild(el('h2', null, T[1]));
    card.appendChild(el('div', 'sb', T[2]));

    if (info.outcome !== 'closed') {
      var vs = el('div', 'vs');
      var n = info.names, me = info.mySeat, w = info.winnerSeat, two = info.players === 2 || (info.players <= 0 && n.length === 2);
      var draw = info.outcome === 'draw';
      if (me !== null && two) {
        var opp = 1 - me;
        var myName = 'Tu', oppName = n[opp] || 'Adversário';
        vs.appendChild(playerBox(myName, true, draw ? '' : (w === me ? 'w' : 'l'), 'l'));
        var sc = info.scores;
        vs.appendChild(el('div', sc ? 'sc' : 'sc vsx', sc ? (sc[me] + ' – ' + sc[opp]) : 'VS'));
        vs.appendChild(playerBox(oppName, false, draw ? '' : (w === opp ? 'w' : 'l'), 'r'));
      } else if (w !== null && w >= 0) {
        vs.appendChild(playerBox(w === me ? 'Tu' : (n[w] || 'Vencedor'), w === me, 'w', 'l'));
      }
      if (vs.childNodes.length) card.appendChild(vs);
    }

    card.appendChild(el('div', 'ft', info.outcome === 'closed' ? 'A voltar…' : 'A abrir o Histórico…'));
    var pb = el('div', 'pb'), bar = el('i'); pb.appendChild(bar); card.appendChild(pb);
    root.appendChild(card);
    if (info.outcome === 'win') confetti(root);
    document.body.appendChild(root);
    requestAnimationFrame(function () {
      root.classList.add('on');
      bar.style.transition = 'width ' + info.waitMs + 'ms linear';
      requestAnimationFrame(function () { bar.style.width = '100%'; });
    });
  }

  function blockInput() {
    var stop = function (e) {
      var b = document.getElementById('ga16Post');
      if (b && b.contains(e.target)) return;
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
    };
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown'].forEach(function (t) {
      addEventListener(t, stop, { capture: true, passive: false });
    });
    var RX = /jogar\s*(novamente|de\s*novo|outra\s*vez)|nova\s*partida|play\s*again|revanche|reiniciar|recome[cç]ar|retry|voltar\s*ao\s*menu/i;
    var hide = function () {
      try {
        document.querySelectorAll('button,a,[role=button],[onclick],.btn').forEach(function (b) {
          var t = (b.textContent || '').trim();
          if (t && t.length < 40 && RX.test(t)) { b.style.setProperty('display', 'none', 'important'); b.disabled = true; }
        });
      } catch (e) {}
    };
    hide(); setTimeout(hide, 1200); setTimeout(hide, 3000);
  }

  function report(info) {
    try {
      var A = window.AndroidInterface;
      if (!A || typeof A.reportMatchResult !== 'function') return;
      A.reportMatchResult('ga16_' + info.outcome, JSON.stringify({
        outcome: info.outcome,
        winnerSeat: info.winnerSeat,
        mySeat: info.mySeat,
        players: info.players,
        names: info.names,
        scores: info.scores,
        winner: info.winnerName,
        game: info.game
      }));
    } catch (e) { console.error('[GA16] reportMatchResult:', e); }
  }

  function ga16Post(o, ctx) {
    // flag própria: alguns jogos já usam window.__ga16Done antes de chamar ga16Post
    if (window.__ga16PostV3) return;
    window.__ga16PostV3 = 1;
    o = o || {}; ctx = ctx || {};
    var mySeat = probeSeat(o, ctx);
    var names = probeNames(o, ctx);
    var ws = num(o.winnerSeat != null ? o.winnerSeat : o.winner);
    var draw = !!o.draw || (ws !== null && ws < 0);
    var players = num(ctx.players != null ? ctx.players : o.players) || names.length || 0;
    var forced = ['win', 'loss', 'draw', 'closed', 'end'].indexOf(ctx.outcome) >= 0 ? ctx.outcome : null;
    var outcome = forced ? forced
      : draw ? 'draw'
      : (ws !== null && mySeat !== null) ? (ws === mySeat ? 'win' : 'loss')
      : 'end';
    var info = {
      outcome: outcome,
      mySeat: mySeat,
      winnerSeat: ws !== null && ws >= 0 ? ws : -1,
      winnerName: (ws !== null && ws >= 0 && names[ws]) ? names[ws]
        : str(o.winnerName || (Array.isArray(o.ranking) && o.ranking[0] && typeof o.ranking[0] === 'object' ? o.ranking[0].name : '')).slice(0, 24),
      players: players,
      names: names,
      scores: probeScores(o),
      game: str(ctx.game),
      waitMs: outcome === 'closed' ? CLOSED_MS : REPORT_MS
    };
    blockInput();
    setTimeout(function () { try { render(info); } catch (e) { console.error('[GA16] popup:', e); } }, outcome === 'closed' ? 0 : SHOW_MS);
    setTimeout(function () { report(info); }, (outcome === 'closed' ? 0 : SHOW_MS) + info.waitMs);
  }
  ga16Post.v = 3;
  window.ga16Post = ga16Post;
})();
