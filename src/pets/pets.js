// ⚠️ 프론트 앱 js/pets.js 를 그대로 옮긴 파일 (모달 클래스 이름만 petBgWrap·petSheet 로). 고치지 말고 프론트에서 새로 받아 쓰기
// ================== 🐾 함께 키우는 펫 ==================
// - 직원마다 한 마리 (pets/{loginId}), 모두의 펫이 모든 화면 아래를 같이 돌아다님 (화면 움직임은 각자 기기에서 계산 → 위치 저장 없음)
// - 고양이: 공지·말풍선·날씨 카드·달력 칸 위로 점프 / 강아지: 핥기(침) / 둘 다: 말풍선 끝 물기(살짝 찌그러짐)
//   → 물기·핥기는 petFx/{loginId} 문서(최근 8개)로 모두에게 보임. 실제 채팅·공지 내용은 절대 안 바뀜 (화면 모양만 잠깐)
// - 날씨 탭에서 비가 오면 레이더 안을 돌아다니다 홀딱 젖음 (pets.wetAt, 20분 동안 젖은 털)
// - 마지막 목욕(bathAt)부터 3일 꼬질 · 7일 엄청 꼬질 (놀거나 젖으면 dirt 시간이 더해짐) → 🛁 목욕
// - 놀이: 🎣 낚싯대(고양이) · 🎾 공 던지기(강아지) · 🏃 어질리티(강아지) — 누구 펫이든 같이 놀고 목욕시킬 수 있음
const PET_W=40, PET_H=36, PET_DAY=86400000, PET_WET_MS=20*60000, PET_FX_MS={bite:5*60000, lick:10*60000};
const PET_SP={
  cheese:{kind:'cat', n:'치즈', b:'치즈 태비', base:'#f7a95c', hi:'#ffc98a', lo:'#d97f32', light:'#fff1dc', ear:'cat', pat:'tabby'},
  calico:{kind:'cat', n:'나비', b:'삼색 고양이', base:'#fffaf2', hi:'#ffffff', lo:'#eadfd2', light:'#fffaf2', ear:'cat', pat:'calico', p1:'#ef9548', p2:'#463a38'},
  tux:{kind:'cat', n:'콩떡', b:'턱시도', base:'#3c3740', hi:'#57505c', lo:'#2c282f', light:'#ffffff', ear:'cat', pat:'tux', eyeC:'#e9c443'},
  siam:{kind:'cat', n:'모카', b:'샴', base:'#f4e6d2', hi:'#fff6ea', lo:'#e3d1b8', light:'#fff6ea', ear:'cat', pat:'point', pt:'#634333'},
  rag:{kind:'cat', n:'구름', b:'랙돌', base:'#f6efe4', hi:'#fffaf2', lo:'#e2d6c4', light:'#ffffff', ear:'cat', pat:'rag', pt:'#9c7a5e', tail:'fluff'},
  ash:{kind:'cat', n:'은비', b:'아메리칸 숏헤어', base:'#c9ccd1', hi:'#dde0e4', lo:'#4d5058', light:'#eef0f2', ear:'cat', pat:'tabby'},
  curl:{kind:'cat', n:'말랑', b:'아메리칸 컬', base:'#e9cfa8', hi:'#f6e2c4', lo:'#cfae80', light:'#fff4e2', ear:'curl', pat:'none', tail:'cat'},
  shiba:{kind:'dog', n:'보리', b:'시바견', base:'#e0863c', hi:'#f2a35e', lo:'#c26b28', light:'#fff4e6', ear:'pointy', pat:'shiba', tail:'curl', scarf:'#3f9e58'},
  corgi:{kind:'dog', n:'감자', b:'웰시코기', base:'#f0a252', hi:'#f8bb72', lo:'#d4853a', light:'#ffffff', ear:'big', pat:'corgi', tail:'stub', short:1},
  maltese:{kind:'dog', n:'솜이', b:'말티즈', base:'#ffffff', hi:'#ffffff', lo:'#ece4dc', light:'#ffffff', ear:'floppy', pat:'none', tail:'curl', bow:'#ff7fa0'},
  bichon:{kind:'dog', n:'몽실', b:'비숑 프리제', base:'#fffcf6', hi:'#ffffff', lo:'#eee5da', light:'#fffcf6', ear:'cloud', pat:'none', tail:'curl'},
  golden:{kind:'dog', n:'버터', b:'골든 리트리버', base:'#eab468', hi:'#f6cb88', lo:'#cf9447', light:'#f6cb88', ear:'floppy', pat:'gold', tail:'long', earC:'#d79a4c', size:1.3},
  husky:{kind:'dog', n:'설기', b:'시베리안 허스키', base:'#f6f6f3', hi:'#ffffff', lo:'#d9dad8', light:'#ffffff', ear:'big', pat:'husky', pt:'#5c626c', tail:'curl', eyeC:'#4c9fe0', size:1.3},
  gsd:{kind:'dog', n:'대장', b:'셰퍼드', base:'#c98a4a', hi:'#dba468', lo:'#a86d34', light:'#e6b47c', ear:'big', pat:'gsd', tail:'long', muz:'#4b3424', size:1.3}
};
const shadeHex=(hex,k)=>{ const n=parseInt(hex.slice(1),16); return '#'+[n>>16,n>>8&255,n&255].map(v=>Math.max(0,Math.min(255,Math.round(v*k))).toString(16).padStart(2,'0')).join(''); };

// ---------- 픽셀 그림 (코드로 점을 찍어 그림, 40×36칸 · 큰 개는 size 배) ----------
function petDraw(p, act, f, o){
  o=o||{};
  const K=p.size||1, CW=Math.ceil(PET_W*K), CH=Math.ceil(PET_H*K);
  const c=document.createElement('canvas'); c.width=CW; c.height=CH; const g=c.getContext('2d');
  const put=(x,y,col)=>{ if(x<0||y<0||x>=CW||y>=CH) return; g.fillStyle=col; g.fillRect(x,y,1,1); };
  const px=(x,y,col)=>{ x=Math.round(x); y=Math.round(y); const x0=Math.floor(x*K), y0=Math.floor(y*K), x1=Math.max(x0+1,Math.floor((x+1)*K)), y1=Math.max(y0+1,Math.floor((y+1)*K)); for(let j=y0;j<y1;j++) for(let i=x0;i<x1;i++) put(i,j,col); };
  const ell=(cx,cy,rx,ry,col)=>{ cx*=K; cy*=K; rx*=K; ry*=K; for(let y=Math.floor(cy-ry);y<=cy+ry;y++) for(let x=Math.floor(cx-rx);x<=cx+rx;x++){ const dx=(x+.5-cx)/rx, dy=(y+.5-cy)/ry; if(dx*dx+dy*dy<=1) put(x,y,col); } };
  const rect=(x,y,w,h,col)=>{ for(let j=0;j<h;j++) for(let i=0;i<w;i++) px(x+i,y+j,col); };
  const eye=(ex,ey,col,PX)=>{ const X=PX!=null?PX:Math.round(Math.round(ex)*K), Y=Math.round(Math.round(ey-1)*K), hh=Math.max(2,Math.round(2*K)); for(let j=0;j<hh;j++) put(X,Y+j,col); };
  const curve=(pts,r,col)=>{ for(let t=0;t<=1;t+=0.04){ const [a,b,d]=pts, x=(1-t)*(1-t)*a[0]+2*(1-t)*t*b[0]+t*t*d[0], y=(1-t)*(1-t)*a[1]+2*(1-t)*t*b[1]+t*t*d[1]; ell(x,y,r,r,col); } };
  const tri=(pts,col)=>{ const [a,b,d]=pts.map(([u,v])=>[u*K,v*K]), s=(p1,p2,p3)=>(p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1]);
    for(let y=Math.floor(Math.min(a[1],b[1],d[1]));y<=Math.max(a[1],b[1],d[1]);y++) for(let x=Math.floor(Math.min(a[0],b[0],d[0]));x<=Math.max(a[0],b[0],d[0]);x++){ const q=[x+.5,y+.5],d1=s(q,a,b),d2=s(q,b,d),d3=s(q,d,a); if(!((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0))) put(x,y,col); } };
  const B=p.base, S=p.lo, L=p.light, dark=B.startsWith('#3'), cat=p.kind==='cat', BLK='#2a2420';
  const tailT=p.tail||(cat?'cat':'curl'), tailC=p.pat==='calico'?p.p1:(p.pat==='point'||p.pat==='rag'||p.pat==='husky')?p.pt:p.pat==='gsd'?BLK:B;
  const legEnd=p.pat==='point'?p.pt:(['tux','shiba','corgi','rag'].includes(p.pat)?L:B);
  const eyeCol=p.eyeC||'#2a1f1d', earC=side=>p.pat==='calico'?(side?p.p2:p.p1):(p.pat==='point'||p.pat==='rag'||p.pat==='husky')?p.pt:p.pat==='gsd'?BLK:B;
  const whiteChest=['tux','shiba','corgi','rag','calico'].includes(p.pat);
  const dy=p.short?3:0;
  // ---- 앞얼굴 ----
  const face=(x,y,closed)=>{
    x=Math.round(2*x*K)/(2*K);   // 크게 그려도 얼굴 가운데가 칸 경계에 오게 → 귀·눈 좌우 대칭
    if(['cat','curl','pointy','big'].includes(p.ear)){
      const h={cat:5,curl:5.5,pointy:4.5,big:6.5}[p.ear], w=p.ear==='big'?5.8:5;
      tri([[x-w,y-1],[x-4.5,y-1-h],[x-1.5,y-3]],earC(0)); tri([[x+w,y-1],[x+4.5,y-1-h],[x+1.5,y-3]],earC(1));
      if(p.ear==='curl'){ [[-5,-7],[-6,-7],[-7,-6]].forEach(([a,d])=>{ px(x+a,y+d,earC(0)); px(x-a-1,y+d,earC(1)); }); }   // 끝이 바깥·뒤로 말린 귀   // 뒤로 말린 귀 끝
    }
    if(p.ear==='cloud') ell(x,y-1,6.6,5.6,B);
    if(p.pat==='rag') ell(x,y+1,6,4.4,B);    // 복슬한 볼
    ell(x,y,5.2,4.4,B);
    if(p.pat==='calico'){ ell(x-3,y-2,2.4,2,p.p1); ell(x+3,y-2.4,2.2,1.8,p.p2); }
    if(p.pat==='point') ell(x,y+1.4,3,2.6,p.pt);
    if(p.pat==='rag'){ ell(x-2.4,y-0.4,2,2,p.pt); ell(x+2.4,y-0.4,2,2,p.pt); ell(x,y+2,2.4,1.8,L); px(x,y-3,L); px(x,y-2,L); px(x,y-1,L); }
    if(p.pat==='tux'){ ell(x,y+2.4,2.4,1.8,L); px(x,y-1,L); px(x,y,L); }
    if(p.pat==='husky'){ ell(x,y-3,5.2,1.9,p.pt); px(x-1,y-3,L); px(x,y-3,L); px(x-1,y-4,L); px(x,y-4,L); px(x-3,y-2,L); px(x+2,y-2,L); }   // 회색 모자 + 흰 이마 줄 + 눈썹 점
    if(p.pat==='tabby'){ px(x-2,y-3,S); px(x+1,y-3,S); px(x-1,y-4,S); px(x,y-4,S); px(x-5,y+1,S); px(x+4,y+1,S); }
    if(!cat){
      if(p.pat==='shiba'){ ell(x-3,y+1.8,1.8,1.3,L); ell(x+3,y+1.8,1.8,1.3,L); px(x-2,y-2,L); px(x+1,y-2,L); }   // 흰 볼 + 눈썹 점
      if(p.pat==='corgi'){ px(x,y-4,L); px(x,y-3,L); px(x,y-2,L); px(x,y-1,L); }    // 이마 흰 줄
      ell(x,y+2.4,2.8,2,(p.pat==='none'||p.ear==='cloud'||p.pat==='gold')?B:L); if(p.muz){ ell(x,y+2.4,2.4,1.8,p.muz); }
      px(x,y+1.6,'#2a1f1d'); px(x-1,y+1.6,'#2a1f1d');
    }
    if(p.ear==='floppy'){ ell(x-5,y+1,1.8,3.6,p.earC||S); ell(x+5,y+1,1.8,3.6,p.earC||S); }
    if(closed){ px(x-3,y,S); px(x-2,y,S); px(x+1,y,S); px(x+2,y,S); }
    else { const C2=Math.round(2*x*K)/2, Lx=Math.round(C2-3*K), Rx=2*C2-Lx-1; eye(0,y,eyeCol,Lx); eye(0,y,eyeCol,Rx); }   // 크기가 달라도 좌우 대칭
    if(cat) px(x,y+1.4,'#e48a9a');
    if(o.tongue&&!closed){ px(x-1,y+4,'#f08aa0'); px(x,y+4,'#f08aa0'); px(x-1,y+5,'#e0708a'); px(x,y+5,'#f08aa0'); }
    if(p.bow){ px(x+2,y-5,p.bow); px(x+3,y-5,p.bow); px(x+2,y-4,p.bow); }
  };
  const OUTC=dark?'#151214':shadeHex(['#ffffff','#fffcf6','#fffaf2','#f6efe4'].includes(B)?'#cdbfb2':B,0.55);
  // 다리: 몸 위에 겹쳐도 보이게 양옆에 선을 긋고(ln), 발끝은 한 줄 밝게
  // 몸 안쪽 선은 테두리보다 연한 그늘색(LN) → 다리가 도드라지되 줄무늬처럼 보이지 않게
  const LN=dark?'#201c22':shadeHex(['#ffffff','#fffcf6','#fffaf2','#f6efe4'].includes(B)?'#e2d6c8':B,0.8);
  const legs=(xs,y,h,sh,ln)=>xs.forEach((x,i)=>{ const k=sh?sh[i]:0; rect(x+k,y,2,h,i%2&&sh?S:B); rect(x+k,y+h-1,2,1,legEnd); if(ln){ rect(x+k+2,y,1,h,LN); } });
  const backPaw=(x,y)=>{ rect(x,y,3,1,legEnd); px(x-1,y,LN); };
  const thick=tailT==='fluff'?1.8:tailT==='long'?1.5:1.2;

  if(act==='idle'){
    const tip=f%4<2?0:1;
    if(tailT==='cat'||tailT==='fluff'||tailT==='long') curve([[20,33],[28,35],[27,26+tip]],thick,tailC);
    else if(tailT==='curl') curve([[21,26],[27+tip,22],[23,19]],1.6,tailC);
    else ell(24,31,1.6,1.4,tailC);
    if(p.short){ ell(18,30,7.5,5,B); ell(15,26,4.4,4.4,B); } else { ell(17,28,6,6.4,B); ell(15,23,4,5,B); }
    if(whiteChest) ell(14.5,25+dy*0.6,2,4-dy*0.4,L);
    if(p.pat==='calico'){ ell(20,27,3,3,p.p1); ell(18,32,2,1.6,p.p2); }
    if(p.pat==='tabby'){ [[20,24],[21,25],[21,27],[22,28],[20,30],[21,31]].forEach(([a,b])=>px(a,b,S)); }
    if(p.pat==='gsd') ell(20.5,25,2.4,3.6,BLK);
    if(p.pat==='husky') ell(20.5,25,2.6,3.8,p.pt);
    legs([12,15],27+dy,8-dy,null);
    face(14,15+dy,f%8===7);
    if(p.scarf){ rect(10,19+dy,9,2,p.scarf); px(16,21+dy,p.scarf); px(17,22+dy,p.scarf); px(15,21+dy,p.scarf); }
  }
  if(act==='walk'||act==='crawl'){   // crawl: 다리를 굽혀 몸을 낮춘 모습 (어질리티 터널)
    const dy=(p.short?3:0)+(act==='crawl'?(p.short?1:4):0);
    const sw=[0,1,0,-1], k=i=>sw[(f+i*2)%4]*1.2, bob=f%2?0:0.5;
    if(tailT==='cat'||tailT==='fluff') curve([[8,23+dy],[2,20+dy],[5,10+dy+(f%2)]],thick,tailC);
    else if(tailT==='long') curve([[8,23],[2,25],[2,31+(f%2)]],thick,tailC);
    else if(tailT==='curl') curve([[9,22],[3,17+(f%2)],[9,16]],1.6,tailC);
    else ell(7.5,22+dy,1.6,1.4,tailC);
    legs([10,13,20,23],26+dy,act==='crawl'?4:(p.short?5:8),[k(0),k(1),k(2),k(3)]);
    ell(16.5,24+bob+dy,p.short?9.5:8.5,3.8,B);
    if(p.pat==='calico'){ ell(14,22.5,3,2,p.p1); ell(19,25,2,1.5,p.p2); }
    if(p.pat==='tabby') [12,15,18,21].forEach(a=>{ px(a,21+bob,S); px(a,22+bob,S); });
    if(p.pat==='gsd') ell(15,22+bob,7,2.4,BLK);
    if(p.pat==='husky') ell(15.5,22+bob+dy,7.8,2.5,p.pt);
    if(['tux','shiba','corgi','rag'].includes(p.pat)) ell(19,26.5+dy,4,1.4,L);
    ell(24,21+dy,2.6,3,B);
    const hx=26, hy=16+bob+dy;
    if(['cat','curl','pointy','big'].includes(p.ear)){ const h={cat:5,curl:4.5,pointy:4.5,big:6.5}[p.ear];
      tri([[hx-3,hy-2],[hx-2,hy-2-h],[hx+0.5,hy-3]],earC(0)); if(p.ear==='curl'){ px(hx-3,hy-7,earC(0)); px(hx-4,hy-7,earC(0)); px(hx-5,hy-6,earC(0)); } }
    if(p.ear==='cloud') ell(hx-0.5,hy-0.5,5.4,4.8,B);
    if(p.pat==='rag') ell(hx-0.5,hy+0.5,5,4,B);
    ell(hx,hy,4.4,3.8,B);
    ell(hx+3.6,hy+1.4,cat?1.8:2.8,cat?1.4:1.8,cat?B:((p.pat==='none'||p.ear==='cloud'||p.pat==='gold')?B:L)); if(p.muz) ell(hx+3.8,hy+1.4,2.4,1.6,p.muz);
    if(p.pat==='point') ell(hx+2,hy+1,2.6,2.2,p.pt);
    if(p.pat==='rag'){ ell(hx+1.6,hy-0.4,2,2,p.pt); ell(hx+3.4,hy+1.6,1.6,1.2,L); }
    if(p.pat==='calico') ell(hx-1.5,hy-1.5,2,1.6,p.p1);
    if(p.pat==='shiba') ell(hx+1.5,hy+2,1.8,1.2,L);
    if(p.pat==='tabby'){ px(hx-1,hy-3,S); px(hx,hy-3,S); }
    if(p.pat==='husky'){ curve([[17,21.2+bob+dy],[22.5,20+dy],[hx-2.8,hy-0.5]],1.7,p.pt); ell(hx-1.4,hy-1.6,3.3,2.3,p.pt); px(hx+1,hy-3,p.pt); px(hx+2,hy-3,p.pt); px(hx+3,hy-2,p.pt); }   // 등→목 뒤→머리까지 이어진 회색, 얼굴·목 앞은 흰색
    if(p.ear==='floppy') ell(hx-2,hy+1,1.6,3.4,p.earC||S);
    eye(hx+2,hy-0.2,eyeCol);
    px(hx+(cat?5:6.2),hy+(cat?0.8:0.6),cat?'#e48a9a':'#2a1f1d');
    if(o.tongue){ px(hx+4,hy+3,'#f08aa0'); px(hx+5,hy+3,'#f08aa0'); px(hx+4,hy+4,'#e0708a'); }
    if(p.scarf){ ell(24,21.5+dy,2.8,1.3,p.scarf); px(22,23+dy,p.scarf); px(21,24+dy,p.scarf); }
    if(p.bow){ px(hx-1,hy-4,p.bow); px(hx,hy-4,p.bow); }
  }
  if(act==='held'){
    const sw=f%2?1:-1, lh=p.short?5:7;
    if(tailT==='cat'||tailT==='fluff') curve([[17,30],[24+sw,32],[25+sw,24]],thick,tailC);
    else if(tailT==='long') curve([[15,28],[16+sw,31],[15+sw*2,33.5]],thick,tailC);
    else if(tailT==='curl') curve([[17,29],[22+sw,30],[20+sw,26]],1.4,tailC);
    else ell(15,30,1.6,1.4,tailC);
    ell(15,21,4.6,p.short?8:9,B); if(whiteChest) ell(14.5,19,2,5,L);
    if(p.pat==='calico'){ ell(17,23,2.4,3,p.p1); ell(13,26,1.6,1.6,p.p2); }
    if(p.pat==='tabby'){ px(18,18,S); px(18,21,S); px(18,24,S); px(12,20,S); px(12,23,S); }
    legs([11,17],14,9,null); legs([11+sw*0.5,17-sw*0.5],p.short?26:27,lh,null);
    
    face(15,8,false);
    if(p.scarf){ rect(11,12,9,2,p.scarf); px(17,14,p.scarf); px(18,15,p.scarf); }
  }
  if(act==='sleep'){
    ell(18,30,9.5,4.6,B); ell(17,27.6,6,2,p.hi);
    if(p.pat==='calico'){ ell(21,28,3,2,p.p1); ell(24,31,2,1.4,p.p2); }
    if(p.pat==='tabby'){ px(16,27,S); px(19,27,S); px(22,27,S); px(25,28,S); }
    if(p.pat==='gsd') ell(20,27.5,6,1.8,BLK);
    if(p.pat==='husky') ell(19,27.4,7,1.9,p.pt);
    if(tailT!=='curl'&&tailT!=='stub') curve([[27,32],[22,36],[10,33.5]],thick,tailC); else ell(27,29,1.6,1.4,tailC);
    face(10,28.5,true);
    if(p.scarf){ rect(13,32,3,1,p.scarf); }
  }
  const img=g.getImageData(0,0,CW,CH), d=img.data, filled=i=>d[i*4+3]>0, out=dark?'#151214':shadeHex(['#ffffff','#fffcf6','#fffaf2','#f6efe4'].includes(B)?'#cdbfb2':B,0.55);
  const add=[]; for(let y=0;y<CH;y++) for(let x=0;x<CW;x++){ const i=y*CW+x; if(filled(i)) continue;
    if((x>0&&filled(i-1))||(x<CW-1&&filled(i+1))||(y>0&&filled(i-CW))||(y<CH-1&&filled(i+CW))) add.push([x,y]); }
  g.fillStyle=out; add.forEach(([x,y])=>g.fillRect(x,y,1,1));
  if(o.dirt||o.wet){   // 🟤 꼬질꼬질 얼룩 / 💧 젖은 털 (몸 안쪽 칸에만)
    const im=g.getImageData(0,0,CW,CH), dd=im.data;
    const cells=[]; for(let y=1;y<CH-1;y++) for(let x=1;x<CW-1;x++){ const i=y*CW+x; if(dd[i*4+3]&&dd[(i-1)*4+3]&&dd[(i+1)*4+3]&&dd[(i-CW)*4+3]&&dd[(i+CW)*4+3]) cells.push(i); }
    if(o.wet) cells.forEach(i=>{ dd[i*4]=dd[i*4]*0.9; dd[i*4+1]=dd[i*4+1]*0.95; dd[i*4+2]=Math.min(255,dd[i*4+2]*0.97+16); });
    if(o.dirt){ let h=7; const n=o.dirt>1?Math.ceil(cells.length*0.09):Math.ceil(cells.length*0.035);
      for(let k=0;k<n&&cells.length;k++){ h=(h*1103515245+12345)>>>0; const i=cells[h%cells.length]; dd[i*4]=dd[i*4]*0.55+46; dd[i*4+1]=dd[i*4+1]*0.5+30; dd[i*4+2]=dd[i*4+2]*0.42+18; } }
    g.putImageData(im,0,0);
    if(o.wet){ let h=11+f; for(let k=0;k<4;k++){ h=(h*1103515245+12345)>>>0; const x=(h%CW); let yb=-1; for(let y=CH-1;y>=0;y--){ if(dd[(y*CW+x)*4+3]){ yb=y; break; } } if(yb>0&&yb<CH-2){ put(x,yb+1+(f+k)%2,'#7fc4f0'); } } }
    if(o.dirt>1){ const sx=Math.round(CW*0.35), sy=2+(f%2); [[0,2],[1,1],[2,2],[3,1]].forEach(([a,b])=>{ put(sx+a,sy+b,'#9aa86a'); put(sx+a+7,sy+b+1,'#9aa86a'); }); }   // 냄새 줄
  }
  if(act==='held'){ rect(12,0,7,4,'#f2cbb8'); rect(12,3,7,1,'#d9a690'); px(15,0,'#d9a690'); px(15,1,'#d9a690'); px(15,2,'#d9a690'); }
  if(act==='sleep'){ const Z=(x,y,c)=>[[0,0],[1,0],[2,0],[3,0],[2,1],[1,2],[0,3],[1,3],[2,3],[3,3]].forEach(([a,b])=>px(x+a,y+b,c)); Z(16,18,'#9a8ab8'); if(f%4>=2) Z(20,13,'#b5a8cc'); }
  return c;
}

// ---------- 상태 ----------
const pt={on:false, docs:{}, fx:{}, run:new Map(), cache:new Map(), call:new Set(), decals:new Map(), lastShared:0, err:'', mode:null,
  hide:(()=>{ try{ return localStorage.getItem('petHide')==='1'; }catch(e){ return false; } })(), raf:0, last:0, layer:null, styleEl:null, hand:{x:0,y:0}};
// 🔌 다른 앱(지원팀)에서 이 파일을 그대로 쓸 때: window.PET_HOST 에 연결을 넣음 (layout-kit/pets/README.md). 없으면 우리 앱 그대로
const PH=()=>window.PET_HOST||null;
const petDb=()=>PH()?PH().db:(typeof db!=='undefined'?db:null);
const petMe=()=>PH()?PH().me():(myAccount&&myAccount.loginId);
const petMyName=()=>PH()?(PH().myName?PH().myName():''):((typeof myProfile!=='undefined'&&myProfile&&myProfile.name)||(myAccount&&myAccount.name)||'');
const petToast=t=>{ if(PH()&&PH().toast) PH().petToast(t); else if(typeof toast==='function') petToast(t); };
const petView=()=>PH()?(PH().view?PH().view():''):(typeof currentView!=='undefined'?currentView:'');
const petSpOf=d=>PET_SP[d&&d.sp]||PET_SP.cheese;
const petNameOf=d=>(d&&d.name)||petSpOf(d).n;
const petOwnerName=id=>{ try{ if(PH()&&PH().ownerName) return PH().ownerName(id); if(typeof isGuestId==='function'&&isGuestId(id)) return displayNameFor(id); return displayNameFor(accId(id)); }catch(e){ return ''; } };   // 지원팀 펫(g_…) 은 게스트 이름·부서로
const petIsCat=d=>petSpOf(d).kind==='cat';
const petEsc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function petDirtDays(d,now){ now=now||Date.now(); return Math.max(0,(now-(d.bathAt||d.createdAt||now))/PET_DAY+(d.dirt||0)/24); }
function petDirt(d){ const x=petDirtDays(d); return x>=7?2:x>=3?1:0; }
const petWet=d=>!!(d&&d.wetAt&&Date.now()-d.wetAt<PET_WET_MS);
const petScale=()=>window.innerWidth>=1100?3:2;
const petPhone=()=>window.innerWidth<700;
function petSprite(sp, act, f, o){   // 그림 캐시
  o=o||{}; const k=sp+'|'+act+'|'+f+'|'+(o.dirt||0)+'|'+(o.wet?1:0)+'|'+(o.tongue?1:0);
  let c=pt.cache.get(k); if(c) return c;
  if(pt.cache.size>600) pt.cache.clear();
  c=petDraw(PET_SP[sp]||PET_SP.cheese, act, f, o); pt.cache.set(k,c); return c;
}
function petCanvas(sp, act, scale, o){   // 패널 미리보기용
  const s=petSprite(sp, act||'idle', 1, o), c=document.createElement('canvas'); c.width=s.width; c.height=s.height;
  c.getContext('2d').drawImage(s,0,0); c.style.width=(s.width*scale)+'px'; c.style.height=(s.height*scale)+'px'; c.className='petCv'; return c;
}

// ---------- 시작 ----------
function petsInit(){
  if(pt.on||!petDb()||!petMe()) return; pt.on=true; const db=petDb();
  const L=document.createElement('div'); L.id='petLayer'; document.body.appendChild(L); pt.layer=L;
  pt.styleEl=document.createElement('style'); pt.styleEl.id='petFxStyle'; document.head.appendChild(pt.styleEl);
  db.collection('pets').onSnapshot(s=>{ pt.err=''; const d={}; s.forEach(x=>{ d[x.id]=x.data(); }); pt.docs=d; petSync(); petPanelRender(); },
    e=>{ pt.err='펫 정보를 못 불러왔어요 (보안 규칙 배포가 필요할 수 있어요)'; petPanelRender(); });
  db.collection('petFx').onSnapshot(s=>{ s.forEach(x=>{ pt.fx[x.id]=x.data(); }); petFxApply(); }, ()=>{});
  window.addEventListener('pointermove',e=>{ pt.hand.x=e.clientX; pt.hand.y=e.clientY; },{passive:true});
  setInterval(()=>{ petSync(); petFxApply(); petSideRender(); }, 60000);   // 1분마다: 보이는 펫 바꾸기·오래된 효과 지우기
  petLoop();
}

// 화면에 보일 펫: 내 펫 + 다른 사람 펫 몇 마리(시간마다 바뀜) + 패널에서 불러온 펫
function petSync(){
  if(!pt.layer) return;
  const me=petMe(), ids=Object.keys(pt.docs), hour=Math.floor(Date.now()/3600000);
  const h=s=>{ let x=hour; for(const ch of s) x=(x*31+ch.charCodeAt(0))>>>0; return x; };
  const max=petPhone()?3:5;
  const others=ids.filter(id=>id!==me&&!pt.call.has(id)).sort((a,b)=>h(a)-h(b));
  const want=[...(pt.docs[me]?[me]:[]), ...[...pt.call].filter(id=>pt.docs[id]&&id!==me), ...others].slice(0,Math.max(max,pt.call.size+1));
  for(const [id,p] of pt.run) if(!want.includes(id)){ p.el.remove(); pt.run.delete(id); }
  want.forEach(id=>{ let p=pt.run.get(id); if(!p){ p=petSpawn(id); pt.run.set(id,p); } p.d=pt.docs[id]; p.sp=p.d.sp in PET_SP?p.d.sp:'cheese'; p.tag.textContent=petNameOf(p.d)+' · '+petOwnerName(id); });
}
function petSpawn(id){
  const el=document.createElement('div'); el.className='petBox';
  const cv=document.createElement('canvas'); cv.className='petCv'; el.appendChild(cv);
  const tag=document.createElement('div'); tag.className='petTag'; el.appendChild(tag);
  const say=document.createElement('div'); say.className='petSay'; el.appendChild(say);
  pt.layer.appendChild(el);
  const a=petArea();
  const p={id, el, cv, tag, say, x:a.l+40+Math.random()*Math.max(10,a.r-a.l-80), y:a.floor, vx:0, vy:0, face:Math.random()<.5?1:-1, st:'idle', t:1+Math.random()*3, f:0, ft:0, plat:null, tx:0, sayT:0, lastShared:0};
  petBindDrag(p);
  return p;
}

// 펫이 다닐 수 있는 곳: 가운데(main) 칸, 바닥은 입력창 위
function petArea(){
  if(PH()&&PH().area) return PH().area();
  const m=document.querySelector('main'), r=m?m.getBoundingClientRect():{left:0,right:innerWidth,top:0,bottom:innerHeight};
  let floor=Math.min(r.bottom, window.visualViewport?visualViewport.height:innerHeight);
  ['chatInputBar','listInputBar','calendarInputBar','favInputBar','aiInputBar'].forEach(id=>{ const e=document.getElementById(id); if(e&&e.offsetParent){ const b=e.getBoundingClientRect(); if(b.height) floor=Math.min(floor,b.top); } });
  const hd=document.getElementById('viewHeader'), top=hd?hd.getBoundingClientRect().bottom:r.top;
  return {l:Math.max(0,r.left)+10, r:Math.min(innerWidth,r.right)-10, top, floor:floor-2};
}
function petHidden(){
  if(PH()&&PH().hidden&&PH().hidden()) return true;
  return pt.hide||!pt.layer||document.hidden||petView()==='screen'||document.documentElement.classList.contains('kbopen')||!pt.run.size;
}

// ---------- 매 프레임 ----------
function petLoop(){
  const step=ts=>{
    pt.raf=requestAnimationFrame(step);
    if(ts-pt.last<33) return;   // 약 30fps
    const dt=Math.min(0.05,(ts-pt.last)/1000); pt.last=ts;
    if(petHidden()&&!pt.mode){ if(pt.layer) pt.layer.style.display='none'; return; }
    pt.layer.style.display='';
    const a=petArea();
    for(const p of pt.run.values()){ petStep(p,dt,a); petPaint(p); }
    if(pt.mode&&pt.mode.step) pt.mode.step(dt,a);
    petDecalsPos();
  };
  pt.raf=requestAnimationFrame(step);
}
const PET_SPD={cat:70, dog:80};
function petSpeed(p){ const s=petSpOf(p.d); return (PET_SPD[s.kind]*(s.short?0.8:1)*(s.size||1))*petScale()/2; }

function petStep(p,dt,a){
  const S=petScale(), spd=petSpeed(p);
  p.ft+=dt; const fr=p.st==='walk'||p.st==='run'?0.16:p.st==='sleep'?0.7:0.45; if(p.ft>fr){ p.ft=0; p.f++; }
  if(p.sayT>0){ p.sayT-=dt; if(p.sayT<=0) p.say.classList.remove('on'); }
  if(p.st==='held'){ petSwing(p,dt,true); return; }
  if(p.st!=='air'&&(p.th||p.om)){ p.th=0; p.om=0; }
  // 발판(말풍선·공지 위 등)에 올라가 있으면 그 칸을 따라 움직임 (스크롤해도 같이)
  let gy=a.floor, gl=a.l, gr=a.r;
  if(p.plat){
    const e=p.plat.el, r=e&&e.isConnected?e.getBoundingClientRect():null;
    const ok=r&&r.width>0&&(p.plat.inside?r.bottom:r.top)>a.top+10&&(p.plat.inside?r.bottom:r.top)<a.floor-10&&r.right>a.l&&r.left<a.r;
    if(!ok){ p.plat=null; if(p.st!=='jump'){ p.st='air'; p.vx=0; p.vy=0; } }
    else { gy=p.plat.inside?r.bottom-4:r.top; gl=Math.max(a.l,r.left+12*S/2); gr=Math.min(a.r,r.right-12*S/2); if(p.st!=='jump'&&p.st!=='air'){ p.x+=(r.left-p.plat.lx); p.y=gy; } p.plat.lx=r.left; }
  }
  if(p.st==='jump'){
    p.jt+=dt/p.jd; const t=Math.min(1,p.jt), J=p.j;
    let ty=J.y1; if(J.plat){ const r=J.plat.el.isConnected?J.plat.el.getBoundingClientRect():null; if(r) ty=J.plat.inside?r.bottom-4:r.top; }
    p.x=J.x0+(J.x1-J.x0)*t; p.y=J.y0+(ty-J.y0)*t-J.h*4*t*(1-t);
    if(t>=1){ p.y=ty; if(J.plat){ p.plat=J.plat; p.plat.lx=J.plat.el.getBoundingClientRect().left; } p.st='idle'; p.t=0.8+Math.random()*2; if(J.then) J.then(p); }
    return;
  }
  if(p.st==='air'){
    petSwing(p,dt,false);
    p.vy+=1700*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.995;
    if(p.x<a.l){ p.x=a.l; p.vx=-p.vx*0.4; } if(p.x>a.r){ p.x=a.r; p.vx=-p.vx*0.4; }
    if(p.y>=a.floor){ p.y=a.floor; p.plat=null; if(Math.abs(p.vy)>700){ p.vy=-p.vy*0.25; p.vx*=0.5; } else { p.vy=0; p.vx=0; p.st='idle'; p.t=1+Math.random()*2; } }
    return;
  }
  p.y=gy; p.x=Math.max(gl,Math.min(gr,p.x));
  if(pt.mode&&pt.mode.drive&&pt.mode.drive(p,dt,a,gl,gr)) return;   // 놀이 중이면 놀이가 움직임을 정함
  if(p.st==='walk'||p.st==='run'){
    const tx=Math.max(gl,Math.min(gr,p.tx)), dx=tx-p.x, v=p.st==='run'?spd*2.2:spd;
    if(Math.abs(dx)<3){ p.st='idle'; p.t=1.5+Math.random()*3; if(p.onArrive){ const f=p.onArrive; p.onArrive=null; f(p); } }
    else { p.face=dx>0?1:-1; p.x+=Math.sign(dx)*Math.min(Math.abs(dx),v*dt); }
    return;
  }
  p.t-=dt; if(p.t>0) return;
  if(p.st==='act'){ p.st='idle'; p.t=1+Math.random()*2; p.tongue=false; return; }
  if(p.st==='sleep'){ p.st='idle'; p.t=1; return; }
  petThink(p,a,gl,gr);
}

// 다음에 뭐 할지
function petThink(p,a,gl,gr){
  const d=p.d, cat=petIsCat(d), r=Math.random(), mine=p.id===petMe(), S=petScale();
  const canShare=mine&&Date.now()-pt.lastShared>110000&&!document.hidden;
  // 🌧️ 날씨 탭에서 비가 오면 레이더 안으로 들어가 놀다 젖음
  if(!p.plat&&petView()==='weather'&&petRaining()&&!petWet(d)&&r<0.45){
    const v=document.querySelector('.wxRadarView'); const vr=v&&v.getBoundingClientRect();
    if(vr&&vr.height>60&&vr.bottom<a.floor&&vr.bottom>a.top+60){ petJump(p,{el:v,inside:true}, vr.left+vr.width*(0.25+Math.random()*0.5), vr.bottom-4, q=>petRainPlay(q)); return; }
  }
  if(p.plat){
    if(p.plat.inside){ petJumpDown(p,a); return; }
    if(r<0.35){ p.st='walk'; p.tx=gl+Math.random()*(gr-gl); return; }
    if(r<0.6&&p.plat.key&&canShare){ petDoFx(p, cat&&Math.random()<0.5?'bite':(cat?'bite':'lick'), p.plat); return; }
    petJumpDown(p,a); return;
  }
  if(cat&&r<0.32){ const pl=petPickPlat(p,a); if(pl){ petJump(p,pl,pl.x,pl.y); return; } }
  if(!cat&&r<0.3&&canShare){   // 강아지: 바닥 가까운 말풍선·공지를 핥거나 끝을 묾
    const pl=petNearFloor(p,a); if(pl){ p.st='walk'; p.tx=pl.x; p.onArrive=q=>petDoFx(q, Math.random()<0.6?'lick':'bite', pl); return; }
  }
  if(r<0.42&&canShare&&cat){ const pl=petNearFloor(p,a); if(pl){ p.st='walk'; p.tx=pl.x; p.onArrive=q=>petDoFx(q,'bite',pl); return; } }
  if(r>0.93){ p.st='sleep'; p.t=12+Math.random()*20; return; }
  if(r>0.6){ p.st='idle'; p.t=2+Math.random()*4; return; }
  p.st='walk'; p.tx=a.l+Math.random()*(a.r-a.l);
}
function petRaining(){ try{ if(!wxData||typeof wxCurrent!=='function') return false; const c=wxCurrent(wxData); return !!(c&&(c.pty||c.raining)); }catch(e){ return false; } }

// 올라갈 수 있는 곳 (고양이): 공지·말풍선·날씨 카드·달력 칸
const PET_PLAT_SEL='#messages .msg:not(.deleted), .noticePost, .wxCard, .calDay';
function petPlatKey(el){
  if(PH()&&PH().platKey) return PH().platKey(el);
  if(el.matches('#messages .msg')) return el.dataset.mid?'m:'+el.dataset.mid:null;
  if(el.matches('.noticePost')) return el.dataset.id?'n:'+el.dataset.id:null;
  return null;
}
function petPlats(a){
  const out=[]; document.querySelectorAll((PH()&&PH().platSel)||PET_PLAT_SEL).forEach(el=>{ if(!el.offsetParent) return; const r=el.getBoundingClientRect();
    if(r.width<50||r.top<a.top+40||r.top>a.floor-50||r.right<a.l+20||r.left>a.r-20) return; out.push({el, r, key:petPlatKey(el)}); });
  return out;
}
function petPickPlat(p,a){
  const S=petScale(), list=petPlats(a).filter(x=>Math.abs((x.r.left+x.r.right)/2-p.x)<420&&p.y-x.r.top<420);
  if(!list.length) return null;
  const x=list[Math.floor(Math.random()*list.length)], lo=Math.max(a.l,x.r.left+14*S/2), hi=Math.min(a.r,x.r.right-14*S/2);
  if(hi<=lo) return null;
  return {el:x.el, key:x.key, x:lo+Math.random()*(hi-lo), y:x.r.top};
}
function petNearFloor(p,a){   // 바닥에서 닿는 높이의 말풍선·공지 (아래쪽 모서리)
  const S=petScale(), list=petPlats({...a, top:-1e9}).filter(x=>x.key&&x.r.bottom>a.floor-36*S*0.9&&x.r.bottom<a.floor+4);
  if(!list.length) return null;
  const x=list[Math.floor(Math.random()*list.length)], side=Math.random()<0.5?0:1;
  return {el:x.el, key:x.key, x:Math.max(a.l,Math.min(a.r, side?x.r.right-4:x.r.left+4)), y:x.r.bottom, low:true};
}
function petJump(p,plat,x1,y1,then){
  const h=Math.max(50, p.y-y1+50);
  p.j={x0:p.x, y0:p.y, x1, y1, h, plat:plat&&plat.el?{el:plat.el, key:plat.key, inside:!!plat.inside}:null, then};
  p.jt=0; p.jd=0.5+Math.min(0.4,Math.abs(p.y-y1)/900); p.face=x1>p.x?1:-1; p.st='jump'; p.plat=null;
}
function petJumpDown(p,a){ const x=Math.max(a.l,Math.min(a.r,p.x+(Math.random()<.5?-1:1)*(40+Math.random()*80))); petJump(p,null,x,a.floor); }

// 🌧️ 레이더 안에서 빗속 놀기 → 젖음 (pets.wetAt, 모두에게 보임)
function petRainPlay(p){
  let n=0; p.st='walk'; const tick=()=>{ if(!p.plat||!p.plat.inside){ return; }
    const r=p.plat.el.getBoundingClientRect(); petRainDrops(p);
    if(++n<6){ p.st='walk'; p.tx=r.left+20+Math.random()*(r.width-40); setTimeout(tick,1100); return; }
    petSay(p,'으앙 다 젖었어 💦');
    const d=p.d, db=petDb(); if(!petWet(d)&&db) db.doc('pets/'+p.id).update({wetAt:Date.now(), dirt:Math.min(24*14,(d.dirt||0)+6)}).catch(()=>{});
    setTimeout(()=>{ if(p.plat&&p.plat.inside) petJumpDown(p,petArea()); },1500);
  }; tick();
}
function petRainDrops(p){
  for(let i=0;i<6;i++){ const d=document.createElement('div'); d.className='petRain'; const S=petScale();
    d.style.left=(p.x-30*S/2+Math.random()*60*S/2)+'px'; d.style.top=(p.y-60*S/2)+'px'; d.style.animationDelay=(i*0.12)+'s';
    pt.layer.appendChild(d); setTimeout(()=>d.remove(),1400); }
}

// 🦷 물기 · 👅 핥기 → petFx 로 모두에게
function petDoFx(p,k,plat){
  if(!plat||!plat.key||!plat.el||!plat.el.isConnected) return;
  const r=plat.el.getBoundingClientRect(), ox=Math.max(0,Math.min(1,(p.x-r.left)/Math.max(1,r.width)));
  p.face=(r.left+r.width/2)>p.x?1:-1;
  p.st='act'; p.t=1.6; p.tongue=k==='lick';
  petSay(p, k==='lick'?'할짝할짝 👅':(petIsCat(p.d)?'앙! 🦷':'앙앙! 🦷'));
  if(p.id!==petMe()) return;
  pt.lastShared=Date.now();
  const e={k, t:plat.key, at:Date.now(), ox:Math.round(ox*100)/100, low:plat.low?1:0};
  const cur=(pt.fx[p.id]&&pt.fx[p.id].list)||[];
  const list=cur.filter(x=>Date.now()-x.at<PET_FX_MS.lick).concat([e]).slice(-8);
  pt.fx[p.id]={list, at:e.at}; petFxApply();
  const db=petDb(); if(db) db.doc('petFx/'+p.id).set({list, at:e.at}).catch(()=>{});
}
function petSay(p,txt,sec){ p.say.textContent=txt; p.say.classList.add('on'); p.sayT=sec||2.2; }

// ---------- 효과 (찌그러진 말풍선·침 자국) ----------
function petFxSel(t){
  if(PH()&&PH().fxSel) return PH().fxSel(t);   // 'm:메시지id' → 그 앱의 말풍선 CSS 선택자
  const [k,id]=[t.slice(0,1),t.slice(2)], q=window.CSS&&CSS.escape?CSS.escape(id):id.replace(/[^\w-]/g,'');
  return k==='m'?'#messages .msg[data-mid="'+q+'"]':k==='n'?'.noticePost[data-id="'+q+'"]':null;
}
function petFxApply(){
  if(!pt.layer) return;
  const now=Date.now(), want=new Map();
  Object.entries(pt.fx).forEach(([who,doc])=>((doc&&doc.list)||[]).forEach(e=>{
    if(!e||!PET_FX_MS[e.k]||now-e.at>PET_FX_MS[e.k]||typeof e.t!=='string') return;
    const sel=petFxSel(e.t); if(sel) want.set(who+':'+e.at,{...e, sel, who});
  }));
  for(const [k,d] of pt.decals) if(!want.has(k)){ d.el.remove(); pt.decals.delete(k); }
  let css='';
  want.forEach((e,k)=>{
    if(!pt.decals.has(k)){ const el=document.createElement('div'); el.className='petDecal '+e.k; el.title=(pt.docs[e.who]?petNameOf(pt.docs[e.who]):'펫')+(e.k==='bite'?'이(가) 물었어요':'이(가) 핥았어요');
      if(e.k==='lick') el.innerHTML='<i></i><b>💧</b>'; pt.layer.appendChild(el); pt.decals.set(k,{...e, el}); }
    if(e.k==='bite'){ const L=e.ox<0.5, sg=L?1:-1; css+=e.sel+'{transform:rotate('+(sg*1.4)+'deg) skewX('+(-sg*3)+'deg) scale(.985);transform-origin:'+(L?'left':'right')+' bottom;transition:transform .35s;border-'+(e.low?'bottom':'top')+'-'+(L?'left':'right')+'-radius:3px!important}\n'; }
  });
  if(pt.styleEl.textContent!==css) pt.styleEl.textContent=css;
}
function petDecalsPos(){
  const now=Date.now();
  for(const d of pt.decals.values()){
    const el=document.querySelector(d.sel); if(!el||!el.offsetParent){ d.el.style.display='none'; continue; }
    const r=el.getBoundingClientRect(), a=petArea();
    if(r.bottom<a.top||r.top>a.floor+40){ d.el.style.display='none'; continue; }
    d.el.style.display='';
    const age=(now-d.at)/PET_FX_MS[d.k];
    if(d.k==='bite'){ const L=d.ox<0.5; d.el.style.left=(L?r.left-3:r.right-9)+'px'; d.el.style.top=(d.low?r.bottom-9:r.top-3)+'px'; }
    else { d.el.style.left=(r.left+d.ox*r.width-16)+'px'; d.el.style.top=(d.low?r.bottom-14:r.top-4)+'px'; d.el.style.opacity=String(Math.max(0.15,1-age)); }
  }
}

// ---------- 그리기 ----------
function petPaint(p){
  const S=petScale(), d=p.d, cat=petIsCat(d);
  let act='idle', f=p.f;
  if(p.st==='walk'||p.st==='run'||p.st==='fetch') act='walk', f=p.f%4;
  else if(p.st==='jump') act='walk', f=1;
  else if(p.st==='air') act=p.vy<0?'walk':'held', f=p.vy<0?1:p.f%2;
  else if(p.st==='held') act='held', f=p.f%2;
  else if(p.st==='sleep') act='sleep', f=p.f%4;
  else f=p.f%8;
  const o={dirt:petDirt(d), wet:petWet(d), tongue:!!p.tongue&&act!=='held'};
  const s=petSprite(p.sp, act, f, o), cv=p.cv;
  if(cv.width!==s.width||cv.height!==s.height){ cv.width=s.width; cv.height=s.height; }
  if(p.drawn!==s){ const g=cv.getContext('2d'); g.clearRect(0,0,cv.width,cv.height); g.drawImage(s,0,0); p.drawn=s; }
  const w=s.width*S, h=s.height*S;
  cv.style.width=w+'px'; cv.style.height=h+'px';
  if((p.st==='held'||p.st==='air')&&Math.abs(p.th||0)>0.5){ cv.style.transformOrigin='50% 3%'; cv.style.transform='rotate('+p.th.toFixed(1)+'deg)'+(act==='walk'&&p.face<0?' scaleX(-1)':''); }
  else { cv.style.transformOrigin=''; cv.style.transform=(act==='walk'&&p.face<0)?'scaleX(-1)':''; }
  p.el.style.transform='translate('+Math.round(p.x-w/2)+'px,'+Math.round(p.y-h)+'px)';
  p.el.style.width=w+'px';
  p.el.classList.toggle('dirty2', o.dirt>1);
}

// ---------- 들어 올리기 · 던지기 · 쓰다듬기 ----------
// 들고 흔들면: 손이 가는 반대쪽으로 몸이 기울었다가 멈추면 대롱대롱 (스프링+감쇠 진자, 각도 p.th · 각속도 p.om)
function petSwing(p,dt,held){
  if(dt<=0) return;
  let target=0;
  if(held){ const vx=p.px==null?0:(p.x-p.px)/dt; p.px=p.x; p.vxs=(p.vxs||0)*0.6+vx*0.4; target=Math.max(-65,Math.min(65,-p.vxs*0.06)); }
  else p.px=null;
  p.th=p.th||0; p.om=p.om||0;
  p.om+=((target-p.th)*70-p.om*(held?5:3))*dt; p.th+=p.om*dt;
  p.th=Math.max(-80,Math.min(80,p.th));
  if(held){ p.dizzy=(p.dizzy||0)*0.985+Math.abs(p.om)*dt;
    if(p.dizzy>40&&p.sayT<=0){ petSay(p,petIsCat(p.d)?'냐아아~ 어지러워 @_@':'으아아~ 멍멍 @_@',1.6); p.dizzy=0; } }
}
function petBindDrag(p){
  p.el.addEventListener('pointerdown',e=>{
    if(pt.mode&&pt.mode.noDrag) return;
    e.preventDefault(); e.stopPropagation();
    const g={sx:e.clientX, sy:e.clientY, moved:false, hist:[[e.clientX,e.clientY,performance.now()]]};
    try{ p.el.setPointerCapture(e.pointerId); }catch(_){}
    const mv=ev=>{
      if(!g.moved&&Math.hypot(ev.clientX-g.sx,ev.clientY-g.sy)>6){ g.moved=true; p.px=null; p.vxs=0; p.th=0; p.om=0; p.st='held'; p.plat=null; p.onArrive=null; p.tongue=false; petSay(p,petIsCat(p.d)?'냐앙?! 🙀':'낑? 🐶',1.5); }
      if(g.moved){ const S=petScale(), s=petSprite(p.sp,'held',0); p.x=ev.clientX; p.y=ev.clientY+s.height*S*0.92; g.hist.push([ev.clientX,ev.clientY,performance.now()]); if(g.hist.length>6) g.hist.shift(); }
    };
    const up=ev=>{
      p.el.removeEventListener('pointermove',mv); p.el.removeEventListener('pointerup',up); p.el.removeEventListener('pointercancel',up);
      if(g.moved){ const h=g.hist, a=h[0], b=h[h.length-1], dt=Math.max(16,b[2]-a[2])/1000;
        p.vx=Math.max(-1400,Math.min(1400,(b[0]-a[0])/dt)); p.vy=Math.max(-1400,Math.min(900,(b[1]-a[1])/dt)); p.st='air'; }
      else petTap(p);
    };
    p.el.addEventListener('pointermove',mv); p.el.addEventListener('pointerup',up); p.el.addEventListener('pointercancel',up);
  });
}
function petTap(p){
  const d=p.d, cat=petIsCat(d), dl=petDirt(d);
  if(p.st==='sleep'){ p.st='idle'; p.t=1.5; petSay(p,'…으음? 😪'); return; }
  const heart=document.createElement('div'); heart.className='petHeart'; heart.textContent='💕';
  heart.style.left=p.x+'px'; heart.style.top=(p.y-36*petScale())+'px'; pt.layer.appendChild(heart); setTimeout(()=>heart.remove(),1200);
  petSay(p, dl>1?'꼬질꼬질… 씻겨 줘요 🛁':dl?(cat?'냥~ (좀 꼬질)':'멍! (좀 꼬질)'):petWet(d)?'축축해… 💦':(cat?['냥!','냐앙~','골골골…'][Math.floor(Math.random()*3)]:['멍!','왈왈!','헥헥 🐾'][Math.floor(Math.random()*3)]));
  if(!p.plat&&p.st!=='air'){ p.st='air'; p.vx=0; p.vy=-380; }
}

// ---------- 놀이: 🎣 낚싯대 (고양이) · 🎾 공 던지기 (강아지) ----------
function petBring(id){ pt.call.add(id); petSync(); return pt.run.get(id); }
function petPlayBar(txt){
  const cover=document.createElement('div'); cover.id='petPlay'; pt.layer.appendChild(cover);
  const bar=document.createElement('div'); bar.className='petPlayBar'; bar.innerHTML='<span>'+txt+'</span><button type="button">그만 놀기</button>';
  document.body.appendChild(bar); bar.querySelector('button').onclick=petPlayEnd;
  return {cover, bar};
}
function petPlayEnd(){
  const m=pt.mode; if(!m) return; pt.mode=null;
  if(m.end) m.end();
  ['petPlay'].forEach(id=>{ const e=document.getElementById(id); if(e) e.remove(); });
  document.querySelectorAll('.petPlayBar,.petLure,.petLine,.petBall').forEach(e=>e.remove());
  for(const p of pt.run.values()){ if(p.st==='run'||p.st==='fetch'){ p.st='idle'; p.t=1; } p.tongue=false; }
}
function petFish(id){
  petClosePanel(); petPlayEnd();
  const me=petBring(id); if(!me) return;
  const {cover}=petPlayBar('🎣 낚싯대를 움직여 보세요 (고양이들이 쫓아와요)');
  const line=document.createElement('div'); line.className='petLine'; const lure=document.createElement('div'); lure.className='petLure'; lure.innerHTML='<i></i><i></i><i></i>';
  pt.layer.append(line,lure);
  const a0=petArea(); const L={x:(a0.l+a0.r)/2, y:a0.floor-140, px:0, py:0, v:0};
  const mv=e=>{ L.x=e.clientX; L.y=e.clientY; };
  cover.addEventListener('pointermove',mv); cover.addEventListener('pointerdown',e=>{ mv(e); try{ cover.setPointerCapture(e.pointerId); }catch(_){} });
  pt.mode={noDrag:true,
    step(dt,a){ L.v=L.v*0.8+Math.hypot(L.x-L.px,L.y-L.py)/Math.max(dt,0.016)*0.2; L.px=L.x; L.py=L.y;
      const y=Math.min(L.y,a.floor-6); line.style.left=L.x+'px'; line.style.top=a.top+'px'; line.style.height=Math.max(0,y-a.top)+'px';
      lure.style.transform='translate('+(L.x-10)+'px,'+(y-6)+'px) rotate('+(Math.sin(Date.now()/120)*Math.min(30,L.v/20))+'deg)'; },
    drive(p,dt,a){ if(!petIsCat(p.d)) return false;
      if(p.st==='sleep'){ p.st='idle'; }
      p.plat=null; p.y=a.floor;
      const dx=L.x-p.x, high=a.floor-Math.min(L.y,a.floor);
      p.cool=(p.cool||0)-dt;
      if(Math.abs(dx)<50&&high>30&&p.cool<=0){   // 뛰어올라 냥냥펀치
        p.st='air'; p.vy=-Math.sqrt(2*1700*Math.min(high+10,520)); p.vx=dx*2; p.cool=1.2+Math.random();
        if(Math.random()<0.5) petSay(p,['냥!','냥냥펀치!','잡았다?!'][Math.floor(Math.random()*3)],1); return true; }
      if(Math.abs(dx)>14){ p.st='run'; p.face=dx>0?1:-1; p.x+=Math.sign(dx)*Math.min(Math.abs(dx),petSpeed(p)*(L.v>300?2.6:1.8)*dt); }
      else { p.st='idle'; p.t=1; }
      return true; },
    end(){ cover.removeEventListener('pointermove',mv); }
  };
}
function petBall(id){
  petClosePanel(); petPlayEnd();
  const dog=petBring(id); if(!dog) return;
  const {cover}=petPlayBar('🎾 화면을 끌었다 놓아서 공을 던져 주세요 · '+petNameOf(dog.d)+'이(가) 물어 와요');
  const ball=document.createElement('div'); ball.className='petBall'; pt.layer.appendChild(ball);
  const B={x:0,y:0,vx:0,vy:0,on:false,held:false}; let n=0, g=null, home={x:pt.hand.x||300};
  cover.addEventListener('pointerdown',e=>{ g={hist:[[e.clientX,e.clientY,performance.now()]]}; B.on=true; B.held=false; B.x=e.clientX; B.y=e.clientY; B.vx=B.vy=0; B.hand=true; try{ cover.setPointerCapture(e.pointerId); }catch(_){} });
  cover.addEventListener('pointermove',e=>{ if(!g) return; B.x=e.clientX; B.y=e.clientY; g.hist.push([e.clientX,e.clientY,performance.now()]); if(g.hist.length>6) g.hist.shift(); });
  cover.addEventListener('pointerup',e=>{ if(!g) return; const h=g.hist, a=h[0], b=h[h.length-1], dt=Math.max(16,b[2]-a[2])/1000;
    B.vx=Math.max(-1600,Math.min(1600,(b[0]-a[0])/dt)); B.vy=Math.max(-1600,Math.min(1000,(b[1]-a[1])/dt));
    if(Math.hypot(B.vx,B.vy)<120){ B.vx=(Math.random()<.5?-1:1)*(300+Math.random()*300); B.vy=-500; }
    B.hand=false; home={x:e.clientX}; g=null; dog.st='idle'; dog.t=0; petSay(dog,'멍!! 🐕',1); });
  pt.mode={noDrag:true,
    step(dt,a){
      if(B.on&&!B.hand&&!B.held){ B.vy+=1700*dt; B.x+=B.vx*dt; B.y+=B.vy*dt;
        if(B.x<a.l){ B.x=a.l; B.vx=-B.vx*0.6; } if(B.x>a.r){ B.x=a.r; B.vx=-B.vx*0.6; }
        if(B.y>a.floor-8){ B.y=a.floor-8; B.vy=Math.abs(B.vy)>120?-B.vy*0.55:0; B.vx*=0.9; if(!B.vy&&Math.abs(B.vx)<8) B.vx=0; } }
      if(B.held){ const S=petScale(); B.x=dog.x+dog.face*13*S; B.y=dog.y-15*S; }
      ball.style.display=B.on?'':'none'; ball.style.transform='translate('+(B.x-8)+'px,'+(B.y-8)+'px)'; },
    drive(p,dt,a){ if(p!==dog) return false; p.plat=null; p.y=a.floor;
      if(!B.on||B.hand){ if(p.st!=='idle'){ p.st='idle'; } p.t=1; return true; }
      const tx=B.held?home.x:B.x, dx=tx-p.x;
      if(!B.held&&Math.abs(dx)<16&&B.y>a.floor-40*petScale()){ B.held=true; petSay(p,'앙! 🎾',1); return true; }
      if(B.held&&Math.abs(dx)<20){ B.held=false; B.vx=p.face*60; B.vy=-120; n++; p.st='idle'; p.t=2; petSay(p,['멍멍! 또 던져 줘!','헥헥 🐾','왈! (꼬리 살랑)'][n%3],1.6); return true; }
      if(Math.abs(dx)>4){ p.st='run'; p.face=dx>0?1:-1; p.x+=Math.sign(dx)*Math.min(Math.abs(dx),petSpeed(p)*2.4*dt); }
      return true; },
    end(){ const db=petDb(); if(n>0&&db&&dog.d) db.doc('pets/'+dog.id).update({dirt:Math.min(24*14,(dog.d.dirt||0)+Math.min(6,n*0.5))}).catch(()=>{}); }
  };
}

// ---------- 🛁 목욕 ----------
function petBath(id){
  const d=pt.docs[id]; if(!d) return; petClosePanel(); petPlayEnd();
  const bg=document.createElement('div'); bg.className='petBgWrap petModalBg'; bg.style.display='flex';
  bg.innerHTML='<div class="petSheet petBathModal"><div class="petTop"><b>🛁 '+petEsc(petNameOf(d))+' 목욕</b><button type="button" class="petX">✕</button></div>'+
    '<div class="petBathStage"><div class="petTub"><div class="petWater"></div></div></div><div class="petBar"><i></i></div><div class="petHint">🧼 펫을 문질러서 거품을 내 주세요</div></div>';
  document.body.appendChild(bg);
  const stage=bg.querySelector('.petBathStage'), bar=bg.querySelector('.petBar i'), hint=bg.querySelector('.petHint'), close=()=>{ bg.remove(); cancelAnimationFrame(raf); };
  bg.querySelector('.petX').onclick=close; bg.addEventListener('click',e=>{ if(e.target===bg) close(); });
  const sc=petPhone()?4:5, cv=petCanvas(d.sp,'idle',sc,{dirt:petDirt(d)}); cv.classList.add('petBathPet'); stage.insertBefore(cv, stage.firstChild);
  let phase='soap', foam=0, bubbles=[], done=false, raf=0;
  const shower=document.createElement('div'); shower.className='petShower'; shower.textContent='🚿'; stage.appendChild(shower);
  const onPet=(x,y)=>{ const r=cv.getBoundingClientRect(); return x>r.left&&x<r.right&&y>r.top&&y<r.bottom; };
  let last=null;
  stage.addEventListener('pointerdown',e=>{ try{ stage.setPointerCapture(e.pointerId); }catch(_){} last=[e.clientX,e.clientY]; });
  stage.addEventListener('pointermove',e=>{
    const sr=stage.getBoundingClientRect(), x=e.clientX, y=e.clientY;
    if(phase==='rinse'){ shower.style.display=''; shower.style.left=(x-sr.left-14)+'px'; shower.style.top=(y-sr.top-40)+'px'; }
    if(done||!onPet(x,y)) { last=[x,y]; return; }
    const dist=last?Math.hypot(x-last[0],y-last[1]):0; last=[x,y];
    if(phase==='soap'&&dist>2){ foam=Math.min(100,foam+dist/45);
      if(Math.random()<0.6){ const b=document.createElement('i'); b.className='petBub'; const s=10+Math.random()*22; b.style.cssText='width:'+s+'px;height:'+s+'px;left:'+(x-sr.left-s/2)+'px;top:'+(y-sr.top-s/2)+'px'; stage.appendChild(b); bubbles.push(b); }
      if(foam>=100){ phase='rinse'; hint.textContent='🚿 이제 샤워기로 거품을 헹궈 주세요'; } }
    if(phase==='rinse'){ for(let i=0;i<3;i++){ const w=document.createElement('i'); w.className='petDrop'; w.style.left=(x-sr.left-6+Math.random()*12)+'px'; w.style.top=(y-sr.top-10)+'px'; stage.appendChild(w); setTimeout(()=>w.remove(),600); }
      bubbles=bubbles.filter(b=>{ const br=b.getBoundingClientRect(); if(Math.hypot(br.left+br.width/2-x,br.top+br.height/2-y)<46){ b.classList.add('pop'); setTimeout(()=>b.remove(),250); return false; } return true; });
      if(!bubbles.length){ done=true; petBathDone(id, cv, stage, hint, sc); } }
    bar.style.width=(phase==='soap'?foam/2:50+50*(1-bubbles.length/Math.max(1,bubbles.length+40)))+'%';
  });
}
function petBathDone(id, cv, stage, hint, sc){
  const d=pt.docs[id]||{}, s=petCanvas(d.sp,'idle',sc,{wet:true}); s.className=cv.className; cv.replaceWith(s);
  stage.parentNode.querySelector('.petBar i').style.width='100%';
  hint.textContent='✨ 깨끗해졌어요! '+petNameOf(d)+' 뽀송뽀송 (조금 동안은 젖어 있어요)';
  for(let i=0;i<8;i++){ const k=document.createElement('i'); k.className='petSpark'; k.textContent='✨'; k.style.left=(20+Math.random()*60)+'%'; k.style.top=(20+Math.random()*50)+'%'; k.style.animationDelay=(i*0.1)+'s'; stage.appendChild(k); }
  const db=petDb(); if(db) db.doc('pets/'+id).update({bathAt:Date.now(), dirt:0, wetAt:Date.now(), bathBy:petMyName().slice(0,40)}).catch(e=>petToast('목욕 저장이 안 됐어요 😢'));
}

// ---------- 🏃 어질리티 (강아지): 옆에서 보는 달리기 — 장애물이 오른쪽에서 와요 ----------
//   허들·콘·웅덩이는 점프로 넘고, 긴 터널은 엎드려서 기어 지나가요. 🦴 간식은 땅·공중·터널 안에
//   조작: 위쪽 누르기·스페이스·↑ = 점프 / 아래쪽 누르고 있기·↓ = 엎드리기
function petAgility(id){
  const d=pt.docs[id]; if(!d) return; petClosePanel(); petPlayEnd();
  const bg=document.createElement('div'); bg.className='petBgWrap petModalBg'; bg.style.display='flex';
  bg.innerHTML='<div class="petSheet petAgiModal"><div class="petTop"><b>🏃 '+petEsc(petNameOf(d))+' 어질리티 연습</b><button type="button" class="petX">✕</button></div>'+
    '<div class="petAgiHud"><span class="lv">❤️❤️❤️</span><span class="sc">🦴 0</span><span class="tm">⏱ 40</span></div>'+
    '<div class="petAgiStage"><div class="petAgiSky"></div><div class="petAgiGround"></div>'+
    '<div class="petAgiZone up">⬆ 점프</div><div class="petAgiZone down">⬇ 엎드리기</div>'+
    '<div class="petAgiStart"><div><b>장애물이 오른쪽에서 와요!</b><br>🚧 허들·콘·웅덩이는 <b>점프</b> (위쪽 누르기 · 스페이스 · ↑)<br>🟦 긴 터널은 <b>엎드려서</b> 지나가기 (아래쪽 누르고 있기 · ↓)<br>🦴 간식도 먹어요</div><button type="button">시작!</button><small>최고 기록 '+(d.agi||0)+'점</small></div></div></div>';
  document.body.appendChild(bg);
  const st=bg.querySelector('.petAgiStage'), gr=bg.querySelector('.petAgiGround'), hudL=bg.querySelector('.lv'), hudS=bg.querySelector('.sc'), hudT=bg.querySelector('.tm');
  let raf=0; const keys={};
  const kd=e=>{ if(!G.run) return; if(e.key===' '||e.key==='ArrowUp'||e.key==='w'){ e.preventDefault(); jump(); } if(e.key==='ArrowDown'||e.key==='s'){ e.preventDefault(); G.duckK=true; } };
  const ku=e=>{ if(e.key==='ArrowDown'||e.key==='s') G.duckK=false; };
  const close=()=>{ cancelAnimationFrame(raf); G.run=false; document.removeEventListener('keydown',kd); document.removeEventListener('keyup',ku); bg.remove(); };
  bg.querySelector('.petX').onclick=close;
  document.addEventListener('keydown',kd); document.addEventListener('keyup',ku);
  const S=2, dogEl=document.createElement('canvas'); dogEl.className='petAgiDog'; st.appendChild(dogEl);
  const W=()=>st.clientWidth, H=()=>st.clientHeight, GROUND=()=>H()-34;
  const G={run:false, x:0, y:0, vy:0, duckP:false, duckK:false, f:0, ft:0, life:3, bones:0, t:40, inv:0, obs:[], spawn:0, v:230, dist:0, gx:0};
  const jump=()=>{ if(G.run&&G.y>=GROUND()-0.5&&!(G.duckP||G.duckK)){ G.vy=-580; } };
  st.addEventListener('pointerdown',e=>{ if(e.target.closest('.petAgiStart')||!G.run) return; e.preventDefault(); try{ st.setPointerCapture(e.pointerId); }catch(_){}
    const r=st.getBoundingClientRect(); if(e.clientY-r.top<r.height*0.55) jump(); else G.duckP=true; });
  const upP=()=>{ G.duckP=false; }; st.addEventListener('pointerup',upP); st.addEventListener('pointercancel',upP);
  // 장애물: h = 땅에서 높이(넘어야 할 높이) / tunnel = 위가 막힌 긴 통로(엎드려야 함)
  const KINDS=[{k:'hurdle',w:20,h:46},{k:'cone',w:26,h:32},{k:'puddle',w:64,h:8},{k:'tunnel'},{k:'tunnel'},{k:'bone'},{k:'bone'},{k:'hurdle',w:20,h:46}];
  const add=K=>{ const g=GROUND(); let o;
    if(K.k==='tunnel'){ const w=170+Math.random()*120; o={k:'tunnel', w, h:62, x:W()+20, y:g}; }
    else if(K.k==='bone'){ const where=Math.random(); o={k:'bone', w:26, h:14, x:W()+20, y:where<0.45?g-10:g-95, good:1}; }
    else o={...K, x:W()+20, y:g};
    o.el=document.createElement('div'); o.el.className='petObs '+o.k; o.el.style.width=o.w+'px'; o.el.style.height=o.h+'px'; st.appendChild(o.el);
    G.obs.push(o);
    if(o.k==='tunnel'&&Math.random()<0.7){ const b={k:'bone', w:26, h:14, x:o.x+o.w/2, y:g-8, good:1}; b.el=document.createElement('div'); b.el.className='petObs bone'; b.el.style.width='26px'; b.el.style.height='14px'; st.appendChild(b.el); G.obs.push(b); }
  };
  const start=()=>{ st.querySelector('.petAgiStart').style.display='none'; G.obs.forEach(o=>o.el.remove()); Object.assign(G,{run:true, life:3, bones:0, t:40, obs:[], spawn:1, v:230, dist:0, vy:0, inv:0}); G.x=Math.max(60,W()*0.2); G.y=GROUND(); last=performance.now(); raf=requestAnimationFrame(loop); };
  st.querySelector('.petAgiStart button').onclick=start;
  let last=0;
  const end=()=>{
    G.run=false; const score=Math.floor(G.dist/30)+G.bones*20;
    const box=st.querySelector('.petAgiStart'); box.style.display='';
    box.innerHTML='<div><b>'+(G.life>0?'🏁 완주!':'💫 아이고, 넘어졌어요')+'</b><br>점수 <b>'+score+'</b>점 (🦴 '+G.bones+'개)'+(score>(d.agi||0)?'<br>🎉 새 최고 기록!':'')+'</div><button type="button">다시</button>';
    box.querySelector('button').onclick=start;
    const db=petDb(); if(db){ const up={dirt:Math.min(24*14,((pt.docs[id]||d).dirt||0)+3)}; if(score>(d.agi||0)){ up.agi=score; d.agi=score; } db.doc('pets/'+id).update(up).catch(()=>{}); }
  };
  const loop=ts=>{
    if(!G.run) return; raf=requestAnimationFrame(loop);
    const dt=Math.min(0.05,(ts-last)/1000); last=ts; const g=GROUND();
    G.t-=dt; G.v+=dt*6; G.dist+=G.v*dt; G.inv-=dt;
    G.vy+=1900*dt; G.y+=G.vy*dt; if(G.y>=g){ G.y=g; G.vy=0; }
    const duck=(G.duckP||G.duckK)&&G.y>=g-0.5;
    G.ft+=dt; if(G.ft>0.09){ G.ft=0; G.f++; }
    G.gx=(G.gx+G.v*dt)%40; gr.style.backgroundPosition=(-G.gx)+'px 0';
    G.spawn-=dt; if(G.spawn<=0){ const K=KINDS[Math.floor(Math.random()*KINDS.length)]; add(K); G.spawn=Math.max(0.75,1.5-G.dist/12000)+Math.random()*0.5+(K.k==='tunnel'?0.6:0); }
    const act=G.y<g-0.5?'walk':duck?'crawl':'walk', fr=G.y<g-0.5?1:G.f%4;
    const s=petSprite(d.sp,act,fr,{}); if(dogEl.width!==s.width||dogEl.height!==s.height){ dogEl.width=s.width; dogEl.height=s.height; }
    const c=dogEl.getContext('2d'); c.clearRect(0,0,dogEl.width,dogEl.height); c.drawImage(s,0,0);
    const dw=s.width*S, dh=s.height*S;
    dogEl.style.width=dw+'px'; dogEl.style.transform='translate('+Math.round(G.x-dw/2)+'px,'+Math.round(G.y-dh)+'px)';
    dogEl.style.opacity=G.inv>0&&Math.floor(G.inv*10)%2?'0.4':'1';
    // 몸 크기(맞았는지 판정): 엎드리면 낮아짐
    const top=G.y-(duck?dh*0.5:dh*0.72), L=G.x-dw*0.3, R=G.x+dw*0.32;
    G.obs=G.obs.filter(o=>{ o.x-=G.v*dt;
      o.el.style.transform='translate('+Math.round(o.k==='tunnel'||o.k==='puddle'||o.k==='hurdle'||o.k==='cone'?o.x:o.x-o.w/2)+'px,'+Math.round(o.k==='bone'?o.y-o.h/2:o.y-o.h)+'px)';
      const ox1=o.k==='bone'?o.x-o.w/2:o.x, ox2=ox1+o.w, over=R>ox1&&L<ox2;
      if(o.good){ if(over&&o.y-o.h/2<G.y&&o.y+o.h/2>top){ G.bones++; o.el.remove(); return false; } }
      else if(over&&!o.done&&G.inv<=0){
        const hit=o.k==='tunnel'?(!duck||G.y<g-0.5):(G.y>g-o.h+4);
        if(hit){ G.life--; G.inv=1.1; o.done=true; o.el.classList.add('hit'); if(o.k==='puddle') o.el.classList.add('splash'); }
      }
      if(o.x+o.w<-40){ o.el.remove(); return false; } return true; });
    hudL.textContent='❤️'.repeat(Math.max(0,G.life))+'🤍'.repeat(3-Math.max(0,G.life)); hudS.textContent='🦴 '+G.bones; hudT.textContent='⏱ '+Math.max(0,Math.ceil(G.t));
    if(G.life<=0||G.t<=0) end();
  };
}

// ---------- 🐾 펫 패널 ----------
let petPanelSel=null;
function openPets(){
  if(typeof closeSidebar==='function') closeSidebar();
  if(!pt.on) petsInit();
  let bg=document.getElementById('petBg');
  if(!bg){ bg=document.createElement('div'); bg.className='petBgWrap'; bg.id='petBg';
    bg.innerHTML='<div class="petSheet petModal"><div class="petTop"><b>🐾 우리 펫</b><button type="button" class="petX">✕</button></div><div id="petBody"></div></div>';
    document.body.appendChild(bg); bg.querySelector('.petX').onclick=petClosePanel; bg.addEventListener('click',e=>{ if(e.target===bg) petClosePanel(); }); }
  bg.style.display='flex'; petPanelSel=null; petPanelRender();
}
function petClosePanel(){ const bg=document.getElementById('petBg'); if(bg) bg.style.display='none'; }
function petStatus(d){
  const days=petDirtDays(d), dl=petDirt(d);
  return (petWet(d)?'💦 젖었어요 · ':'')+(dl>1?'🤢 엄청 꼬질꼬질':dl?'🟤 꼬질꼬질':'✨ 깨끗')+' ('+(days<1?'오늘':Math.floor(days)+'일')+(d.bathBy?' · 마지막 목욕 '+d.bathBy:'')+')';
}
function petSideRender(){   // 왼쪽 팀원 아래 버튼: 내 펫 그림 + 상태 한 줄
  const ic=document.getElementById('petSideIc'), sub=document.getElementById('petSideSub'); if(!ic) return;
  const d=pt.docs[petMe()];
  if(!d){ ic.textContent='🐾'; sub.textContent=Object.keys(pt.docs).length?'모두의 펫 '+Object.keys(pt.docs).length+'마리 · 내 펫 데려오기':'같이 키우는 강아지·고양이'; return; }
  const key=d.sp+'|'+petDirt(d)+'|'+petWet(d);
  if(ic.dataset.k!==key){ ic.dataset.k=key; ic.innerHTML=''; const c=petCanvas(d.sp,'idle',1,{dirt:petDirt(d), wet:petWet(d)}); ic.appendChild(c); }
  const dl=petDirt(d); sub.textContent=petNameOf(d)+' · '+(petWet(d)?'💦 젖음':dl>1?'🤢 엄청 꼬질':dl?'🟤 꼬질꼬질':'✨ 깨끗');
}
function petPanelRender(){
  petSideRender();
  const box=document.getElementById('petBody'); if(!box||document.getElementById('petBg').style.display!=='flex') return;
  const me=petMe(), mine=pt.docs[me];
  box.innerHTML='';
  if(pt.err){ const e=document.createElement('div'); e.className='petErr'; e.textContent=pt.err; box.appendChild(e); }
  if(!mine||petPanelSel){
    const h=document.createElement('div'); h.className='petSecH'; h.textContent=mine?'🔁 다른 아이로 바꾸기':'내 펫을 골라 주세요 (한 사람당 한 마리)'; box.appendChild(h);
    const grid=document.createElement('div'); grid.className='petPick';
    let sel=petPanelSel&&petPanelSel!==true?petPanelSel:(mine?mine.sp:null);
    const nameIn=document.createElement('input'); nameIn.type='text'; nameIn.maxLength=12; nameIn.placeholder='이름 (12자까지)'; nameIn.value=mine?mine.name:'';
    Object.entries(PET_SP).forEach(([k,s])=>{ const b=document.createElement('button'); b.type='button'; b.className='petPickBtn'+(sel===k?' on':'');
      b.appendChild(petCanvas(k,'idle',2)); b.insertAdjacentHTML('beforeend','<span>'+petEsc(s.b)+'</span>');
      b.onclick=()=>{ sel=k; petPanelSel=k; grid.querySelectorAll('.petPickBtn').forEach(x=>x.classList.toggle('on',x===b)); if(!nameIn.value||Object.values(PET_SP).some(z=>z.n===nameIn.value)) nameIn.value=s.n; };
      grid.appendChild(b); });
    box.appendChild(grid);
    const row=document.createElement('div'); row.className='petRow'; row.appendChild(nameIn);
    const ok=document.createElement('button'); ok.type='button'; ok.className='petMain'; ok.textContent=mine?'바꾸기':'데려오기 🐾';
    ok.onclick=async()=>{ if(!sel){ petToast('아이를 먼저 골라 주세요'); return; } const name=(nameIn.value||PET_SP[sel].n).trim().slice(0,12)||PET_SP[sel].n;
      const db=petDb(); try{ if(mine) await db.doc('pets/'+me).update({sp:sel, name}); else await db.doc('pets/'+me).set({owner:me, sp:sel, name, createdAt:Date.now(), bathAt:Date.now(), dirt:0});
        petPanelSel=null; petToast(mine?'바꿨어요':'🐾 '+name+'이(가) 왔어요!'); }catch(e){ petToast('저장이 안 됐어요 (권한) 😢'); } };
    row.appendChild(ok);
    if(mine){ const cc=document.createElement('button'); cc.type='button'; cc.textContent='취소'; cc.onclick=()=>{ petPanelSel=null; petPanelRender(); }; row.appendChild(cc); }
    box.appendChild(row);
    if(!mine) { petPanelAll(box); return; }
    return;
  }
  // 내 펫
  const card=document.createElement('div'); card.className='petMine';
  card.appendChild(petCanvas(mine.sp,'idle',3,{dirt:petDirt(mine), wet:petWet(mine)}));
  const info=document.createElement('div'); info.className='petInfo';
  info.innerHTML='<b>'+petEsc(petNameOf(mine))+'</b> <small>'+petEsc(petSpOf(mine).b)+'</small><div class="petSt">'+petEsc(petStatus(mine))+'</div>'+(petIsCat(mine)?'':'<div class="petSt">🏃 어질리티 최고 '+(mine.agi||0)+'점</div>');
  const btns=document.createElement('div'); btns.className='petBtns';
  petActBtns(me, mine).forEach(b=>btns.appendChild(b));
  const rn=document.createElement('button'); rn.type='button'; rn.textContent='✏️ 이름'; rn.onclick=async()=>{ const v=prompt('새 이름 (12자까지)', mine.name||''); if(v==null) return; const n=v.trim().slice(0,12); if(!n) return; try{ await petDb().doc('pets/'+me).update({name:n}); }catch(e){ petToast('저장이 안 됐어요 😢'); } };
  const ch=document.createElement('button'); ch.type='button'; ch.textContent='🔁 바꾸기'; ch.onclick=()=>{ petPanelSel=true; petPanelRender(); };
  btns.append(rn,ch); info.appendChild(btns); card.appendChild(info); box.appendChild(card);
  petPanelAll(box);
}
function petActBtns(id,d){
  const out=[], mk=(t,f)=>{ const b=document.createElement('button'); b.type='button'; b.textContent=t; b.onclick=f; out.push(b); };
  mk('🛁 목욕',()=>petBath(id));
  if(petIsCat(d)) mk('🎣 낚싯대',()=>petFish(id)); else { mk('🎾 공 던지기',()=>petBall(id)); mk('🏃 어질리티',()=>petAgility(id)); }
  return out;
}
function petPanelAll(box){
  const me=petMe(), ids=Object.keys(pt.docs).filter(id=>id!==me);
  const h=document.createElement('div'); h.className='petSecH'; h.textContent='🏡 모두의 펫 ('+Object.keys(pt.docs).length+'마리) · 누구 펫이든 같이 놀고 씻겨 줄 수 있어요'; box.appendChild(h);
  if(!ids.length){ const e=document.createElement('div'); e.className='petEmpty'; e.textContent='아직 다른 직원의 펫이 없어요'; box.appendChild(e); }
  ids.sort((a,b)=>petDirtDays(pt.docs[b])-petDirtDays(pt.docs[a])).forEach(id=>{ const d=pt.docs[id];
    const r=document.createElement('div'); r.className='petItem'; r.appendChild(petCanvas(d.sp,'idle',2,{dirt:petDirt(d), wet:petWet(d)}));
    const i=document.createElement('div'); i.className='petInfo'; i.innerHTML='<b>'+petEsc(petNameOf(d))+'</b> <small>'+petEsc(petOwnerName(id))+' · '+petEsc(petSpOf(d).b)+'</small><div class="petSt">'+petEsc(petStatus(d))+'</div>';
    const bs=document.createElement('div'); bs.className='petBtns';
    const call=document.createElement('button'); call.type='button'; call.textContent=pt.run.has(id)?'📍 화면에 있어요':'📍 불러오기'; call.onclick=()=>{ petBring(id); petPanelRender(); };
    bs.appendChild(call); petActBtns(id,d).forEach(b=>bs.appendChild(b)); i.appendChild(bs); r.appendChild(i); box.appendChild(r); });
  const foot=document.createElement('div'); foot.className='petFoot';
  const hb=document.createElement('button'); hb.type='button'; hb.textContent=pt.hide?'🙈 펫 숨김 중 (이 기기) → 보이기':'🙈 펫 숨기기 (이 기기만)';
  hb.onclick=()=>{ pt.hide=!pt.hide; try{ localStorage.setItem('petHide',pt.hide?'1':'0'); }catch(e){} petPanelRender(); };
  foot.appendChild(hb);
  foot.insertAdjacentHTML('beforeend','<div class="petHelp">펫을 끌어서 들어 올리거나 던질 수 있어요 · 누르면 반가워해요<br>🐱 고양이는 공지·말풍선·달력 칸 위로 폴짝 · 🦷 말풍선 끝을 물면 잠깐 찌그러지고 · 🐶 강아지는 핥아서 침 자국 (모두에게 보이지만 글 내용은 안 바뀌어요)<br>🌧️ 비 오는 날 날씨 탭 레이더에서 놀다 젖어요 · 3일 지나면 꼬질, 7일이면 엄청 꼬질 → 🛁 목욕</div>');
  box.appendChild(foot);
}
