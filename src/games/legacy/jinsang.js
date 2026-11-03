// 🏌️ 진상 날리기: 프론트로 몰려오는 진상을 톡! 드라이버 풀스윙으로 하늘 끝까지 날려 보내는 스트레스 해소 게임
// - 진상을 누르면 날아감 (단단한 진상은 여러 번) · 연달아 날리면 콤보 · 📞 전화 폭탄도 눌러서 끊기
// - 💢 사이다 게이지가 차면 🥤 버튼: 화면의 진상을 한꺼번에 날림
// - 진상이 프론트까지 오면 고함 → 🧠 멘탈 감소, 0이 되면 끝. 갈수록 많이·빨리 옴. 순위는 점수
const JS_DESK=418, JS_ME={x:180, y:470}, JS_SODA={x:282, y:474, r:30};
const JS_KIND={
  basic:{hp:1, sp:[36,48], pts:10, dmg:15, r:17, body:'#f08ab0', skin:'#ffd9b8', name:'진상'},
  fast:{hp:1, sp:[72,88], pts:15, dmg:15, r:16, body:'#e8504a', skin:'#ffb39a', name:'고함'},
  madam:{hp:2, sp:[34,44], pts:25, dmg:20, r:19, body:'#9b6bd6', skin:'#ffe0c6', name:'사모님'},
  phone:{hp:2, sp:[30,38], pts:25, dmg:15, r:17, body:'#3f7fd1', skin:'#ffd9b8', name:'전화'},
  group:{hp:1, sp:[30,40], pts:40, dmg:25, r:26, body:'#f2a33a', skin:'#ffd9b8', name:'단체'},
  boss:{hp:7, sp:[18,22], pts:150, dmg:40, r:30, body:'#3a3a3a', skin:'#f5c9a0', name:'회장님 친구'}
};
const JS_LINES={
  basic:['사장 나와!','내가 누군 줄 알아?','여기 단골이야!','왜 이렇게 비싸?','OB 아니잖아!','공 찾아와!','그린이 왜 이래?','티업 좀 당겨줘','비 오면 환불해!','캐디 바꿔줘!','교수인데 할인 안되나요?','비 맞고 치라구요?','감기 걸리면 책임질거에요?','제가 왜 위약회원이죠?','홀아웃 환불 금액이 왜 이거밖에 안돼요?'],
  fast:['빨리빨리!!','아직이야?!','몇 번을 말해!!','책임자 어딨어!!','지금 당장!!'],
  madam:['어머 여기 왜 이래?','우리 남편이 누군데','다른 데는 해 주던데?','그늘집 맛없어요','언니 이리 와 봐요','저희 이거 안먹었는데요?','락카 앞쪽으로 바꿔주세요'],
  phone:['내가 전화 몇 번 했어!','왜 전화 안 받아?','본사에 전화한다!','비오는데 취소 되죠?','내일 예약인데 위약금 없이 취소해주세요'],
  group:['우리 12명인데 한 팀으로!','할인 안 돼?','예약 없는데 칠게!','뒷팀이랑 시간 변경 안돼요?'],
  boss:['회장님 친구야!!','내 말 한 마디면 너 끝이야','회원권 얼마인 줄 알아?']
};
const JS_HIT=['으아아~','FORE~!!','죄송합니닷~','다신 안 올게요~','살려줘~','엄마아~','기억해 두겠다~'];
const JS={key:'stress', title:'🏌️ 진상 날리기', icon:'🏌️', col:'stressScores', V:1, unit:'점', nUnit:'명', sub:'속이 뻥 뚫리게 날려 버려요!', noLv:true,
  rankNote:'각자 최고 점수 · 높을수록 위',
  help:()=>'몰려오는 <b>진상을 톡!</b> 드라이버 풀스윙으로 날려 버려요. 연달아 날리면 <b>콤보</b>, 💢 게이지가 차면 <b>🥤 사이다 한 방</b>으로 한꺼번에! 📞 날아오는 전화도 톡 쳐서 끊어요.',
  n:g=>g.kills,
  fresh(){ return {t:0, score:0, kills:0, mental:100, soda:0, combo:0, comboT:0, guys:[], phones:[], fx:[], spawnT:0.8, bossT:32, shake:0, shout:null, swing:null, slow:0}; },
  ready:()=>[
    ['진상들이 프론트로 몰려와요!',14,'#555'],
    ['👆 톡 = 드라이버 풀스윙으로 날리기',14,'#2b4a6b'],
    ['단단한 진상은 여러 번 · 📞 전화도 톡!',13,'#333'],
    ['💢 게이지가 차면 🥤 사이다 한 방',13,'#2f7a34'],
    ['프론트까지 오면 🧠 멘탈 감소',13,'#c0392b']],
  over:g=>[['🧠 멘탈 바닥… 오늘은 여기까지!',17,'#2b4a6b'],[g.score+'점',40,'#e8504a'],['날려 버린 진상 '+g.kills+'명',15,'#333'],[g.kills>=60?'오늘 사이다 원 없이 마셨어요 🥤':g.kills>=25?'속이 좀 풀렸나요? 😆':'다음엔 더 멀리 날려 봐요 🏌️',13,'#777']],
  down(g,p){
    if(g.soda>=100&&Math.hypot(p.x-JS_SODA.x,p.y-JS_SODA.y)<JS_SODA.r+8){ jsSoda(g); return; }
    // a phone in the air first (they come fast), then the closest guy
    const ph=g.phones.find(f=>Math.hypot(p.x-f.x,p.y-f.y)<22);
    if(ph){ ph.dead=1; g.score+=5; g.fx.push({x:ph.x,y:ph.y-10,t:'뚝!',col:'#fff',life:0.6},{boom:1,x:ph.x,y:ph.y,life:0.3}); jsSwing(g,ph.x,ph.y); return; }
    let best=null, bd=1e9; g.guys.forEach(o=>{ if(o.fly) return; const d=Math.hypot(p.x-o.x,p.y-(o.y-o.r*0.4))-o.r; if(d<bd){ bd=d; best=o; } });
    if(best&&bd<16){ jsHit(g,best); return; }
    g.fx.push({x:p.x,y:p.y,t:'휙',col:'rgba(255,255,255,.8)',life:0.4});
  },
  step(g,dt){
    g.t+=dt; g.shake=Math.max(0,g.shake-dt); g.comboT-=dt; if(g.comboT<=0) g.combo=0;
    if(g.shout){ g.shout.life-=dt; if(g.shout.life<=0) g.shout=null; }
    if(g.swing){ g.swing.t+=dt; if(g.swing.t>0.25) g.swing=null; }
    const sd=g.slow>0?0.35:1; g.slow=Math.max(0,g.slow-dt); const d2=dt*sd;
    // spawns: faster as time goes on
    g.spawnT-=dt; if(g.spawnT<=0){ jsSpawn(g); if(Math.random()<Math.min(0.6,(g.t-30)/150)) jsSpawn(g); g.spawnT=Math.max(0.42,1.6-g.t/55)*mgRand(0.75,1.25); }
    g.bossT-=dt; if(g.bossT<=0){ jsSpawn(g,'boss'); g.bossT=38; }
    g.guys.forEach(o=>{
      o.wob+=d2*8; o.hurt=Math.max(0,o.hurt-dt); o.lineT-=dt; if(o.lineT<=0){ o.line=jsLine(o.k); o.lineT=mgRand(2.5,4); }
      if(o.fly){ const f=o.fly; f.t+=dt; o.x+=f.vx*dt; o.y+=f.vy*dt; f.vy+=60*dt; o.rot+=f.spin*dt; o.sc=Math.max(0.05,1-f.t*0.9); if(f.t>1.15){ o.gone=1; g.fx.push({star:1,x:o.x,y:o.y,life:0.7}); } return; }
      if(o.k==='phone'&&(o.throws||0)<3){ if(o.y<o.stopY) o.y+=o.sp*d2; else { o.throwT-=d2; if(o.throwT<=0){ o.throws=(o.throws||0)+1; o.throwT=mgRand(1.6,2.4); g.phones.push({x:o.x+10,y:o.y-10,vx:(JS_ME.x-o.x)*0.55,vy:(JS_DESK-o.y)*0.55,rot:0}); } } }
      else { o.y+=o.sp*d2; o.x+=Math.sin(o.wob*0.4+o.ph)*o.zig*d2; o.x=mgClamp(o.x,o.r+4,MG_W-o.r-4); }
      if(o.y>=JS_DESK-6){ o.gone=1; jsHurt(g,o.dmg,o.line||'사장 나와!'); }
    });
    g.guys=g.guys.filter(o=>!o.gone);
    g.phones.forEach(f=>{ f.x+=f.vx*d2; f.y+=f.vy*d2; f.rot+=d2*9; if(f.y>=JS_DESK){ f.dead=1; jsHurt(g,8,'따르릉!! 📞'); } });
    g.phones=g.phones.filter(f=>!f.dead);
    g.fx.forEach(f=>{ f.life-=dt; if(!f.boom&&!f.star&&!f.big) f.y-=dt*30; }); g.fx=g.fx.filter(f=>f.life>0);
    if(g.mental<=0){ g.mental=0; mgEnd(JS,'hp'); }
  },
  draw:jsDraw
};
function openStress(){ mgOpen(JS); }
const jsLine=k=>{ const a=JS_LINES[k]; return a[Math.floor(Math.random()*a.length)]; };
function jsSpawn(g,force){
  const t=g.t, r=Math.random();
  const k=force||(t<10?(r<0.8?'basic':'fast'):r<0.38?'basic':r<0.56?'fast':r<0.72?'madam':r<0.86?'phone':'group');
  const K=JS_KIND[k], sp=mgRand(K.sp[0],K.sp[1])*(1+Math.min(1.3,t/90));
  g.guys.push({k, x:mgRand(K.r+10,MG_W-K.r-10), y:-K.r-10, r:K.r, hp:K.hp, hp0:K.hp, sp, pts:K.pts, dmg:K.dmg, wob:mgRand(0,6), ph:mgRand(0,6), zig:k==='fast'?40:mgRand(6,18),
    line:jsLine(k), lineT:mgRand(2,3.5), hurt:0, stopY:mgRand(150,240), throwT:0.8, rot:0, sc:1});
  if(k==='boss'){ g.fx.push({big:1,x:MG_W/2,y:110,t:'👑 회장님 친구 등장! 여러 번 날려요',life:2}); }
}
function jsSwing(g,x,y){ g.swing={t:0, a:Math.atan2(y-JS_ME.y,x-JS_ME.x)}; }
function jsHit(g,o){
  jsSwing(g,o.x,o.y);
  o.hp--; o.hurt=0.25;
  if(o.hp>0){ o.y=Math.max(-o.r,o.y-(o.k==='boss'?22:40)); g.fx.push({x:o.x,y:o.y-o.r-12,t:o.k==='boss'?'퍽! ('+o.hp+')':'퍽!',col:'#fff3a8',life:0.6},{boom:1,x:o.x,y:o.y-o.r*0.4,life:0.25}); g.shake=0.08; return; }
  jsLaunch(g,o,false);
}
function jsLaunch(g,o,soda){
  const ang=-Math.PI/2+mgRand(-0.9,0.9), v=mgRand(520,700)*(o.k==='boss'?1.2:1);
  o.fly={t:0, vx:Math.cos(ang)*v*0.55, vy:Math.sin(ang)*v, spin:mgRand(9,16)*(Math.random()<0.5?-1:1)};
  o.line=JS_HIT[Math.floor(Math.random()*JS_HIT.length)];
  g.combo=soda?g.combo:g.combo+1; g.comboT=1.4;
  const mul=Math.min(2,1+0.1*Math.max(0,g.combo-1)), pts=Math.round(o.pts*mul);
  g.score+=pts; g.kills+=o.k==='group'?3:1; if(!soda) g.soda=Math.min(100,g.soda+(o.k==='boss'?20:o.k==='group'?6:3));
  const yd=Math.round(mgRand(180,320)*(o.k==='boss'?1.6:1));
  g.fx.push({x:o.x,y:o.y-o.r-14,t:'+'+pts+' · '+yd+'야드',col:'#fff3a8',life:0.9},{boom:1,x:o.x,y:o.y-o.r*0.4,life:0.3});
  if(!soda&&g.combo>=3) g.fx.push({x:MG_W/2,y:150,t:g.combo+' COMBO!',col:'#ffd34d',life:0.8,cmb:1});
  if(o.k==='boss'){ g.slow=0.9; g.shake=0.4; g.fx.push({big:1,x:MG_W/2,y:110,t:'👑 회장님 친구, 저 멀리~ ⭐',life:1.8}); }
  else g.shake=Math.max(g.shake,0.12);
  try{ navigator.vibrate&&navigator.vibrate(o.k==='boss'?120:25); }catch(_){}
}
function jsSoda(g){
  g.soda=0; g.slow=0.8; g.shake=0.5;
  g.guys.forEach(o=>{ if(o.fly) return; if(o.k==='boss'&&o.hp>3){ o.hp-=3; o.hurt=0.4; o.y=Math.max(-o.r,o.y-60); return; } jsLaunch(g,o,true); });
  g.phones.forEach(f=>{ f.dead=1; g.score+=5; });
  g.fx.push({big:1,x:MG_W/2,y:200,t:'🥤 속이 뻥!! 다 날아가라~',life:1.6},{soda:1,life:1});
  try{ navigator.vibrate&&navigator.vibrate([60,40,120]); }catch(_){}
}
function jsHurt(g,dmg,line){
  g.mental-=dmg; g.combo=0; g.shake=0.35; g.shout={t:line,life:1.0};
  try{ navigator.vibrate&&navigator.vibrate(80); }catch(_){}
}

// ---------- 그리기 ----------
function jsGuy(c,o){
  const K=JS_KIND[o.k], r=o.r, bob=o.fly?0:Math.sin(o.wob)*2;
  c.save(); c.translate(o.x,o.y+bob); if(o.fly){ c.rotate(o.rot); c.scale(o.sc,o.sc); }
  if(!o.fly){ c.beginPath(); c.ellipse(0,r*0.95-bob,r*0.9,r*0.25,0,0,7); c.fillStyle='rgba(0,0,0,.18)'; c.fill(); }
  const one=(dx,dy,s,col)=>{
    const R=r*s;
    // legs (walking)
    if(!o.fly){ c.fillStyle='#4a4a5a'; const sw=Math.sin(o.wob*1.5)*R*0.18; mgRR(c,dx-R*0.4+sw,dy+R*0.45,R*0.28,R*0.5,R*0.1); c.fill(); mgRR(c,dx+R*0.12-sw,dy+R*0.45,R*0.28,R*0.5,R*0.1); c.fill(); }
    // body
    c.fillStyle=o.hurt>0?'#ff8a7a':col; mgRR(c,dx-R*0.62,dy-R*0.15,R*1.24,R*0.8,R*0.35); c.fill();
    // arms waving
    c.strokeStyle=o.hurt>0?'#ff8a7a':col; c.lineWidth=R*0.2; c.lineCap='round'; const wv=Math.sin(o.wob*2)*R*0.3;
    c.beginPath(); c.moveTo(dx-R*0.55,dy); c.lineTo(dx-R*0.95,dy-R*0.45+wv); c.moveTo(dx+R*0.55,dy); c.lineTo(dx+R*0.95,dy-R*0.45-wv); c.stroke();
    // head
    c.beginPath(); c.arc(dx,dy-R*0.55,R*0.5,0,7); c.fillStyle=o.hurt>0||o.k==='fast'?'#ff9f8a':K.skin; c.fill();
    // face
    c.strokeStyle='#2a2a2a'; c.lineWidth=Math.max(1.2,R*0.08);
    if(o.fly){ const e=R*0.12; [[-0.18,-0.6],[0.18,-0.6]].forEach(([u,v])=>{ c.beginPath(); c.moveTo(dx+u*R-e,dy+v*R-e); c.lineTo(dx+u*R+e,dy+v*R+e); c.moveTo(dx+u*R+e,dy+v*R-e); c.lineTo(dx+u*R-e,dy+v*R+e); c.stroke(); }); c.beginPath(); c.arc(dx,dy-R*0.38,R*0.12,0,7); c.stroke(); }
    else {
      c.beginPath(); c.moveTo(dx-R*0.32,dy-R*0.78); c.lineTo(dx-R*0.08,dy-R*0.68); c.moveTo(dx+R*0.32,dy-R*0.78); c.lineTo(dx+R*0.08,dy-R*0.68); c.stroke();   // angry brows
      c.fillStyle='#2a2a2a'; c.beginPath(); c.arc(dx-R*0.17,dy-R*0.6,R*0.06,0,7); c.arc(dx+R*0.17,dy-R*0.6,R*0.06,0,7); c.fill();
      c.beginPath(); c.ellipse(dx,dy-R*0.36,R*0.16,R*(0.08+0.06*Math.abs(Math.sin(o.wob*3))),0,0,7); c.fillStyle='#7a2a2a'; c.fill();   // shouting mouth
    }
  };
  if(o.k==='group'){ one(-r*0.55,r*0.15,0.6,'#f2a33a'); one(r*0.55,r*0.15,0.6,'#5cbf5a'); one(0,-r*0.1,0.66,'#3f7fd1'); }
  else one(0,0,1,K.body);
  // props
  if(o.k==='basic'){ c.fillStyle='#fff'; mgRR(c,-r*0.5,-r*1.08,r*1.0,r*0.18,r*0.08); c.fill(); c.fillStyle='#e8504a'; mgRR(c,r*0.1,-r*1.0,r*0.55,r*0.1,r*0.05); c.fill(); }   // visor
  if(o.k==='fast'){ c.fillStyle='#ffd34d'; c.beginPath(); c.moveTo(r*0.9,-r*0.6); c.lineTo(r*1.45,-r*0.9); c.lineTo(r*1.45,-r*0.2); c.closePath(); c.fill(); }   // megaphone
  if(o.k==='madam'){ c.fillStyle='#6b3e1f'; c.beginPath(); c.arc(0,-r*0.82,r*0.5,Math.PI*0.95,Math.PI*2.05); c.fill(); c.beginPath(); c.arc(-r*0.45,-r*0.62,r*0.2,0,7); c.arc(r*0.45,-r*0.62,r*0.2,0,7); c.fill(); c.fillStyle='#e8b04a'; mgRR(c,r*0.75,-r*0.1,r*0.45,r*0.38,r*0.08); c.fill(); }
  if(o.k==='phone'){ c.font=Math.round(r*0.7)+'px sans-serif'; c.textBaseline='middle'; c.textAlign='left'; c.fillStyle='#000'; c.fillText('📱',r*0.7,-r*0.75); }
  if(o.k==='boss'){ c.fillStyle='#111'; mgRR(c,-r*0.42,-r*0.72,r*0.84,r*0.2,r*0.08); c.fill(); c.strokeStyle='#f6c64b'; c.lineWidth=r*0.1; c.beginPath(); c.arc(0,-r*0.05,r*0.35,0.2,Math.PI-0.2); c.stroke();
    c.fillStyle='#f6c64b'; c.beginPath(); c.moveTo(-r*0.35,-r*1.0); c.lineTo(-r*0.25,-r*1.3); c.lineTo(-r*0.1,-r*1.08); c.lineTo(0,-r*1.36); c.lineTo(r*0.1,-r*1.08); c.lineTo(r*0.25,-r*1.3); c.lineTo(r*0.35,-r*1.0); c.closePath(); c.fill(); }
  c.restore();
  // hp pips for tough ones
  if(!o.fly&&o.hp0>1){ for(let i=0;i<o.hp0;i++){ c.fillStyle=i<o.hp?'#e8504a':'rgba(0,0,0,.25)'; mgRR(c,o.x-o.hp0*4.5+i*9,o.y-r*(o.k==='boss'?1.55:1.35)-4,7,4,2); c.fill(); } }
}
function jsBubble(c,o){
  if(!o.line||o.y<60) return;
  const s=o.fly?12:11, w=Math.min(220,(mgFit(c,o.line,206,s), c.measureText(o.line).width)+14), h=20;   // long lines get a wider bubble
  const x=mgClamp(o.x-w/2,4,MG_W-w-4), y=o.y-o.r*(o.k==='boss'?1.6:1.45)-h-(o.hp0>1&&!o.fly?6:0);
  c.save(); if(o.fly) c.globalAlpha=Math.max(0,1-o.fly.t);
  c.fillStyle=o.fly?'#fff6c8':'#fff'; mgRR(c,x,y,w,h,9); c.fill(); c.strokeStyle=o.fly?'#f2b64b':'#e8504a'; c.lineWidth=1.5; c.stroke();
  c.beginPath(); c.moveTo(mgClamp(o.x,x+8,x+w-8)-4,y+h); c.lineTo(mgClamp(o.x,x+8,x+w-8),y+h+5); c.lineTo(mgClamp(o.x,x+8,x+w-8)+4,y+h); c.fillStyle=o.fly?'#fff6c8':'#fff'; c.fill();
  mgText(c,o.line,x+w/2,y+h/2+0.5,mgFit(c,o.line,w-10,s),o.fly?'#b5741a':'#c0392b','center',false);
  c.restore();
}
function jsDraw(c,g){
  const now=performance.now()/1000;
  c.save(); if(g.shake>0) c.translate(mgRand(-5,5)*g.shake*3,mgRand(-5,5)*g.shake*3);
  // course lawn + path to the clubhouse
  const gr=c.createLinearGradient(0,0,0,JS_DESK); gr.addColorStop(0,'#bfe3f7'); gr.addColorStop(0.18,'#dff2c9'); gr.addColorStop(0.2,'#7fc15a'); gr.addColorStop(1,'#5ea544');
  c.fillStyle=gr; c.fillRect(0,0,MG_W,MG_H);
  c.fillStyle='rgba(255,255,255,.06)'; for(let y=104;y<JS_DESK;y+=26) c.fillRect(0,y,MG_W,13);
  c.fillStyle='#e9dcc0'; c.beginPath(); c.moveTo(140,JS_DESK); c.lineTo(220,JS_DESK); c.lineTo(196,96); c.lineTo(164,96); c.closePath(); c.fill();
  [[40,82,22],[300,78,26],[90,86,16],[250,88,14]].forEach(([x,y,r])=>{ c.beginPath(); c.arc(x,y,r,0,7); c.fillStyle='#4f9a3e'; c.fill(); });
  c.fillStyle='#fff'; [[60,30],[250,22]].forEach(([x,y])=>{ c.beginPath(); c.arc(x,y,10,0,7); c.arc(x+12,y-4,12,0,7); c.arc(x+26,y,9,0,7); c.fill(); });
  // phones in the air
  g.phones.forEach(f=>{ c.save(); c.translate(f.x,f.y); c.rotate(f.rot); c.font='18px sans-serif'; c.textBaseline='middle'; c.textAlign='left'; c.fillStyle='#000'; c.fillText('📞',-9,0); c.restore(); });
  // guys (front ones on top)
  const list=g.guys.slice().sort((a,b)=>(a.fly?1:0)-(b.fly?1:0)||a.y-b.y);
  list.forEach(o=>jsGuy(c,o));
  // speech bubbles: only the 3 closest to the desk (plus the ones just sent flying), so the screen stays readable
  const talk=g.guys.filter(o=>!o.fly&&o.y>70).sort((a,b)=>b.y-a.y).slice(0,3);
  g.guys.forEach(o=>{ if((o.fly&&o.fly.t<0.7)||talk.includes(o)) jsBubble(c,o); });
  // the front desk + me
  c.fillStyle='#8a5a34'; c.fillRect(0,JS_DESK,MG_W,MG_H-JS_DESK); c.fillStyle='#a8743f'; c.fillRect(0,JS_DESK,MG_W,14); c.fillStyle='rgba(0,0,0,.15)'; c.fillRect(0,JS_DESK+14,MG_W,3);
  mgText(c,'FRONT',40,JS_DESK+40,13,'rgba(255,255,255,.55)','center',false); mgText(c,'FRONT',MG_W-40,JS_DESK+40,13,'rgba(255,255,255,.55)','center',false);
  // me with a driver
  const m=JS_ME; c.save(); c.translate(m.x,m.y-26);
  c.beginPath(); c.arc(0,0,13,0,7); c.fillStyle='#ffd9b8'; c.fill();
  c.beginPath(); c.arc(0,-3,13.5,Math.PI,0); c.fillStyle='#2f7a34'; c.fill(); c.fillStyle='#246227'; mgRR(c,-2,-6,16,4,2); c.fill();
  c.fillStyle='#2a2a2a'; c.beginPath(); c.arc(-4,2,1.6,0,7); c.arc(4,2,1.6,0,7); c.fill();
  c.strokeStyle='#2a2a2a'; c.lineWidth=1.5; c.beginPath(); c.arc(0,5,4,0.15*Math.PI,0.85*Math.PI); c.stroke();
  c.restore();
  // the swing: the club sweeps toward the target
  const sw=g.swing, base=sw?sw.a:-Math.PI/2-0.9, k=sw?Math.min(1,sw.t/0.12):0, a=sw?base-1.6+k*2.2:base;
  c.save(); c.translate(m.x+10,m.y-14); c.rotate(a+Math.PI/2);
  c.strokeStyle='#bbb'; c.lineWidth=3; c.beginPath(); c.moveTo(0,0); c.lineTo(0,-46); c.stroke();
  c.fillStyle='#333'; mgRR(c,-7,-54,14,10,3); c.fill(); c.restore();
  if(sw&&sw.t<0.18){ c.strokeStyle='rgba(255,255,255,'+(0.8-sw.t*4)+')'; c.lineWidth=6; c.beginPath(); c.arc(m.x+10,m.y-14,52,base-1.0,base+0.6); c.stroke(); }
  // 🥤 soda button
  if(g.soda>=100&&JS.st==='play'){ const S=JS_SODA, p=1+0.08*Math.sin(now*8); c.beginPath(); c.arc(S.x,S.y,S.r*p,0,7); c.fillStyle='rgba(80,180,255,.9)'; c.fill(); c.strokeStyle='#fff'; c.lineWidth=3; c.stroke(); mgText(c,'🥤',S.x,S.y,24,'#000','center',false); mgText(c,'사이다!',S.x,S.y+S.r+10,11,'#fff','center'); }
  // effects
  g.fx.forEach(f=>{
    if(f.boom){ c.globalAlpha=f.life/0.3; c.fillStyle='#fff3a8'; c.beginPath(); for(let i=0;i<10;i++){ const aa=i*Math.PI/5, rr=i%2?8:20*(1.2-f.life); c.lineTo(f.x+Math.cos(aa)*rr,f.y+Math.sin(aa)*rr); } c.closePath(); c.fill(); c.globalAlpha=1; return; }
    if(f.star){ c.globalAlpha=Math.min(1,f.life*2); mgText(c,'⭐',f.x,Math.max(14,f.y),14+(0.7-f.life)*20,'#fff','center',false); c.globalAlpha=1; return; }
    if(f.soda){ c.globalAlpha=f.life*0.5; c.fillStyle='#bfe8ff'; c.fillRect(0,0,MG_W,MG_H); c.globalAlpha=1; return; }
    c.globalAlpha=Math.min(1,f.life*1.6);
    if(f.big){ const s=mgFit(c,f.t,MG_W-50,17); c.fillStyle='rgba(0,0,0,.55)'; mgRR(c,20,f.y-19,MG_W-40,38,16); c.fill(); mgText(c,f.t,MG_W/2,f.y,s,'#fff','center',false); }
    else mgText(c,f.t,f.x,f.y,f.cmb?24:13,f.col||'#fff','center');
    c.globalAlpha=1; });
  c.restore();
  // shout from someone who reached the desk
  if(g.shout){ const s=g.shout, t='😤 '+s.t; c.globalAlpha=Math.min(1,s.life*2); c.fillStyle='rgba(200,40,40,.88)'; mgRR(c,16,JS_DESK-64,MG_W-32,44,16); c.fill(); mgText(c,t,MG_W/2,JS_DESK-42,mgFit(c,t,MG_W-50,19),'#fff','center',false); c.globalAlpha=1; }
  // HUD: score, mental, soda gauge
  c.fillStyle='rgba(30,30,40,.72)'; mgRR(c,6,6,MG_W-12,40,12); c.fill();
  mgText(c,'🏌️ '+g.score+'점',14,19,14,'#fff');
  mgText(c,'🧠',140,19,13,'#fff',null,false); c.fillStyle='rgba(255,255,255,.2)'; mgRR(c,160,13,80,11,5); c.fill(); c.fillStyle=g.mental>50?'#5cbf5a':g.mental>25?'#f2b64b':'#e8504a'; mgRR(c,160,13,80*g.mental/100,11,5); c.fill();
  mgText(c,g.kills+'명',MG_W-14,19,13,'#ffd9a8','right');
  mgText(c,'💢',14,36,11,'#fff',null,false); c.fillStyle='rgba(255,255,255,.2)'; mgRR(c,32,31,MG_W-50,8,4); c.fill(); c.fillStyle=g.soda>=100?'#5bc0ff':'#ff7a5c'; mgRR(c,32,31,(MG_W-50)*g.soda/100,8,4); c.fill();
  if(g.combo>=2){ mgText(c,'x'+g.combo,MG_W-14,58,15,'#ffd34d','right'); }
}
