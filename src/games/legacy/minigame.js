// 🎮 미니게임 공통 틀: 쉬움·보통·어려움 단계 버튼 + 캔버스 게임 창 + 단계별 순위표 (🚗 카트 배차왕, ⛳ 로스트볼 찾기가 씀)
// 게임 하나(M)는 이런 모양: {key, title, col(순위 컬렉션), V(기록 버전), unit(점수 단위), nUnit(두 번째 숫자 단위),
//   help()→안내 HTML, fresh(lv)→새 게임 상태, step(g,dt), draw(c,g), down(g,p,e)/move/up, ready(lv)→시작 화면 줄들, over(g)→끝 화면 줄들, n(g)}
// 기록: {col}/{아이디} = {v, name, b1,n1, b2,n2, b3,n3} (단계별 최고 점수와 그때의 두 번째 숫자) — 플레이 시각은 기록하지 않음
const MG_W=360, MG_H=520;
const MG_LV=[{k:1,n:'쉬움',ic:'🟢'},{k:2,n:'보통',ic:'🟡'},{k:3,n:'어려움',ic:'🔴'}];
const mgMe=()=>(typeof myAccount!=='undefined'&&myAccount&&myAccount.loginId)||null;
const mgRand=(a,b)=>a+Math.random()*(b-a);
const mgClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mgLvOf=M=>MG_LV[(M.lv||1)-1];
function mgRR(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
const MG_FONT='"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
// text drawn left-aligned at a computed x (Safari draws centered text with a max width oddly)
function mgText(c,t,x,y,size,col,align,stroke){
  c.font='800 '+size+'px '+MG_FONT; c.textBaseline='middle'; c.textAlign='left';
  const w=c.measureText(t).width, x0=align==='center'?x-w/2:align==='right'?x-w:x;
  if(stroke!==false){ c.lineWidth=3; c.strokeStyle='rgba(0,0,0,.45)'; c.strokeText(t,x0,y); }
  c.fillStyle=col||'#fff'; c.fillText(t,x0,y); return w;
}
function mgFit(c,t,maxW,size){ let s=size; c.font='800 '+s+'px '+MG_FONT; while(s>9&&c.measureText(t).width>maxW){ s--; c.font='800 '+s+'px '+MG_FONT; } return s; }

// 순위 기록이 서버에 안 올라가면: 화면에 이유를 알리고, 기기에 남겨 뒀다가 다음에 게임을 열 때 다시 올림
function scoreFailed(label, key, e, args){
  console.warn(key+' upload',e);
  try{ localStorage.setItem('ydr_retry_'+key+'_'+mgMe(), JSON.stringify(args)); }catch(_){}
  if(typeof toast==='function') toast('⚠️ '+label+' 기록을 순위에 못 올렸어요 ('+((e&&(e.code||e.message))||'오류')+') · 다음에 게임을 열 때 다시 올려요');
}
const scoreSaved=key=>{ try{ localStorage.removeItem('ydr_retry_'+key+'_'+mgMe()); }catch(_){} };
function scoreRetry(key, fn){ let a=null; try{ a=JSON.parse(localStorage.getItem('ydr_retry_'+key+'_'+mgMe())||'null'); }catch(_){} if(a) fn(...a); }
// admin only: names whose records were saved by an old version of the app (hidden from the ranking)
function scoreOldNote(docs, isOld){
  if(!(typeof isAdmin==='function'&&isAdmin())) return '';
  const names=docs.filter(d=>isOld(d.data())).map(d=>d.data().name||d.id);
  return names.length?'<div class="gfEmptySm" style="text-align:left">⚠️ (관리자에게만 보임) 예전 버전 앱으로 저장돼 순위에서 빠진 기록: <b>'+names.map(gfEsc).join(', ')+'</b> · 이 직원들은 앱을 완전히 껐다 켜고 다시 해야 해요</div>':'';
}
function mgOpen(M){
  if(!mgMe()) return;
  if(M.who!==mgMe()){ M.who=mgMe(); M.st='ready'; M.g=null; M.best=null; M.bestLoaded=null; }
  const id=M.key;
  let bg=document.getElementById(id+'Bg');
  if(!bg){
    bg=document.createElement('div'); bg.className='modal-bg mgBg'; bg.id=id+'Bg';
    bg.innerHTML='<div class="modal golfModal"><div class="gfTop"><div class="gfTitleBox"><b>'+M.title+'</b><span class="gfBest" data-r="best"></span></div><button class="gfRankBtn" data-r="rankBtn">🏆 순위표</button><button class="gfNew" data-r="new">🔄 새 게임</button><button class="gfX" data-r="x" title="닫기">✕</button></div>'
      +'<div class="brLvRow">'+MG_LV.map(L=>'<button class="brLv" data-lv="'+L.k+'">'+L.ic+' '+L.n+'</button>').join('')+'</div>'
      +'<div class="gfRank" data-r="rank" style="display:none"></div><div class="gfPlay" data-r="play"><canvas class="mgCv"></canvas><div class="gfHelp" data-r="help"></div></div></div>';
    document.body.appendChild(bg);
    M.bg=bg; M.el=k=>bg.querySelector('[data-r="'+k+'"]');
    M.cv=bg.querySelector('canvas'); M.ctx=M.cv.getContext('2d');
    M.el('x').onclick=()=>mgClose(M);
    M.el('new').onclick=()=>mgNew(M);
    M.el('rankBtn').onclick=()=>mgRankToggle(M);
    bg.querySelectorAll('.brLv').forEach(b=>b.onclick=()=>mgSetLv(M,+b.dataset.lv));
    const cv=M.cv;
    cv.addEventListener('pointerdown',e=>mgDown(M,e)); cv.addEventListener('pointermove',e=>{ if(M.st==='play'&&M.move) M.move(M.g,mgPos(M,e),e); });
    cv.addEventListener('pointerup',e=>{ if(M.st==='play'&&M.up) M.up(M.g,mgPos(M,e),e); }); cv.addEventListener('pointercancel',e=>{ if(M.st==='play'&&M.up) M.up(M.g,null,e); });
    cv.addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('keydown',e=>{ if(bg.style.display==='flex'&&e.key==='Escape') mgClose(M); });
    document.addEventListener('visibilitychange',()=>{ if(document.hidden&&M.st==='play') M.st='pause'; });
    window.addEventListener('resize',()=>{ if(bg.style.display==='flex'&&M.cv.offsetParent) mgSize(M); });
  }
  if(M.noLv) M.lv=1;   // one track that gets harder by itself: no 쉬움·보통·어려움 buttons
  else if(!M.lv){ try{ M.lv=+localStorage.getItem('ydr_'+id+'_lv')||1; }catch(e){ M.lv=1; } }
  bg.querySelector('.brLvRow').style.display=M.noLv?'none':'';
  if(!M.g){ M.g=M.fresh(M.lv); M.st='ready'; }
  else if(M.st==='play') M.st='pause';
  clearTimeout(M.closeT); bg.classList.remove('gfClosing'); bg.style.display='flex';
  mgLvBtns(M); M.el('help').innerHTML=M.help(); mgRankToggle(M,false); mgBestLbl(M); mgLoadBest(M);
  scoreRetry(M.col,(k,s,n)=>mgUpload(M,k,s,n));
  cancelAnimationFrame(M.raf); M.last=performance.now(); M.raf=requestAnimationFrame(t=>mgLoop(M,t));
}
function mgClose(M){
  const bg=M.bg;
  if(bg&&bg.style.display==='flex'){ bg.classList.add('gfClosing'); clearTimeout(M.closeT); M.closeT=setTimeout(()=>{ bg.style.display='none'; bg.classList.remove('gfClosing'); },200); }
  cancelAnimationFrame(M.raf); M.raf=0;
  if(M.st==='play') M.st='pause';
}
async function mgNew(M){
  if(M.st==='play'||M.st==='pause'){ M.st='pause'; if(!(await uiConfirm('지금 게임을 그만두고 처음부터 할까요?','새 게임'))) return; }
  M.g=M.fresh(M.lv); M.st='ready'; mgRankToggle(M,false);
}
function mgLvBtns(M){ M.bg.querySelectorAll('.brLv').forEach(b=>b.classList.toggle('on',+b.dataset.lv===M.lv)); }
async function mgSetLv(M,k){
  if(k===M.lv) return;
  if(M.st==='play'||M.st==='pause'){ M.st='pause'; if(!(await uiConfirm('지금 게임을 그만두고 '+MG_LV[k-1].ic+' '+MG_LV[k-1].n+' 단계로 바꿀까요?','바꾸기'))) return; }
  M.lv=k; try{ localStorage.setItem('ydr_'+M.key+'_lv',k); }catch(e){}
  mgLvBtns(M); mgBestLbl(M);
  M.g=M.fresh(k); M.st='ready';
  if(M.el('rank').style.display!=='none') mgRankLoad(M);
}
function mgSize(M){
  const cv=M.cv, wrap=cv.parentElement;
  const maxW=Math.min(wrap.clientWidth-20, 420), maxH=Math.max(220, Math.min(window.innerHeight*0.7, window.innerHeight*0.94-150));
  const sc=Math.min(maxW/MG_W, maxH/MG_H);
  cv.style.width=Math.round(MG_W*sc)+'px'; cv.style.height=Math.round(MG_H*sc)+'px';
  M.dpr=Math.min(3,(window.devicePixelRatio||1)*sc);
  cv.width=Math.round(MG_W*M.dpr); cv.height=Math.round(MG_H*M.dpr);
}
function mgPos(M,e){ const r=M.cv.getBoundingClientRect(); return {x:(e.clientX-r.left)*MG_W/r.width, y:(e.clientY-r.top)*MG_H/r.height}; }
function mgDown(M,e){
  e.preventDefault();
  if(M.st!=='play'){ if(M.st==='over'&&performance.now()-M.overAt<900) return; if(M.st==='over') M.g=M.fresh(M.lv); M.st='play'; M.last=performance.now(); return; }
  try{ M.cv.setPointerCapture(e.pointerId); }catch(_){}
  M.down(M.g,mgPos(M,e),e);
}
function mgLoop(M,t){
  if(M.who!==mgMe()){ M.raf=0; if(M.bg) M.bg.style.display='none'; M.st='ready'; M.g=null; return; }
  const dt=Math.min(0.05,(t-M.last)/1000); M.last=t;
  if(M.st==='play'&&M.g) M.step(M.g,dt);
  if(M.g&&M.cv.offsetParent){ const c=M.ctx; c.setTransform(M.dpr,0,0,M.dpr,0,0); M.draw(c,M.g); if(M.st!=='play') mgOverlay(M,c); }
  M.raf=requestAnimationFrame(tt=>mgLoop(M,tt));
}
// the end of a game: called by the game's step (why: 'time' / 'hp' / anything)
function mgEnd(M,why){
  if(M.st!=='play') return;
  const g=M.g, k=M.oneRank?1:M.lv; M.st='over'; M.overAt=performance.now(); g.why=why;
  M.best=M.best||{}; g.newBest=g.score>0&&(M.best[k]==null||g.score>M.best[k]);   // 0점은 '최고 기록' 축하 안 함
  if(g.newBest){ M.best[k]=g.score; mgBestLbl(M); }
  if(g.score>0) mgUpload(M,k,g.score,M.n(g));   // 0점은 순위에 올리지 않음
}
function mgOverlay(M,c){
  const g=M.g, L=mgLvOf(M);
  c.fillStyle='rgba(15,30,15,.62)'; c.fillRect(0,0,MG_W,MG_H);
  let lines;
  if(M.st==='ready') lines=[[M.title+(M.noLv?'':' · '+L.ic+' '+L.n),22,'#2b4a6b'],...M.ready(M.lv),['',8],['👆 화면을 누르면 시작!',17,'#e8504a']];
  else if(M.st==='pause') lines=[['⏸️ 잠깐 멈춤',22,'#2b4a6b'],['남은 시간 '+Math.ceil(g.t)+'초 · '+g.score+M.unit,14,'#555'],['👆 누르면 계속',16,'#e8504a']];
  else lines=[...M.over(g),['',6],[g.newBest?'🎉 '+(M.noLv||M.oneRank?'':L.n+' 단계 ')+'내 최고 기록!':(M.best||{})[M.oneRank?1:M.lv]==null?'다음엔 꼭 기록을 남겨 봐요!':'🏆 '+(M.noLv||M.oneRank?'':L.n+' ')+'내 최고 '+((M.best||{})[M.oneRank?1:M.lv])+M.unit,16,g.newBest?'#2f7a34':'#555'],['👆 누르면 다시 하기',16,'#e8504a']];
  const gap=l=>l[0]===''?l[1]:Math.max(22,l[1]*1.55), h=lines.reduce((a,l)=>a+gap(l),0)+40, y0=Math.max(60,(MG_H-h)/2);
  c.fillStyle='rgba(255,255,255,.95)'; mgRR(c,26,y0,MG_W-52,h,22); c.fill();
  let y=y0+20;
  lines.forEach(l=>{ const gp=gap(l); if(l[0]){ const s=mgFit(c,l[0],MG_W-76,l[1]); mgText(c,l[0],MG_W/2,y+gp/2,s,l[2]||'#333','center',false); } y+=gp; });
}
function mgBestLbl(M){ const el=M.el('best'), L=mgLvOf(M), b=M.best&&M.best[M.oneRank?1:L.k]; if(el) el.textContent=b!=null?'🏆 '+(M.noLv||M.oneRank?'내':L.n)+' 최고 '+b+M.unit:M.sub; }
// oneRank: one ranking for every start level — the best of b1·b2·b3 (records kept per level before) counts
function mgMerge(v){ let b=null, n=0; MG_LV.forEach(L=>{ const x=v['b'+L.k]; if(x!=null&&(b==null||x>b||(x===b&&(v['n'+L.k]||0)>n))){ b=+x; n=v['n'+L.k]||0; } }); return {b,n}; }

// ---------- 🏆 기록 ----------
async function mgLoadBest(M){
  const me=mgMe(); if(!me||!db||M.bestLoaded===me) return;
  try{ const d=await db.collection(M.col).doc(me).get(); M.bestLoaded=me; const v=d.exists&&d.data().v===M.V?d.data():{}; M.best=M.best||{};
    if(M.oneRank){ const x=mgMerge(v).b; if(x!=null&&(M.best[1]==null||x>M.best[1])) M.best[1]=x; }
    else MG_LV.forEach(L=>{ const x=v['b'+L.k]; if(x!=null&&(M.best[L.k]==null||x>M.best[L.k])) M.best[L.k]=x; }); mgBestLbl(M); }catch(e){}
}
async function mgUpload(M,k,score,n){
  const me=mgMe(); if(!me||!db||!db.runTransaction) return;
  const ref=db.collection(M.col).doc(me);
  try{
    await db.runTransaction(async t=>{
      const d=(await t.get(ref)).data()||{}, o={v:M.V, name:(myProfile&&myProfile.name)||d.name||''};
      if(d.v===M.V&&M.oneRank){ const x=mgMerge(d); if(x.b!=null){ o.b1=x.b; o.n1=x.n; } }
      else if(d.v===M.V) MG_LV.forEach(L=>{ if(d['b'+L.k]!=null){ o['b'+L.k]=d['b'+L.k]; o['n'+L.k]=d['n'+L.k]||0; } });
      if(o['b'+k]==null||score>o['b'+k]){ o['b'+k]=score; o['n'+k]=n; }
      t.set(ref,o);
    });
    scoreSaved(M.col);
  }catch(e){ scoreFailed(M.title,M.col,e,[k,score,n]); }
}
function mgRankToggle(M,show){
  const r=M.el('rank'), p=M.el('play'), btn=M.el('rankBtn');
  if(show===undefined) show=r.style.display==='none';
  r.style.display=show?'':'none'; p.style.display=show?'none':''; btn.textContent=show?'🎮 게임':'🏆 순위표';
  const on=show?r:p; on.classList.remove('gfFadeIn'); void on.offsetWidth; on.classList.add('gfFadeIn');
  M.el('new').style.display=show?'none':'';
  M.bg.querySelector('.brLvRow').style.display=M.noLv||(show&&M.oneRank)?'none':'';   // one ranking: no 쉬움·보통·어려움 buttons over it
  if(show){ if(M.st==='play') M.st='pause'; mgRankLoad(M); } else mgSize(M);
}
async function mgRankLoad(M){
  const box=M.el('rank'); box.innerHTML='<div class="gfEmpty">불러오는 중...</div>';
  const me=mgMe(), L=mgLvOf(M); let rows=[], oldNote='';
  try{ const snap=await db.collection(M.col).get(); snap.forEach(d=>{ const v=d.data(); if(v.v!==M.V) return; if(M.oneRank){ const x=mgMerge(v); if(x.b!=null) rows.push({id:d.id, name:v.name, best:x.b, n:x.n}); return; } if(v['b'+L.k]!=null) rows.push({id:d.id, name:v.name, best:+v['b'+L.k], n:v['n'+L.k]||0}); });
    oldNote=scoreOldNote(snap.docs,v=>(+v.v||0)<M.V); }
  catch(e){ box.innerHTML='<div class="gfEmpty">순위표를 불러오지 못했어요</div>'; return; }
  rows.sort((a,b)=>b.best-a.best||b.n-a.n||String(a.name).localeCompare(String(b.name)));
  let html='<div class="gfSec">🏆 '+(M.noLv||M.oneRank?'':L.ic+' '+L.n+' 단계 ')+'순위 <span>('+(M.rankNote||'각자 최고 점수 · 높을수록 위')+')</span></div>';
  if(!rows.length) html+='<div class="gfEmptySm">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요! '+M.icon+'</div>';
  else {
    html+='<div class="gfList">'; let rank=0, prev=null;
    rows.forEach((r,i)=>{ if(r.best!==prev){ rank=i+1; prev=r.best; }
      const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank+'위';
      html+='<div class="gfRow'+(r.id===me?' me':'')+'" style="cursor:default"><span class="gfMedal">'+medal+'</span><span class="gfNm">'+gfEsc(r.name||'직원')+(r.id===me?' (나)':'')+'</span><span class="gfBestCol"><b>'+r.best+M.unit+'</b> <i>'+r.n+M.nUnit+'</i></span></div>'; });
    html+='</div>';
  }
  box.innerHTML=html+oldNote;
}
