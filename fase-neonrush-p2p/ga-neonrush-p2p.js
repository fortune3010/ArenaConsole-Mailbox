#!/usr/bin/env node
/* GA NeonRush — multijogador real (até 12): estrela WebRTC (Host <-> convidados) + reserva pelo servidor.
 *
 * Uso (na RAIZ do repo Arenaapk):
 *   node ga-neonrush-p2p.js
 *   (ou: node ga-neonrush-p2p.js <neonrush-namespace.js> <neonrush/index.html>)
 *
 * Servidor (neonrush-namespace.js):
 *  - limite 8 -> 12 jogadores por sala;
 *  - nr_turn   : devolve os ICE/TURN (./cloudflare-turn, como o Hockey; se não existir, STUN público);
 *  - nr_signal : reencaminha SDP/ICE só para o socket indicado e só dentro da mesma sala;
 *  - nr_state  : reserva — reencaminha posições pela sala quando o WebRTC não liga (máx. 30 msg/s por socket).
 *  - o vencedor continua a ser decidido pelo servidor (player_finished -> game_over -> GA16 onFinish): sem alterações.
 * Cliente (index.html):
 *  - cada telemóvel simula o SEU carro; envia a posição 12x/s (convidado -> Host por DataChannel; Host -> todos);
 *  - os carros dos outros pilotos substituem os bots, com interpolação suave, nome por cima e lugar real no HUD;
 *  - grelha de 4 filas x 3; a meta de cada um fica à mesma distância da sua posição de partida;
 *  - corrige o envio de player_finished (antes usava `sock` fora do âmbito e nunca chegava ao servidor);
 *  - no fim, mostra o MEU lugar (antes mostrava sempre o 1.º) e passa o resultado certo ao ga16Post;
 *  - limite de pilotos 8 -> 12 (menu e bots do modo treino).
 * NÃO toca: microfone, ga16-post.js, física, gráficos.
 * Cada âncora tem de existir exatamente 1 vez; se alguma falhar não escreve nada. Faz .bak. Idempotente (NR_P2P).
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const NS = process.argv[2] || 'backend/services/neonrush-namespace.js';
const HT = process.argv[3] || 'backend/public/games/neonrush/index.html';
for (const f of [NS, HT]) if (!fs.existsSync(f)) {
  console.error('✗ Não encontro ' + f + '\n  Corre na raiz do Arenaapk. Se a pasta do jogo tiver outro nome: ls backend/public/games\n  e depois: node ga-neonrush-p2p.js ' + NS + ' backend/public/games/<pasta>/index.html');
  process.exit(1);
}
const MARK = 'NR_P2P';
let fails = 0;
function must(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) { fails++; console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 150) + '\n  Mostra-me: grep -nF \'' + from.slice(0, 45).replace(/'/g, "'\\''") + '\' <ficheiro>'); return src; }
  console.log('✓ ' + label); return src.replace(from, () => to);
}

/* ============================ SERVIDOR ============================ */
const ns0 = fs.readFileSync(NS, 'utf8'); let ns = ns0;
if (ns.includes(MARK)) console.log('= servidor já tem ' + MARK + ' (salto)');
else {
  ns = must(ns, "const norm = c => String(c == null ? '' : c).replace(/[^\\w-]/g, '').slice(0, 32);",
    "const norm = c => String(c == null ? '' : c).replace(/[^\\w-]/g, '').slice(0, 32);\n" +
    "// NR_P2P: ICE/TURN para o WebRTC (mesma fonte do Hockey). Sem ./cloudflare-turn usa STUN público.\n" +
    "const NR_STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];\n" +
    "let nrIce = async () => NR_STUN;\n" +
    "try { const t = require('./cloudflare-turn'); if (t && typeof t.getIceServers === 'function') nrIce = () => t.getIceServers(); } catch (e) { console.warn('[neonrush] sem cloudflare-turn; P2P só com STUN'); }",
    'S1 servidor: fonte de ICE/TURN');

  ns = must(ns, 'max: Math.max(2, Math.min(8, d.players | 0 || 8))', 'max: Math.max(2, Math.min(12, d.players | 0 || 8)) /* NR_P2P: até 12 */',
    'S2 servidor: limite 12 jogadores');

  ns = must(ns, "on('start_game', () => { // só o Host, com todos já com veículo",
    "// NR_P2P: sinalização WebRTC (estrela Host <-> convidados) + reserva pelo servidor se o P2P falhar.\n" +
    "    on('nr_turn', () => {\n" +
    "      Promise.resolve().then(() => nrIce()).then(ice => s.emit('nr_turn', { iceServers: Array.isArray(ice) && ice.length ? ice : NR_STUN }))\n" +
    "        .catch(e => { console.warn('[neonrush] TURN:', e && e.message); s.emit('nr_turn', { iceServers: NR_STUN }); });\n" +
    "    });\n" +
    "    on('nr_signal', d => {\n" +
    "      const r = room; if (!r || r.phase === 'lobby' || !me()) return;\n" +
    "      const to = String(d.to || ''); if (to === s.id || !r.players.has(to)) return;\n" +
    "      const out = { from: s.id }, c = d.candidate;\n" +
    "      if (d.sdp && typeof d.sdp === 'object' && (d.sdp.type === 'offer' || d.sdp.type === 'answer') && typeof d.sdp.sdp === 'string' && d.sdp.sdp.length < 20000) out.sdp = { type: d.sdp.type, sdp: d.sdp.sdp };\n" +
    "      else if (c && typeof c === 'object' && typeof c.candidate === 'string' && c.candidate.length < 2000) out.candidate = { candidate: c.candidate, sdpMid: c.sdpMid == null ? null : String(c.sdpMid).slice(0, 64), sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null };\n" +
    "      else return;\n" +
    "      nsp.to(to).emit('nr_signal', out);\n" +
    "    });\n" +
    "    on('nr_state', d => {\n" +
    "      const r = room; if (!r || r.phase === 'lobby' || !me() || !Array.isArray(d.s)) return;\n" +
    "      const now = Date.now(); if (now - (s.data.nrW || 0) >= 1000) { s.data.nrW = now; s.data.nrN = 0; } if (++s.data.nrN > 30) return;\n" +
    "      const out = [];\n" +
    "      for (const a of d.s.slice(0, 12)) { if (!Array.isArray(a) || a.length < 6) continue; const v = a.slice(0, 6).map(Number); if (v.every(Number.isFinite)) out.push(v.map(Math.round)); }\n" +
    "      if (!out.length) return; const op = s.to(r.code); (op.volatile || op).emit('nr_state', { s: out });\n" +
    "    });\n" +
    "    on('start_game', () => { // só o Host, com todos já com veículo",
    'S3 servidor: nr_turn + nr_signal + nr_state');
}

/* ============================ CLIENTE ============================ */
const h0 = fs.readFileSync(HT, 'utf8'); let h = h0;
if (h.includes(MARK)) console.log('= index.html já tem ' + MARK + ' (salto)');
else {
  // Módulo de rede P2P (dentro do script de rede, antes de mp()). Usa as variáveis globais do jogo em tempo de execução.
  const MOD = String.raw`/* NR_P2P: corrida multijogador real — estrela WebRTC (Host <-> convidados); reserva pelo servidor (nr_state) */
const NRP=N.P={seat:-1,host:false,hostId:null,ids:[],names:[],cars:[],peers:new Map(),ice:null,q:[],last:{},raw:new Map(),st:new Map(),seq:0,o0:0,x0:0,timer:0,on:0};
const NRL=[-.667,0,.667],nrOff=(i,n)=>((Math.ceil(n/3)-1)-((i/3)|0))*900,nrOpen=P=>!!(P&&P.dc&&P.dc.readyState==='open');
function nrCarSet(c,a){c.rz=+a[2];c.rx=Math.max(-2.5,Math.min(2.5,a[3]/1000));c.rv=Math.max(0,+a[4]);c.ra=a[5]/100;c.rt=performance.now();c.got=1}
function nrApply(a){if(!Array.isArray(a)||a.length<6)return;const i=a[0]|0,n=+a[1];if(i===NRP.seat||i<0||i>=NRP.ids.length||!(n>(NRP.last[i]||0)))return;
 const v=a.slice(0,6).map(Number);if(!v.every(Number.isFinite))return;NRP.last[i]=n;NRP.raw.set(i,{a:v,t:Date.now()});const c=NRP.st.get(i);if(c)nrCarSet(c,v)}
N.mkCars=()=>{if(!NRP.on||NRP.seat<0)return null;NRP.st.clear();const n=NRP.ids.length,out=[];
 for(let i=0;i<n;i++){if(i===NRP.seat)continue;const v=VEH[NRP.cars[i]]||VEH[0],o=nrOff(i,n),x=NRL[i%3],
  c={net:1,seat:i,nm:NRP.names[i],o,z:PZ+o,x,tx:x,vx:0,spd:0,b:0,t:9,col:v.col,ty:v.ty,len:v.L,hw:v.hw,m:v.m,h:v.h,hp:1,spin:0,ang:0,sdir:1,kb:0,n:-1,q:0,pg:0,rz:PZ+o,rx:x,rv:0,ra:0,rt:0,got:0};
  const r=NRP.raw.get(i);if(r)nrCarSet(c,r.a);NRP.st.set(i,c);out.push(c)}
 return out};
window.__nrCar=(c,dt)=>{if(c.got){const age=(performance.now()-c.rt)/1000;if(age>3)c.rv*=Math.pow(.15,dt);
  const tz=c.rz+c.rv*Math.min(.4,age),ez=tz-c.z;c.spd+=(c.rv-c.spd)*Math.min(1,dt*8);if(Math.abs(ez)>9000)c.z=tz;else c.z+=c.spd*dt+ez*Math.min(1,dt*5);
  const x0=c.x;c.x+=(c.rx-c.x)*Math.min(1,dt*9);c.tx=c.rx;c.vx+=((c.x-x0)/Math.max(dt,1e-3)-c.vx)*Math.min(1,dt*8);c.ang=c.ra;c.spin=0;c.kb=0}
 c.pg=c.z-PZ-c.o};
window.__nrTag=(c,x,y,sc)=>{try{const T=VT[c.ty],w=sc*T[0]*U*HX;if(w<10*K)return;const hh=w*T[1]/T[0],fs=Math.max(9,Math.min(15,w*.14/K))*K,t=String(c.nm||'').slice(0,14);
 g.save();g.font='700 '+(fs|0)+'px Orbitron,system-ui,sans-serif';g.textAlign='center';const tw=g.measureText(t).width+fs*.9,ty=y-hh*1.1-fs*.8;
 g.fillStyle='rgba(11,2,33,.62)';g.fillRect(x-tw/2,ty-fs*.95,tw,fs*1.35);g.fillStyle=c.col;g.fillRect(x-tw/2,ty+fs*.3,tw,Math.max(1,fs*.1));g.fillStyle='#fff';g.fillText(t,x,ty);g.restore()}catch(e){}};
function nrPeer(sock,id,init){let P=NRP.peers.get(id);if(P)return P;if(typeof RTCPeerConnection!=='function')return null;let pc;try{pc=new RTCPeerConnection({iceServers:NRP.ice||[]})}catch(e){console.warn('[NR P2P] RTCPeerConnection',e);return null}
 P={pc,dc:null,rq:[]};NRP.peers.set(id,P);
 pc.onicecandidate=e=>{if(e.candidate)sock.emit('nr_signal',{to:id,candidate:e.candidate.toJSON?e.candidate.toJSON():e.candidate})};
 pc.onconnectionstatechange=()=>{const s=pc.connectionState;console.log('[NR P2P]',String(id).slice(0,6),s);if(s==='failed'||s==='closed'){if(NRP.peers.get(id)===P)NRP.peers.delete(id);try{pc.close()}catch(e){}}};
 const wire=dc=>{P.dc=dc;dc.onopen=()=>console.log('[NR P2P] canal aberto com',String(id).slice(0,6));dc.onmessage=e=>{try{const m=JSON.parse(e.data);if(m&&Array.isArray(m.s))m.s.forEach(nrApply)}catch(_){}}};
 if(init){wire(pc.createDataChannel('nr',{ordered:false,maxRetransmits:0}));
  pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>sock.emit('nr_signal',{to:id,sdp:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}})).catch(e=>console.warn('[NR P2P] oferta',e))}
 else pc.ondatachannel=e=>wire(e.channel);
 return P}
function nrSig(sock,d){let P=NRP.peers.get(d.from);
 if(!P){if(NRP.host||d.from!==NRP.hostId||!d.sdp||d.sdp.type!=='offer')return;P=nrPeer(sock,d.from,false);if(!P)return}
 const pc=P.pc;
 if(d.sdp)pc.setRemoteDescription(d.sdp).then(()=>{P.rq.splice(0).forEach(c=>pc.addIceCandidate(c).catch(()=>{}));
  if(d.sdp.type==='offer')return pc.createAnswer().then(a=>pc.setLocalDescription(a)).then(()=>sock.emit('nr_signal',{to:d.from,sdp:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}}))}).catch(e=>console.warn('[NR P2P] sdp',e));
 else if(d.candidate){if(pc.remoteDescription)pc.addIceCandidate(d.candidate).catch(()=>{});else P.rq.push(d.candidate)}}
function nrTick(sock){if(!NRP.on||NRP.seat<0||!(state>=1||fin>0))return;
 const me=[NRP.seat,++NRP.seq,Math.round(pos+PZ),Math.round(px*1000),Math.round(spd),Math.round((ang||0)*100)];
 if(!NRP.host){const P=NRP.peers.get(NRP.hostId);if(nrOpen(P)){try{P.dc.send(JSON.stringify({s:[me]}));return}catch(e){}}sock.emit('nr_state',{s:[me]});return}
 const now=Date.now(),arr=[me];NRP.raw.forEach(r=>{if(now-r.t<3000)arr.push(r.a)});const js=JSON.stringify({s:arr});let miss=0;
 NRP.ids.forEach((id,i)=>{if(i===NRP.seat)return;const P=NRP.peers.get(id);if(nrOpen(P)){try{P.dc.send(js)}catch(e){miss=1}}else miss=1});
 if(miss)sock.emit('nr_state',{s:arr})}
function nrStart(sock,m){const ps=Array.isArray(m&&m.players)?m.players:[];NRP.ids=ps.map(p=>p.id);NRP.names=ps.map(p=>String(p.name||''));NRP.cars=ps.map(p=>p.car|0);
 NRP.seat=NRP.ids.indexOf(sock.id);NRP.hostId=m.host;NRP.host=m.host===sock.id;N.seat=NRP.seat;if(NRP.seat<0)return;
 NRP.o0=nrOff(NRP.seat,ps.length);NRP.x0=NRL[NRP.seat%3];NRP.on=1;
 console.log('[NR P2P] corrida com',ps.length,'pilotos · lugar',NRP.seat,NRP.host?'(Host)':'');
 sock.emit('nr_turn',{});clearInterval(NRP.timer);NRP.timer=setInterval(()=>{try{nrTick(sock)}catch(e){}},83)}
NRP.stop=()=>{NRP.on=0;clearInterval(NRP.timer);setTimeout(()=>{NRP.peers.forEach(P=>{try{P.pc.close()}catch(e){}});NRP.peers.clear()},4000)};
addEventListener('pagehide',()=>{try{NRP.peers.forEach(P=>P.pc.close())}catch(e){}});
function nrP2P(sock){
 sock.on('match_start',m=>{try{nrStart(sock,m)}catch(e){console.error('[NR P2P] início',e)}});
 sock.on('nr_turn',d=>{NRP.ice=d&&Array.isArray(d.iceServers)&&d.iceServers.length?d.iceServers:[{urls:'stun:stun.l.google.com:19302'}];
  if(NRP.host)NRP.ids.forEach((id,i)=>{if(i!==NRP.seat)nrPeer(sock,id,true)});NRP.q.splice(0).forEach(x=>nrSig(sock,x))});
 sock.on('nr_signal',d=>{if(!d||!d.from)return;if(!NRP.ice){NRP.q.push(d);return}nrSig(sock,d)});
 sock.on('nr_state',d=>{if(d&&Array.isArray(d.s))d.s.forEach(nrApply)})}
`;
  h = must(h, '// ---- room + start=1: liga ao servidor;', MOD + '// ---- room + start=1: liga ao servidor;', 'C1 cliente: módulo P2P (estrela WebRTC + reserva)');

  h = must(h, "sock.on('lobby_state',s=>{L=s;render()});",
    "sock.on('lobby_state',s=>{L=s;render()});N.sock=sock;try{nrP2P(sock)}catch(e){console.error('[NR P2P]',e)}/*NR_P2P*/",
    'C2 cliente: ligar o P2P ao socket da sala');

  h = must(h, 'const d0=window.done;window.done=function(){d0();',
    "const d0=window.done;window.done=function(){d0();try{if(sock.connected)sock.emit('player_finished',{time:fin})}catch(e){}/*NR_P2P: antes nunca chegava ao servidor*/",
    'C3 cliente: player_finished chega ao servidor');

  h = must(h, "sock.on('game_over',g=>{try{window.ga16Post&&window.ga16Post(g)}catch(e){};try{const ranking=(g&&g.ranking)||[];if(!ranking.length)return;const mine=ranking[0];",
    "sock.on('game_over',g=>{const rk0=(g&&g.ranking)||[],me0=rk0.find(r=>r.seat===N.seat),nm0=[];rk0.forEach(r=>{nm0[r.seat]=r.name});try{N.P&&N.P.stop()}catch(e){}/*NR_P2P*/" +
      "try{const w0=rk0[0]&&!rk0[0].dnf?rk0[0].seat:undefined;window.ga16Post&&window.ga16Post(Object.assign({},g,{winnerSeat:w0,names:nm0}),{mySeat:N.seat>=0?N.seat:undefined,players:rk0.length,names:nm0,outcome:me0?(me0.place===1&&!me0.dnf?'win':'loss'):undefined,game:'neonrush'})}catch(e){};" +
      "try{const ranking=rk0;if(!ranking.length)return;const mine=me0||ranking[0];",
    'C4 cliente: fim de jogo mostra o MEU lugar + ga16Post com resultado');

  h = must(h, 'function pk(k,d){if(k==2)NP=Math.max(2,Math.min(8,NP+d));',
    'function pk(k,d){if(k==2)NP=Math.max(2,Math.min(12,NP+d));/*NR_P2P: até 12*/',
    'C5 cliente: menu até 12 pilotos');

  h = must(h, 'cars=[-.667,.667,0,-.667,.667,0,-.667].slice(0,NP-1)',
    'cars=[-.667,.667,0,-.667,.667,0,-.667,.667,0,-.667,.667].slice(0,NP-1)',
    'C6 cliente: até 11 bots no treino');

  h = must(h, 'n:-1,q:0}});rank=cars.length+1}',
    'n:-1,q:0}});if(window.__NET&&__NET.mkCars){const nc=__NET.mkCars();if(nc){cars=nc;pos=__NET.P.o0;px=camX=__NET.P.x0;FIN=TL+pos}}/*NR_P2P: pilotos reais + grelha*/rank=cars.length+1}',
    'C7 cliente: pilotos reais em vez de bots + grelha');

  h = must(h, 'for(const c of cars){const d=c.z-me.z,f=state>=2?',
    'for(const c of cars){if(c.net){if(window.__nrCar)__nrCar(c,dt);continue}/*NR_P2P*/const d=c.z-me.z,f=state>=2?',
    'C8 cliente: carros remotos seguem a rede (sem IA)');

  h = must(h, 'const rk=1+cars.filter(c=>c.z>ps2).length;',
    'const rk=1+cars.filter(c=>c.net?c.pg>pos-((window.__NET&&__NET.P&&__NET.P.o0)||0):c.z>ps2).length;/*NR_P2P*/',
    'C9 cliente: lugar no HUD pela distância real percorrida');

  h = must(h, 'vcar(c,x1+(x2-x1)*q+sc*c.x*RW*HX,y1+(y2-y1)*q,sc)',
    '{const nx_=x1+(x2-x1)*q+sc*c.x*RW*HX,ny_=y1+(y2-y1)*q;vcar(c,nx_,ny_,sc);if(c.net&&window.__nrTag)__nrTag(c,nx_,ny_,sc)}/*NR_P2P*/',
    'C10 cliente: nome do piloto por cima do carro');
}

if (fails) { console.error('\n✗ ' + fails + ' âncora(s) falharam. NADA foi escrito.'); process.exit(2); }

/* ============================ validação + escrita ============================ */
function bad(x) { const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m, n = 0;
  while ((m = re.exec(x))) { const a = m[1] || ''; if (/\ssrc\s*=/i.test(a) || /type\s*=\s*["']?(module|application\/json)/i.test(a)) continue; try { new Function(m[2]); } catch (e) { n++; } } return n; }
const b0 = bad(h0), b1 = bad(h);
if (b1 > b0) { console.error('✗ O index.html ficaria com erro de sintaxe (' + b0 + ' -> ' + b1 + '). NADA foi escrito.'); process.exit(3); }
console.log('✓ index.html: scripts inline compilam (erros antes/depois: ' + b0 + '/' + b1 + ')');
const wrote = [];
if (h !== h0) { fs.copyFileSync(HT, HT + '.bak'); fs.writeFileSync(HT, h); wrote.push(HT); }
if (ns !== ns0) {
  fs.copyFileSync(NS, NS + '.bak'); fs.writeFileSync(NS, ns); wrote.push(NS);
  try { execFileSync(process.execPath, ['--check', NS], { stdio: 'pipe' }); console.log('✓ node --check ' + NS); }
  catch (e) { fs.copyFileSync(NS + '.bak', NS); if (h !== h0) fs.copyFileSync(HT + '.bak', HT); console.error('✗ node --check falhou; repostos os originais.\n' + String(e.stderr || e.message)); process.exit(4); }
}
if (!wrote.length) { console.log('= Nada a fazer.'); process.exit(0); }
console.log('\nOK. Escritos: ' + wrote.join(', ') + '\nBackups: *.bak (não os adiciones ao git).\n\ngit add ' + wrote.join(' '));
