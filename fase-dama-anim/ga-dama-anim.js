#!/usr/bin/env node
/* GA Dama — animação premium das peças (só visual).
 *
 * Uso (na RAIZ do repo Arenaapk):
 *   node ga-dama-anim.js
 *   (ou: node ga-dama-anim.js <caminho/dama/index.html>)
 *
 * O que muda:
 *  - A peça desliza num ÚNICO movimento contínuo (Web Animations API) por todas as casas do caminho,
 *    com curva suave (ease-in-out) em vez de parar/arrancar a cada casa.
 *  - Levanta-se ao partir (sombra cresce), pousa com um pequeno "assentar" no fim; nas capturas múltiplas
 *    toca em cada casa de aterragem (70 ms) e volta a levantar.
 *  - Duração proporcional à distância (1 casa ≈ 0,29 s; captura ≈ 0,38 s; dama longa até 0,72 s).
 *  - Cada peça capturada desaparece no momento em que a peça passa por cima dela (sparks/som/vibração iguais).
 *  - Sem Web Animations API ou com "reduzir movimento" no sistema: usa EXATAMENTE o código antigo.
 *
 * NÃO toca: rede (sendMove/move_piece/game_state), GA16, microfone, regras, tabuleiro, sons.
 * Cada âncora tem de existir exatamente 1 vez; se alguma falhar não escreve nada. Faz .bak. Idempotente.
 */
'use strict';
const fs = require('fs');
const F = process.argv[2] || 'backend/public/games/dama/index.html';
if (!fs.existsSync(F)) { console.error('✗ Não encontro ' + F + ' (corre na raiz do Arenaapk)'); process.exit(1); }
const MARK = 'GA_DAMA_ANIM';
const s0 = fs.readFileSync(F, 'utf8');
if (s0.includes(MARK)) { console.log('= Já aplicado. Nada a fazer.'); process.exit(0); }
let s = s0, fails = 0;
function must(from, to, label) {
  const n = s.split(from).length - 1;
  if (n !== 1) { fails++; console.error('✗ ' + label + ': âncora encontrada ' + n + ' vez(es), esperado 1.\n  Âncora: ' + from.slice(0, 140) + '\n  Mostra-me: grep -nF \'' + from.slice(0, 45).replace(/'/g, "'\\''") + '\' ' + F); return; }
  s = s.replace(from, () => to); console.log('✓ ' + label);
}

// C1) CSS: estado "em voo" (levantada + sombra maior). Ao sair do voo, a transição .22s com overshoot que já existe em .b faz o "assentar".
must('.p.sel .b{transform:translateY(-8%) scale(1.07);filter:drop-shadow(0 0 6px #ffd96acc) brightness(1.06)}',
  '.p.sel .b{transform:translateY(-8%) scale(1.07);filter:drop-shadow(0 0 6px #ffd96acc) brightness(1.06)}' +
  '/*' + MARK + '*/.p.fly{z-index:6}.p.fly .b{transform:translateY(-10%) scale(1.09);filter:drop-shadow(0 0 7px #ffd96a99) brightness(1.05)}' +
  '.p.fly::before{transform:translate(8%,20%) scale(1.14);opacity:.42}',
  'C1 CSS: .p.fly');

// J1) animMove: deslize contínuo por todo o caminho; capturas no momento da passagem.
const OLD_LOOP = 'for(const li of m.path){pos(el,li);hop(el);S.slide();S.move(.27);setTimeout(()=>buzz(14),270);await sleep(300)}';
must(OLD_LOOP,
  'const gaK=new Set();/*' + MARK + '*/' +
  "if(typeof el.animate==='function'&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){" +
    "const E='cubic-bezier(.45,.05,.3,1)',xy=i=>[i&7,i>>3],tf=i=>`translate(${(i&7)*100}%,${(i>>3)*100}%)`,pts=[m.from,...m.path],sg=[];let tot=0;" +
    "for(let k=1;k<pts.length;k++){const a=xy(pts[k-1]),b=xy(pts[k]),sx=b[0]-a[0],sy=b[1]-a[1],d=Math.max(Math.abs(sx),Math.abs(sy))||1,ms=Math.min(720,190+95*d);" +
      "const ov=m.captured.filter(ci=>{if(gaK.has(ci))return false;const c=xy(ci),dx=c[0]-a[0],dy=c[1]-a[1];return dx*sy===dy*sx&&Math.sign(dx)===Math.sign(sx)&&Math.sign(dy)===Math.sign(sy)&&Math.abs(dx)<Math.abs(sx)&&Math.abs(dy)<Math.abs(sy)});" +
      "ov.forEach(ci=>gaK.add(ci));sg.push({t0:tot,ms,ov,to:pts[k]});tot+=ms+(k<pts.length-1?70:0)}" +
    "const kf=[{transform:tf(m.from),offset:0,easing:E}];" +
    "sg.forEach((q,k)=>{kf.push({transform:tf(q.to),offset:Math.min(1,(q.t0+q.ms)/tot),easing:E});if(k<sg.length-1)kf.push({transform:tf(q.to),offset:Math.min(1,sg[k+1].t0/tot),easing:E})});kf[kf.length-1].offset=1;" +
    "el.style.transition='none';el.classList.remove('hop');el.classList.add('fly');let an=null;try{an=el.animate(kf,{duration:tot,fill:'forwards'})}catch(e){}" +
    "sg.forEach((q,k)=>{setTimeout(()=>{try{S.slide();S.move(q.ms/1000)}catch(e){}},q.t0);setTimeout(()=>buzz(14),q.t0+q.ms-20);" +
      "if(k<sg.length-1){setTimeout(()=>el.classList.remove('fly'),q.t0+q.ms);setTimeout(()=>el.classList.add('fly'),sg[k+1].t0)}" +
      "q.ov.forEach(ci=>setTimeout(()=>{const ce=pe.get(ci);pe.delete(ci);if(ce){ce.classList.add('die');setTimeout(()=>ce.remove(),650)}sparks(ci,false);S.cap();buzz([18,40,18])},q.t0+q.ms*.55))});" +
    "await Promise.race([an&&an.finished?an.finished.catch(()=>{}):sleep(tot),sleep(tot+400)]);" +
    "pos(el,last);void el.offsetWidth;try{an&&an.cancel()}catch(e){}void el.offsetWidth;el.style.transition='';el.classList.remove('fly');await sleep(gaK.size?120:60)" +
  "}else{" + OLD_LOOP + "}",
  'J1 animMove: deslize contínuo + capturas na passagem');

// J2) o ciclo antigo das capturas salta as que já desapareceram durante o voo (fica como rede de segurança).
must("for(const ci of m.captured){const ce=pe.get(ci);",
  "for(const ci of m.captured){if(gaK.has(ci))continue;const ce=pe.get(ci);",
  'J2 animMove: capturas já feitas não se repetem');

if (fails) { console.error('\n✗ ' + fails + ' âncora(s) falharam. NADA foi escrito.'); process.exit(2); }

// validação de sintaxe dos scripts inline (antes vs depois)
function bad(h) { const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m, n = 0;
  while ((m = re.exec(h))) { const a = m[1] || ''; if (/\ssrc\s*=/i.test(a) || /type\s*=\s*["']?(module|application\/json)/i.test(a)) continue;
    try { new Function(m[2]); } catch (e) { n++; } } return n; }
const x = bad(s0), y = bad(s);
if (y > x) { console.error('✗ O index.html ficaria com erro de sintaxe (' + x + ' -> ' + y + '). NADA foi escrito.'); process.exit(3); }
console.log('✓ scripts inline compilam (erros antes/depois: ' + x + '/' + y + ')');
fs.copyFileSync(F, F + '.bak'); fs.writeFileSync(F, s);
console.log('\nOK. Escrito: ' + F + '  (backup: ' + F + '.bak — não o adiciones ao git)\n\ngit add ' + F);
