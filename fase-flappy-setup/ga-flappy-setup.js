#!/usr/bin/env node
/* GA Flappy — setup premium (só o ecrã ?mode=setup).
 *
 * Uso (na RAIZ do repo Arenaapk):
 *   node ga-flappy-setup.js
 *   (ou: node ga-flappy-setup.js <caminho/flappy/index.html>)
 *
 * O que muda (só visual, dentro de setup()):
 *  - Cabeçalho animado: o pássaro escolhido voa entre canos no céu do mundo escolhido (atualiza ao tocar).
 *  - Mundos em cartões com miniatura desenhada (céu do mundo + canos + chão) e ✓ no escolhido.
 *  - Pássaros em cartões com o pássaro desenhado na cor da skin (em vez da bolinha).
 *  - Contador de jogadores e botão "GUARDAR CONFIGURAÇÃO" com estilo premium.
 * Fica IGUAL: ids (#sw #sk #sn #sm #sc #sq #sg), data-i/data-k, o handler de cliques, saveSetup(),
 *  limites de jogadores (2–12 / torneio 2–4), localStorage, rede, GA16, microfone, modo multijogador.
 *
 * Cada âncora tem de existir exatamente 1 vez; se alguma falhar não escreve nada. Faz .bak. Idempotente.
 */
'use strict';
const fs = require('fs');
const F = process.argv[2] || 'backend/public/games/flappy/index.html';
if (!fs.existsSync(F)) { console.error('✗ Não encontro ' + F + ' (corre na raiz do Arenaapk; se a pasta tiver outro nome: ls backend/public/games)'); process.exit(1); }
const MARK = 'GA_FLAPPY_SETUP';
const s0 = fs.readFileSync(F, 'utf8');
if (s0.includes(MARK)) { console.log('= Já aplicado. Nada a fazer.'); process.exit(0); }
let s = s0, fails = 0;
function must(from, to, label) {
  const n = s.split(from).length - 1;
  if (n !== 1) { fails++; console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 140) + '\n  Mostra-me: grep -nF \'' + from.slice(0, 45).replace(/'/g, "'\\''") + '\' ' + F); return; }
  s = s.replace(from, () => to); console.log('✓ ' + label);
}

/* ---------------- CSS (só dentro de #stp) ---------------- */
const CSS = String.raw`/*GA_FLAPPY_SETUP*/
#stp{gap:14px;background:radial-gradient(120% 55% at 50% 0%,#24407e 0%,#101a3a 45%,#05060f 100%)}
#stp>*{flex:none}
#stp h2{align-self:stretch;display:flex;align-items:center;gap:8px;margin:0 0 10px;font:900 12px/1 system-ui;letter-spacing:.2em;text-transform:uppercase;color:#9fe9ff}
#stp h2::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(120,255,255,.45),transparent)}
#stp .gaSec{width:min(94vw,460px);padding:14px;border-radius:20px;box-sizing:border-box;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.02));border:1px solid rgba(160,230,255,.18);box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08)}
#gaHero{position:relative;width:min(94vw,460px);height:176px;border-radius:22px;overflow:hidden;border:1px solid rgba(160,230,255,.35);box-shadow:0 0 0 1px #000,0 16px 40px rgba(0,0,0,.6),0 0 30px rgba(80,220,255,.25);background:#5ec8ff}
#gaFH{position:absolute;inset:0;width:100%;height:100%;display:block}
#gaHero .gaTt{position:absolute;left:0;right:0;top:12px;text-align:center;pointer-events:none;line-height:1}
#gaHero .gaTt b{display:block;font:900 30px/1 system-ui;letter-spacing:.08em;color:#fff;-webkit-text-stroke:2px #10203a;paint-order:stroke fill;text-shadow:0 3px 0 #10203a,0 8px 16px rgba(0,0,0,.45)}
#gaHero .gaTt span{display:inline-block;margin-top:5px;padding:3px 11px;border-radius:999px;font:900 10px/1.2 system-ui;letter-spacing:.38em;color:#10203a;background:linear-gradient(90deg,#ffe36a,#ffb13a);box-shadow:0 2px 6px rgba(0,0,0,.35)}
#gaFHn{position:absolute;left:10px;bottom:10px;max-width:calc(100% - 20px);padding:5px 10px;border-radius:12px;box-sizing:border-box;background:rgba(5,8,20,.62);font:700 12px/1.2 system-ui;color:#dff8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stp #sw{width:100%;gap:10px}
#stp .wc{position:relative;overflow:hidden;min-height:0;padding:0 0 9px;gap:1px;border-radius:16px;border:2px solid rgba(255,255,255,.12);background:#0d1530 !important;color:#fff;box-shadow:0 6px 14px rgba(0,0,0,.4);transition:transform .15s,border-color .2s,box-shadow .2s;cursor:pointer}
#stp .wc .gaTh{display:block;width:100%;height:auto;aspect-ratio:7/4;margin-bottom:6px;pointer-events:none}
#stp .wc b{padding:0 10px;font:800 14px/1.15 system-ui;text-shadow:0 1px 2px #000}
#stp .wc i{padding:0 10px;font-size:11px;color:#bfe4ff;opacity:.85}
#stp .wc.on{border-color:#7ff;box-shadow:0 0 0 2px rgba(120,255,255,.3),0 0 22px rgba(80,220,255,.6);transform:translateY(-2px)}
#stp .wc.on::after{content:'';position:absolute;top:7px;right:7px;width:24px;height:24px;border-radius:50%;background:#7ff;box-shadow:0 2px 6px rgba(0,0,0,.6)}#stp .wc.on::before{content:'';position:absolute;z-index:1;top:13px;right:14px;width:10px;height:5px;border-left:3px solid #10203a;border-bottom:3px solid #10203a;transform:rotate(-45deg)}
#stp #sk{width:100%;display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}
#stp .kc{flex-direction:column;justify-content:center;gap:4px;padding:8px 6px 10px;border-radius:16px;border:2px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#e8f6ff;font:700 12px/1.15 system-ui;transition:transform .15s,border-color .2s,box-shadow .2s,background .2s;cursor:pointer}
#stp .kc .gaKb{display:block;width:54px;height:54px;pointer-events:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5))}
#stp .kc.on{border-color:#7ff;background:radial-gradient(circle at 50% 35%,rgba(120,255,255,.28),rgba(80,220,255,.06));box-shadow:0 0 18px rgba(80,220,255,.55)}
#stp .wc:active,#stp .kc:active{transform:scale(.96)}
#stp #sn{justify-content:center;gap:24px}
#stp #sn b{min-width:60px;text-align:center;font:900 36px/1 system-ui;color:#fff;text-shadow:0 0 16px rgba(80,220,255,.7)}
#stp #sn button{background:radial-gradient(circle at 35% 30%,#3a5ea8,#14204a);border:2px solid rgba(160,230,255,.45);color:#fff;box-shadow:0 6px 14px rgba(0,0,0,.5);cursor:pointer}
#stp #sn button:disabled{opacity:.35}
#stp #sg{width:min(94vw,460px);min-height:58px;margin-top:4px;border-radius:18px;border:0;font:900 16px/1 system-ui;letter-spacing:.12em;color:#10203a;background:linear-gradient(180deg,#ffe97a,#ffb330);box-shadow:0 6px 0 #b9721a,0 14px 26px rgba(0,0,0,.5),inset 0 2px 0 rgba(255,255,255,.6);cursor:pointer}
#stp #sg:active{transform:translateY(4px);box-shadow:0 2px 0 #b9721a,0 8px 16px rgba(0,0,0,.5)}
@media (prefers-reduced-motion:reduce){#stp .wc,#stp .kc{transition:none}}`.replace(/\n/g, '');

must('#sn{display:flex;align-items:center;gap:16px;font:900 24px system-ui}#sn button{width:46px;height:46px;padding:0;border-radius:50%;font-size:22px}',
  '#sn{display:flex;align-items:center;gap:16px;font:900 24px system-ui}#sn button{width:46px;height:46px;padding:0;border-radius:50%;font-size:22px}' + CSS,
  'C1 CSS premium do setup');

/* ---------------- JS: desenho + novo layout (mesmos ids) ---------------- */
const JS = String.raw`/*GA_FLAPPY_SETUP*/
const gaNorm=v=>{try{const c=gaNorm.c||(gaNorm.c=document.createElement('canvas').getContext('2d'));if(!c)return null;c.fillStyle='#010203';c.fillStyle=String(v);return c.fillStyle!=='#010203'?c.fillStyle:null}catch(_){return null}};
const gaCol=(v,d)=>{if(v==null||v==='')return d;const a=gaNorm(v);if(a)return a;const m=String(v).match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i);return (m&&gaNorm(m[0]))||d};
const gaRGB=c=>{c=gaCol(c,'#ffcc33');let m=/^#([0-9a-f]{6})$/i.exec(c);if(m){const n=parseInt(m[1],16);return[n>>16&255,n>>8&255,n&255]}m=c.match(/\d+(\.\d+)?/g);return m&&m.length>=3?[+m[0],+m[1],+m[2]]:[255,204,51]};
const gaSh=(c,f)=>'rgb('+gaRGB(c).map(v=>Math.max(0,Math.min(255,Math.round(f>1?v+(255-v)*(f-1):v*f)))).join(',')+')';
const gaFr=x=>x-Math.floor(x),gaCy=(n,gh)=>gh*(.34+.32*gaFr(Math.sin(n*12.99+3.1)*437.58));
const gaSky=(c,w,h,wd)=>{const g=c.createLinearGradient(0,0,0,h),sk=wd&&Array.isArray(wd.sky)?wd.sky:[];let ok=0;
  sk.forEach((x,i)=>{try{const o=Array.isArray(x)&&Number.isFinite(+x[0])&&+x[0]>=0&&+x[0]<=1?+x[0]:(sk.length>1?i/(sk.length-1):0);g.addColorStop(o,gaCol(Array.isArray(x)?x[1]:x,'#5ec8ff'));ok++}catch(_){}});
  if(!ok){g.addColorStop(0,'#4fb8ff');g.addColorStop(1,'#c4f0ff')}c.fillStyle=g;c.fillRect(0,0,w,h)};
const gaClouds=(c,w,h,off)=>{c.fillStyle='rgba(255,255,255,.55)';for(let i=0;i<4;i++){const sp=w*.45,x=((i*sp-off*.35)%(w+sp)+w+sp)%(w+sp)-sp*.5,y=h*(.18+.14*gaFr(i*.37)),r=h*.07;c.beginPath();c.arc(x,y,r,0,7);c.arc(x+r*1.1,y-r*.4,r*1.2,0,7);c.arc(x+r*2.3,y,r*.95,0,7);c.fill()}};
const gaPipe=(wd)=>gaCol(wd&&(wd.pipe||wd.cano||wd.pipeColor),'#3fbf5a');
const gaPipes=(c,w,h,off,wd)=>{const pc=gaPipe(wd),gh=h*.86,sp=Math.max(64,h*1.15),pw=Math.max(12,h*.19),gap=h*.4,n0=Math.floor(off/sp);
  for(let j=-1;j<=Math.ceil(w/sp)+1;j++){const n=n0+j,x=n*sp-off+w*.5,cy=gaCy(n,gh),g=c.createLinearGradient(x,0,x+pw,0);g.addColorStop(0,gaSh(pc,.68));g.addColorStop(.35,gaSh(pc,1.35));g.addColorStop(1,gaSh(pc,.52));c.fillStyle=g;
    c.fillRect(x,0,pw,cy-gap/2);c.fillRect(x,cy+gap/2,pw,gh-cy-gap/2);c.fillRect(x-pw*.13,cy-gap/2-pw*.42,pw*1.26,pw*.42);c.fillRect(x-pw*.13,cy+gap/2,pw*1.26,pw*.42);
    c.strokeStyle=gaSh(pc,.38);c.lineWidth=1;c.strokeRect(x-pw*.13+.5,cy-gap/2-pw*.42+.5,pw*1.26-1,pw*.42-1);c.strokeRect(x-pw*.13+.5,cy+gap/2+.5,pw*1.26-1,pw*.42-1)}
  return{sp,pw,gh}};
const gaGround=(c,w,h,off,wd)=>{const gy=h*.86,gc=gaCol(wd&&(wd.ground||wd.chao),'#e3cf86');c.fillStyle=gc;c.fillRect(0,gy,w,h-gy);c.fillStyle=gaSh('#5fd16b',1);c.fillRect(0,gy,w,Math.max(3,h*.03));
  c.fillStyle=gaSh(gc,.86);const st=Math.max(10,h*.09);for(let x=-((off||0)%st)-st;x<w+st;x+=st){c.beginPath();c.moveTo(x,gy+h*.045);c.lineTo(x+st*.5,gy+h*.045);c.lineTo(x+st*.2,h);c.lineTo(x-st*.3,h);c.closePath();c.fill()}};
const gaBird=(c,x,y,r,k,t,rot)=>{const b=gaCol(k&&k.body,'#ffcc33'),ln=Math.max(1,r*.09);c.save();c.translate(x,y);c.rotate(rot||0);c.lineWidth=ln;
  let g=c.createRadialGradient(-r*.35,-r*.4,r*.1,0,0,r*1.15);g.addColorStop(0,gaSh(b,1.5));g.addColorStop(.55,b);g.addColorStop(1,gaSh(b,.55));c.fillStyle=g;c.beginPath();c.ellipse(0,0,r*1.12,r,0,0,7);c.fill();c.strokeStyle=gaSh(b,.4);c.stroke();
  c.fillStyle=gaCol(k&&(k.belly||k.barriga),'rgba(255,255,255,.5)');c.beginPath();c.ellipse(-r*.08,r*.45,r*.62,r*.36,0,0,7);c.fill();
  c.save();c.translate(-r*.25,r*.08);c.rotate(-.3+Math.sin((t||0)*.02)*.7);c.fillStyle=gaCol(k&&(k.wing||k.asa),gaSh(b,.8));c.beginPath();c.ellipse(-r*.32,0,r*.6,r*.3,0,0,7);c.fill();c.strokeStyle=gaSh(b,.42);c.stroke();c.restore();
  c.fillStyle='#fff';c.beginPath();c.arc(r*.45,-r*.3,r*.34,0,7);c.fill();c.strokeStyle='rgba(0,0,0,.35)';c.stroke();c.fillStyle='#14161f';c.beginPath();c.arc(r*.56,-r*.28,r*.16,0,7);c.fill();c.fillStyle='#fff';c.beginPath();c.arc(r*.61,-r*.34,r*.06,0,7);c.fill();
  c.fillStyle=gaCol(k&&(k.beak||k.bico),'#ff8a1e');c.beginPath();c.moveTo(r*.86,-r*.06);c.lineTo(r*1.58,r*.12);c.lineTo(r*.86,r*.34);c.closePath();c.fill();c.strokeStyle='#b5520a';c.stroke();c.restore()};
const gaS={w:W[sc],k:K.find(k=>k.id==sk)||K[0],t0:(window.performance&&performance.now())||Date.now(),run:0};
const gaHero=()=>{if(gaS.run)return;gaS.run=1;const fr=()=>{try{const cv=$('gaFH');if(!cv||!cv.isConnected){gaS.run=0;return}const c=cv.getContext&&cv.getContext('2d');if(!c){gaS.run=0;return}
  const dp=Math.min(2,window.devicePixelRatio||1),cw=cv.clientWidth||320,ch=cv.clientHeight||176;if(cv.width!==Math.round(cw*dp)||cv.height!==Math.round(ch*dp)){cv.width=Math.round(cw*dp);cv.height=Math.round(ch*dp)}c.setTransform(dp,0,0,dp,0,0);
  const t=((window.performance&&performance.now())||Date.now())-gaS.t0,rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches,off=rm?0:t*.075;
  gaSky(c,cw,ch,gaS.w);gaClouds(c,cw,ch,off);const P=gaPipes(c,cw,ch,off,gaS.w);gaGround(c,cw,ch,off,gaS.w);
  const bx=cw*.3,u=(bx-cw*.5-P.pw/2+off)/P.sp,n=Math.floor(u),f=u-n,e=f*f*(3-2*f),ya=gaCy(n,P.gh),yb=gaCy(n+1,P.gh),y=ya+(yb-ya)*e+Math.sin(t*.012)*ch*.012;
  gaBird(c,bx,y,Math.max(11,ch*.1),gaS.k,rm?0:t,Math.max(-.5,Math.min(.6,(yb-ya)/ch*6*f*(1-f)*4)))}catch(err){gaS.run=0;console.error('[flappy setup] GA hero',err);return}requestAnimationFrame(fr)};requestAnimationFrame(fr)};
const gaFS=(sc,sk,pl)=>{try{gaS.w=W[sc];gaS.k=K.find(k=>k.id==sk)||K[0];
  document.querySelectorAll('#sw .wc').forEach(b=>{const w=W[+b.dataset.i];if(!w)return;const cv=document.createElement('canvas');cv.className='gaTh';cv.width=210;cv.height=120;b.insertBefore(cv,b.firstChild);const c=cv.getContext&&cv.getContext('2d');if(!c)return;gaSky(c,210,120,w);gaClouds(c,210,120,40);gaPipes(c,210,120,30,w);gaGround(c,210,120,0,w)});
  document.querySelectorAll('#sk .kc').forEach(b=>{const k=K.find(x=>x.id==b.dataset.k);if(!k)return;const u=b.querySelector('u');const cv=document.createElement('canvas');cv.className='gaKb';cv.width=cv.height=108;const c=cv.getContext&&cv.getContext('2d');if(!c)return;if(u)u.style.display='none';b.insertBefore(cv,b.firstChild);gaBird(c,50,56,27,k,350,-.12)});
  const n=$('gaFHn');if(n)n.textContent=((gaS.w&&gaS.w.nome)||'')+(gaS.k&&gaS.k.nome?' · '+gaS.k.nome:'')+' · '+pl+' jogadores'}catch(e){console.error('[flappy setup] GA',e)}};
`.replace(/\n/g, '');

must(`st.innerHTML='<h2>Escolhe o mundo</h2><div id="sw"></div><h2>O teu pássaro</h2><div id="sk"></div><h2>Jogadores</h2><div id="sn"><button id="sm">−</button><b id="sc"></b><button id="sq">+</button></div><button id="sg">GUARDAR CONFIGURAÇÃO</button>';`,
  JS + `st.innerHTML='<div id="gaHero"><canvas id="gaFH"></canvas><div class="gaTt"><b>FLAPPY</b><span>ARENA</span></div><div id="gaFHn"></div></div>` +
    `<div class="gaSec"><h2>Escolhe o mundo</h2><div id="sw"></div></div>` +
    `<div class="gaSec"><h2>O teu pássaro</h2><div id="sk"></div></div>` +
    `<div class="gaSec"><h2>Jogadores</h2><div id="sn"><button id="sm">−</button><b id="sc"></b><button id="sq">+</button></div></div>` +
    `<button id="sg">GUARDAR CONFIGURAÇÃO</button>';`,
  'H1 setup(): cabeçalho animado + secções (mesmos ids)');

must("$('sq').disabled=pl>=maxPlayers};R();",
  "$('sq').disabled=pl>=maxPlayers;gaFS(sc,sk,pl)};R();gaHero();",
  'H2 setup(): desenhar mundos/pássaros a cada render + arrancar animação');

if (fails) { console.error('\n✗ ' + fails + ' âncora(s) falharam. NADA foi escrito.'); process.exit(2); }

function bad(h) { const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m, n = 0;
  while ((m = re.exec(h))) { const a = m[1] || ''; if (/\ssrc\s*=/i.test(a) || /type\s*=\s*["']?(module|application\/json)/i.test(a)) continue;
    try { new Function(m[2]); } catch (e) { n++; } } return n; }
const x = bad(s0), y = bad(s);
if (y > x) { console.error('✗ O index.html ficaria com erro de sintaxe (' + x + ' -> ' + y + '). NADA foi escrito.'); process.exit(3); }
console.log('✓ scripts inline compilam (erros antes/depois: ' + x + '/' + y + ')');
fs.copyFileSync(F, F + '.bak'); fs.writeFileSync(F, s);
console.log('\nOK. Escrito: ' + F + '  (backup: ' + F + '.bak — não o adiciones ao git)\n\ngit add ' + F);
