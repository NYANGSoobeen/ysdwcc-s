// 🚗 카트 배차왕: 몰려오는 손님 팀에게 알맞은 카트를 골라 VISTA·DUKE 코스로 내보내기 (60초, 쉬움·보통·어려움)
// - 손님 팀 카드를 누르고 → 카트를 누르면 출발. 팀이 원하는 코스(VISTA/DUKE) 티가 비어 있어야 함
// - 5명 팀은 5인승 카트만 · 배터리 40% 미만이나 진흙 묻은 카트로 보내면 손님 불만 ❤️ -1 · 손님이 너무 오래 기다려 떠나도 ❤️ -1
// - 손님 없이 카트만 누르면 정비: 진흙 → 세차, 그 밖엔 충전 켜기/끄기 (충전 중인 카트도 바로 보낼 수 있음)
// - 점수: 보낸 팀마다 10점 + 덜 기다리게 했을수록 최대 +5, 👑 VIP는 2배. ❤️ 3개를 다 잃으면 끝
const CT_TIME=60, CT_HP=3, CT_LOW=40, CT_QMAX=5;
const CT_LV={
  1:{arrive:[4.4,5.8], pat:26, tee:2.6, round:[13,17], drain:[24,34], dirty:0.15, vip:0, five:0.22, charge:10, wash:1.8, carts:[5,4,5,4,5,4]},
  2:{arrive:[3.6,4.8], pat:19, tee:3.4, round:[13,17], drain:[30,42], dirty:0.3, vip:0.12, five:0.32, charge:9, wash:2.5, carts:[4,5,4,4,5,4]},
  3:{arrive:[2.8,3.8], pat:16, tee:4.2, round:[13,17], drain:[34,46], dirty:0.42, vip:0.22, five:0.42, charge:8, wash:3.2, carts:[4,4,5,4,4,5]}
};
// layout (canvas 360×520)
const CT_Q={x:10, y:52, w:64, h:94, gap:5};
const CT_TEE={VISTA:{x:10, y:156, w:166, h:62}, DUKE:{x:184, y:156, w:166, h:62}};
const CT_G={x:10, y:262, w:108, h:120, gx:8, gy:8};
const ctCartRect=i=>({x:CT_G.x+(i%3)*(CT_G.w+CT_G.gx), y:CT_G.y+Math.floor(i/3)*(CT_G.h+CT_G.gy), w:CT_G.w, h:CT_G.h});
const ctQRect=i=>({x:CT_Q.x+i*(CT_Q.w+CT_Q.gap), y:CT_Q.y, w:CT_Q.w, h:CT_Q.h});
const ctIn=(p,r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;

const CT={key:'cart', title:'🚗 카트 배차왕', icon:'🚗', col:'cartScores', V:1, unit:'점', nUnit:'팀', sub:'손님을 기다리게 하지 마세요!',
  help:()=>'<b>손님 팀</b>을 누르고 <b>카트</b>를 누르면 출발해요. 5명 팀은 <b>5인승</b>, 배터리 <b>40% 이상</b>, <b>진흙 없는</b> 카트로! 손님 없이 카트만 누르면 <b>세차·충전</b>해요.',
  n:g=>g.sent,
  fresh(lv){
    const L=CT_LV[lv];
    const carts=L.carts.map((cap,i)=>({no:i+1, cap, bat:Math.round(mgRand(lv===3?35:50,100)), st:'ready', t:0, dirty:lv===3&&i===2, charging:false}));
    const g={lv, t:CT_TIME, score:0, sent:0, hp:CT_HP, q:[], sel:-1, carts, tee:{VISTA:0,DUKE:0}, arriveT:0.6, fx:[], msg:'', msgT:0, shake:0, nextId:1};
    ctArrive(g); ctArrive(g);
    return g;
  },
  ready:lv=>{ const L=CT_LV[lv]; return [
    ['손님이 몰려와요! 알맞은 카트로 빨리 보내 주세요',13,'#555'],
    ['① 손님 팀 누르기 → ② 카트 누르기',14,'#2b4a6b'],
    ['5명 팀 = 5인승 · 🔋 40% 이상 · 🟤 진흙 없는 카트',13,'#333'],
    ['원하는 코스(VISTA/DUKE) 티가 비어야 출발',13,'#333'],
    ['손님 없이 카트 누르기 = 세차·충전',13,'#2f7a34'],
    [CT_TIME+'초 · ❤️ 3개'+(L.vip?' · 👑 VIP는 점수 2배':''),13,'#777']]; },
  over:g=>[[g.why==='hp'?'😡 손님 불만이 너무 많아요!':'⏰ 영업 끝!',20,'#2b4a6b'],[g.score+'점',40,'#e8504a'],['보낸 손님 '+g.sent+'팀',15,'#333'],[g.sent>=12?'오늘 배차 완벽해요 👍':g.sent>=6?'조금만 더 빠르게! 🚗':'손님들이 많이 기다렸어요 😅',13,'#777']],
  down(g,p){
    // a team card
    for(let i=0;i<g.q.length;i++) if(ctIn(p,ctQRect(i))){ g.sel=g.sel===i?-1:i; return; }
    // a cart
    for(let i=0;i<g.carts.length;i++) if(ctIn(p,ctCartRect(i))){ if(g.sel>=0) ctSend(g,g.sel,i); else ctFix(g,i); return; }
    g.sel=-1;
  },
  step(g,dt){
    const L=CT_LV[g.lv];
    g.t-=dt; if(g.t<=0){ g.t=0; mgEnd(CT,'time'); return; }
    g.msgT=Math.max(0,g.msgT-dt); g.shake=Math.max(0,g.shake-dt);
    g.tee.VISTA=Math.max(0,g.tee.VISTA-dt); g.tee.DUKE=Math.max(0,g.tee.DUKE-dt);
    g.arriveT-=dt; if(g.arriveT<=0){ if(g.q.length<CT_QMAX){ ctArrive(g); g.arriveT=mgRand(L.arrive[0],L.arrive[1]); } else g.arriveT=0.5; }
    // waiting teams lose patience; one that runs out leaves angry
    for(let i=g.q.length-1;i>=0;i--){ const m=g.q[i]; m.p-=dt;
      if(m.p<=0){ g.q.splice(i,1); if(g.sel===i) g.sel=-1; else if(g.sel>i) g.sel--; ctHurt(g,'😡 기다리다 지친 손님이 돌아갔어요'); if(CT.st!=='play') return; } }
    g.carts.forEach(c=>{
      if(c.st==='out'){ c.t-=dt; if(c.t<=0){ c.st='ready'; c.bat=Math.max(c.stall?0:3,c.bat-(c.stall?100:c.drain)); c.dirty=c.dirty||Math.random()<L.dirty; c.stall=false; c.back=1; } }
      else if(c.st==='wash'){ c.t-=dt; if(c.t<=0){ c.st='ready'; c.dirty=false; c.shine=1; } }
      else if(c.charging){ c.bat=Math.min(100,c.bat+L.charge*dt); if(c.bat>=100) c.charging=false; }
      c.back=Math.max(0,(c.back||0)-dt); c.shine=Math.max(0,(c.shine||0)-dt);
    });
    g.fx.forEach(f=>{ f.life-=dt; if(f.drive){ f.k=Math.min(1,f.k+dt/0.7); } else f.y-=dt*26; }); g.fx=g.fx.filter(f=>f.life>0);
  },
  draw:ctDraw
};
function openCart(){ mgOpen(CT); }
function ctArrive(g){
  const L=CT_LV[g.lv], r=Math.random();
  const size=Math.random()<L.five?5:r<0.2?2:r<0.45?3:4, vip=Math.random()<L.vip;
  const pat=L.pat*(vip?0.8:1)*mgRand(0.9,1.1);
  g.q.push({id:g.nextId++, size, course:Math.random()<0.5?'VISTA':'DUKE', vip, p:pat, p0:pat, born:performance.now()});
}
function ctSay(g,t){ g.msg=t; g.msgT=1.8; }
function ctHurt(g,t){ g.hp--; g.shake=0.3; ctSay(g,t+' ❤️-1'); try{ navigator.vibrate&&navigator.vibrate(90); }catch(_){} if(g.hp<=0) mgEnd(CT,'hp'); }
// tapping a cart with no team chosen: wash a muddy one, else plug in / unplug
function ctFix(g,i){
  const c=g.carts[i], L=CT_LV[g.lv];
  if(c.st==='out') return ctSay(g,'#'+c.no+' 카트는 코스에 나가 있어요');
  if(c.st==='wash') return ctSay(g,'#'+c.no+' 카트 세차 중이에요 🫧');
  if(c.dirty){ c.st='wash'; c.t=L.wash; c.charging=false; return ctSay(g,'#'+c.no+' 카트 세차 시작 🫧'); }
  if(c.charging){ c.charging=false; return ctSay(g,'#'+c.no+' 충전 멈춤'); }
  if(c.bat>=99.5) return ctSay(g,'#'+c.no+' 배터리가 이미 가득해요 🔋');
  c.charging=true; ctSay(g,'#'+c.no+' 충전 시작 ⚡');
}
function ctSend(g,qi,ci){
  const m=g.q[qi], c=g.carts[ci], L=CT_LV[g.lv];
  if(c.st==='out') return ctSay(g,'#'+c.no+' 카트는 코스에 나가 있어요');
  if(c.st==='wash') return ctSay(g,'#'+c.no+' 카트는 세차 중이에요 🫧');
  if(m.size>c.cap) return ctSay(g,m.size+'명 팀은 5인승 카트에 태워야 해요');
  if(g.tee[m.course]>0) return ctSay(g,m.course+' 티가 아직 사용 중이에요 ('+g.tee[m.course].toFixed(1)+'초)');
  // off it goes
  g.q.splice(qi,1); g.sel=-1;
  c.charging=false; c.st='out'; c.t=mgRand(L.round[0],L.round[1]); c.drain=mgRand(L.drain[0],L.drain[1]);
  g.tee[m.course]=L.tee;
  const r=ctCartRect(ci), T=CT_TEE[m.course];
  g.fx.push({drive:1, k:0, x0:r.x+r.w/2, y0:r.y+44, x1:T.x+T.w-34, y1:T.y+T.h/2+6, cap:c.cap, life:1.1});
  if(c.dirty){ c.dirty=false; return ctHurt(g,'🟤 진흙 묻은 카트를 받은 손님이 화났어요'); }
  if(c.bat<CT_LOW){ c.stall=true; return ctHurt(g,'🔋 배터리 부족! 카트가 코스에서 멈췄어요'); }
  const pts=Math.round((10+5*Math.max(0,m.p/m.p0))*(m.vip?2:1));
  g.score+=pts; g.sent++;
  g.fx.push({x:T.x+T.w/2, y:T.y+12, t:'+'+pts+(m.vip?' 👑':''), col:'#fff4a8', life:1});
}

// ---------- 그리기 ----------
function ctPeople(c,n,cx,cy,col){
  const rows=n<=3?[n]:[Math.ceil(n/2),Math.floor(n/2)], s=9.5;
  rows.forEach((k,ri)=>{ for(let j=0;j<k;j++){ const x=cx+(j-(k-1)/2)*s*1.3, y=cy+(ri-(rows.length-1)/2)*s*1.55;
    c.beginPath(); c.arc(x,y-3,3.2,0,7); c.fillStyle='#ffd9b8'; c.fill();
    c.beginPath(); c.arc(x,y+4.2,4.6,Math.PI,0); c.fillStyle=col; c.fill(); } });
}
// a golf cart from the side (cap 5 = one seat longer)
function ctCartPic(c,x,y,cap,dirty,sc){
  sc=sc||1; c.save(); c.translate(x,y); c.scale(sc,sc);
  const L=cap===5?62:52, h=L/2;
  c.fillStyle='rgba(0,0,0,.15)'; c.beginPath(); c.ellipse(0,15,h+4,4,0,0,7); c.fill();
  // roof + posts
  c.fillStyle='#2f7a34'; mgRR(c,-h-2,-27,L+4,6,3); c.fill();
  c.strokeStyle='#7a7a7a'; c.lineWidth=2.2; c.beginPath(); c.moveTo(-h+3,-21); c.lineTo(-h+3,0); c.moveTo(h-8,-21); c.lineTo(h-4,0); c.stroke();
  // body
  c.fillStyle='#f6f2e6'; mgRR(c,-h,-2,L,13,5); c.fill(); c.strokeStyle='#d8d0bc'; c.lineWidth=1; c.stroke();
  c.fillStyle='#e9e2cf'; mgRR(c,h-12,-8,12,10,3); c.fill();   // front
  // seats
  c.fillStyle='#3a5f8a'; const seats=cap===5?3:2; for(let i=0;i<seats;i++){ mgRR(c,-h+5+i*15,-11,11,9,3); c.fill(); }
  // bag at the back
  c.fillStyle='#c94b43'; mgRR(c,-h-5,-14,7,14,2); c.fill();
  // wheels
  c.fillStyle='#2a2a2a'; [-h+9,h-9].forEach(wx=>{ c.beginPath(); c.arc(wx,11,5.5,0,7); c.fill(); c.fillStyle='#bbb'; c.beginPath(); c.arc(wx,11,2,0,7); c.fill(); c.fillStyle='#2a2a2a'; });
  if(dirty){ c.fillStyle='#7a5434'; [[-h+6,4,4],[ -4,7,3.5],[h-14,2,3],[-h+16,-1,2.5],[6,9,2.6]].forEach(([a,b,r])=>{ c.beginPath(); c.arc(a,b,r,0,7); c.fill(); }); }
  c.restore();
}
function ctDraw(c,g){
  const L=CT_LV[g.lv], now=performance.now()/1000;
  c.save(); if(g.shake>0) c.translate(mgRand(-3,3)*g.shake*5,mgRand(-3,3)*g.shake*5);
  // ground: clubhouse front (top) + parking lot (bottom)
  c.fillStyle='#e9efe2'; c.fillRect(0,0,MG_W,MG_H);
  c.fillStyle='#cfd8c4'; c.fillRect(0,232,MG_W,MG_H-232);
  c.strokeStyle='rgba(255,255,255,.7)'; c.lineWidth=2; for(let i=1;i<3;i++){ const x=CT_G.x+i*(CT_G.w+CT_G.gx)-CT_G.gx/2; c.beginPath(); c.moveTo(x,262); c.lineTo(x,MG_H-6); c.stroke(); }
  // HUD
  c.fillStyle='rgba(30,50,70,.82)'; mgRR(c,6,6,MG_W-12,32,12); c.fill();
  mgText(c,'🚗 '+g.score+'점',14,22,15,'#fff');
  c.font='14px sans-serif'; c.textBaseline='middle'; c.textAlign='left'; c.fillStyle='#000'; c.fillText('❤️'.repeat(Math.max(0,g.hp))+'🤍'.repeat(Math.max(0,CT_HP-g.hp)),112,22);
  mgText(c,'보냄 '+g.sent+'팀',190,22,13,'#d6ecff');
  mgText(c,'⏱ '+Math.ceil(g.t)+'초',MG_W-14,22,15,g.t<10?'#ffb0a8':'#fff','right');
  c.fillStyle='rgba(0,0,0,.12)'; c.fillRect(14,41,MG_W-28,3); c.fillStyle=g.t<10?'#ff8a80':'#7fc4ff'; c.fillRect(14,41,(MG_W-28)*g.t/CT_TIME,3);
  // waiting teams
  for(let i=0;i<CT_QMAX;i++){
    const r=ctQRect(i), m=g.q[i];
    if(!m){ c.strokeStyle='rgba(0,0,0,.12)'; c.setLineDash([4,5]); c.lineWidth=1.5; mgRR(c,r.x+.5,r.y+.5,r.w-1,r.h-1,12); c.stroke(); c.setLineDash([]); continue; }
    const k=m.p/m.p0, sel=g.sel===i, lift=sel?-4:0;
    c.fillStyle=sel?'#fff7d1':'#fff'; mgRR(c,r.x,r.y+lift,r.w,r.h,12); c.fill();
    c.lineWidth=sel?3:1.2; c.strokeStyle=sel?'#f2b64b':k<0.3&&Math.sin(now*12)>0?'#e8504a':'#d5dccd'; c.stroke();
    // course badge
    const oc=m.course==='VISTA'?'#2f7fd1':'#e8873a'; c.fillStyle=oc; mgRR(c,r.x+4,r.y+5+lift,37,16,8); c.fill(); mgText(c,m.course,r.x+22.5,r.y+13.5+lift,mgFit(c,m.course,32,9.5),'#fff','center',false);
    c.font='15px sans-serif'; c.fillStyle='#000'; c.textAlign='left'; c.fillText(k>0.6?'😊':k>0.3?'😐':'😠',r.x+r.w-21,r.y+14+lift);
    if(m.vip){ c.font='12px sans-serif'; c.fillText('👑',r.x+r.w/2-7,r.y+31+lift); }
    ctPeople(c,m.size,r.x+r.w/2,r.y+50+lift,m.vip?'#8a5cc9':'#5a8f4a');
    mgText(c,m.size+'명',r.x+r.w/2,r.y+73+lift,11,'#444','center',false);
    c.fillStyle='#eee'; mgRR(c,r.x+6,r.y+r.h-10+lift,r.w-12,5,2.5); c.fill();
    c.fillStyle=k>0.6?'#5cbf5a':k>0.3?'#f2b64b':'#e8504a'; mgRR(c,r.x+6,r.y+r.h-10+lift,(r.w-12)*Math.max(0,k),5,2.5); c.fill();
  }
  // tees
  ['VISTA','DUKE'].forEach(k=>{
    const T=CT_TEE[k], busy=g.tee[k];
    c.fillStyle=k==='VISTA'?'#dcebfa':'#fbe6d4'; mgRR(c,T.x,T.y,T.w,T.h,14); c.fill();
    c.fillStyle='#8fcf6c'; mgRR(c,T.x+T.w-58,T.y+10,48,T.h-20,8); c.fill();
    c.strokeStyle='#fff'; c.lineWidth=2; c.beginPath(); c.moveTo(T.x+T.w-30,T.y+T.h-14); c.lineTo(T.x+T.w-30,T.y+14); c.stroke();
    c.fillStyle='#e8504a'; c.beginPath(); c.moveTo(T.x+T.w-30,T.y+14); c.lineTo(T.x+T.w-16,T.y+19); c.lineTo(T.x+T.w-30,T.y+24); c.fill();
    mgText(c,'⛳ '+k+' 코스',T.x+10,T.y+18,13,k==='VISTA'?'#1f5c9c':'#b25d18',null,false);
    if(busy>0){ mgText(c,'⏳ 출발 중 '+busy.toFixed(1)+'초',T.x+10,T.y+42,12,'#666',null,false); c.fillStyle='rgba(0,0,0,.1)'; c.fillRect(T.x+10,T.y+52,T.w-80,3); c.fillStyle='#999'; c.fillRect(T.x+10,T.y+52,(T.w-80)*busy/L.tee,3); }
    else mgText(c,'✅ 출발 가능',T.x+10,T.y+42,12,'#2f7a34',null,false);
  });
  // message
  if(g.msgT>0){ c.globalAlpha=Math.min(1,g.msgT*2); const s=mgFit(c,g.msg,MG_W-50,13); c.font='800 '+s+'px '+MG_FONT; const w=c.measureText(g.msg).width+24; c.fillStyle='rgba(30,40,50,.85)'; mgRR(c,(MG_W-w)/2,226,w,26,13); c.fill(); mgText(c,g.msg,MG_W/2,239,s,'#fff','center',false); c.globalAlpha=1; }
  else mgText(c,g.sel>=0?'👇 이 손님을 태울 카트를 눌러 주세요':'🅿️ 카트 주차장 · 손님 없이 누르면 세차·충전',MG_W/2,242,12,g.sel>=0?'#c0392b':'#556',
    'center',false);
  // carts
  const selM=g.sel>=0?g.q[g.sel]:null;
  g.carts.forEach((ct,i)=>{
    const r=ctCartRect(i), out=ct.st==='out';
    const fit=selM&&!out&&ct.st!=='wash'&&ct.cap>=selM.size;
    c.fillStyle=out?'rgba(255,255,255,.35)':'#fff'; mgRR(c,r.x,r.y,r.w,r.h,14); c.fill();
    c.lineWidth=fit?2.5:1.2; c.strokeStyle=fit?'#f2b64b':'#c9d1bd'; c.stroke();
    mgText(c,'#'+ct.no,r.x+8,r.y+13,12,'#555',null,false);
    c.fillStyle=ct.cap===5?'#8a5cc9':'#5a8f4a'; mgRR(c,r.x+r.w-36,r.y+5,30,16,8); c.fill(); mgText(c,ct.cap+'인',r.x+r.w-21,r.y+13.5,10,'#fff','center',false);
    if(out){ c.globalAlpha=0.35; ctCartPic(c,r.x+r.w/2,r.y+50,ct.cap,false,1); c.globalAlpha=1; mgText(c,'🏌️ 운행 중 '+Math.ceil(ct.t)+'초',r.x+r.w/2,r.y+84,11,'#666','center',false); return; }
    ctCartPic(c,r.x+r.w/2,r.y+50,ct.cap,ct.dirty,1);
    if(ct.st==='wash'){ c.fillStyle='rgba(120,190,255,.25)'; mgRR(c,r.x+4,r.y+24,r.w-8,46,10); c.fill(); c.fillStyle='rgba(255,255,255,.9)'; for(let b=0;b<6;b++){ const a=now*2+b; c.beginPath(); c.arc(r.x+20+((b*17+now*20)%70),r.y+66-((now*30+b*9)%40),2.5+b%3,0,7); c.fill(); } }
    if(ct.shine>0){ c.globalAlpha=ct.shine; mgText(c,'✨',r.x+r.w-20,r.y+34,16,'#fff','center',false); c.globalAlpha=1; }
    // battery
    const bx=r.x+10, by=r.y+78, bw=r.w-34, low=ct.bat<CT_LOW;
    c.fillStyle='#e4e4e4'; mgRR(c,bx,by,bw,10,3); c.fill(); c.fillStyle='#bbb'; c.fillRect(bx+bw,by+3,3,4);
    c.fillStyle=low?'#e8504a':ct.bat<70?'#f2b64b':'#5cbf5a'; mgRR(c,bx,by,Math.max(4,bw*ct.bat/100),10,3); c.fill();
    mgText(c,Math.round(ct.bat)+'%',bx+bw+7,by+5,10,low?'#e8504a':'#555',null,false);
    const lbl=ct.st==='wash'?'🫧 세차 중 '+ct.t.toFixed(1)+'초':ct.dirty?'🟤 진흙! 눌러서 세차':ct.charging?'⚡ 충전 중':low?'🔋 배터리 부족':ct.back>0?'↩️ 돌아왔어요':'✅ 출발 가능';
    const lc=ct.st==='wash'?'#2f7fd1':ct.dirty?'#8a5a34':ct.charging?'#2f7a34':low?'#e8504a':'#2f7a34';
    if(ct.charging){ c.globalAlpha=0.6+0.4*Math.sin(now*6); }
    mgText(c,lbl,r.x+r.w/2,r.y+103,10.5,lc,'center',false); c.globalAlpha=1;
  });
  // carts driving off, points
  g.fx.forEach(f=>{
    if(f.drive){ const e=f.k<0.5?2*f.k*f.k:1-Math.pow(-2*f.k+2,2)/2, x=f.x0+(f.x1-f.x0)*e, y=f.y0+(f.y1-f.y0)*e; c.globalAlpha=Math.min(1,f.life*2); ctCartPic(c,x,y,f.cap,false,0.7); c.globalAlpha=1; return; }
    c.globalAlpha=Math.min(1,f.life*1.5); mgText(c,f.t,f.x,f.y,16,f.col||'#fff','center'); c.globalAlpha=1; });
  c.restore();
}
