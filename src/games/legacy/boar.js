// 🎮 게임 선택 (헤더 🎮 버튼 → ⛳ 원터치 골프 / 🐗 멧돼지 사냥)
// 🐗 멧돼지 사냥: 골프장 코스를 파헤치는 멧돼지를 40초 안에 많이 잡기
// - 코스 3단계: 🟢 쉬움 · 🟡 보통 · 🔴 어려움 (고정 코스, 어려울수록 나무·연못이 많고 멧돼지가 빠르고 많음, 움직임도 BR_MV대로 달라짐). 순위는 코스별
// - 조작(휴대폰): 왼쪽 아래 이동 동그라미를 끌면 걷기(조이스틱), 오른쪽 아래 🔫 버튼 = 바라보는(걷는) 방향으로 사격(누르고 있으면 연사),
//   그 밖의 곳을 누르면 총구가 그쪽을 보며 사격(누른 채 움직이면 총구가 따라가며 연사) / (컴퓨터): WASD·방향키로 걷고, 클릭 = 그곳으로 사격, 스페이스 = 바라보는 방향으로 사격
// - 자동 조준 없음: 총은 걷는 방향(또는 마지막으로 쏜 방향)을 보고, 앞쪽 점선이 총알이 나갈 길
// - 🐗 멧돼지: 사람이 다가오면 도망감 (1점) · 😠 돌진 멧돼지: 앞발을 구르다(!) 일직선으로 달려듦 (2점)
//   👑 대장 멧돼지: 크고 4발 맞아야 잡힘 (5점). 돌진에 부딪히면 ❤️ 하나 잃음 (3개 다 잃으면 끝)
// - 달려드는 멧돼지는 나무에 박으면 잠깐 기절. 총알은 나무를 못 뚫음. 연못엔 못 들어감
// - 멧돼지가 코스를 파헤친 자리(🕳️)가 쌓임. 탄창 6발, 다 쓰면 자동 장전
// - 최고 기록은 boarScores/{아이디} (모두 봄)에 저장. 플레이 시각은 기록하지 않음
const BR_LOW=420;   // 이 아래는 조작판(이동·🔫) 자리: 멧돼지도 사냥꾼도 내려가지 않음
const BR_W=360, BR_H=520, BR_TIME=40, BR_HP=3, BR_AMMO=6, BR_V=3;   // BR_V: 기록 버전 (올리면 순위·최고 기록 초기화) · 3 = 자동 조준 없앤 뒤
const BR_KIND={
  run:{r:15, hp:1, pt:1, walk:42, flee:128, col:'#8a5a34', dark:'#6b4224'},
  chg:{r:16, hp:1, pt:2, walk:62, dash:340, wind:0.75, col:'#5e3d27', dark:'#422a1a'},
  boss:{r:24, hp:4, pt:5, walk:50, dash:290, wind:1.0, col:'#4a3426', dark:'#2e2018'}
};
const br={st:'ready', raf:0, last:0, cv:null, ctx:null, dpr:1, ptrs:{}, keys:{}};
const brMe=()=>(typeof myAccount!=='undefined'&&myAccount&&myAccount.loginId)||null;
const brRand=(a,b)=>a+Math.random()*(b-a);
const brClamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ---------- 🎮 게임 선택 ----------
function openGames(){
  if(!brMe()) return;
  let bg=document.getElementById('gameBg');
  if(!bg){
    bg=document.createElement('div'); bg.className='modal-bg'; bg.id='gameBg';
    bg.innerHTML='<div class="modal gamePick"><div class="gfTop"><div class="gfTitleBox"><b>🎮 게임</b><span class="gfBest">하고 싶은 게임을 골라 주세요</span></div><button class="gfX" id="gameX" title="닫기">✕</button></div>'
      +'<button class="gpCard" id="gpGolf"><span class="gpIc">⛳</span><span class="gpTx"><b>원터치 골프</b><i>꾹 눌러 파워를 맞추고 떼면 샷! 9홀 파 대비 점수로 순위</i></span></button>'
      +'<button class="gpCard boar" id="gpBoar"><span class="gpIc">🐗</span><span class="gpTx"><b>멧돼지 사냥</b><i>코스를 파헤치는 멧돼지를 40초 안에 많이 잡아라! 쉬움·보통·어려움 코스</i></span></button>'
      +'<button class="gpCard cart" id="gpCart"><span class="gpIc">🚗</span><span class="gpTx"><b>카트 배차왕</b><i>몰려오는 손님 팀에게 알맞은 카트를 골라 VISTA·DUKE 코스로! 쉬움·보통·어려움</i></span></button>'
      +'<button class="gpCard stress" id="gpStress"><span class="gpIc">🏌️</span><span class="gpTx"><b>진상 날리기</b><i>몰려오는 진상을 드라이버 풀스윙으로 하늘 끝까지! 속이 뻥~ 🥤</i></span></button>'
      +'<button class="gpCard lost" id="gpLost"><span class="gpIc">🔍</span><span class="gpTx"><b>로스트볼 찾기</b><i>숨은 공을 다 찾으면 다음 단계! 쉬움 1·보통 5·어려움 10단계부터 도전</i></span></button></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click',e=>{ if(e.target===bg) closeGames(); });
    document.getElementById('gameX').onclick=closeGames;
    document.getElementById('gpGolf').onclick=()=>{ closeGames(true); openGolf(); };
    document.getElementById('gpBoar').onclick=()=>{ closeGames(true); openBoar(); };
    document.getElementById('gpCart').onclick=()=>{ closeGames(true); openCart(); };
    document.getElementById('gpLost').onclick=()=>{ closeGames(true); openLost(); };
    document.getElementById('gpStress').onclick=()=>{ closeGames(true); openStress(); };
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&bg.style.display==='flex') closeGames(); });
  }
  clearTimeout(br.pickT); bg.classList.remove('gfClosing'); bg.style.display='flex';
}
function closeGames(now){
  const bg=document.getElementById('gameBg'); if(!bg||bg.style.display!=='flex') return;
  if(now){ bg.style.display='none'; return; }
  bg.classList.add('gfClosing'); clearTimeout(br.pickT); br.pickT=setTimeout(()=>{ bg.style.display='none'; bg.classList.remove('gfClosing'); },200);
}

// ---------- 🐗 코스 3단계 (고정) ----------
// spd: 멧돼지 속도 배수 · chg: 달려드는 멧돼지 비율(시작) · more: 한 번에 나오는 수 추가
// mv: 움직임 — flee: 이 거리 안에 오면 도망 · wob: 도망칠 때 흔들림 · juke: 도망치다 갑자기 꺾기(초 간격, 0=안 함)
//     dig: 코스를 파헤치는 간격 배수(클수록 드물게)
//     wind: 앞발 구르는 시간 배수 · dashT: 돌진 시간 · home: 돌진 중 나를 따라 휘는 정도 · rest: 돌진 뒤 쉬는 시간 · turn: 다가올 때 방향 트는 빠르기 · cool: 다음 돌진까지
const BR_MV={
  1:{dig:2.2, flee:110, wob:0.2, juke:0, wind:1.4, dashT:0.8, home:0, rest:1.3, turn:1.2, cool:[1.8,3.0]},
  2:{dig:1.5, flee:150, wob:0.5, juke:0, wind:1.0, dashT:1.0, home:0, rest:0.8, turn:2.0, cool:[1.2,2.2]},
  3:{dig:1.0, flee:200, wob:0.7, juke:0.8, wind:0.65, dashT:1.1, home:1.3, rest:0.5, turn:3.2, cool:[0.7,1.4]}
};
const BR_LV=[
  {k:1, n:'쉬움', ic:'🟢', spd:0.85, chg:0.18, more:0,
   fw:{pts:[[180,560],[180,110]], w:132}, green:{x:180,y:112,r:56}, tee:{x:180,y:470},
   ponds:[{x:305,y:330,rx:30,ry:40}], sand:[{x:122,y:158,r:17},{x:240,y:160,r:16}],
   trees:[{x:52,y:190,r:17},{x:306,y:190,r:16},{x:60,y:405,r:17},{x:300,y:450,r:16}]},
  {k:2, n:'보통', ic:'🟡', spd:1.0, chg:0.28, more:1,
   fw:{pts:[[140,560],[120,330],[228,108]], w:112}, green:{x:228,y:108,r:52}, tee:{x:140,y:470},
   ponds:[{x:290,y:320,rx:40,ry:54}], sand:[{x:168,y:150,r:18},{x:285,y:150,r:16},{x:200,y:400,r:19}],
   trees:[{x:50,y:150,r:17},{x:118,y:85,r:16},{x:45,y:300,r:18},{x:305,y:470,r:17},{x:268,y:236,r:16},{x:42,y:470,r:16}]},
  {k:3, n:'어려움', ic:'🔴', spd:1.18, chg:0.4, more:2,
   fw:{pts:[[260,560],[262,385],[112,262],[128,104]], w:94}, green:{x:128,y:104,r:46}, tee:{x:260,y:470},
   ponds:[{x:72,y:420,rx:40,ry:50},{x:300,y:200,rx:34,ry:46}], sand:[{x:80,y:140,r:16},{x:178,y:138,r:16},{x:195,y:330,r:18}],
   trees:[{x:240,y:80,r:17},{x:40,y:240,r:16},{x:300,y:290,r:17},{x:205,y:200,r:16},{x:150,y:450,r:17},{x:332,y:360,r:15},{x:40,y:80,r:15},{x:330,y:90,r:16}]}
];
const brLv=()=>BR_LV[(br.lv||2)-1];
function brMakeCourse(){ const L=brLv(); return {fw:L.fw, green:L.green, tee:L.tee, ponds:L.ponds, sand:L.sand, trees:L.trees}; }
function brSegD(x,y,a,b){ const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy||1; let t=((x-a[0])*dx+(y-a[1])*dy)/l; t=brClamp(t,0,1); return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy); }
function brFwD(c,x,y){ const p=c.fw.pts; let m=1e9; for(let i=0;i<p.length-1;i++) m=Math.min(m,brSegD(x,y,p[i],p[i+1])); return m; }
const brInPond=(p,x,y,pad)=>Math.hypot((x-p.x)/(p.rx+pad),(y-p.y)/(p.ry+pad))<1;
// push a circle out of trees and the pond; returns the tree it hit
function brSolid(o, r){
  let hit=null;
  br.c.trees.forEach(t=>{ const dx=o.x-t.x, dy=o.y-t.y, d=Math.hypot(dx,dy)||1, m=t.r+r; if(d<m){ o.x=t.x+dx/d*m; o.y=t.y+dy/d*m; hit=t; } });
  br.c.ponds.forEach(p=>{ if(brInPond(p,o.x,o.y,r)){ const a=Math.atan2((o.y-p.y)/(p.ry+r),(o.x-p.x)/(p.rx+r)); o.x=p.x+Math.cos(a)*(p.rx+r+0.5); o.y=p.y+Math.sin(a)*(p.ry+r+0.5); hit=hit||'pond'; } });
  return hit;
}

// ---------- 열기 / 닫기 ----------
function openBoar(mode){
  if(!brMe()) return;
  if(br.who!==brMe()){ br.who=brMe(); br.st='ready'; br.g=null; br.best=null; }
  let bg=document.getElementById('boarBg');
  if(!bg){
    bg=document.createElement('div'); bg.className='modal-bg'; bg.id='boarBg';
    bg.innerHTML='<div class="modal golfModal boarModal"><div class="gfTop"><div class="gfTitleBox"><b>🐗 멧돼지 사냥</b><span class="gfBest" id="brBest"></span></div><button class="gfRankBtn" id="brRankBtn">🏆 순위표</button><button class="gfNew" id="brNew">🔄 새 게임</button><button class="gfX" id="brX" title="닫기">✕</button></div>'
      +'<div class="brLvRow" id="brLvRow">'+BR_LV.map(L=>'<button class="brLv" data-lv="'+L.k+'">'+L.ic+' '+L.n+'</button>').join('')+'</div>'
      +'<div class="gfRank" id="brRank" style="display:none"></div><div class="gfPlay" id="brPlay"><canvas id="brCv"></canvas><div class="gfHelp" id="brHelp"></div></div></div>';
    document.body.appendChild(bg);
    br.cv=document.getElementById('brCv'); br.ctx=br.cv.getContext('2d');
    document.getElementById('brX').onclick=closeBoar;
    document.getElementById('brNew').onclick=brNewGame;
    document.getElementById('brRankBtn').onclick=()=>brRankToggle();
    bg.querySelectorAll('.brLv').forEach(b=>b.onclick=()=>brSetLv(+b.dataset.lv));
    const cv=br.cv;
    cv.addEventListener('pointerdown',brDown); cv.addEventListener('pointermove',brMove);
    cv.addEventListener('pointerup',brUp); cv.addEventListener('pointercancel',e=>{ delete br.ptrs[e.pointerId]; });
    cv.addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('keydown',e=>{ if(bg.style.display!=='flex') return; if(e.key==='Escape') return closeBoar();
      const k=BR_KEY[e.code]; if(k){ br.keys[k]=true; e.preventDefault(); }
      if(e.code==='Space'){ e.preventDefault(); if(!e.repeat){ if(br.st!=='play') brStart(); else br.keys.fire=true; } } });
    document.addEventListener('keyup',e=>{ const k=BR_KEY[e.code]; if(k) delete br.keys[k]; if(e.code==='Space') delete br.keys.fire; });
    window.addEventListener('blur',()=>{ br.keys={}; });
    document.addEventListener('visibilitychange',()=>{ if(document.hidden&&br.st==='play') br.st='pause'; });
  }
  if(!br.lv){ try{ br.lv=+localStorage.getItem('ydr_boar_lv')||2; }catch(e){ br.lv=2; } }
  if(!br.g){ br.g=brFresh(); br.st='ready'; }
  else if(br.st==='play') br.st='pause';
  brLvBtns(); brHelp();
  clearTimeout(br.closeT); bg.classList.remove('gfClosing'); bg.style.display='flex';
  brRankToggle(mode==='rank'); brBestLbl(); brLoadBest();
  scoreRetry('boarScores',(k,s,n)=>brUpload(k,s,n));
  cancelAnimationFrame(br.raf); br.last=performance.now(); br.raf=requestAnimationFrame(brLoop);
}
function closeBoar(){
  const bg=document.getElementById('boarBg');
  if(bg&&bg.style.display==='flex'){ bg.classList.add('gfClosing'); clearTimeout(br.closeT); br.closeT=setTimeout(()=>{ bg.style.display='none'; bg.classList.remove('gfClosing'); },200); }
  cancelAnimationFrame(br.raf); br.raf=0; br.ptrs={}; br.keys={};
  if(br.st==='play') br.st='pause';
}
async function brNewGame(){
  if((br.st==='play'||br.st==='pause')&&!(await uiConfirm('지금 게임을 그만두고 처음부터 할까요?','새 게임'))) return;
  br.g=brFresh(); br.st='ready'; brRankToggle(false);
}
// physical keys → move (WASD and arrows, whatever the keyboard language)
const BR_KEY={KeyW:'u', ArrowUp:'u', KeyS:'dn', ArrowDown:'dn', KeyA:'l', ArrowLeft:'l', KeyD:'r', ArrowRight:'r'};
const brTouch=()=>br.touch!=null?br.touch:(window.matchMedia&&matchMedia('(pointer:coarse)').matches);
function brHelp(){ const el=document.getElementById('brHelp'); if(!el) return;
  el.innerHTML=brTouch()?'왼쪽 아래 <b>이동</b> 동그라미를 끌면 걷고, 오른쪽 아래 <b>🔫 버튼</b>은 바라보는 방향(점선)으로 쏴요 (누르고 있으면 연사). 그 밖의 곳을 누르면 <b>총구가 그쪽으로 돌아 쏴요</b> (누른 채 움직이면 따라가며 연사).'
    :'<b>W A S D</b>·<b>방향키</b>로 걷고, <b>클릭</b>하면 그곳으로 쏴요. <b>스페이스</b>는 바라보는 방향(점선)으로 사격. 😠 앞발 구르는(!) 멧돼지는 옆으로 피하거나 나무 뒤로!'; }
function brLvBtns(){ document.querySelectorAll('#brLvRow .brLv').forEach(b=>b.classList.toggle('on',+b.dataset.lv===br.lv)); }
async function brSetLv(k){
  if(k===br.lv) return;
  const rankOn=document.getElementById('brRank').style.display!=='none';
  if(!rankOn&&(br.st==='play'||br.st==='pause')){ if(br.st==='play') br.st='pause'; if(!(await uiConfirm('지금 게임을 그만두고 '+BR_LV[k-1].ic+' '+BR_LV[k-1].n+' 코스로 바꿀까요?','바꾸기'))) return; }
  br.lv=k; try{ localStorage.setItem('ydr_boar_lv',k); }catch(e){}
  brLvBtns(); brBestLbl();
  if(rankOn){ brRankLoad(); if(br.st==='ready'||br.st==='over'){ br.g=brFresh(); br.st='ready'; } return; }
  br.g=brFresh(); br.st='ready';
}
function brStart(){ if(br.st==='over'&&performance.now()-br.overAt<900) return; if(br.st==='over'||!br.g) br.g=brFresh(); br.st='play'; br.last=performance.now(); }
function brFresh(){
  br.c=brMakeCourse();
  return {t:BR_TIME, score:0, kills:0, hp:BR_HP, inv:0, ammo:BR_AMMO, reload:0, cd:0, p:{x:br.c.tee.x, y:BR_LOW-24, ang:-Math.PI/2, step:0}, boars:[], bullets:[], fx:[], mess:[], spawnT:0.5, bossAt:[27,11], shake:0, msg:'', msgT:0};
}
function brSize(){
  const cv=br.cv, wrap=cv.parentElement;
  const maxW=Math.min(wrap.clientWidth-20, 420), maxH=Math.max(220, Math.min(window.innerHeight*0.7, window.innerHeight*0.94-150));
  const sc=Math.min(maxW/BR_W, maxH/BR_H);
  cv.style.width=Math.round(BR_W*sc)+'px'; cv.style.height=Math.round(BR_H*sc)+'px';
  br.dpr=Math.min(3,(window.devicePixelRatio||1)*sc);
  cv.width=Math.round(BR_W*br.dpr); cv.height=Math.round(BR_H*br.dpr);
}
window.addEventListener('resize',()=>{ const bg=document.getElementById('boarBg'); if(bg&&bg.style.display==='flex'&&br.cv.offsetParent) brSize(); });
function brBestLbl(){ const el=document.getElementById('brBest'), L=brLv(), b=br.best&&br.best[L.k]; if(el) el.textContent=b!=null?'🏆 '+L.n+' 최고 '+b+'점':'코스를 지켜 주세요!'; }

// ---------- 조작 ----------
function brPos(e){ const r=br.cv.getBoundingClientRect(); return {x:(e.clientX-r.left)*BR_W/r.width, y:(e.clientY-r.top)*BR_H/r.height}; }
const BR_FIRE={x:BR_W-58, y:BR_H-58, r:36}, BR_STICK={x:58, y:BR_H-58};   // 🔫 button and the walk-stick hint, on one line
const brOnFire=p=>Math.hypot(p.x-BR_FIRE.x,p.y-BR_FIRE.y)<BR_FIRE.r+10;
function brDown(e){
  e.preventDefault();
  const touch=e.pointerType!=='mouse'; if(br.touch!==touch){ br.touch=touch; brHelp(); }
  if(br.st!=='play'){ brStart(); return; }
  try{ br.cv.setPointerCapture(e.pointerId); }catch(_){}
  const p=brPos(e);
  if(!touch){ brShoot(p.x,p.y); return; }   // mouse: click = shoot there
  // touch: 🔫 button = fire where the gun faces (hold for more), 이동 circle = walk stick, anywhere else = turn the gun there and fire
  if(brOnFire(p)){ br.ptrs[e.pointerId]={fire:true}; brFireAhead(); return; }
  // walk stick: only the 이동 circle at the bottom left (the stick stays centered there)
  if(Math.hypot(p.x-BR_STICK.x,p.y-BR_STICK.y)<BR_FIRE.r+14&&!Object.values(br.ptrs).some(q=>q.stick)){ br.ptrs[e.pointerId]={stick:true,x0:BR_STICK.x,y0:BR_STICK.y,x:p.x,y:p.y}; return; }
  br.ptrs[e.pointerId]={aim:true,x:p.x,y:p.y}; brAim(p); brShoot(p.x,p.y);   // aim finger: the gun turns to it and fires
}
function brMove(e){ const q=br.ptrs[e.pointerId]; if(!q||!(q.stick||q.aim)) return; const p=brPos(e); q.x=p.x; q.y=p.y; if(q.aim) brAim(p); }
function brAim(t){ const p=br.g.p; if(Math.hypot(t.x-p.x,t.y-p.y)>4) p.ang=Math.atan2(t.y-p.y,t.x-p.x); }
function brUp(e){ delete br.ptrs[e.pointerId]; }
// shoot straight where I'm facing (no auto-aim)
function brFireAhead(){ const p=br.g.p; brShoot(p.x+Math.cos(p.ang)*100,p.y+Math.sin(p.ang)*100); }
function brShoot(x,y){
  const g=br.g, p=g.p; if(g.reload>0||g.cd>0) return;
  const dx=x-p.x, dy=y-p.y, d=Math.hypot(dx,dy); if(d<3) return;
  p.ang=Math.atan2(dy,dx); g.cd=0.2; g.ammo--; g.flash=0.07;
  g.bullets.push({x:p.x+dx/d*16, y:p.y+dy/d*16, vx:dx/d*900, vy:dy/d*900, life:0.5});
  if(g.ammo<=0){ g.reload=1.2; }
}

// ---------- 멧돼지 ----------
function brSpawn(kind){
  const g=br.g, k=BR_KIND[kind];
  let x, y, tries=0;
  do{ const side=Math.floor(Math.random()*3); x=side===0?-20:side===1?BR_W+20:brRand(20,BR_W-20); y=side===2?-20:brRand(60,BR_LOW-30); tries++; }
  while(Math.hypot(x-g.p.x,y-g.p.y)<170&&tries<20);
  g.boars.push({kind, x, y, r:k.r, hp:k.hp, s:'walk', st:0, dir:Math.atan2(BR_H/2-y,BR_W/2-x), face:x<BR_W/2?1:-1, legs:Math.random()*6, digT:brRand(2,4)*BR_MV[brLv().k].dig, cool:brRand(0.6,1.6), hurt:0, enter:1.2});
  if(kind==='boss'){ g.msg='👑 대장 멧돼지 등장! 4발 맞혀야 해요'; g.msgT=2.2; }
}
function brBoarStep(b, dt){
  const g=br.g, p=g.p, k=BR_KIND[b.kind], dx=p.x-b.x, dy=p.y-b.y, dist=Math.hypot(dx,dy)||1;
  b.st+=dt; b.hurt=Math.max(0,b.hurt-dt); b.enter=Math.max(0,b.enter-dt);
  let sp=0; const M=BR_MV[brLv().k];
  if(b.s==='stun'){ if(b.st>1.6){ b.s='walk'; b.st=0; b.cool=1; } }
  else if(b.s==='dig'){ if(b.st>1.1){ g.mess.push({x:b.x+b.face*b.r*0.9, y:Math.min(BR_LOW-10,b.y+b.r*0.5), r:brRand(9,14)*(b.kind==='boss'?1.4:1), a:Math.random()*3}); if(g.mess.length>160) g.mess.shift(); b.s='walk'; b.st=0; b.digT=brRand(2.5,5)*M.dig; } }
  else if(b.s==='wind'){ b.face=dx>0?1:-1; if(b.st>k.wind*M.wind){ b.s='dash'; b.st=0; b.dir=Math.atan2(dy,dx); } }
  else if(b.s==='dash'){ sp=k.dash;
    if(M.home){ const want=Math.atan2(dy,dx), d=Math.atan2(Math.sin(want-b.dir),Math.cos(want-b.dir)); b.dir+=brClamp(d,-M.home*dt,M.home*dt); }   // 어려움: 피하는 쪽으로 살짝 휘어 옴
    if(b.st>M.dashT){ b.s='rest'; b.st=0; } }
  else if(b.s==='rest'){ if(b.st>M.rest){ b.s='walk'; b.st=0; b.cool=brRand(M.cool[0],M.cool[1]); } }
  else {   // walk
    if(b.kind==='run'){
      if(dist<M.flee&&!b.enter){
        if(M.juke){ b.jk=(b.jk||0)-dt; if(b.jk<=0){ b.jk=brRand(M.juke*0.6,M.juke*1.4); b.jd=brRand(0.7,1.3)*(Math.random()<0.5?-1:1); } }   // 어려움: 갑자기 옆으로 꺾기
        b.dir=Math.atan2(-dy,-dx)+Math.sin(b.st*3)*M.wob+(M.juke?b.jd||0:0); sp=k.flee; b.flee=true; }
      else { b.flee=false; sp=k.walk; if(Math.random()<dt*0.6) b.dir+=brRand(-1.2,1.2); b.digT-=dt; if(b.digT<=0&&!b.enter){ b.s='dig'; b.st=0; } }
    } else {
      b.cool-=dt; sp=k.walk;
      const want=Math.atan2(dy,dx); b.dir+=Math.atan2(Math.sin(want-b.dir),Math.cos(want-b.dir))*Math.min(1,dt*M.turn);
      if(dist<200&&b.cool<=0&&!b.enter){ b.s='wind'; b.st=0; sp=0; }
      else { b.digT-=dt; if(b.digT<=0&&dist>230&&!b.enter){ b.s='dig'; b.st=0; } }
    }
  }
  sp*=brLv().spd; b.vx=Math.cos(b.dir)*sp; b.vy=Math.sin(b.dir)*sp;
  if(sp){
    b.x+=Math.cos(b.dir)*sp*dt; b.y+=Math.sin(b.dir)*sp*dt; b.legs+=dt*sp*0.12;
    if(Math.abs(Math.cos(b.dir))>0.15) b.face=Math.cos(b.dir)>0?1:-1;
    // stay on the course (walls bounce), keep out of the pond and trees
    if(!b.enter){
      if(b.x<b.r){ b.x=b.r; b.dir=Math.PI-b.dir; } if(b.x>BR_W-b.r){ b.x=BR_W-b.r; b.dir=Math.PI-b.dir; }
      if(b.y<44+b.r){ b.y=44+b.r; b.dir=-b.dir; } if(b.y>BR_LOW-b.r){ b.y=BR_LOW-b.r; b.dir=-b.dir; }   // the control strip is a wall
    }
    const hit=brSolid(b,b.r*0.8);
    if(hit){ if(b.s==='dash'&&hit!=='pond'){ b.s='stun'; b.st=0; g.shake=0.15; brPop(b.x,b.y-b.r-6,'💫 기절!','#fff'); } else b.dir+=brRand(1.2,2.2)*(Math.random()<0.5?-1:1); }
  }
  // a charging boar hits me
  if(b.s==='dash'&&g.inv<=0&&dist<b.r+12){
    g.hp--; g.inv=1.3; g.shake=0.35; brPop(p.x,p.y-24,'💥 -❤️','#ffdddd');
    p.x+=Math.cos(b.dir)*34; p.y+=Math.sin(b.dir)*34; brSolid(p,11); p.x=brClamp(p.x,12,BR_W-12); p.y=brClamp(p.y,48,BR_LOW-12);
    try{ navigator.vibrate&&navigator.vibrate(120); }catch(_){}
    b.s='rest'; b.st=0;
    if(g.hp<=0) brEnd('hp');
  }
}
function brPop(x,y,t,col){ br.g.fx.push({x,y,t,col:col||'#fff',life:0.9}); }
function brHit(b){
  const g=br.g; b.hp--; b.hurt=0.18;
  if(b.s==='walk'&&b.kind!=='run'){ b.cool=Math.max(b.cool,0.4); }
  if(b.hp>0){ brPop(b.x,b.y-b.r-8,'💢','#fff'); return; }
  const k=BR_KIND[b.kind]; b.dead=0.0001; g.score+=k.pt; g.kills++;
  brPop(b.x,b.y-b.r-8,'+'+k.pt,b.kind==='run'?'#fff7c2':'#ffd2a6');
}

// ---------- 게임 진행 ----------
function brStep(dt){
  const g=br.g, p=g.p;
  g.t-=dt; if(g.t<=0){ g.t=0; brEnd('time'); return; }
  g.inv=Math.max(0,g.inv-dt); g.cd=Math.max(0,g.cd-dt); g.shake=Math.max(0,g.shake-dt); g.flash=Math.max(0,(g.flash||0)-dt); if(g.msgT>0) g.msgT-=dt;
  if(g.reload>0){ g.reload-=dt; if(g.reload<=0){ g.reload=0; g.ammo=BR_AMMO; } }
  // walk: the dragging finger (a stick from where it touched) or the keys
  let mx=0, my=0;
  const s=Object.values(br.ptrs).find(q=>q.stick);
  if(s){ const dx=s.x-s.x0, dy=s.y-s.y0, d=Math.hypot(dx,dy); if(d>4){ const k=Math.min(1,d/BR_FIRE.r); mx=dx/d*k; my=dy/d*k; } }
  const K=br.keys; if(K.l) mx-=1; if(K.r) mx+=1; if(K.u) my-=1; if(K.dn) my+=1;
  if(K.fire||Object.values(br.ptrs).some(q=>q.fire)) brFireAhead();
  const aim=Object.values(br.ptrs).find(q=>q.aim);
  if(aim){ brAim(aim); brShoot(aim.x,aim.y); }   // held: keep facing the finger and keep firing
  const ml=Math.hypot(mx,my); if(ml>1){ mx/=ml; my/=ml; }
  if(ml>0.05){ p.x+=mx*150*dt; p.y+=my*150*dt; p.step+=dt*10*Math.min(1,ml); if(!aim) p.ang=Math.atan2(my,mx); }   // the gun faces where I walk (unless a finger is aiming)
  p.x=brClamp(p.x,12,BR_W-12); p.y=brClamp(p.y,48,BR_LOW-12); brSolid(p,11);
  // more boars as time goes on
  const el=BR_TIME-g.t, alive=g.boars.filter(b=>!b.dead);
  g.spawnT-=dt;
  const L=brLv();
  if(g.spawnT<=0&&alive.length<Math.min(9,3+L.more+Math.floor(el/9))){ brSpawn(Math.random()<L.chg+el/100?'chg':'run'); g.spawnT=Math.max(0.8,2.1-el/28-L.more*0.15); }
  if(g.bossAt.length&&g.t<=g.bossAt[0]){ g.bossAt.shift(); brSpawn('boss'); }
  g.boars.forEach(b=>{ if(b.dead){ b.dead+=dt; return; } brBoarStep(b,dt); });
  g.boars=g.boars.filter(b=>!b.dead||b.dead<0.9);
  // bullets stop at trees or the first boar
  g.bullets.forEach(u=>{
    const n=3; for(let i=0;i<n&&u.life>0;i++){
      u.x+=u.vx*dt/n; u.y+=u.vy*dt/n;
      if(br.c.trees.some(t=>Math.hypot(u.x-t.x,u.y-t.y)<t.r)){ u.life=0; g.fx.push({x:u.x,y:u.y,t:'',puff:1,life:0.3}); break; }
      const b=g.boars.find(b=>!b.dead&&!b.enter&&Math.hypot(u.x-b.x,u.y-b.y)<b.r+4);
      if(b){ u.life=0; brHit(b); break; }
    }
    u.life-=dt; if(u.x<-10||u.x>BR_W+10||u.y<-10||u.y>BR_H+10) u.life=0;
  });
  g.bullets=g.bullets.filter(u=>u.life>0);
  g.fx.forEach(f=>{ f.life-=dt; f.y-=dt*(f.puff?0:28); }); g.fx=g.fx.filter(f=>f.life>0);
}
function brEnd(why){
  const g=br.g; if(br.st!=='play') return;
  br.st='over'; br.overAt=performance.now(); g.why=why; br.ptrs={};
  const k=brLv().k; br.best=br.best||{};
  g.newBest=br.best[k]==null||g.score>br.best[k];
  if(g.newBest){ br.best[k]=g.score; brBestLbl(); }
  brUpload(k,g.score,g.kills);
}
function brLoop(t){
  if(br.who!==brMe()){ br.raf=0; const bg=document.getElementById('boarBg'); if(bg) bg.style.display='none'; br.st='ready'; br.g=null; return; }
  const dt=Math.min(0.05,(t-br.last)/1000); br.last=t;
  if(br.st==='play'&&br.g) brStep(dt);
  if(br.g&&br.ctx&&br.cv.offsetParent) brDraw();
  br.raf=requestAnimationFrame(brLoop);
}

// ---------- 그리기 ----------
function brRR(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function brDrawCourse(c){
  const C=br.c;
  c.fillStyle='#4f8a3c'; c.fillRect(0,0,BR_W,BR_H);
  c.fillStyle='rgba(0,0,0,.05)'; for(let y=0;y<BR_H;y+=26) c.fillRect(0,y,BR_W,13);
  const fw=()=>{ c.beginPath(); const p=C.fw.pts; c.moveTo(p[0][0],p[0][1]); for(let k=1;k<p.length;k++) c.lineTo(p[k][0],p[k][1]); };
  c.lineCap='round'; c.lineJoin='round';
  fw(); c.strokeStyle='#5f9e47'; c.lineWidth=C.fw.w+8; c.stroke();
  fw(); c.strokeStyle='#73b957'; c.lineWidth=C.fw.w; c.stroke();
  c.fillStyle='#82c862'; brRR(c,C.tee.x-30,C.tee.y-18,60,36,8); c.fill();
  C.ponds.forEach(P=>{ c.beginPath(); c.ellipse(P.x,P.y,P.rx+4,P.ry+4,0,0,7); c.fillStyle='#6fa457'; c.fill();
  c.beginPath(); c.ellipse(P.x,P.y,P.rx,P.ry,0,0,7); c.fillStyle='#3d8fd6'; c.fill();
  c.strokeStyle='rgba(255,255,255,.35)'; c.lineWidth=1.5; for(let i=-1;i<=1;i++){ c.beginPath(); c.moveTo(P.x-P.rx*0.5,P.y+i*P.ry*0.4); c.quadraticCurveTo(P.x-P.rx*0.25,P.y+i*P.ry*0.4-4,P.x,P.y+i*P.ry*0.4); c.quadraticCurveTo(P.x+P.rx*0.25,P.y+i*P.ry*0.4+4,P.x+P.rx*0.5,P.y+i*P.ry*0.4); c.stroke(); } });
  const G=C.green; c.beginPath(); c.arc(G.x,G.y,G.r+5,0,7); c.fillStyle='#6fb552'; c.fill();
  c.beginPath(); c.arc(G.x,G.y,G.r,0,7); c.fillStyle='#8fd36a'; c.fill();
  C.sand.forEach(q=>{ c.beginPath(); c.arc(q.x,q.y,q.r,0,7); c.fillStyle='#ead9a6'; c.fill(); c.strokeStyle='#d2bd80'; c.lineWidth=2; c.stroke(); });
  c.beginPath(); c.arc(G.x,G.y,6,0,7); c.fillStyle='#fff'; c.fill(); c.beginPath(); c.arc(G.x,G.y,4.5,0,7); c.fillStyle='#1d2a1a'; c.fill();
  c.strokeStyle='#eee'; c.lineWidth=2; c.beginPath(); c.moveTo(G.x,G.y); c.lineTo(G.x,G.y-34); c.stroke();
  c.fillStyle='#e8504a'; c.beginPath(); c.moveTo(G.x,G.y-34); c.lineTo(G.x+18,G.y-29); c.lineTo(G.x,G.y-24); c.closePath(); c.fill();
}
function brDrawMess(c){
  // a dug-up patch: torn turf ring, dark soil, a few clods and grass chunks flung around
  br.g.mess.forEach(m=>{
    if(!m.k) m.k=[...Array(10)].map(()=>0.75+Math.random()*0.4);
    c.save(); c.translate(m.x,m.y);
    const blob=(sc,col)=>{ c.beginPath(); m.k.forEach((k,i)=>{ const a=i/m.k.length*Math.PI*2, rr=m.r*sc*k; const x=Math.cos(a)*rr, y=Math.sin(a)*rr*0.6; i?c.lineTo(x,y):c.moveTo(x,y); }); c.closePath(); c.fillStyle=col; c.fill(); };
    blob(1.18,'#9a7650'); blob(0.9,'#6e4b2c'); blob(0.5,'#563820');
    c.fillStyle='#8a6440'; for(let i=0;i<4;i++){ const a=m.a+i*1.7, d=m.r*1.35; c.beginPath(); c.arc(Math.cos(a)*d,Math.sin(a)*d*0.6,m.r*0.13,0,7); c.fill(); }
    c.fillStyle='#3f7a2f'; for(let i=0;i<2;i++){ const a=m.a+2.4+i*2.6, d=m.r*1.5; c.save(); c.translate(Math.cos(a)*d,Math.sin(a)*d*0.6); c.rotate(a); c.fillRect(-3,-2,6,4); c.restore(); }
    c.restore(); });
}
function brDrawTrees(c){
  br.c.trees.forEach(t=>{ c.beginPath(); c.ellipse(t.x+3,t.y+6,t.r,t.r*0.7,0,0,7); c.fillStyle='rgba(0,0,0,.2)'; c.fill();
    c.beginPath(); c.arc(t.x,t.y,t.r,0,7); c.fillStyle='#2f7a34'; c.fill();
    c.beginPath(); c.arc(t.x-t.r*0.3,t.y-t.r*0.3,t.r*0.55,0,7); c.fillStyle='#3f9343'; c.fill(); });
}
// a boar, seen from the side (face: 1 → right)
function brDrawBoar(c,b){
  const k=BR_KIND[b.kind], r=b.r, dead=b.dead;
  c.save(); c.translate(b.x,b.y);
  if(dead) c.globalAlpha=Math.max(0,1-dead/0.9);
  c.beginPath(); c.ellipse(0,r*0.78,r*1.15,r*0.32,0,0,7); c.fillStyle='rgba(0,0,0,.22)'; c.fill();
  let jx=0, jy=0;
  if(b.s==='wind'){ jx=Math.sin(b.st*60)*1.6; }
  if(b.s==='dig'){ jy=Math.sin(b.st*25)*1.2; }
  c.translate(jx,jy); c.scale(b.face,1);
  if(dead){ c.translate(0,-r*0.1); c.scale(1,-1); }
  const ph=b.legs, sw=Math.sin(ph)*r*0.22, moving=b.s==='walk'||b.s==='dash';
  // legs
  c.fillStyle=k.dark;
  [[-0.6,1],[0.55,-1],[-0.35,-1],[0.8,1]].forEach(([u,sg],i)=>{ const o=moving?sw*sg:0; brRR(c,u*r+o-r*0.11,r*0.35,r*0.22,r*0.5,r*0.08); c.fill(); });
  // tail
  c.strokeStyle=k.dark; c.lineWidth=Math.max(1.5,r*0.1); c.beginPath(); c.moveTo(-r*1.12,-r*0.15); c.quadraticCurveTo(-r*1.45,-r*0.5,-r*1.3,-r*0.05); c.stroke();
  // body
  c.beginPath(); c.ellipse(0,0,r*1.2,r*0.78,0,0,7); c.fillStyle=b.hurt>0?'#e0805a':k.col; c.fill();
  // back bristles
  c.fillStyle=k.dark; c.beginPath(); c.moveTo(-r*0.95,-r*0.42);
  for(let i=0;i<7;i++){ const x=-r*0.95+i*r*0.3; c.lineTo(x+r*0.15,-r*(0.86+(i%2)*0.12)); c.lineTo(x+r*0.3,-r*0.6); }
  c.lineTo(r*0.9,-r*0.3); c.closePath(); c.fill();
  // belly light
  c.beginPath(); c.ellipse(r*0.05,r*0.32,r*0.75,r*0.3,0,0,7); c.fillStyle='rgba(255,230,200,.18)'; c.fill();
  // head
  c.beginPath(); c.ellipse(r*1.0,-r*0.05,r*0.6,r*0.55,-0.2,0,7); c.fillStyle=b.hurt>0?'#e0805a':k.col; c.fill();
  // ear
  c.fillStyle=k.dark; c.beginPath(); c.moveTo(r*0.72,-r*0.45); c.lineTo(r*0.8,-r*0.95); c.lineTo(r*1.05,-r*0.5); c.closePath(); c.fill();
  // snout
  c.beginPath(); c.ellipse(r*1.55,r*0.08,r*0.24,r*0.26,0,0,7); c.fillStyle='#c79a86'; c.fill();
  c.fillStyle='#5a3a2c'; c.beginPath(); c.arc(r*1.6,r*0.0,r*0.05,0,7); c.arc(r*1.6,r*0.17,r*0.05,0,7); c.fill();
  // tusk
  c.strokeStyle=b.kind==='boss'?'#fffbe8':'#fff6dc'; c.lineWidth=Math.max(1.6,r*(b.kind==='boss'?0.13:0.09)); c.lineCap='round';
  c.beginPath(); c.moveTo(r*1.35,r*0.28); c.quadraticCurveTo(r*1.5,r*0.1,r*1.42,-r*0.12); c.stroke();
  // eye
  if(dead){ c.strokeStyle='#222'; c.lineWidth=1.4; const ex=r*1.08, ey=-r*0.2, s=r*0.1; c.beginPath(); c.moveTo(ex-s,ey-s); c.lineTo(ex+s,ey+s); c.moveTo(ex+s,ey-s); c.lineTo(ex-s,ey+s); c.stroke(); }
  else {
    c.beginPath(); c.arc(r*1.08,-r*0.2,r*0.1,0,7); c.fillStyle=b.kind==='run'?'#1e1410':'#d8262a'; c.fill();
    if(b.kind!=='run'){ c.strokeStyle='#1e1410'; c.lineWidth=Math.max(1.5,r*0.08); c.beginPath(); c.moveTo(r*0.88,-r*0.42); c.lineTo(r*1.25,-r*0.3); c.stroke(); }
  }
  if(b.kind==='boss'&&!dead){   // crown
    c.fillStyle='#f6c64b'; c.beginPath(); c.moveTo(r*0.6,-r*0.62); c.lineTo(r*0.66,-r*1.05); c.lineTo(r*0.82,-r*0.8); c.lineTo(r*0.97,-r*1.12); c.lineTo(r*1.08,-r*0.78); c.lineTo(r*1.24,-r*1.0); c.lineTo(r*1.2,-r*0.55); c.closePath(); c.fill();
  }
  c.restore();
  if(dead) return;
  // dust when charging, "!" while getting ready, stars when stunned, HP for the boss
  if(b.s==='dash'){ c.fillStyle='rgba(225,205,160,.6)'; for(let i=0;i<3;i++){ c.beginPath(); c.arc(b.x-Math.cos(b.dir)*(r+6+i*8)+brRand(-3,3),b.y+r*0.6+brRand(-3,3),4-i,0,7); c.fill(); } }
  if(b.s==='wind'){ const bl=Math.sin(b.st*20)>0; c.font='900 18px sans-serif'; c.textAlign='center'; c.textBaseline='middle'; c.lineWidth=3; c.strokeStyle='#fff'; c.fillStyle=bl?'#e8302a':'#ff8a2a'; c.strokeText('!',b.x,b.y-r-12); c.fillText('!',b.x,b.y-r-12); c.textAlign='left';
    // where it will run
    const g=br.g, a=Math.atan2(g.p.y-b.y,g.p.x-b.x); c.save(); c.setLineDash([6,6]); c.strokeStyle='rgba(255,70,50,.55)'; c.lineWidth=3; c.beginPath(); c.moveTo(b.x,b.y); c.lineTo(b.x+Math.cos(a)*120,b.y+Math.sin(a)*120); c.stroke(); c.restore(); }
  if(b.s==='stun'){ c.fillStyle='#ffe066'; for(let i=0;i<3;i++){ const a=b.st*5+i*2.1; c.beginPath(); c.arc(b.x+Math.cos(a)*r*0.8,b.y-r-6+Math.sin(a)*3,2.6,0,7); c.fill(); } }
  if(b.kind==='boss'){ for(let i=0;i<BR_KIND.boss.hp;i++){ c.fillStyle=i<b.hp?'#e8504a':'rgba(0,0,0,.25)'; brRR(c,b.x-22+i*11.5,b.y-r-22,9,5,2); c.fill(); } }
}
function brDrawHunter(c){
  const g=br.g, p=g.p, blink=g.inv>0&&Math.floor(g.inv*12)%2===0;
  if(blink&&br.st==='play') return;
  c.save(); c.translate(p.x,p.y);
  c.beginPath(); c.ellipse(0,12,12,4,0,0,7); c.fillStyle='rgba(0,0,0,.22)'; c.fill();
  const bob=Math.sin(p.step)*1.2;
  // where a shot goes (dotted line ahead of the gun)
  if(br.st==='play'){ c.save(); c.rotate(p.ang); c.setLineDash([3,7]); c.strokeStyle='rgba(255,255,255,.55)'; c.lineWidth=2; c.beginPath(); c.moveTo(30,0); c.lineTo(110,0); c.stroke(); c.restore(); }
  // gun (turns to where I aim)
  c.save(); c.rotate(p.ang); c.fillStyle='#3a3a3a'; brRR(c,4,-2.2,20,4.4,1.5); c.fill(); c.fillStyle='#8a5a34'; brRR(c,2,-3,8,6,2); c.fill();
  if(g.flash>0){ c.fillStyle='#ffd34d'; c.beginPath(); c.moveTo(24,0); c.lineTo(33,-5); c.lineTo(31,0); c.lineTo(33,5); c.closePath(); c.fill(); }
  c.restore();
  // body (orange safety vest) + head + cap
  c.beginPath(); c.arc(0,2+bob,10,0,7); c.fillStyle='#f08a24'; c.fill(); c.strokeStyle='#fff3c4'; c.lineWidth=2; c.beginPath(); c.moveTo(-7,0+bob); c.lineTo(7,0+bob); c.stroke();
  c.beginPath(); c.arc(0,-8+bob,7.5,0,7); c.fillStyle='#ffd9b8'; c.fill();
  c.beginPath(); c.arc(0,-10+bob,7.6,Math.PI,0); c.fillStyle='#e8504a'; c.fill();
  const fx=Math.cos(p.ang)>0?1:-1; c.fillStyle='#c8403b'; brRR(c,fx>0?2:-11,-11.5+bob,9,3,1.5); c.fill();
  c.fillStyle='#2a2a2a'; c.beginPath(); c.arc(fx*2.5,-7+bob,1.2,0,7); c.arc(fx*5.5,-7+bob,1.2,0,7); c.fill();
  c.restore();
}
function brText(c,t,x,y,size,col,align){
  c.font='800 '+size+'px "Apple SD Gothic Neo","Malgun Gothic",sans-serif'; c.textBaseline='middle';
  let w=c.measureText(t).width; const x0=align==='center'?x-w/2:align==='right'?x-w:x;   // no maxWidth/center (Safari)
  c.lineWidth=3; c.strokeStyle='rgba(0,0,0,.45)'; c.textAlign='left'; c.strokeText(t,x0,y); c.fillStyle=col||'#fff'; c.fillText(t,x0,y);
}
function brFit(c,t,maxW,size){ let s=size; c.font='800 '+s+'px sans-serif'; while(s>10&&c.measureText(t).width>maxW){ s--; c.font='800 '+s+'px sans-serif'; } return s; }
function brDraw(){
  const c=br.ctx, g=br.g;
  c.setTransform(br.dpr,0,0,br.dpr,0,0);
  c.save();
  if(g.shake>0) c.translate(brRand(-4,4)*g.shake*6,brRand(-4,4)*g.shake*6);
  brDrawCourse(c); brDrawMess(c);
  // things lower on screen are drawn in front
  const list=g.boars.map(b=>({y:b.y,b})).concat([{y:g.p.y,me:1}]).sort((a,b)=>a.y-b.y);
  list.forEach(o=>o.me?brDrawHunter(c):brDrawBoar(c,o.b));
  brDrawTrees(c);
  c.strokeStyle='#fff6b0'; c.lineWidth=2.5; c.lineCap='round';
  g.bullets.forEach(u=>{ const l=Math.hypot(u.vx,u.vy); c.beginPath(); c.moveTo(u.x-u.vx/l*10,u.y-u.vy/l*10); c.lineTo(u.x,u.y); c.stroke(); });
  g.fx.forEach(f=>{ if(f.puff){ c.globalAlpha=f.life/0.3; c.fillStyle='#e9e2c8'; c.beginPath(); c.arc(f.x,f.y,5,0,7); c.fill(); c.globalAlpha=1; return; }
    c.globalAlpha=Math.min(1,f.life/0.4); brText(c,f.t,f.x,f.y,16,f.col,'center'); c.globalAlpha=1; });
  c.restore();
  // joystick
  // the control strip (nobody goes below the line)
  c.fillStyle='rgba(10,30,10,.28)'; c.fillRect(0,BR_LOW,BR_W,BR_H-BR_LOW);
  c.strokeStyle='rgba(255,255,255,.45)'; c.lineWidth=2; c.setLineDash([8,7]); c.beginPath(); c.moveTo(0,BR_LOW); c.lineTo(BR_W,BR_LOW); c.stroke(); c.setLineDash([]);
  if(brTouch()&&br.st==='play'){   // 🔫 button + where the walk stick lives
    const held=Object.values(br.ptrs).some(q=>q.fire), F=BR_FIRE;
    c.beginPath(); c.arc(F.x,F.y,F.r,0,7); c.fillStyle=held?'rgba(232,80,74,.6)':'rgba(232,80,74,.3)'; c.fill(); c.strokeStyle='rgba(255,255,255,.8)'; c.lineWidth=2.5; c.stroke();
    c.fillStyle='#000'; c.font='26px sans-serif'; c.textBaseline='middle'; c.textAlign='left'; const gw=c.measureText('🔫').width; c.fillText('🔫',F.x-gw/2,F.y+1);
    if(g.reload>0){ c.beginPath(); c.arc(F.x,F.y,F.r+4,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-g.reload/1.2)); c.strokeStyle='#ffd34d'; c.lineWidth=4; c.stroke(); }
    if(!Object.values(br.ptrs).some(q=>q.stick)){ c.beginPath(); c.arc(BR_STICK.x,BR_STICK.y,BR_FIRE.r,0,7); c.fillStyle='rgba(255,255,255,.18)'; c.fill(); c.strokeStyle='rgba(255,255,255,.8)'; c.lineWidth=2.5; c.stroke(); brText(c,'이동',BR_STICK.x,BR_STICK.y,13,'rgba(255,255,255,.75)','center'); }
  }
  const s=Object.values(br.ptrs).find(q=>q.stick);
  if(s&&br.st==='play'){ c.beginPath(); c.arc(s.x0,s.y0,BR_FIRE.r,0,7); c.fillStyle='rgba(255,255,255,.18)'; c.fill(); c.strokeStyle='rgba(255,255,255,.8)'; c.lineWidth=2.5; c.stroke();
    const dx=s.x-s.x0, dy=s.y-s.y0, d=Math.hypot(dx,dy), k=d>BR_FIRE.r?BR_FIRE.r/d:1; c.beginPath(); c.arc(s.x0+dx*k,s.y0+dy*k,15,0,7); c.fillStyle='rgba(255,255,255,.6)'; c.fill(); }
  // HUD
  c.fillStyle='rgba(20,40,20,.55)'; brRR(c,6,6,BR_W-12,32,12); c.fill();
  brText(c,'🐗 '+g.score+'점',14,22,15,'#fff');
  const hearts='❤️'.repeat(Math.max(0,g.hp))+'🤍'.repeat(Math.max(0,BR_HP-g.hp)); c.font='14px sans-serif'; c.textBaseline='middle'; c.textAlign='left'; c.fillText(hearts,96,22);
  // ammo
  for(let i=0;i<BR_AMMO;i++){ c.fillStyle=g.reload>0?'rgba(255,255,255,.25)':i<g.ammo?'#ffd34d':'rgba(255,255,255,.25)'; brRR(c,178+i*8,15,5,14,2); c.fill(); }
  if(g.reload>0){ c.fillStyle='#ffd34d'; c.fillRect(178,31,46*(1-g.reload/1.2),2.5); }
  // time
  const tl=Math.ceil(g.t); brText(c,'⏱ '+tl+'초',BR_W-14,22,15,g.t<10?'#ffb0a8':'#fff','right');
  c.fillStyle='rgba(255,255,255,.2)'; c.fillRect(14,40,BR_W-28,3); c.fillStyle=g.t<10?'#ff8a80':'#bff59a'; c.fillRect(14,40,(BR_W-28)*g.t/BR_TIME,3);
  if(g.msgT>0&&br.st==='play'){ c.globalAlpha=Math.min(1,g.msgT); const sz=brFit(c,g.msg,BR_W-40,15); c.fillStyle='rgba(0,0,0,.5)'; brRR(c,14,54,BR_W-28,30,12); c.fill(); brText(c,g.msg,BR_W/2,69,sz,'#fff','center'); c.globalAlpha=1; }
  if(br.st!=='play') brOverlay(c);
}
function brOverlay(c){
  const g=br.g;
  c.fillStyle='rgba(15,30,15,.62)'; c.fillRect(0,0,BR_W,BR_H);
  const card=(y,h)=>{ c.fillStyle='rgba(255,255,255,.95)'; brRR(c,30,y,BR_W-60,h,22); c.fill(); };
  const line=(t,y,sz,col)=>{ const s=brFit(c,t,BR_W-84,sz); c.font='800 '+s+'px "Apple SD Gothic Neo","Malgun Gothic",sans-serif'; c.textBaseline='middle'; c.textAlign='left'; c.fillStyle=col||'#333'; c.fillText(t,(BR_W-c.measureText(t).width)/2,y); };
  if(br.st==='ready'){
    card(120,280);
    line('🐗 멧돼지 사냥 · '+brLv().ic+' '+brLv().n,158,22,'#6b4224');
    line('멧돼지들이 코스를 파헤치고 있어요!',196,13.5,'#555');
    line(BR_TIME+'초 안에 최대한 많이 잡아 주세요',216,13.5,'#555');
    line('🐗 도망가는 멧돼지 1점',252,13.5,'#333');
    line('😠 달려드는 멧돼지 2점 (! 뜨면 피하기)',274,13.5,'#333');
    line('👑 대장 멧돼지 5점 (4발)',296,13.5,'#333');
    line(brTouch()?'왼쪽 끌기 = 걷기 · 🔫 버튼 = 쏘기':'WASD·방향키 = 걷기 · 클릭 = 쏘기',328,13.5,'#2f7a34');
    line('👆 화면을 누르면 시작!',370,17,'#e8504a');
  } else if(br.st==='pause'){
    card(190,130); line('⏸️ 잠깐 멈춤',232,22,'#6b4224'); line('남은 시간 '+Math.ceil(g.t)+'초 · '+g.score+'점',264,14,'#555'); line('👆 누르면 계속',296,16,'#e8504a');
  } else {
    card(110,300);
    line(g.why==='hp'?'💥 멧돼지에게 당했어요!':'⏰ 시간 끝!',150,20,'#6b4224');
    line(g.score+'점',200,40,'#e8504a');
    line('잡은 멧돼지 '+g.kills+'마리',242,15,'#333');
    line('🕳️ 코스 피해 '+g.mess.length+'곳',266,14,'#8a5a34');
    line(g.newBest?'🎉 '+brLv().n+' 코스 내 최고 기록!':'🏆 '+brLv().n+' 내 최고 '+br.best[brLv().k]+'점',304,16,g.newBest?'#2f7a34':'#555');
    line(g.mess.length<=5?'코스가 거의 멀쩡해요 👍':g.mess.length<=15?'잔디 보수가 좀 필요하겠어요 🌱':'코스가 난장판이에요... 🚜',332,13,'#777');
    line('👆 누르면 다시 하기',376,16,'#e8504a');
  }
}

// ---------- 🏆 기록 ----------
// an admin opening the ranking deletes records from before the reset
async function brCleanOld(docs){ br.oldNote=scoreOldNote(docs,v=>(+v.v||0)<BR_V); }   // older records stay hidden; the admin sees whose app is out of date
async function brLoadBest(){
  const me=brMe(); if(!me||!db||br.bestLoaded===me) return;
  try{ const d=await db.collection('boarScores').doc(me).get(); br.bestLoaded=me; const v=d.exists&&d.data().v===BR_V?d.data():{}; br.best=br.best||{};
    BR_LV.forEach(L=>{ const x=v['b'+L.k]; if(x!=null&&(br.best[L.k]==null||x>br.best[L.k])) br.best[L.k]=x; }); brBestLbl(); }catch(e){}
}
// boarScores/{id}: {v, name, b1,n1 (쉬움), b2,n2 (보통), b3,n3 (어려움)} — best score and boars caught per course
async function brUpload(k, score, kills){
  const me=brMe(); if(!me||!db||!db.runTransaction) return;
  const ref=db.collection('boarScores').doc(me);
  try{
    await db.runTransaction(async t=>{
      const d=(await t.get(ref)).data()||{}, o={v:BR_V, name:(myProfile&&myProfile.name)||d.name||''};
      if(d.v===BR_V) BR_LV.forEach(L=>{ if(d['b'+L.k]!=null){ o['b'+L.k]=d['b'+L.k]; o['n'+L.k]=d['n'+L.k]||0; } });   // 예전 버전 기록(60초 랜덤 코스·자동 조준 시절)은 초기화
      if(o['b'+k]==null||score>o['b'+k]){ o['b'+k]=score; o['n'+k]=kills; }
      t.set(ref,o);
    });
    scoreSaved('boarScores');
  }catch(e){ scoreFailed('🐗 멧돼지 사냥','boarScores',e,[k,score,kills]); }
}
function brRankToggle(show){
  const r=document.getElementById('brRank'), p=document.getElementById('brPlay'), btn=document.getElementById('brRankBtn');
  if(show===undefined) show=r.style.display==='none';
  r.style.display=show?'':'none'; p.style.display=show?'none':''; btn.textContent=show?'🐗 게임':'🏆 순위표';
  const on=show?r:p; on.classList.remove('gfFadeIn'); void on.offsetWidth; on.classList.add('gfFadeIn');
  document.getElementById('brNew').style.display=show?'none':'';
  br.ptrs={};
  if(show){ if(br.st==='play') br.st='pause'; brRankLoad(); } else brSize();
}
async function brRankLoad(){
  const box=document.getElementById('brRank'); box.innerHTML='<div class="gfEmpty">불러오는 중...</div>';
  const me=brMe(); let rows=[];
  const L=brLv();
  try{ const snap=await db.collection('boarScores').get(); snap.forEach(d=>{ const v=d.data(); if(v.v===BR_V&&v['b'+L.k]!=null) rows.push({id:d.id, name:v.name, best:+v['b'+L.k], n:v['n'+L.k]||0}); });
    brCleanOld(snap.docs); }
  catch(e){ box.innerHTML='<div class="gfEmpty">순위표를 불러오지 못했어요</div>'; return; }
  rows.sort((a,b)=>b.best-a.best||String(a.name).localeCompare(String(b.name)));
  let html='<div class="gfSec">🏆 '+L.ic+' '+L.n+' 코스 순위 <span>(각자 최고 점수 · 높을수록 위)</span></div>';
  if(!rows.length) html+='<div class="gfEmptySm">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요! 🐗</div>';
  else {
    html+='<div class="gfList">'; let rank=0, prev=null;
    rows.forEach((r,i)=>{ if(r.best!==prev){ rank=i+1; prev=r.best; }
      const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank+'위';
      html+='<div class="gfRow'+(r.id===me?' me':'')+'" style="cursor:default"><span class="gfMedal">'+medal+'</span><span class="gfNm">'+gfEsc(r.name||'직원')+(r.id===me?' (나)':'')+'</span><span class="gfBestCol"><b>'+r.best+'점</b> <i>'+r.n+'마리</i></span></div>'; });
    html+='</div>';
  }
  box.innerHTML=html+(br.oldNote||'');
}
