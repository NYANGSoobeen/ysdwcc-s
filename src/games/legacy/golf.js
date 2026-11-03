// ⛳ 원터치 골프 (헤더 ⛳ 버튼 → 페이지 안 팝업)
// - 꾹 누르면 그쪽으로 조준 + 파워 게이지가 오르내림, 손을 떼면 침
//   그린 밖: 공이 날아가서(드라이버·아이언·러프·벙커에 따라 거리 다름) 떨어진 곳에서 조금 굴러감 / 그린 위: 퍼터로 굴림
// - 파3(화면 1개)·파4(2개)·파5(3개 길이) 홀: 티 → 페어웨이 → 그린, 벙커·물·나무·OB. 화면이 공을 따라 움직이고 오른쪽 위에 미니맵
// - 물·OB는 1벌타 후 친 자리로, 나무에 맞으면 그 자리에 떨어짐. 홀당 최대 파+5타
// - 코스는 18홀 고정(파72: 파3 4개·파4 10개·파5 4개), 🔄 새 게임마다 그중 9홀을 랜덤으로 골라 플레이
// - 🌬️ 새 게임을 시작할 때의 실제 바람(날씨 meta/weather의 풍속·풍향)이 공을 밀어 난이도가 됨 (화면 위쪽 = 북쪽)
// - 순위는 코스마다 파가 달라서 '파 대비 점수(-2, E, +3)'로 매김
// - 진행 상황·점수는 이 기기에 '직원(아이디)별로' 저장되어 창을 닫거나 새로고침해도 이어서 할 수 있음 (🔄 새 게임 전까지)
//   한 기기에서 다른 직원이 로그인하면 열려 있던 게임 창은 닫히고, 그 직원의 게임을 따로 불러옴
// - 🌧️ 비: 그린이 젖어 덜 굴러가고 물웅덩이(공이 확 느려짐)가 생김 / ❄️ 눈: 하드모드(잘 안 굴러감) + 눈더미(튕김)
// - 9홀을 다 돌면 최고 기록은 golfScores/{아이디}(모두 봄), 내 게임 내역은 golfMine/{아이디}(나만 봄)에 저장. 플레이 시각은 기록하지 않음
const GF_W=360, GF_H=520, GF_CUP=7, GF_BALL=5, GF_MAXV=380, GF_CV=2, GF_RV=4;   // GF_MAXV: 퍼터 최대 속도 · GF_CV: 코스 버전 · GF_RV: 기록 버전 (올리면 순위·내역·최고 기록 초기화, 기록 문서의 cv 칸에 적힘)
const GF_FRIC={green:190, fairway:430, tee:430, rough:900, sand:1150, puddle:2400};
// 클럽: 공이 놓인 곳에 따라 자동 (carry: 최대로 날아가는 거리, px)
const GF_CLUB={tee:{n:'드라이버', carry:430}, fairway:{n:'아이언', carry:360}, rough:{n:'러프 샷', carry:260}, sand:{n:'웨지 (벙커)', carry:170}, puddle:{n:'웨지', carry:200}};
const gfMaxStroke=h=>h.par+5;
// green: union of rects [x,y,w,h,radius] and circles [x,y,r]; over: green drawn on top of water (bridges, islands)
// slope: zones {r:[x,y,w,h], s:[sx,sy]} (px/s²)
// GF_HOLES: the first fixed course (old saved games and old records use its pars)
const GF_HOLES=[
  {par:2, tee:[180,450], cup:[180,110], green:[[70,60,220,440,40]], slope:[], sand:[], water:[], walls:[], tip:'몸풀기! 꾹 눌러서 파워를 맞춰 보세요'},
  {par:2, tee:[100,450], cup:[262,118], green:[[40,60,280,440,40]], slope:[{r:[0,0,360,520], s:[-55,0]}], sand:[], water:[], walls:[], tip:'오른쪽 → 왼쪽 경사! 오른쪽을 보고 치세요'},
  {par:2, tee:[180,462], cup:[180,98], green:[[60,50,240,460,40]], slope:[], sand:[[180,285,48]], water:[], walls:[], tip:'가운데 벙커를 피해서'},
  {par:3, tee:[105,445], cup:[285,115], green:[[40,55,135,435,30],[40,55,290,150,30]], slope:[], sand:[[300,250,36]], water:[], walls:[], tip:'꺾이는 홀 · 두 번에 나눠 쳐도 OK'},
  {par:2, tee:[180,462], cup:[180,92], green:[[50,45,260,460,40]], slope:[], sand:[], water:[[0,250,148,48],[212,250,148,48]], walls:[], tip:'물에 빠지면 1벌타! 가운데 다리로'},
  {par:2, tee:[180,455], cup:[180,105], green:[[60,50,240,450,40]], slope:[{r:[0,0,360,280], s:[0,70]}], sand:[], water:[], walls:[], tip:'오르막! 위쪽은 내려오는 경사예요'},
  {par:3, tee:[180,462], cup:[180,110], green:[[40,55,280,450,30]], slope:[], sand:[], water:[], walls:[[95,265,170,22]], tip:'벽에 맞으면 튕겨요 · 옆으로 돌아가거나 벽을 이용'},
  {par:2, tee:[95,455], cup:[245,105], green:[[40,50,280,450,40]], slope:[{r:[0,0,180,520], s:[45,0]},{r:[180,0,180,520], s:[-45,0]}], sand:[[290,150,30]], water:[], walls:[], tip:'양쪽에서 가운데로 모이는 그릇 경사'},
  {par:3, tee:[180,460], cup:[180,135], green:[[100,370,160,130,30]], over:[[164,215,32,170,10],[180,140,82]], slope:[], sand:[], water:[[0,0,360,375]], walls:[], tip:'마지막! 섬 그린 · 좁은 다리를 건너세요'}
];
// ---- 18홀 코스 (고정 씨드): 파 3·4·5마다 길이·모양이 다르고, 페어웨이(도그레그)·벙커·물·나무를 랜덤 배치 ----
const gfSegD=(x,y,a,b)=>{ const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy||1; let t=((x-a[0])*dx+(y-a[1])*dy)/l; t=Math.max(0,Math.min(1,t)); return Math.hypot(x-a[0]-t*dx, y-a[1]-t*dy); };
const gfFwD=(h,x,y)=>{ let m=1e9; const p=h.fw.pts; for(let i=0;i<p.length-1;i++) m=Math.min(m,gfSegD(x,y,p[i],p[i+1])); return m; };
function gfMakeHole(par, no, rnd){
  const R=(a,b)=>a+rnd()*(b-a), cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const L=Math.round(par===3?R(580,660):par===4?R(980,1100):R(1380,1500));
  const tee=[Math.round(R(140,220)), L-55], gr=Math.round(par===3?R(50,60):R(56,70));
  const green=[Math.round(R(105,255)), Math.round(R(105,130)), gr];
  let pts, w;
  if(par===3){ pts=[[green[0],green[1]+gr+110],[green[0],green[1]]]; w=78; }
  else if(par===4){ const my=tee[1]-R(400,460); pts=[[tee[0],tee[1]-25],[cl(tee[0]+R(-110,110),70,290),my],[green[0],green[1]]]; w=R(96,124); }
  else { const y1=tee[1]-R(410,460), y2=y1-R(400,450); pts=[[tee[0],tee[1]-25],[cl(tee[0]+R(-100,100),70,290),y1],[cl(180+R(-110,110),70,290),y2],[green[0],green[1]]]; w=R(100,124); }
  pts=pts.map(q=>q.map(Math.round)); w=Math.round(w);
  const h={v:GF_CV, par, L, no, tee, green, cup:[Math.round(green[0]+R(-.4,.4)*gr), Math.round(green[1]+R(-.35,.35)*gr)], fw:{pts,w}, sand:[], water:[], trees:[], slope:[], walls:[], over:[]};
  // 그린 옆 벙커 1~2개 (아래쪽·옆쪽)
  const nb=rnd()<0.5?2:1, used=[];
  for(let k=0;k<nb;k++){ let a; do{ a=R(150,390)*Math.PI/180; }while(used.some(u=>Math.abs(u-a)<0.9)); used.push(a);
    const r=Math.round(R(15,22)), d=gr+r-4; h.sand.push([Math.round(green[0]+Math.cos(a)*d), Math.round(green[1]+Math.sin(a)*d*.9+gr*.15), r]); }
  // 티샷 떨어지는 곳 근처 페어웨이 벙커 (파4·5)
  if(par>3&&rnd()<0.75){ const q=pts[1], side=rnd()<0.5?-1:1, r=Math.round(R(20,28)); h.sand.push([Math.round(cl(q[0]+side*(w/2+r*0.35),r+5,355-r)), Math.round(q[1]+R(-30,40)), r]); }
  // 물: 파3은 그린 앞을 가로지르는 연못, 파4는 그린 앞이나 옆, 파5는 중간을 가로지르는 개울
  const wr=rnd(); let water=null;
  if(par===3&&wr<0.5){ const y=Math.round(R(green[1]+gr+60, tee[1]-170)); water=[0,y,360,Math.round(R(50,75))]; }
  else if(par===4&&wr<0.35){ water=[0,Math.round(green[1]+gr+R(55,110)),360,48]; }
  else if(par===4&&wr<0.6){ const q=pts[1], left=q[0]>180; water=left?[0,Math.round(q[1]-150),Math.round(Math.max(40,q[0]-w/2-25)),200]:[Math.round(Math.min(320,q[0]+w/2+25)),Math.round(q[1]-150),360,200]; if(!left) water[2]=360-water[0]; }
  else if(par===5&&wr<0.55){ const y=Math.round((pts[1][1]+pts[2][1])/2+R(-40,40)); water=[0,y,360,Math.round(R(44,60))]; }
  if(water) h.water.push(water);
  // 나무: 페어웨이·그린·티·물에서 떨어진 러프에
  const want=par*3+Math.round(R(0,4));
  for(let t=0;t<400&&h.trees.length<want;t++){
    const x=R(14,346), y=R(40,L-30), r=Math.round(R(13,20));
    if(gfFwD(h,x,y)<w/2+r+6||Math.hypot(x-green[0],y-green[1])<gr+r+18||Math.hypot(x-tee[0],y-tee[1])<r+50) continue;
    if(h.water.some(q=>x>q[0]-r&&x<q[0]+q[2]+r&&y>q[1]-r&&y<q[1]+q[3]+r)||h.sand.some(q=>Math.hypot(x-q[0],y-q[1])<q[2]+r+4)||h.trees.some(q=>Math.hypot(x-q[0],y-q[1])<q[2]+r+4)) continue;
    h.trees.push([Math.round(x),Math.round(y),r]);
  }
  // 그린 경사
  if(rnd()<0.65){ const m=Math.round(R(25,50)), d=Math.floor(rnd()*4); h.slope.push({r:[green[0]-gr-12,green[1]-gr-12,2*gr+24,2*gr+24], s:[[m,0],[-m,0],[0,m],[0,-m]][d]}); }
  h.tip=(par===3?'파 3 · 그린까지 한 번에!':par===4?'파 4 · 티샷 → 두 번째 샷으로 그린':'파 5 · 긴 홀! 세 번에 나눠 그린으로')+(h.water.length?' · 물 조심':'');
  return h;
}
const GF_COURSE=(()=>{
  let a=20261016; const rnd=()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  return [4,3,5,4,4,3,4,5,4, 4,3,4,5,4,3,4,4,5].map((par,i)=>gfMakeHole(par,i+1,rnd));
})();
// 9 random holes of the 18, played in course order
function gfPickNine(){
  const idx=GF_COURSE.map((_,i)=>i);
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return idx.slice(0,9).sort((x,y)=>x-y);
}
const gf={st:null, ball:null, vel:null, moving:false, aim:null, holding:false, holdT:0, power:0, raf:0, last:0, msg:'', msgT:0, prev:null, cv:null, ctx:null, dpr:1, sunk:false};
const gfUid=()=>{ try{ const u=firebase.auth().currentUser; return u?u.uid:null; }catch(e){ return null; } };
// whose game: the login ID (stays the same after a password reset, unlike the uid)
const gfMe=()=>(typeof myAccount!=='undefined'&&myAccount&&myAccount.loginId)||null;
const gfKey=()=>'ydr_golf_p_'+gfMe();
function gfLoad(){
  const me=gfMe(); if(!me) return null;
  try{
    localStorage.removeItem('ydr_golf_me');   // the first version saved every staff member's game under one name
    let st=JSON.parse(localStorage.getItem(gfKey())||'null');
    const old='ydr_golf_'+gfUid();
    if(!st){ st=JSON.parse(localStorage.getItem(old)||'null'); if(st) st.owner=me; }   // saved by uid before
    localStorage.removeItem(old);
    return st&&st.owner===me?st:null;
  }catch(e){ return null; }
}
function gfSave(){ const st=gf.st, me=gfMe(); if(!st||!me||st.owner!==me) return; try{ localStorage.setItem(gfKey(), JSON.stringify(st)); }catch(e){} }
function gfFresh(bestD){ return {cv:GF_CV, rv:GF_RV, owner:gfMe(), hole:0, ball:null, strokes:0, scores:[], bestD:bestD==null?null:bestD, done:false, picks:gfPickNine(), wind:null, wx:null, seed:Math.floor(Math.random()*1e9)}; }
const gfHoles=()=>gf.st.picks?gf.st.picks.map(i=>GF_COURSE[i]):(gf.st.holes||GF_HOLES);
const gfNos=()=>gfHoles().map((h,i)=>h.no||i+1);
// ---- 🌬️ wind: today's wind when the game started (speed m/s, VEC = where it blows from) ----
const GF_DIRS=['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'];
const gfDirName=d=>GF_DIRS[Math.round(((+d%360)+360)%360/22.5)%16]+'풍';
const gfLevel=s=>s==null?'바람 정보 없음':s<2?'쉬움':s<5?'보통':s<9?'어려움':'매우 어려움';
function gfWindVec(){ const w=gf.st&&gf.st.wind; if(!w||!w.s) return [0,0];
  const m=Math.min(w.s*10,110), a=((+w.d||0)+180)*Math.PI/180; return [Math.sin(a)*m, -Math.cos(a)*m]; }
const gfWindTxt=w=>!w?'🌬️ 바람 정보 없음 (바람 없이 플레이)':w.s<0.5?'🌬️ 오늘 바람 없음 · 난이도 쉬움':'🌬️ 오늘 바람 '+gfDirName(w.d)+' '+(+w.s).toFixed(1)+'m/s · 난이도 '+gfLevel(w.s);
// meta/weather 가 10분 넘게 묵었으면 기상청 자료를 새로 받아 달라고 하고 잠깐(최대 8초) 기다림
async function gfFreshWeather(){
  const ref=db.doc('meta/weather'), s=await ref.get(), d=s.exists?s.data():{};
  if(Date.now()-(d.at||0)<10*60*1000||typeof wxAsk!=='function') return d;
  const asked=Date.now(); wxAsk(false);
  return await new Promise(res=>{ let un=null; const done=v=>{ clearTimeout(tm); if(un) un(); res(v); };
    const tm=setTimeout(()=>done(d),8000);
    un=ref.onSnapshot(x=>{ const v=x.exists?x.data():{}; if((v.at||0)>=asked-1000&&!v.busyUntil) done(v); },()=>done(d)); });
}
// 지금 날씨를 게임에 적용: 새 게임, 골프를 열 때(그 홀을 아직 안 쳤으면), 다음 홀로 넘어갈 때 — 비가 오기 시작하면 바로 비 오는 코스로
async function gfFetchWind(){
  const st=gf.st, before=st.wx?st.wx.k:'';
  try{ const d=await gfFreshWeather(); const c=wxCurrent(d);   // 지금 날씨 (날씨 탭과 같은 실시간 관측)
    if(c.ws!=null) st.wind={s:Math.round(c.ws*10)/10, d:c.wdeg||0};
    // 강수형태 PTY: 1 비, 2 비/눈, 4 소나기, 5 빗방울, 6 빗방울눈날림 → 비 / 3 눈, 7 눈날림 → 눈
    const pty=c.pty, mm=c.mm;
    if(c.a||(c.n&&c.n.t)||c.ul.length){   // 날씨 자료가 있을 때만 (못 받았으면 그대로)
      if([1,2,4,5,6].includes(pty)) st.wx={k:'rain', mm:Math.max(mm,0.5)}; else if([3,7].includes(pty)) st.wx={k:'snow', mm}; else st.wx=null;
    }
  }catch(e){}
  if(gf.st!==st) return;
  gfSave(); gfWindLbl(); gf.haz=null;
  const now=st.wx?st.wx.k:'';
  if((st.scores.length||st.strokes)&&now!==before){ gfShow(now==='rain'?'🌧️ 비가 와요 · 그린이 젖었어요':now==='snow'?'❄️ 눈이 와요 · 하드모드!':'☀️ 비가 그쳤어요', 2.6); return; }
  if(!st.scores.length&&!st.strokes){ if(st.wx) gfShow(st.wx.k==='rain'?'🌧️ 비 오는 날 · 그린이 젖었어요':'❄️ 눈 오는 날 · 하드모드!', 2.8); else if(st.wind) gfShow(gfWindTxt(st.wind).replace('오늘 바람 ',''), 2.6); }
}
const gfWxTxt=x=>!x?'':x.k==='rain'?'🌧️ 비 '+(+x.mm).toFixed(1)+'mm · 그린이 젖어 덜 굴러가요 · 물웅덩이 조심! · ':'❄️ 눈 · 공이 잘 안 굴러가요(하드모드) · 눈더미에 튕겨요 · ';
function gfWindLbl(){ const el=document.getElementById('gfWind'); if(el) el.textContent=gf.st.wind===undefined?'🌬️ 날씨를 불러오는 중…':gfWxTxt(gf.st.wx)+gfWindTxt(gf.st.wind).replace(/^🌬️ 오늘 바람 없음 · 난이도 쉬움$/, gf.st.wx?'🌬️ 바람 없음':'$&'); }
// ---- 🌧️ puddles / ❄️ snow piles: fixed per game and hole (seeded), never on the tee, the cup or other hazards ----
function gfHaz(){
  const st=gf.st, wx=st&&st.wx; if(!wx) return {puddles:[], piles:[]};
  const key=st.seed+':'+st.hole+':'+wx.k; if(gf.haz&&gf.haz.key===key) return gf.haz;
  let a=(st.seed||1)+st.hole*7919; const rnd=()=>{ a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  const h=gfHole(), out={key, puddles:[], piles:[]}, list=wx.k==='rain'?out.puddles:out.piles;
  const want=(wx.k==='rain'?(wx.mm>=5?4:3):3)+((h.par||3)-3)*2;
  for(let tries=0; tries<200&&list.length<want; tries++){
    const x=30+rnd()*300, y=60+rnd()*((h.L||GF_H)-140), rx=wx.k==='rain'?18+rnd()*14:13+rnd()*7, ry=wx.k==='rain'?rx*0.5:rx;
    const far=(p,d)=>Math.hypot(x-p[0],y-p[1])>d+rx;
    if(!far(h.tee,26)||!far(h.cup,30)) continue;
    let ok=true; for(let k=-1;k<=1&&ok;k++) for(let m=-1;m<=1&&ok;m++){ const sf=gfSurface0(x+k*rx,y+m*ry); if(sf!=='green'&&sf!=='fairway') ok=false; }
    if(!ok||(h.walls||[]).some(w=>x>w[0]-rx-8&&x<w[0]+w[2]+rx+8&&y>w[1]-ry-8&&y<w[1]+w[3]+ry+8)) continue;
    if(list.some(q=>Math.hypot(x-q[0],y-q[1])<rx+q[2]+14)) continue;
    list.push([Math.round(x),Math.round(y),Math.round(rx),Math.round(ry)]);
  }
  gf.haz=out; return out;
}
// how much more the ground holds the ball back in this weather
function gfWxFric(surf){ const x=gf.st&&gf.st.wx; if(!x||surf==='puddle') return 1;
  if(x.k==='rain') return surf==='green'?Math.min(1.4,1.15+Math.min(x.mm,10)*0.025):surf==='sand'?1.3:1.1;
  return surf==='green'?1.75:1.3; }
const gfPars=()=>gfHoles().map(h=>h.par);
const gfHole=()=>gfHoles()[gf.st.hole];
const gfInRect=(x,y,r)=>x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];
const gfInShape=(x,y,g)=>g.length===3?Math.hypot(x-g[0],y-g[1])<=g[2]:gfInRect(x,y,g);
function gfSurface(x,y){
  const s=gfSurface0(x,y);
  if((s==='green'||s==='fairway')&&gfHaz().puddles.some(q=>((x-q[0])/q[2])**2+((y-q[1])/q[3])**2<=1)) return 'puddle';
  return s;
}
function gfSurface0(x,y){
  const h=gfHole();
  if(x<0||x>GF_W||y<0||y>h.L) return 'ob';
  if(h.sand.some(s=>Math.hypot(x-s[0],y-s[1])<=s[2])) return 'sand';
  if(h.water.some(w=>gfInRect(x,y,w))) return 'water';
  if(Math.hypot(x-h.green[0],y-h.green[1])<=h.green[2]) return 'green';
  if(Math.abs(x-h.tee[0])<=30&&Math.abs(y-h.tee[1])<=20) return 'tee';
  return gfFwD(h,x,y)<=h.fw.w/2?'fairway':'rough';
}
function gfSlope(x,y){ let sx=0, sy=0; (gfHole().slope||[]).forEach(z=>{ if(gfInRect(x,y,z.r)){ sx+=z.s[0]; sy+=z.s[1]; } }); return [sx,sy]; }

function openGolf(mode){
  if(!gfMe()) return;
  if(gf.who!==gfMe()){ gf.st=null; gf.who=gfMe(); }   // another staff member logged in on this device
  if(!gf.st){ gf.st=gfLoad(); if(!gf.st){ gf.st=gfFresh(); gfFetchWind(); } }
  if(gf.st.owner!==gfMe()) gf.st.owner=gfMe();
  if(gf.st.rv!==GF_RV){ gf.st.bestD=null; gf.st.rv=GF_RV; gfSave(); }   // 기록이 초기화되면 내 최고 기록도 초기화
  if(gf.st.cv!==GF_CV){ gf.st=gfFresh(null); gfSave(); gfFetchWind(); gf.newCourseMsg=true; }   // 코스가 바뀌기 전 게임은 새로 시작
  if(gf.st.bestD===undefined){ gf.st.bestD=gf.st.best!=null?gf.st.best-GF_PAR:null; delete gf.st.best; }   // saved before random courses
  if(!gf.st.done && gf.st.scores[gf.st.hole]!=null){ gf.st.hole++; gf.st.ball=null; }   // closed right after holing out
  let bg=document.getElementById('golfBg');
  if(!bg){
    bg=document.createElement('div'); bg.className='modal-bg'; bg.id='golfBg';
    bg.innerHTML='<div class="modal golfModal"><div class="gfTop"><div class="gfTitleBox"><b>⛳ 원터치 골프</b><span class="gfBest" id="gfBest"></span></div><button class="gfRankBtn" id="gfRankBtn">🏆 순위표</button><button class="gfNew" id="gfNew">🔄 새 게임</button><button class="gfX" id="gfX" title="닫기">✕</button></div>'
      +'<div class="gfRank" id="gfRank" style="display:none"></div><div class="gfPlay" id="gfPlay"><div class="gfWind" id="gfWind"></div><canvas id="gfCv"></canvas><div class="gfCard" id="gfCard"></div><div class="gfHelp"><b>꾹 누르면</b> 그쪽으로 조준하고 파워가 차요. <b>손을 떼면</b> 쳐요. 그린 밖에선 공이 날아가고(동그라미 = 떨어질 곳), 그린 위에선 굴러가요.</div></div></div>';
    document.body.appendChild(bg);
    gf.cv=document.getElementById('gfCv'); gf.ctx=gf.cv.getContext('2d');
    document.getElementById('gfX').onclick=closeGolf;
    document.getElementById('gfNew').onclick=gfNewGame;
    document.getElementById('gfRankBtn').onclick=()=>gfRankToggle();
    const cv=gf.cv;
    cv.addEventListener('pointerdown',gfDown); cv.addEventListener('pointermove',gfMove);
    cv.addEventListener('pointerup',gfUp); cv.addEventListener('pointercancel',()=>{ gf.holding=false; });
    cv.addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&bg.style.display==='flex') closeGolf(); });
  }
  clearTimeout(gf.closeT); bg.classList.remove('gfClosing'); bg.style.display='flex'; gfRankToggle(mode==='rank');
  scoreRetry('golfScores',(...a)=>gfUpload(...a));
  gfSize(); gfStartHole(false); gfCard(); gfWindLbl();
  if(!gf.st.done&&!gf.st.strokes) gfFetchWind();   // 이 홀을 아직 안 쳤으면 지금 날씨로
  cancelAnimationFrame(gf.raf); gf.last=performance.now(); gf.raf=requestAnimationFrame(gfLoop);
}
function closeGolf(){
  const bg=document.getElementById('golfBg');
  if(bg&&bg.style.display==='flex'){ bg.classList.add('gfClosing'); clearTimeout(gf.closeT); gf.closeT=setTimeout(()=>{ bg.style.display='none'; bg.classList.remove('gfClosing'); },200); }
  cancelAnimationFrame(gf.raf); gf.raf=0; gf.holding=false;
  if(gf.moving&&gf.st){ gf.moving=false; gfStopped(); }   // a rolling ball is settled where it is
}
async function gfNewGame(){
  if(!gf.st.done && (gf.st.scores.length||gf.st.strokes) && !(await uiConfirm('지금까지의 기록을 지우고 1번 홀부터 새로 시작할까요?','새 게임'))) return;
  gf.st=gfFresh(gf.st.bestD); gfSave(); gfStartHole(false); gfCard(); gfWindLbl(); gfFetchWind();
}
function gfSize(){
  const cv=gf.cv, wrap=cv.parentElement;
  // fit inside the popup without scrolling (a scrollbar would also eat width and add a sideways scroll)
  const maxW=Math.min(wrap.clientWidth-20, 420), maxH=Math.max(220, Math.min(window.innerHeight*0.66, window.innerHeight*0.94-190));
  const sc=Math.min(maxW/GF_W, maxH/GF_H);
  cv.style.width=Math.round(GF_W*sc)+'px'; cv.style.height=Math.round(GF_H*sc)+'px';
  gf.dpr=Math.min(3,(window.devicePixelRatio||1)*sc);
  cv.width=Math.round(GF_W*gf.dpr); cv.height=Math.round(GF_H*gf.dpr);
}
window.addEventListener('resize',()=>{ const bg=document.getElementById('golfBg'); if(bg&&bg.style.display==='flex') gfSize(); });
function gfStartHole(reset){
  const h=gfHole(); if(reset||!gf.st.ball) { gf.st.ball=h.tee.slice(); gf.st.strokes=0; }
  gf.ball={x:gf.st.ball[0], y:gf.st.ball[1]}; gf.vel={x:0,y:0}; gf.moving=false; gf.fly=null; gf.sunk=false; gf.holding=false;
  gf.cam=gfCamFor(gf.ball.y);
  if(gf.newCourseMsg){ gf.newCourseMsg=false; gfShow('⛳ 새 코스! 파3·파4·파5 홀이 생겼어요', 3); }
  else if(!gf.st.done) gfShow(h.tip, 2.6);
}
const gfCamFor=y=>Math.max(0,Math.min(((gfHole()&&gfHole().L)||GF_H)-GF_H, y-GF_H*0.62));   // 공이 화면 아래쪽 2/3쯤 오게
function gfShow(t, sec){ gf.msg=t; gf.msgT=sec||1.6; }
function gfPos(e){ const r=gf.cv.getBoundingClientRect(); return {x:(e.clientX-r.left)*GF_W/r.width, y:(e.clientY-r.top)*GF_H/r.height+(gf.cam||0)}; }   // 화면 → 코스 좌표
function gfDown(e){
  e.preventDefault(); if(gf.moving||gf.fly||gf.sunk||gf.st.done) return;
  try{ gf.cv.setPointerCapture(e.pointerId); }catch(_){}
  gf.holding=true; gf.holdT=0; gf.power=0; gf.aim=gfPos(e);
}
function gfMove(e){ if(gf.holding) gf.aim=gfPos(e); }
function gfUp(e){
  if(!gf.holding) return; gf.holding=false;
  const dx=gf.aim.x-gf.ball.x, dy=gf.aim.y-gf.ball.y, d=Math.hypot(dx,dy);
  if(d<4||gf.power<0.02) return;
  gf.prev=[gf.ball.x, gf.ball.y]; gf.st.strokes++; gfCard();
  const lie=gfSurface(gf.ball.x,gf.ball.y);
  if(lie==='green'){ const v=GF_MAXV*gf.power; gf.vel={x:dx/d*v, y:dy/d*v}; gf.moving=true; gf.chip=false; return; }   // 퍼팅: 굴림
  // 샷: 공이 날아감 (바람에 밀림)
  const club=GF_CLUB[lie]||GF_CLUB.rough, dist=club.carry*gf.power, T=0.55+0.9*gf.power, [wx,wy]=gfWindVec();
  gf.fly={x0:gf.ball.x, y0:gf.ball.y, x1:gf.ball.x+dx/d*dist+wx*T*0.35, y1:gf.ball.y+dy/d*dist+wy*T*0.35, T, t:0, H:18+50*gf.power, ux:dx/d, uy:dy/d, p:gf.power};
}
// 날아가던 공이 떨어짐
function gfLand(){
  const f=gf.fly, b=gf.ball, h=gfHole(); gf.fly=null; b.x=f.x1; b.y=f.y1;
  const back=why=>{ gf.st.strokes++; b.x=gf.prev[0]; b.y=gf.prev[1]; gf.vel={x:0,y:0}; gfShow(why,1.8); gfStopped(); gfCard(); };
  const s=gfSurface(b.x,b.y);
  if(s==='ob') return back('🚩 OB! 1벌타 · 친 자리에서 다시');
  if(s==='water') return back('💦 퐁당! 1벌타 · 친 자리에서 다시');
  const tr=h.trees.find(q=>Math.hypot(b.x-q[0],b.y-q[1])<q[2]+2);
  if(tr){ const dx=f.x0-tr[0], dy=f.y0-tr[1], d=Math.hypot(dx,dy)||1; b.x=tr[0]+dx/d*(tr[2]+GF_BALL+2); b.y=tr[1]+dy/d*(tr[2]+GF_BALL+2); gfShow('🌳 나무에 맞았어요',1.4); gfStopped(); return; }
  if(s==='green'&&Math.hypot(b.x-h.cup[0],b.y-h.cup[1])<GF_CUP*0.6){ gfSink(); return; }   // 바로 컵에 쏙 (아주 드물게)
  if(s==='sand'||s==='puddle'){ gfStopped(); return; }
  const v=s==='green'?60+80*f.p:s==='rough'?30+40*f.p:100+150*f.p;   // 떨어진 뒤 굴러가는 힘
  gf.vel={x:f.ux*v, y:f.uy*v}; gf.moving=true; gf.chip=true;   // 샷 뒤에 굴러가는 공은 컵에 잘 안 들어감
}
function gfStep(dt){
  const b=gf.ball, v=gf.vel, h=gfHole();
  const surf=gfSurface(b.x,b.y);
  if(surf==='water'||surf==='ob'){ gf.moving=false; gf.st.strokes++; b.x=gf.prev[0]; b.y=gf.prev[1]; v.x=v.y=0; gfShow(surf==='ob'?'🚩 OB! 1벌타':'💦 퐁당! 1벌타',1.6); gfStopped(); gfCard(); return; }
  const [sx,sy]=surf==='green'?gfSlope(b.x,b.y):[0,0], [wx0,wy0]=gfWindVec(), wk=surf==='green'?1:0.3, wx=wx0*wk, wy=wy0*wk;
  v.x+=(sx+wx)*dt; v.y+=(sy+wy)*dt;
  let sp=Math.hypot(v.x,v.y);
  const dec=GF_FRIC[surf]*gfWxFric(surf)*dt;
  if(sp<=dec||sp<4){ v.x=v.y=0; gf.moving=false; gfStopped(); return; }
  v.x-=v.x/sp*dec; v.y-=v.y/sp*dec; sp-=dec;
  b.x+=v.x*dt; b.y+=v.y*dt;
  // trees: round bumpers
  h.trees.forEach(q=>{ const dx=b.x-q[0], dy=b.y-q[1], d=Math.hypot(dx,dy), r=q[2]+GF_BALL;
    if(d<r&&d>0){ const nx=dx/d, ny=dy/d; b.x=q[0]+nx*r; b.y=q[1]+ny*r; const dot=v.x*nx+v.y*ny; if(dot<0){ v.x=(v.x-2*dot*nx)*0.4; v.y=(v.y-2*dot*ny)*0.4; } } });
  // walls
  (h.walls||[]).forEach(w=>{
    const cx=Math.max(w[0],Math.min(b.x,w[0]+w[2])), cy=Math.max(w[1],Math.min(b.y,w[1]+w[3]));
    const dx=b.x-cx, dy=b.y-cy, d=Math.hypot(dx,dy);
    if(d<GF_BALL){
      const nx=d?dx/d:0, ny=d?dy/d:(b.y<w[1]+w[3]/2?-1:1);
      b.x=cx+nx*GF_BALL; b.y=cy+ny*GF_BALL;
      const dot=v.x*nx+v.y*ny; if(dot<0){ v.x=(v.x-2*dot*nx)*0.7; v.y=(v.y-2*dot*ny)*0.7; }
    }
  });
  // snow piles: round bumpers
  gfHaz().piles.forEach(q=>{ const dx=b.x-q[0], dy=b.y-q[1], d=Math.hypot(dx,dy), r=q[2]+GF_BALL;
    if(d<r&&d>0){ const nx=dx/d, ny=dy/d; b.x=q[0]+nx*r; b.y=q[1]+ny*r; const dot=v.x*nx+v.y*ny; if(dot<0){ v.x=(v.x-2*dot*nx)*0.5; v.y=(v.y-2*dot*ny)*0.5; } } });
  // cup
  const cd=Math.hypot(b.x-h.cup[0], b.y-h.cup[1]);
  if(cd<GF_CUP&&surf==='green'){
    if(gf.chip?(sp<90&&cd<GF_CUP*0.75):sp<330){ gfSink(); return; }
    // too fast: lips out, slowed and pulled a little
    v.x*=0.6; v.y*=0.6; v.x+=(h.cup[0]-b.x)*8; v.y+=(h.cup[1]-b.y)*8;
  }
}
function gfStopped(){ gf.st.ball=[gf.ball.x, gf.ball.y];
  const mx=gfMaxStroke(gfHole()); if(!gf.sunk && gf.st.strokes>=mx){ gfShow(mx+'타 · 다음 홀로 넘어가요',1.6); gfFinishHole(mx); return; }
  gfSave();
}
function gfSink(){
  const h=gfHole(), n=gf.st.strokes; gf.moving=false; gf.sunk=true; gf.ball.x=h.cup[0]; gf.ball.y=h.cup[1];
  const d=n-h.par;
  const name=n===1?'🎉 홀인원!!':d<=-2?'🦅 이글!':d===-1?'🐦 버디!':d===0?'👍 파!':d===1?'보기':d===2?'더블 보기':'+'+d;
  gfShow(name, 1.6); gfFinishHole(n);
}
function gfFinishHole(n){
  gf.st.scores[gf.st.hole]=n; gf.st.ball=null;
  if(gf.st.hole>=gfHoles().length-1){
    gf.st.done=true; const tot=gfTotal(), pars=gfPars(), dd=tot-pars.reduce((a,b)=>a+b,0); gfUpload(tot, gf.st.scores.slice(), pars, gf.st.picks?gfNos():null, gf.st.wind?gf.st.wind.s:null, gf.st.wx?gf.st.wx.k:null);
    if(gf.st.bestD==null||dd<gf.st.bestD){ gf.st.bestD=dd; setTimeout(()=>gfShow('🏆 최고 기록! '+tot+'타 ('+gfDiff(dd)+')',4),1700); }
    else setTimeout(()=>gfShow('🏁 끝! '+tot+'타 ('+gfDiff(dd)+')',4),1700);
    gfSave(); gfCard(); return;
  }
  gfSave(); gfCard();
  const st=gf.st;
  setTimeout(()=>{ if(gf.st===st&&!st.done&&st.scores[st.hole]!=null){ gf.st.hole++; gfSave(); gfStartHole(true); gfCard(); gfFetchWind(); } },1500);
}
// scorecard cells: 9 holes + total (cur: the hole being played, shown with its strokes so far)
function gfCardHtml(scores, cur, curStrokes, pars, nos){
  pars=pars||GF_HOLES.map(h=>h.par);
  const cells=pars.map((par,i)=>{ const h={par};
    const s=scores[i], isCur=i===cur;
    const cls=s==null?'':s<h.par?'under':s===h.par?'par':'over';
    return '<div class="gfCell'+(isCur?' cur':'')+'"><span>'+(nos?nos[i]+'번':i+1)+'</span><i>파'+h.par+'</i><b class="'+cls+'">'+(s!=null?s:isCur?(curStrokes||'·'):'')+'</b></div>';
  }).join('');
  const tot=scores.reduce((a,b)=>a+(b||0),0), par=scores.reduce((a,b,i)=>a+(b!=null?pars[i]:0),0);
  return cells+'<div class="gfCell tot"><span>합계</span><i>'+(scores.length?gfDiff(tot-par):'')+'</i><b>'+(tot||'')+'</b></div>';
}
const gfDiff=d=>d>0?'+'+d:d===0?'E':String(d);
const GF_PAR=GF_HOLES.reduce((a,h)=>a+h.par,0);   // the first fixed course
const gfTotal=()=>gf.st.scores.reduce((a,b)=>a+(b||0),0);
function gfCard(){
  const el=document.getElementById('gfCard'); if(!el) return;
  el.innerHTML=gfCardHtml(gf.st.scores, gf.st.done?-1:gf.st.hole, gf.st.strokes, gfPars(), gf.st.picks?gfNos():null);
  document.getElementById('gfBest').textContent=gf.st.bestD!=null?'🏆 최고 '+gfDiff(gf.st.bestD):'';
}
function gfLoop(t){
  if(gf.who!==gfMe()){ gf.moving=false; gf.st=null; gf.raf=0; const bg=document.getElementById('golfBg'); if(bg) bg.style.display='none'; return; }   // logged out / another staff member
  const dt=Math.min(0.05,(t-gf.last)/1000); gf.last=t;
  if(gf.holding){ gf.holdT+=dt; const ph=(gf.holdT/1.5)%2; gf.power=ph<1?ph:2-ph; }
  if(gf.fly){ const f=gf.fly; f.t+=dt; const k=Math.min(1,f.t/f.T); gf.ball.x=f.x0+(f.x1-f.x0)*k; gf.ball.y=f.y0+(f.y1-f.y0)*k; f.h=4*f.H*k*(1-k); if(k>=1) gfLand(); }
  if(gf.moving){ const n=4; for(let i=0;i<n&&gf.moving;i++) gfStep(dt/n); }
  if(gf.st&&gf.ball){ const tgt=gfCamFor(gf.ball.y); gf.cam=(gf.cam||0)+(tgt-(gf.cam||0))*Math.min(1,dt*5); }
  if(gf.msgT>0) gf.msgT-=dt;
  gfDraw();
  gf.raf=requestAnimationFrame(gfLoop);
}
function gfFall(c, wx){
  const t=performance.now()/1000, [wvx]=gfWindVec();
  if(!gf.parts||gf.parts.k!==wx){ gf.parts={k:wx, list:[...Array(wx==='rain'?130:110)].map(()=>({x:Math.random()*GF_W, y:Math.random()*GF_H, z:0.6+Math.random()*0.8}))}; }
  if(wx==='rain'){
    c.fillStyle='rgba(20,40,70,.18)'; c.fillRect(0,0,GF_W,GF_H);
    c.strokeStyle='rgba(210,230,255,.7)'; c.lineWidth=1.3; c.beginPath();
    const vx=30+wvx*1.5, vy=620;
    gf.parts.list.forEach(p=>{ const y=(p.y+t*vy*p.z)%(GF_H+30)-15, x=((p.x+t*vx*p.z)%GF_W+GF_W)%GF_W, l=12*p.z; c.moveTo(x,y); c.lineTo(x+vx/vy*l,y+l); });
    c.stroke();
    c.strokeStyle='rgba(255,255,255,.55)'; c.lineWidth=1;
    for(let i=0;i<6;i++){ const ph=(t*1.3+i/6)%1, x=(i*97+Math.floor(t*1.3+i/6)*53)%GF_W, y=(i*151+Math.floor(t*1.3+i/6)*89)%GF_H; c.globalAlpha=1-ph; c.beginPath(); c.ellipse(x,y,3+ph*8,1.5+ph*3,0,0,7); c.stroke(); }
    c.globalAlpha=1;
  } else {
    c.fillStyle='#fff';
    gf.parts.list.forEach((p,i)=>{ const y=(p.y+t*40*p.z)%(GF_H+10)-5, x=((p.x+t*wvx*0.4*p.z+Math.sin(t*1.5+i)*8)%GF_W+GF_W)%GF_W; c.globalAlpha=0.85; c.beginPath(); c.arc(x,y,1.2+p.z*1.4,0,7); c.fill(); });
    c.globalAlpha=1;
  }
}
function gfRR(c,x,y,w,h,r,keep){ if(!keep) c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function gfDraw(){
  const c=gf.ctx, h=gfHole(), L=h.L, cam=Math.round((gf.cam||0)*2)/2, wx=gf.st.wx&&gf.st.wx.k, haz=gfHaz();
  c.setTransform(gf.dpr,0,0,gf.dpr,0,0);
  c.save(); c.translate(0,-cam);   // ---- 코스 (세로로 긴 홀을 화면이 따라감) ----
  const y0=Math.max(0,cam-20), y1=Math.min(L,cam+GF_H+20);
  // rough
  c.fillStyle='#4f8a3c'; c.fillRect(0,y0,GF_W,y1-y0);
  c.fillStyle='rgba(0,0,0,.05)'; for(let y=Math.floor(y0/26)*26;y<y1;y+=26) c.fillRect(0,y,GF_W,13);
  // fairway (mowing stripes inside)
  const fwPath=()=>{ c.beginPath(); const p=h.fw.pts; c.moveTo(p[0][0],p[0][1]); for(let k=1;k<p.length;k++) c.lineTo(p[k][0],p[k][1]); };
  c.lineCap='round'; c.lineJoin='round';
  fwPath(); c.strokeStyle='#5f9e47'; c.lineWidth=h.fw.w+8; c.stroke();
  fwPath(); c.strokeStyle='#73b957'; c.lineWidth=h.fw.w; c.stroke();
  // tee box
  c.fillStyle='#82c862'; gfRR(c,h.tee[0]-30,h.tee[1]-20,60,40,8); c.fill();
  c.fillStyle='#fff'; c.beginPath(); c.arc(h.tee[0]-22,h.tee[1]-12,2.5,0,7); c.arc(h.tee[0]+22,h.tee[1]-12,2.5,0,7); c.fill();
  // water
  c.fillStyle='#3d8fd6'; h.water.forEach(w=>{ gfRR(c,w[0],w[1],w[2],w[3],Math.min(14,w[3]/3)); c.fill(); });
  c.strokeStyle='rgba(255,255,255,.35)'; c.lineWidth=1.5; h.water.forEach(w=>{ for(let y=w[1]+12;y<w[1]+w[3];y+=16){ c.beginPath(); for(let x=w[0]+6;x<w[0]+w[2]-10;x+=24){ c.moveTo(x,y); c.quadraticCurveTo(x+6,y-4,x+12,y); } c.stroke(); } });
  // green
  const [gx,gy,gr]=h.green;
  c.beginPath(); c.arc(gx,gy,gr+5,0,7); c.fillStyle='#6fb552'; c.fill();
  c.save(); c.beginPath(); c.arc(gx,gy,gr,0,7); c.fillStyle='#8fd36a'; c.fill(); c.clip();
  c.fillStyle='rgba(255,255,255,.08)'; for(let x=gx-gr;x<gx+gr;x+=16) c.fillRect(x,gy-gr,8,2*gr);
  if(wx==='rain'){ c.fillStyle='rgba(30,80,50,.25)'; c.fillRect(gx-gr,gy-gr,2*gr,2*gr); }
  if(wx==='snow'){ c.fillStyle='rgba(245,248,255,.78)'; c.fillRect(gx-gr,gy-gr,2*gr,2*gr); }
  c.restore();
  // sand
  h.sand.forEach(q=>{ c.beginPath(); c.arc(q[0],q[1],q[2],0,7); c.fillStyle='#ead9a6'; c.fill(); c.strokeStyle='#d2bd80'; c.lineWidth=2; c.stroke(); });
  // puddles
  haz.puddles.forEach(([x,y,rx,ry])=>{ c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2); c.fillStyle='rgba(90,160,230,.75)'; c.fill(); c.strokeStyle='rgba(255,255,255,.55)'; c.lineWidth=1.5; c.stroke(); });
  // slope arrows (on the green)
  c.strokeStyle='rgba(255,255,255,.5)'; c.lineWidth=2;
  for(let y=gy-gr+14;y<gy+gr;y+=26) for(let x=gx-gr+14;x<gx+gr;x+=26){
    if(Math.hypot(x-gx,y-gy)>gr-8) continue; const [sx,sy]=gfSlope(x,y); const m=Math.hypot(sx,sy); if(!m) continue;
    const ux=sx/m, uy=sy/m, Lr=6; c.beginPath(); c.moveTo(x-ux*Lr,y-uy*Lr); c.lineTo(x+ux*Lr,y+uy*Lr);
    c.moveTo(x+ux*Lr,y+uy*Lr); c.lineTo(x+ux*Lr-ux*4-uy*3.5,y+uy*Lr-uy*4+ux*3.5); c.moveTo(x+ux*Lr,y+uy*Lr); c.lineTo(x+ux*Lr-ux*4+uy*3.5,y+uy*Lr-uy*4-ux*3.5); c.stroke();
  }
  // snow piles
  haz.piles.forEach(([x,y,r])=>{ c.beginPath(); c.arc(x,y,r,0,7); c.fillStyle='#fff'; c.fill(); c.strokeStyle='#cfd8e6'; c.lineWidth=1.5; c.stroke(); });
  // cup + flag
  const [hx,hy]=h.cup;
  c.beginPath(); c.arc(hx,hy,GF_CUP+1.5,0,Math.PI*2); c.fillStyle='#fff'; c.fill();
  c.beginPath(); c.arc(hx,hy,GF_CUP,0,Math.PI*2); c.fillStyle='#1d2a1a'; c.fill();
  if(!gf.sunk){ c.strokeStyle=wx==='snow'?'#666':'#eee'; c.lineWidth=2; c.beginPath(); c.moveTo(hx,hy); c.lineTo(hx,hy-38); c.stroke();
    c.fillStyle='#e8504a'; c.beginPath(); c.moveTo(hx,hy-38); c.lineTo(hx+20,hy-32); c.lineTo(hx,hy-26); c.closePath(); c.fill(); }
  // aim (+ where a shot would land)
  const b=gf.ball, lie=gfSurface(b.x,b.y), putt=lie==='green';
  if(gf.holding&&gf.aim){
    const dx=gf.aim.x-b.x, dy=gf.aim.y-b.y, d=Math.hypot(dx,dy)||1;
    if(putt){ const Lp=30+gf.power*150; c.setLineDash([5,6]); c.strokeStyle='rgba(255,255,255,.9)'; c.lineWidth=2.5; c.beginPath(); c.moveTo(b.x,b.y); c.lineTo(b.x+dx/d*Lp,b.y+dy/d*Lp); c.stroke(); c.setLineDash([]); }
    else { const club=GF_CLUB[lie]||GF_CLUB.rough, dist=club.carry*gf.power, lx=b.x+dx/d*dist, ly=b.y+dy/d*dist;
      c.setLineDash([4,7]); c.strokeStyle='rgba(255,255,255,.75)'; c.lineWidth=2; c.beginPath(); c.moveTo(b.x,b.y); c.lineTo(lx,ly); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(lx,ly,10+dist*0.03,0,7); c.strokeStyle='#fff'; c.lineWidth=2.5; c.stroke(); c.fillStyle='rgba(255,255,255,.18)'; c.fill(); }
  }
  // ball (in the air: higher = bigger, shadow stays on the ground)
  const fh=gf.fly?(gf.fly.h||0):0;
  // trees (drawn over a rolling ball, under a flying one)
  const trees=()=>h.trees.forEach(([x,y,r])=>{ if(y+r<y0||y-r>y1) return; c.beginPath(); c.ellipse(x+3,y+5,r,r*.7,0,0,7); c.fillStyle='rgba(0,0,0,.18)'; c.fill();
    c.beginPath(); c.arc(x,y,r,0,7); c.fillStyle='#2f7a34'; c.fill(); c.beginPath(); c.arc(x-r*.3,y-r*.3,r*.55,0,7); c.fillStyle='#3f9343'; c.fill(); });
  if(!fh) trees();
  if(!(gf.sunk&&gf.msgT<1.2)){
    c.beginPath(); c.arc(b.x+1.5+fh*.25,b.y+2+fh*.35,GF_BALL,0,Math.PI*2); c.fillStyle='rgba(0,0,0,'+(fh?.18:.25)+')'; c.fill();
    const br=GF_BALL*(1+fh/90);
    c.beginPath(); c.arc(b.x,b.y-fh,br,0,Math.PI*2); c.fillStyle=wx==='snow'?'#ff7a1a':'#fff'; c.fill(); c.strokeStyle=wx==='snow'?'#c25500':'#bbb'; c.lineWidth=1; c.stroke();
  }
  if(fh) trees();
  c.restore();   // ---- 여기부터 화면에 고정 ----
  // falling rain / snow (moves with the wind)
  if(wx) gfFall(c, wx);
  // HUD
  c.fillStyle='rgba(0,0,0,.35)'; gfRR(c,8,8,GF_W-16,28,14); c.fill();
  c.fillStyle='#fff'; c.font='bold 14px "Noto Sans KR",sans-serif'; c.textBaseline='middle';
  c.textAlign='left'; c.fillText((h.no?(gf.st.hole+1)+'/9 · '+h.no+'번':(gf.st.hole+1)+'번')+' 홀 · 파 '+h.par, 20, 22);
  c.textAlign='right'; c.fillText(gf.st.done?'완료':'타수 '+gf.st.strokes, GF_W-20, 22);
  // wind arrow (where the wind pushes the ball)
  const wv=gfWindVec(), wm=Math.hypot(wv[0],wv[1]);
  if(wm){ const ux=wv[0]/wm, uy=wv[1]/wm, cx=GF_W-34, cy=62, L=13;
    c.fillStyle='rgba(0,0,0,.35)'; c.beginPath(); c.arc(cx,cy,22,0,Math.PI*2); c.fill();
    c.strokeStyle='#fff'; c.lineWidth=3; c.beginPath(); c.moveTo(cx-ux*L,cy-uy*L); c.lineTo(cx+ux*L,cy+uy*L);
    c.moveTo(cx+ux*L,cy+uy*L); c.lineTo(cx+ux*L-ux*7-uy*6,cy+uy*L-uy*7+ux*6); c.moveTo(cx+ux*L,cy+uy*L); c.lineTo(cx+ux*L-ux*7+uy*6,cy+uy*L-uy*7-ux*6); c.stroke();
    c.fillStyle='#fff'; c.font='bold 11px "Noto Sans KR",sans-serif'; c.textAlign='center'; c.fillText((+gf.st.wind.s).toFixed(1)+'m/s', cx, cy+32); }
  // mini map (whole hole) under the wind arrow
  { const mw=40, sc=mw/GF_W, mh=L*sc, mx=GF_W-mw-12, my=104;
    c.save(); c.globalAlpha=.88; c.fillStyle='#3f7a30'; gfRR(c,mx-2,my-2,mw+4,mh+4,5); c.fill();
    c.beginPath(); const p=h.fw.pts; c.moveTo(mx+p[0][0]*sc,my+p[0][1]*sc); for(let k=1;k<p.length;k++) c.lineTo(mx+p[k][0]*sc,my+p[k][1]*sc); c.strokeStyle='#73b957'; c.lineWidth=h.fw.w*sc; c.lineCap='round'; c.stroke();
    c.fillStyle='#3d8fd6'; h.water.forEach(w=>c.fillRect(mx+w[0]*sc,my+w[1]*sc,w[2]*sc,w[3]*sc));
    c.fillStyle='#ead9a6'; h.sand.forEach(q=>{ c.beginPath(); c.arc(mx+q[0]*sc,my+q[1]*sc,Math.max(1.5,q[2]*sc),0,7); c.fill(); });
    c.fillStyle='#8fd36a'; c.beginPath(); c.arc(mx+h.green[0]*sc,my+h.green[1]*sc,h.green[2]*sc,0,7); c.fill();
    c.fillStyle='#e8504a'; c.beginPath(); c.arc(mx+h.cup[0]*sc,my+h.cup[1]*sc,2,0,7); c.fill();
    c.strokeStyle='rgba(255,255,255,.9)'; c.lineWidth=1; c.strokeRect(mx,my+cam*sc,mw,GF_H*sc);
    c.fillStyle='#fff'; c.beginPath(); c.arc(mx+b.x*sc,my+b.y*sc,2.2,0,7); c.fill(); c.restore(); }
  // club + distance to the pin
  if(!gf.st.done&&!gf.sunk){ const yd=Math.round(Math.hypot(b.x-h.cup[0],b.y-h.cup[1])*0.38), club=putt?'퍼터':(GF_CLUB[lie]||GF_CLUB.rough).n;
    const txt='🏌️ '+club+' · 핀까지 '+yd+'y'; c.font='bold 12px "Noto Sans KR",sans-serif'; const tw=c.measureText(txt).width;
    c.fillStyle='rgba(0,0,0,.4)'; gfRR(c,10,44,tw+18,24,12); c.fill(); c.fillStyle='#fff'; c.textAlign='left'; c.fillText(txt,19,56); }
  // power gauge
  if(gf.holding){
    const gw=GF_W-80, gx=40, gy=GF_H-30;
    c.fillStyle='rgba(0,0,0,.4)'; gfRR(c,gx-3,gy-3,gw+6,18,9); c.fill();
    const grd=c.createLinearGradient(gx,0,gx+gw,0); grd.addColorStop(0,'#7be07b'); grd.addColorStop(0.6,'#ffd84d'); grd.addColorStop(1,'#ff5a4d');
    c.fillStyle=grd; gfRR(c,gx,gy,Math.max(12,gw*gf.power),12,6); c.fill();
    c.fillStyle='#fff'; c.font='bold 11px "Noto Sans KR",sans-serif'; c.textAlign='center'; c.fillText(Math.round(gf.power*100)+'%', GF_W/2, gy+6);
  }
  // message
  if(gf.msgT>0&&gf.msg){
    c.globalAlpha=Math.min(1,gf.msgT*2);
    // 긴 문구는 글자를 줄여서 상자 안에 (아이폰 사파리는 가운데 정렬+최대 폭을 같이 쓰면 글자가 옆으로 밀려서, 직접 가운데에 놓음)
    let fs=17, tw=0; do{ c.font='bold '+fs+'px "Noto Sans KR",sans-serif'; tw=c.measureText(gf.msg).width; fs--; }while(tw>GF_W-64&&fs>=10);
    const w=tw+36;
    c.fillStyle='rgba(30,30,30,.72)'; gfRR(c,(GF_W-w)/2,GF_H/2-24,w,48,24); c.fill();
    c.fillStyle='#fff'; c.textAlign='left'; c.fillText(gf.msg, (GF_W-tw)/2, GF_H/2); c.globalAlpha=1;
  }
}

// ---- 🏆 records: no play times are kept ----
// golfScores/{loginId}: everyone sees it — only the best round (name, best, bestD, bestCard, bestPars, bestNos, bestWind, bestWx)
// golfMine/{loginId}:   only me — my last 5 rounds (hist: [{t, d, card, pars, nos, wind, wx}], newest first)
// records from before random courses have no pars: they were played on GF_HOLES
const GF_HIST=5;   // 내 게임 내역: 최근 5판만
const GF_PUB=['cv','name','best','bestD','bestCard','bestPars','bestNos','bestWind','bestWx'];   // cv: 코스 버전 (예전 퍼팅 코스 기록은 cv가 없어 순위표에서 빠지고 지워짐)
const gfPub=v=>{ const o={}; GF_PUB.forEach(k=>{ if(v&&v[k]!==undefined&&v[k]!==null) o[k]=v[k]; }); if(o.best!=null&&o.bestD==null) o.bestD=gfRecD(v,'best'); return o; };
const gfEsc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// once per login: records from before the current course are reset
async function gfSync(){
  const me=gfMe(), uid=gfUid(); if(!me||!uid||!db||!db.runTransaction||gf.synced===me) return;
  try{
    const oldRef=db.collection('golfScores').doc(uid), ref=db.collection('golfScores').doc(me), mineRef=db.collection('golfMine').doc(me);
    await db.runTransaction(async t=>{
      const o=await t.get(oldRef), c=await t.get(ref), m=await t.get(mineRef);
      // 예전 코스 기록은 초기화: 내 순위 기록(옛 uid 이름 포함)은 지우고, 내 게임 내역은 비움
      if(o.exists) t.delete(oldRef);
      if(c.exists&&(+c.data().cv||0)<GF_RV) t.delete(ref);   // only records older than this version (an app left open on an old version must not wipe newer ones)
      if(!m.exists||(+m.data().cv||0)<GF_RV) t.set(mineRef,{cv:GF_RV, hist:[]});
    });
    gf.synced=me;
  }catch(e){ console.warn('golf sync',e); }
}
// an admin opening the ranking deletes every record from before the reset: everyone's ranking row and everyone's own game history
async function gfCleanAll(docs){ gf.oldNote=scoreOldNote(docs,v=>(+v.cv||0)<GF_RV); }   // older records stay hidden; the admin sees whose app is out of date
async function gfUpload(tot, card, pars, nos, wind, wx){
  const me=gfMe(); if(!me||!db||!db.runTransaction) return;
  await gfSync();
  const ref=db.collection('golfScores').doc(me), mineRef=db.collection('golfMine').doc(me);
  try{
    await db.runTransaction(async t=>{
      let d=(await t.get(ref)).data()||{}, m=(await t.get(mineRef)).data()||{};
      if(d.cv!==GF_RV) d={}; if(m.cv!==GF_RV) m={hist:[]};
      const dd=tot-pars.reduce((a,b)=>a+b,0), oldD=gfRecD(d,'best');
      const pub=gfPub(d); pub.cv=GF_RV; pub.name=(myProfile&&myProfile.name)||d.name||'';
      if(oldD==null||dd<oldD) Object.assign(pub,{best:tot, bestD:dd, bestCard:card, bestPars:pars, bestNos:nos, bestWind:wind, bestWx:wx});
      t.set(ref,gfPub(pub));
      t.set(mineRef,{cv:GF_RV, hist:[{t:tot, d:dd, card, pars, nos, wind, wx}].concat(m.hist||[]).slice(0,GF_HIST)});
    });
    scoreSaved('golfScores');
  }catch(e){ scoreFailed('⛳ 골프','golfScores',e,[tot, card, pars, nos, wind, wx]); }
}
// a record's pars / score against par (k: 'best' or 'last')
const gfRecPars=(r,k)=>r[k+'Pars']||GF_HOLES.map(h=>h.par);
function gfRecD(r,k){ if(!r||r[k]==null) return null; if(k==='best'&&r.bestD!=null) return r.bestD; return r[k]-gfRecPars(r,k).reduce((a,b)=>a+b,0); }
const gfCond=(wx,wind)=>(wx==='rain'?' · 🌧️':wx==='snow'?' · ❄️':'')+(wind!=null?' · 🌬️'+(+wind).toFixed(1)+'m/s':'');
const gfRecTxt=(r,k)=>r[k]==null?'-':gfDiff(gfRecD(r,k))+' ('+r[k]+'타'+gfCond(r[k+'Wx'],r[k+'Wind'])+')';
function gfRankToggle(show){
  const r=document.getElementById('gfRank'), p=document.getElementById('gfPlay'), btn=document.getElementById('gfRankBtn');
  if(show===undefined) show=r.style.display==='none';
  r.style.display=show?'':'none'; p.style.display=show?'none':''; btn.textContent=show?'⛳ 게임':'🏆 순위표';
  const on=show?r:p; on.classList.remove('gfFadeIn'); void on.offsetWidth; on.classList.add('gfFadeIn');
  document.getElementById('gfNew').style.display=show?'none':'';
  gf.holding=false;
  if(show) gfRankLoad(); else gfSize();
}
// a row that opens/closes its details smoothly
const gfFold=(head, body)=>'<div class="gfFoldWrap">'+head+'<div class="gfDetail"><div class="gfDetailIn">'+body+'</div></div></div>';
async function gfRankLoad(){
  const box=document.getElementById('gfRank'); box.innerHTML='<div class="gfEmpty">불러오는 중...</div>';
  await gfSync();
  const me=gfMe();
  let rows=[], mine=null;
  try{
    const [snap, m]=await Promise.all([db.collection('golfScores').get(), db.collection('golfMine').doc(me).get()]);
    mine=m.exists&&m.data().cv===GF_RV?m.data():null;
    snap.forEach(d=>{ const v=d.data(); if(v.best!=null&&v.cv===GF_RV) rows.push(Object.assign({id:d.id},gfPub(v))); });
    gfCleanAll(snap.docs);
  }catch(e){ box.innerHTML='<div class="gfEmpty">순위표를 불러오지 못했어요</div>'; return; }
  // one row per person (an old record left under a uid joins the one with the same name)
  const by={};
  rows.forEach(r=>{ const k=r.name||r.id, o=by[k]; if(!o||(r.id===me&&o.id!==me)||(gfRecD(r,'best')<gfRecD(o,'best')&&o.id!==me)) by[k]=r; });
  rows=Object.values(by); rows.forEach(r=>r.d=gfRecD(r,'best'));
  rows.sort((a,b)=>a.d-b.d||String(a.name).localeCompare(String(b.name)));
  let html='';
  // 📋 my rounds: only I can see these
  const hist=((mine&&mine.hist)||[]).slice(0,GF_HIST);
  html+='<div class="gfSec">📋 내 게임 내역 <span>(나만 볼 수 있어요 · 최근 '+GF_HIST+'판)</span></div>';
  if(!hist.length) html+='<div class="gfEmptySm">아직 끝까지 친 게임이 없어요</div>';
  else html+='<div class="gfList">'+hist.map((h,i)=>gfFold('<div class="gfRow gfHist"><span class="gfMedal">'+(i===0?'최근':(i+1))+'</span><span class="gfNm">'+gfDiff(h.d)+' <i>('+h.t+'타'+gfCond(h.wx,h.wind)+')</i></span><span class="gfChev">▾</span></div>',
    '<div class="gfCard">'+gfCardHtml(h.card||[],-1,0,h.pars,h.nos)+'</div>')).join('')+'</div>';
  // 🏆 everyone's best only
  html+='<div class="gfSec">🏆 순위 <span>(각자 최고 기록 · 파 대비 점수) · 이름을 누르면 최고 기록표</span></div>';
  if(!rows.length) html+='<div class="gfEmptySm">아직 기록이 없어요. 9홀을 다 돌면 순위표에 올라가요! ⛳</div>';
  else{
    html+='<div class="gfList">';
    let rank=0, prev=null;
    rows.forEach((r,i)=>{ if(r.d!==prev){ rank=i+1; prev=r.d; }
      const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank+'위';
      html+=gfFold('<div class="gfRow'+(r.id===me?' me':'')+'"><span class="gfMedal">'+medal+'</span><span class="gfNm">'+gfEsc(r.name||'직원')+(r.id===me?' (나)':'')+'</span>'
        +'<span class="gfBestCol"><b>'+gfDiff(r.d)+'</b> <i>'+r.best+'타</i></span><span class="gfChev">▾</span></div>',
        '<div class="gfDHd">🏆 최고 기록 · '+gfRecTxt(r,'best')+'</div><div class="gfCard">'+gfCardHtml(r.bestCard||[],-1,0,gfRecPars(r,'best'),r.bestNos)+'</div>');
    });
    html+='</div>';
  }
  box.innerHTML=html+(gf.oldNote||'');
  box.querySelectorAll('.gfFoldWrap > .gfRow').forEach(row=>row.onclick=()=>{ const open=!row.classList.contains('open'); row.classList.toggle('open',open); row.nextElementSibling.classList.toggle('open',open); });
}
