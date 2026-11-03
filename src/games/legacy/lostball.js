// ⛳ 로스트볼 찾기: 단계가 점점 올라가는 숨은 공 찾기. 몇 단계까지 깨는지로 순위
// - 출발 단계: 🟢 쉬움 1단계 · 🟡 보통 5단계 · 🔴 어려움 10단계부터 · 순위는 하나로 통합 (가장 높이 깬 단계)
// - 한 단계 = 한 장소: 제한 시간 안에 숨은 공을 모두 톡! 다 찾으면 다음 단계, 시간이 다 되면 끝
// - 단계가 오를수록 공이 많아지고 작아지고, 풀·낙엽에 가려지고, 공처럼 보이는 하얀 돌·꽃·버섯이 늘고, 숲 그늘이 짙어짐
// - 아무것도 없는 곳을 누르면 시간이 줄어듦 · 1~2단계는 한동안 못 찾으면 공 근처가 반짝
// - 기록: lostScores/{아이디}의 b1 = 깬 가장 높은 단계(어느 출발이든), n1 = 그때 찾은 공 수 (예전 b2·b3 기록은 합쳐짐)
const LB_TOP=48;   // under the HUD
const LB_START={1:1, 2:5, 3:10};
const LB_RMIN=7;   // 공 반지름 하한 (화면 지름 약 12px): 이보다 작으면 눈 싸움이 돼서 더 작게 하지 않음   // 쉬움·보통·어려움이 시작하는 단계
// how a stage looks: everything gets harder step by step
function lbP(st){
  const k=Math.min(1,(st-1)/12), cap=(v,m)=>Math.min(m,v);
  const balls=cap(4+Math.floor(st/2),9);
  return {r:Math.max(LB_RMIN,9-(st-1)*0.28), balls,   // 공은 8단계쯤까지만 작아지고 그 뒤로는 그대로 (더 숨기만 함)
    grass:cap(200+45*st,820), leaves:cap(28+13*st,230), rocks:cap(4+st,16), flowers:cap(3+st,18), mush:cap(Math.max(0,st-3),10), bush:cap(4+Math.floor(st/3),9),
    cover:cap(Math.max(0,(st-2)*0.08),0.8), heavy:st>=8, half:cap(Math.max(0,(st-5)*0.06),0.4), lightRock:st<=2?0.2:0.55,
    dark:cap(Math.max(0,(st-3)*0.025),0.28), miss:st<4?1:2, hint:st<=2?6:0,
    time:Math.round(10+balls*1.8-st*0.2)};
}
const LB={key:'lost', title:'⛳ 로스트볼 찾기', icon:'⛳', col:'lostScores', V:3, unit:'단계', nUnit:'개', sub:'몇 단계까지 갈 수 있을까요?', oneRank:true, rankNote:'통합 순위 · 쉬움·보통·어려움 상관없이 가장 높이 깬 단계, 같으면 찾은 공이 많을수록 위',
  help:()=>'숨은 <b>골프공</b>을 시간 안에 모두 톡 눌러 찾으면 <b>다음 단계</b>! 단계가 오를수록 공이 작고 많아지고 더 잘 숨어요. 빈 곳을 누르면 시간이 줄어요. 하얀 <b>돌·꽃·버섯</b>에 속지 마세요!',
  n:g=>g.found,
  fresh(lv){ const g={lv, t:0, score:0, stage:LB_START[lv], found:0, fx:[], since:0, shake:0}; lbScene(g); return g; },
  ready:lv=>[
    ['러프와 숲에 빠진 공을 찾아 주세요!',13.5,'#555'],
    [LB_START[lv]+'단계부터 시작해요',15,'#2b4a6b'],
    ['시간 안에 공을 모두 찾으면 다음 단계로!',13,'#333'],
    ['단계마다 공이 작아지고 더 잘 숨어요',13,'#333'],
    ['빈 곳을 누르면 시간 -1~2초',13,'#c0392b'],
    ['몇 단계까지 깨는지로 순위가 정해져요 🏆',13,'#2f7a34']],
  over:g=>[['⏰ '+g.stage+'단계에서 시간 끝!',19,'#2b4a6b'],[g.score?g.score+'단계까지 클리어':'아직 깬 단계가 없어요',g.score?30:20,'#e8504a'],['찾은 공 모두 '+g.found+'개'+(g.missed?' · 놓친 공 '+g.missed+'개':''),15,'#333'],[g.score>=15?'로스트볼 전문가예요 🕵️':g.score>=8?'눈썰미 좋아요 👀':'공이 꼭꼭 숨었네요 😅',13,'#777']],
  down(g,p){
    if(p.y<LB_TOP||g.next!=null||g.reveal!=null) return;
    const L=g.L, tol=L.r+9;
    let best=null, bd=1e9; g.balls.forEach(b=>{ if(b.found) return; const d=Math.hypot(p.x-b.x,p.y-b.y); if(d<bd){ bd=d; best=b; } });
    if(best&&bd<=tol){
      best.found=1; g.found++; g.since=0; g.fx.push({x:best.x, y:best.y-14, t:'+1', col:'#fff6a8', life:0.9}, {ring:1, x:best.x, y:best.y, life:0.5});
      if(g.balls.every(b=>b.found)){ g.score=g.stage; g.fx.push({x:MG_W/2, y:MG_H/2, t:'🎉 '+g.stage+'단계 클리어! 다음 단계로', col:'#fff', life:1.3, big:1}); g.stage++; g.next=1.1; }
    } else { g.t=Math.max(0,g.t-L.miss); g.shake=0.2; g.fx.push({x:p.x, y:p.y-12, t:'-'+L.miss+'초', col:'#ffb0a8', life:0.8}, {miss:1, x:p.x, y:p.y, life:0.4}); }
  },
  step(g,dt){
    g.since+=dt; g.shake=Math.max(0,g.shake-dt);
    // time up: first show where the missed balls were (2.5s), then the end screen
    if(g.reveal!=null){ g.reveal-=dt; if(g.reveal<=0){ mgEnd(LB,'time'); return; } }
    else if(g.next!=null){ g.next-=dt; if(g.next<=0){ g.next=null; lbScene(g); } }
    else { g.t-=dt; if(g.t<=0){ g.t=0; g.reveal=2.5; g.missed=g.balls.filter(b=>!b.found).length; } }   // the clock stops between stages
    g.fx.forEach(f=>{ f.life-=dt; if(!f.ring&&!f.miss) f.y-=dt*24; }); g.fx=g.fx.filter(f=>f.life>0);
  },
  draw:lbDraw
};
function openLost(){ mgOpen(LB); }
// a new place: everything is random, stored as data so it can be drawn again at any size
function lbScene(g){
  const L=g.L=lbP(g.stage), R=mgRand, s={};
  g.t=g.T=L.time;
  const inField=(x,y,m)=>x>m&&x<MG_W-m&&y>LB_TOP+m&&y<MG_H-m;
  s.tone=R(0,1);
  s.patches=[...Array(14)].map(()=>({x:R(0,MG_W), y:R(LB_TOP,MG_H), rx:R(30,80), ry:R(20,50), a:R(0,3), d:R(-1,1)}));
  s.bush=[...Array(L.bush)].map(()=>{ const x=R(20,MG_W-20), y=R(LB_TOP+20,MG_H-20); return {x,y,parts:[...Array(6)].map(()=>({dx:R(-26,26), dy:R(-16,16), r:R(12,22)}))}; });
  const balls=[];
  for(let t=0;t<600&&balls.length<L.balls;t++){
    const x=R(18,MG_W-18), y=R(LB_TOP+18,MG_H-18);
    if(balls.some(b=>Math.hypot(b.x-x,b.y-y)<44)) continue;
    const half=Math.random()<L.half;
    if(lbBushShow(s.bush,x,y,L.r,half)<LB_SHOW) continue;   // 덤불 뒤에 살짝 숨는 건 OK, 다 가려지면 안 됨
    balls.push({x, y, found:0, half});
  }
  g.balls=balls;
  const away=(x,y,d)=>balls.every(b=>Math.hypot(b.x-x,b.y-y)>d);
  const spot=d=>{ for(let t=0;t<40;t++){ const x=R(10,MG_W-10), y=R(LB_TOP+10,MG_H-10); if(away(x,y,d)) return [x,y]; } return [R(10,MG_W-10),R(LB_TOP+10,MG_H-10)]; };
  s.rocks=[...Array(L.rocks)].map(()=>{ const [x,y]=spot(L.r+16); return {x,y,rx:R(5,11)*(L.heavy?0.8:1), ry:R(4,8), light:Math.random()<L.lightRock}; });
  s.flowers=[...Array(L.flowers)].map(()=>{ const [x,y]=spot(L.r+16); return {x,y,r:R(3.5,6),a:R(0,3)}; });
  s.mush=[...Array(L.mush)].map(()=>{ const [x,y]=spot(L.r+16); return {x,y,r:R(4,7)}; });
  s.grass=[...Array(L.grass)].map(()=>({x:R(0,MG_W), y:R(LB_TOP,MG_H+10), h:R(6,16), lean:R(-5,5), c:Math.floor(R(0,4))}));
  s.leaves=[...Array(L.leaves)].map(()=>({x:R(0,MG_W), y:R(LB_TOP,MG_H), r:R(3,7), a:R(0,6.3), c:Math.floor(R(0,4))}));
  // covers: grass blades and leaves drawn over some of the balls
  s.cover=[]; balls.forEach(b=>{ if(Math.random()<L.cover){ const n=L.heavy?7:4; for(let i=0;i<n;i++) s.cover.push({x:b.x+R(-L.r,L.r), y:b.y+R(L.r*0.3,L.r*1.4), h:R(8,15), lean:R(-6,6), c:Math.floor(R(0,4))}); }
    if(L.heavy&&Math.random()<0.5) s.leaves.push({x:b.x+R(-L.r*0.8,L.r*0.8), y:b.y+R(-L.r*0.6,L.r*0.6), r:R(4,6), a:R(0,6.3), c:Math.floor(R(0,4)), top:1}); });
  g.s=s; g.since=0; g.img=null;
}
// how much of a ball can still be seen past the bushes (0..1): a grid of points over the ball (only its top when half buried)
const LB_SHOW=0.55;
function lbBushShow(bush,x,y,r,half){
  let all=0, seen=0;
  for(let i=-3;i<=3;i++) for(let j=-3;j<=3;j++){ const dx=i/3*r, dy=j/3*r; if(dx*dx+dy*dy>r*r) continue; if(half&&dy>r*0.25) continue;
    all++; const px=x+dx, py=y+dy; if(!bush.some(b=>b.parts.some(p=>Math.hypot(b.x+p.dx-px,b.y+p.dy-py)<p.r))) seen++; }
  return all?seen/all:1;
}
const LB_GRASS=['#3f7a2c','#4f8f36','#5ea544','#2f6a24'], LB_LEAF=['#b8862b','#c9a03a','#8f5a22','#a77a3a'];
function lbRender(g, dpr){
  const s=g.s, L=g.L;
  const cv=document.createElement('canvas'); cv.width=Math.round(MG_W*dpr); cv.height=Math.round(MG_H*dpr);
  const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0);
  const gr=c.createLinearGradient(0,LB_TOP,0,MG_H); gr.addColorStop(0,s.tone<0.5?'#5e9440':'#567f3a'); gr.addColorStop(1,'#3f6f2c'); c.fillStyle=gr; c.fillRect(0,0,MG_W,MG_H);
  s.patches.forEach(p=>{ c.beginPath(); c.ellipse(p.x,p.y,p.rx,p.ry,p.a,0,7); c.fillStyle=p.d>0?'rgba(255,255,200,.06)':'rgba(0,30,0,.12)'; c.fill(); });
  // ground grass
  c.lineCap='round';
  const blade=(b,w)=>{ c.strokeStyle=LB_GRASS[b.c]; c.lineWidth=w; c.beginPath(); c.moveTo(b.x,b.y); c.quadraticCurveTo(b.x+b.lean*0.3,b.y-b.h*0.6,b.x+b.lean,b.y-b.h); c.stroke(); };
  s.grass.forEach((b,i)=>{ if(i%2===0) blade(b,1.6); });
  // rocks, flowers, mushrooms (the look-alikes)
  s.rocks.forEach(r=>{ c.beginPath(); c.ellipse(r.x+1.5,r.y+2,r.rx,r.ry,0,0,7); c.fillStyle='rgba(0,0,0,.2)'; c.fill(); c.beginPath(); c.ellipse(r.x,r.y,r.rx,r.ry,0,0,7); c.fillStyle=r.light?'#e2e0d6':'#8d8a80'; c.fill(); c.beginPath(); c.ellipse(r.x-r.rx*0.3,r.y-r.ry*0.35,r.rx*0.4,r.ry*0.3,0,0,7); c.fillStyle='rgba(255,255,255,.35)'; c.fill(); });
  s.flowers.forEach(f=>{ c.fillStyle='#fbfbf6'; for(let k=0;k<5;k++){ const a=f.a+k*1.2566; c.beginPath(); c.ellipse(f.x+Math.cos(a)*f.r*0.6,f.y+Math.sin(a)*f.r*0.6,f.r*0.55,f.r*0.32,a,0,7); c.fill(); } c.beginPath(); c.arc(f.x,f.y,f.r*0.3,0,7); c.fillStyle='#f2c230'; c.fill(); });
  s.mush.forEach(m=>{ c.fillStyle='#efe7d6'; c.fillRect(m.x-m.r*0.25,m.y,m.r*0.5,m.r*0.9); c.beginPath(); c.arc(m.x,m.y+1,m.r,Math.PI,0); c.fillStyle='#f7f3ea'; c.fill(); c.fillStyle='#d9cdb5'; c.beginPath(); c.arc(m.x-m.r*0.35,m.y-m.r*0.35,m.r*0.15,0,7); c.arc(m.x+m.r*0.3,m.y-m.r*0.5,m.r*0.12,0,7); c.fill(); });
  // balls
  g.balls.forEach(b=>{ const r=L.r;
    c.beginPath(); c.ellipse(b.x+r*0.25,b.y+r*0.55,r*0.95,r*0.45,0,0,7); c.fillStyle='rgba(0,0,0,.25)'; c.fill();
    c.save(); if(b.half){ c.beginPath(); c.rect(b.x-r-2,b.y-r-2,2*r+4,r*1.25+2); c.clip(); }
    const bg=c.createRadialGradient(b.x-r*0.35,b.y-r*0.4,r*0.1,b.x,b.y,r); bg.addColorStop(0,'#ffffff'); bg.addColorStop(0.7,'#f1f1ee'); bg.addColorStop(1,'#cfcfc8');
    c.beginPath(); c.arc(b.x,b.y,r,0,7); c.fillStyle=bg; c.fill();
    c.fillStyle='rgba(0,0,0,.12)'; for(let k=0;k<7;k++){ const a=k*0.9, d=r*(k%2?0.55:0.3); c.beginPath(); c.arc(b.x+Math.cos(a)*d,b.y+Math.sin(a)*d,Math.max(0.6,r*0.09),0,7); c.fill(); }
    c.restore();
    if(b.half){ c.fillStyle='#4a3a26'; c.beginPath(); c.ellipse(b.x,b.y+r*0.3,r*1.25,r*0.45,0,0,7); c.fill(); }   // half buried in soil
  });
  // the rest of the grass, bushes, leaves and covers on top
  s.grass.forEach((b,i)=>{ if(i%2===1) blade(b,1.5); });
  s.bush.forEach(b=>b.parts.forEach(p=>{ c.beginPath(); c.arc(b.x+p.dx,b.y+p.dy,p.r,0,7); c.fillStyle='#2f6a28'; c.fill(); c.beginPath(); c.arc(b.x+p.dx-p.r*0.3,b.y+p.dy-p.r*0.3,p.r*0.5,0,7); c.fillStyle='#3d7f33'; c.fill(); }));
  s.cover.forEach(b=>blade(b,1.7));
  s.leaves.forEach(l=>{ c.save(); c.translate(l.x,l.y); c.rotate(l.a); c.beginPath(); c.ellipse(0,0,l.r,l.r*0.5,0,0,7); c.fillStyle=LB_LEAF[l.c]; c.fill(); c.strokeStyle='rgba(0,0,0,.2)'; c.lineWidth=0.7; c.beginPath(); c.moveTo(-l.r,0); c.lineTo(l.r,0); c.stroke(); c.restore(); });
  // forest shade
  if(L.dark){ const v=c.createRadialGradient(MG_W/2,MG_H/2,80,MG_W/2,MG_H/2,360); v.addColorStop(0,'rgba(0,20,0,'+L.dark*0.4+')'); v.addColorStop(1,'rgba(0,15,0,'+(L.dark+0.25)+')'); c.fillStyle=v; c.fillRect(0,0,MG_W,MG_H);
    c.fillStyle='rgba(255,250,200,.05)'; for(let i=0;i<4;i++){ c.beginPath(); c.moveTo(40+i*90,LB_TOP); c.lineTo(80+i*90,LB_TOP); c.lineTo(20+i*90,MG_H); c.lineTo(-20+i*90,MG_H); c.fill(); } }
  return cv;
}
function lbDraw(c,g){
  const L=g.L, dpr=LB.dpr||1;
  if(!g.img||g.imgDpr!==dpr){ g.img=lbRender(g,dpr); g.imgDpr=dpr; }
  c.save(); c.setTransform(1,0,0,1,0,0); c.drawImage(g.img,0,0); c.setTransform(dpr,0,0,dpr,0,0);
  if(g.shake>0) c.translate(mgRand(-3,3)*g.shake*5,0);
  const now=performance.now()/1000;
  // missed balls when time ran out: red pulsing rings (they stay under the end screen too)
  if(g.reveal!=null||LB.st==='over'){ const k=0.5+0.5*Math.sin(now*7);
    g.balls.forEach(b=>{ if(b.found) return; c.beginPath(); c.arc(b.x,b.y,L.r+7+k*4,0,7); c.strokeStyle='#ff4a3d'; c.lineWidth=3; c.stroke();
      c.beginPath(); c.arc(b.x,b.y,L.r+1.5,0,7); c.strokeStyle='rgba(255,255,255,.9)'; c.lineWidth=1.5; c.stroke();
      mgText(c,'여기!',b.x,b.y-L.r-17,11,'#fff','center'); });
    if(g.reveal!=null){ const t='⏰ 시간 끝! 못 찾은 공 '+g.missed+'개는 여기 있었어요'; const sz=mgFit(c,t,MG_W-50,15); c.fillStyle='rgba(180,30,30,.85)'; mgRR(c,16,MG_H-62,MG_W-32,40,16); c.fill(); mgText(c,t,MG_W/2,MG_H-42,sz,'#fff','center',false); } }
  // found balls get a ring
  g.balls.forEach(b=>{ if(!b.found) return; c.beginPath(); c.arc(b.x,b.y,L.r+5,0,7); c.strokeStyle='#ffe066'; c.lineWidth=2.5; c.stroke(); mgText(c,'✓',b.x,b.y,L.r*1.4+4,'#2f7a34','center',false); });
  // hint on easy: a sparkle near a ball after a while
  if(L.hint&&g.since>L.hint&&g.next==null){ const b=g.balls.find(b=>!b.found); if(b){ const a=now*3; c.globalAlpha=0.5+0.5*Math.sin(now*8); mgText(c,'✨',b.x+Math.cos(a)*18,b.y+Math.sin(a)*14,14,'#fff','center',false); c.globalAlpha=1; } }
  g.fx.forEach(f=>{
    if(f.ring){ c.globalAlpha=f.life/0.5; c.beginPath(); c.arc(f.x,f.y,L.r+6+(0.5-f.life)*30,0,7); c.strokeStyle='#fff'; c.lineWidth=2; c.stroke(); c.globalAlpha=1; return; }
    if(f.miss){ c.globalAlpha=f.life/0.4; c.strokeStyle='#ff6b5e'; c.lineWidth=2.5; c.beginPath(); c.moveTo(f.x-6,f.y-6); c.lineTo(f.x+6,f.y+6); c.moveTo(f.x+6,f.y-6); c.lineTo(f.x-6,f.y+6); c.stroke(); c.globalAlpha=1; return; }
    c.globalAlpha=Math.min(1,f.life*1.5);
    if(f.big){ const s=mgFit(c,f.t,MG_W-60,18); c.fillStyle='rgba(0,0,0,.55)'; mgRR(c,24,f.y-20,MG_W-48,40,16); c.fill(); mgText(c,f.t,MG_W/2,f.y,s,'#fff','center',false); }
    else mgText(c,f.t,f.x,f.y,15,f.col,'center');
    c.globalAlpha=1; });
  c.restore();
  // HUD
  c.fillStyle='rgba(20,40,20,.7)'; mgRR(c,6,6,MG_W-12,32,12); c.fill();
  mgText(c,'🏅 '+g.stage+'단계',14,22,15,'#fff');
  const left=g.balls.filter(b=>!b.found).length;
  mgText(c,'⛳ 남은 공 '+left+' / '+g.balls.length,118,22,13,'#e3f5d4');
  mgText(c,'⏱ '+Math.ceil(g.t)+'초',MG_W-14,22,15,g.t<6?'#ffb0a8':'#fff','right');
  c.fillStyle='rgba(255,255,255,.2)'; c.fillRect(14,41,MG_W-28,3); c.fillStyle=g.t<6?'#ff8a80':'#bff59a'; c.fillRect(14,41,(MG_W-28)*Math.min(1,g.t/g.T),3);
}
