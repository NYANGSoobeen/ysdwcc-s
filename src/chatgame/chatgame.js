// 🎲 채팅 미니 게임: 📊 투표 · 🪜 사다리타기 · 🎲 주사위 · 🎡 돌림판 · 🎟️ 제비뽑기
// - 채팅 ＋ 버튼에서 만들면 메시지 하나로 올라감: {text:'📊 투표: …'(글로 요약), game:{type, …}}
//   text 는 알림·검색·타부서 앱(게임 화면이 없을 때)에서 그대로 글로 보이게 하는 요약
// - 결과(사다리 모양·주사위 눈·돌림판·당첨자)는 만드는 순간 정해서 같이 저장 → 누가 봐도 결과가 똑같음
// - 투표만 나중에 바뀜: votes:{사람id:[고른 번호…]} (사람마다 자기 칸만 씀 · 게스트도 보안 규칙이 자기 칸만 허용)
// - 방금(20초 안) 올라온 주사위·돌림판·제비뽑기는 굴러가는 모습이 저절로 나오고, 카드를 누르면 다시 봄
// 메시지 모양은 GUEST_LINK.md(타부서 앱)와 같이 맞춤
const GAME_RECENT=20000, GAME_MAX_ITEMS=10;
const gamePlayed=new Set();          // 이 화면에서 이미 굴린 메시지 (다시 그려도 또 굴리지 않게)
const ladderOpened=new Map();        // 사다리: 메시지별로 내가 열어 본 사람 번호들 (다시 그려도 그대로)
function gameRand(n){ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%n; }
function gameShuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=gameRand(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
// 여러 줄 또는 쉼표로 적은 목록 → 항목들 (빈 칸·너무 긴 것 정리)
function gameList(s){ if(Array.isArray(s)) return s.map(x=>String(x).trim().slice(0,30)).filter(Boolean); return String(s||'').split(/[\n,]/).map(x=>x.trim().slice(0,30)).filter(Boolean); }
function gameMenuItems(){
  return [
    {label:'📊 투표', action:()=>gameNew('poll')},
    {label:'🪜 사다리타기', action:()=>gameNew('ladder')},
    {label:'🎲 주사위', action:()=>gameNew('dice')},
    {label:'🎡 돌림판', action:()=>gameNew('wheel')},
    {label:'🎟️ 제비뽑기', action:()=>gameNew('draw')}
  ];
}
function gameNameHint(){   // 이 방에서 최근에 말한 사람들 (최대 10명)
  try{ const seen=[]; (typeof viewDocs!=='undefined'?viewDocs:[]).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(m=>{ if(m.authorId&&!m.system&&!seen.includes(m.authorId)) seen.push(m.authorId); });
    return seen.slice(0,GAME_MAX_ITEMS).map(id=>displayNameFor(id)).filter(n=>n&&n!=='팀원'); }catch(e){ return []; } }
async function gameNew(type){
  if(!db||!currentChannel) return;
  const ch=currentChannel;
  let game=null, text='';
  const extra={};
  if(type==='poll'){
    const r=await uiForm('📊 투표 만들기',[
      {key:'q', label:'질문', placeholder:'예: 오늘 점심 뭐 먹을까요?', maxlength:100},
      {key:'opts', label:'항목 (2~'+GAME_MAX_ITEMS+'개)', type:'list', min:2, start:3, max:GAME_MAX_ITEMS, maxlength:30, placeholder:'항목', addLabel:'항목 추가'},
      {key:'multi', type:'checkbox', label:'여러 개 고를 수 있게'},
      {key:'anon', type:'checkbox', label:'누가 골랐는지 안 보이게 (익명)'},
      {key:'until', label:'마감 시각 (비우면 직접 마감할 때까지)', type:'datetime-local'},
      {key:'photo', label:'🖼️ 사진 (선택)', type:'file', accept:'image/*'},
      {key:'link', label:'🔗 링크 (선택)', placeholder:'https://…', maxlength:500}
    ],{okLabel:'올리기'});
    if(!r) return;
    const q=(r.q||'').trim().slice(0,100), opts=(r.opts||[]).map(x=>String(x).slice(0,30));
    if(!q){ toast('질문을 적어 주세요'); return; }
    if(opts.length<2||opts.length>GAME_MAX_ITEMS){ toast('항목은 2~'+GAME_MAX_ITEMS+'개로 적어 주세요'); return; }
    const until=r.until?new Date(r.until).getTime():0;
    if(until&&until<Date.now()+60000){ toast('마감 시각은 지금보다 뒤로 정해 주세요'); return; }
    let link=(r.link||'').trim();
    if(link&&!/^https?:\/\//i.test(link)) link='https://'+link;
    if(link&&!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(link)){ toast('링크 주소를 확인해 주세요'); return; }
    game={type:'poll', q, opts, multi:!!r.multi, anon:!!r.anon, until:until||0, closed:false, ...(link?{link}:{})};
    text='📊 투표: '+q+'\n'+opts.map((o,i)=>(i+1)+'. '+o).join('\n')+(link?'\n'+link:'');
    // 사진은 채팅 사진과 똑같이 imageAssetId 로 (저장공간 정리·삭제·사진 저장이 그대로 됨) → 말풍선 맨 위에 보임
    if(r.photo&&/^image\//.test(r.photo.type)){
      if(!assets){ toast('이미지 업로드 권한이 없어요'); return; }
      try{ toast('사진 올리는 중...'); extra.imageAssetId=(await assets.upload(await compressImage(r.photo, CHAT_IMG))).id; }
      catch(e){ fail(e,'사진 올리기'); return; }
    }
  } else if(type==='ladder'){
    const r=await uiForm('🪜 사다리타기',[
      {key:'names', label:'참가자 (2~'+GAME_MAX_ITEMS+'명)', type:'list', max:GAME_MAX_ITEMS, maxlength:30, min:2, start:3, value:gameNameHint(), placeholder:'참가자', addLabel:'참가자 추가'},
      {key:'prizes', label:'결과 (예: 커피 쏘기 · 참가자보다 적으면 나머지는 "통과")', type:'list', max:GAME_MAX_ITEMS, maxlength:30, min:1, start:1, placeholder:'결과', addLabel:'결과 추가'}
    ],{okLabel:'올리기'});
    if(!r) return;
    const names=gameList(r.names);
    if(names.length<2||names.length>GAME_MAX_ITEMS){ toast('참가자는 2~'+GAME_MAX_ITEMS+'명으로 적어 주세요'); return; }
    let prizes=gameList(r.prizes).slice(0,names.length);
    if(!prizes.length){ toast('결과를 하나 이상 적어 주세요 (예: 커피 쏘기)'); return; }
    while(prizes.length<names.length) prizes.push('통과');
    game={type:'ladder', names, prizes:gameShuffle(prizes), rungs:ladderMake(names.length)};
    text='🪜 사다리타기: '+names.join(', ')+'\n결과: '+gameShuffle(prizes).join(', ')+' (누가 뭔지는 사다리를 타 봐야 알아요)';
  } else if(type==='dice'){
    const r=await uiForm('🎲 주사위',[{key:'n', label:'주사위 개수 (1~3)', type:'number', value:'1'}],{okLabel:'굴리기'});
    if(!r) return;
    const n=Math.max(1,Math.min(3,parseInt(r.n,10)||1)), vals=Array.from({length:n},()=>gameRand(6)+1);
    game={type:'dice', vals};
    text='🎲 주사위: '+vals.join(' · ')+(n>1?' (합 '+vals.reduce((a,b)=>a+b,0)+')':'');
  } else if(type==='wheel'){
    const r=await uiForm('🎡 돌림판',[{key:'opts', label:'항목 (2~'+GAME_MAX_ITEMS+'개)', type:'list', max:GAME_MAX_ITEMS, maxlength:30, min:2, start:3, placeholder:'항목', addLabel:'항목 추가'}],{okLabel:'돌리기'});
    if(!r) return;
    const opts=gameList(r.opts);
    if(opts.length<2||opts.length>GAME_MAX_ITEMS){ toast('항목은 2~'+GAME_MAX_ITEMS+'개로 적어 주세요'); return; }
    const pick=gameRand(opts.length);
    game={type:'wheel', opts, pick};
    text='🎡 돌림판: '+opts.join(', ')+' → '+opts[pick];
  } else if(type==='draw'){
    const r=await uiForm('🎟️ 제비뽑기',[
      {key:'names', label:'후보 (2~'+GAME_MAX_ITEMS+'명)', type:'list', max:GAME_MAX_ITEMS, maxlength:30, min:2, start:3, value:gameNameHint(), placeholder:'후보', addLabel:'후보 추가'},
      {key:'k', label:'뽑을 수', type:'number', value:'1'}
    ],{okLabel:'뽑기'});
    if(!r) return;
    const names=gameList(r.names);
    if(names.length<2||names.length>GAME_MAX_ITEMS){ toast('후보는 2~'+GAME_MAX_ITEMS+'명으로 적어 주세요'); return; }
    const k=Math.max(1,Math.min(names.length-1,parseInt(r.k,10)||1));
    const picked=gameShuffle(names.map((_,i)=>i)).slice(0,k).sort((a,b)=>a-b);
    game={type:'draw', names, picked};
    text='🎟️ 제비뽑기 ('+k+'명): '+picked.map(i=>names[i]).join(', ');
  }
  if(!game) return;
  const reply=typeof takeReply==='function'?takeReply():{};
  try{ await db.collection('channels/'+ch+'/messages').add({text, game, ...extra, authorId:myId||null, createdAt:Date.now(), ...reply}); }
  catch(e){ if(extra.imageAssetId&&typeof dropAsset==='function') dropAsset(extra.imageAssetId); fail(e,'올리기'); }
}

// ---------- 말풍선 안 카드 ----------
function gameCard(m){
  const g=m.game, el=document.createElement('div'); el.className='gameCard gm-'+g.type;
  el.onclick=e=>e.stopPropagation();
  try{
    if(g.type==='poll') pollCard(el, m);
    else if(g.type==='ladder') ladderCard(el, m);
    else if(g.type==='dice') diceCard(el, m);
    else if(g.type==='wheel') wheelCard(el, m);
    else if(g.type==='draw') drawCard(el, m);
    else { el.textContent=m.text||''; }
  }catch(e){ el.textContent=m.text||''; }
  return el;
}
function gameHead(el, icon, title, sub){
  const h=document.createElement('div'); h.className='gmHead';
  h.innerHTML='<span class="gmIc">'+icon+'</span><span class="gmTitle"></span>';
  h.querySelector('.gmTitle').textContent=title;
  if(sub){ const s=document.createElement('span'); s.className='gmSub'; s.textContent=sub; h.appendChild(s); }
  el.appendChild(h); return h;
}
const gameIsNew=m=>m.createdAt&&Date.now()-m.createdAt<GAME_RECENT&&!gamePlayed.has(m.id);
// 다시 보기 버튼
function gameReplay(el, fn){ const b=document.createElement('button'); b.type='button'; b.className='gmReplay'; b.textContent='↻ 다시 보기'; b.onclick=e=>{ e.stopPropagation(); fn(); }; el.appendChild(b); }

// 📊 투표
function pollClosed(g){ return !!g.closed||(g.until&&Date.now()>=g.until); }
function pollCard(el, m){
  const g=m.game, votes=m.votes||{}, me=myId||'', mine=new Set(votes[me]||[]);
  const closed=pollClosed(g), counts=g.opts.map(()=>0), who=g.opts.map(()=>[]);
  Object.keys(votes).forEach(id=>(votes[id]||[]).forEach(i=>{ if(counts[i]!=null){ counts[i]++; who[i].push(id); } }));
  const people=Object.keys(votes).filter(id=>(votes[id]||[]).length).length, top=Math.max(...counts);
  gameHead(el,'📊',g.q);
  const tags=[]; if(g.multi) tags.push('여러 개 선택'); if(g.anon) tags.push('익명');
  if(tags.length){ const t=document.createElement('div'); t.className='gmTags'; t.textContent=tags.join(' · '); el.appendChild(t); }
  g.opts.forEach((o,i)=>{
    const b=document.createElement('button'); b.type='button'; b.className='pollOpt'+(mine.has(i)?' on':'')+(closed&&top>0&&counts[i]===top?' win':'');
    b.disabled=closed;
    const pct=people?Math.round(counts[i]/people*100):0;
    b.innerHTML='<span class="pollBar"></span><span class="pollChk"></span><span class="pollTx"></span><span class="pollN"></span>';
    b.querySelector('.pollBar').style.width=pct+'%';
    b.querySelector('.pollChk').textContent=mine.has(i)?'✔':'';
    const tx=b.querySelector('.pollTx'); if(/https?:\/\//i.test(o)&&typeof chatLinkify==='function') chatLinkify(tx, o, m); else tx.textContent=o;
    b.querySelector('.pollN').textContent=counts[i]?counts[i]+'명':'';
    b.onclick=e=>{ e.stopPropagation(); pollVote(m, i); };
    el.appendChild(b);
    if(!g.anon&&who[i].length){ const w=document.createElement('div'); w.className='pollWho'; w.textContent=who[i].map(id=>displayNameFor(id)).join(', '); el.appendChild(w); }
  });
  if(g.link&&/^https?:\/\//i.test(g.link)){ const a=document.createElement('a'); a.className='pollLink'; a.href=g.link; a.target='_blank'; a.rel='noopener noreferrer';
    a.textContent='🔗 '+g.link.replace(/^https?:\/\//i,''); a.onclick=e=>e.stopPropagation(); el.appendChild(a); }
  const f=document.createElement('div'); f.className='gmFoot';
  const info=document.createElement('span');
  info.textContent=people+'명 참여'+(closed?' · 마감됐어요':g.until?' · '+new Date(g.until).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+' 마감':'');
  f.appendChild(info);
  if(!closed&&m.authorId===me){ const c=document.createElement('button'); c.type='button'; c.className='gmBtn'; c.textContent='마감하기';
    c.onclick=async e=>{ e.stopPropagation(); if(!await uiConfirm('투표를 마감할까요?\n마감하면 더 고를 수 없어요.')) return;
      try{ await gameRef(m).update({game:{...g, closed:true}}); }catch(err){ fail(err,'마감'); } };
    f.appendChild(c); }
  el.appendChild(f);
  // 마감 시각이 되면 저절로 '마감됐어요'로 바뀌게 (화면을 보고 있을 때)
  if(!closed&&g.until){ const ms=g.until-Date.now(); if(ms<36e5) setTimeout(()=>{ if(el.isConnected&&typeof renderMessages==='function'){ chatRowCache.rows.delete(m.id); renderMessages(); } }, ms+500); }
}
function gameRef(m){ return db.doc('channels/'+currentChannel+'/messages/'+m.id); }
async function pollVote(m, i){
  const g=m.game; if(!myId||pollClosed(g)) return;
  const cur=new Set((m.votes||{})[myId]||[]);
  if(g.multi){ if(cur.has(i)) cur.delete(i); else cur.add(i); }
  else { const had=cur.has(i); cur.clear(); if(!had) cur.add(i); }
  const fp=new firebase.firestore.FieldPath('votes', myId), arr=[...cur].sort((a,b)=>a-b);
  try{ await gameRef(m).update(fp, arr.length?arr:firebase.firestore.FieldValue.delete()); }
  catch(e){ fail(e,'투표'); }
}

// 🪜 사다리: rungs = 가로줄 위치 (줄 번호*16 + 왼쪽 세로줄 번호) · 세로줄 사이마다 적어도 하나
const LADDER_ROWS=10;
function ladderMake(n){
  for(let k=0;k<50;k++){ const r=ladderTry(n); if(r) return r; }   // 아주 가끔 빈 칸이 생기면 다시 만듦
  return ladderTry(n,true);
}
function ladderTry(n, force){
  const set=new Set();
  for(let r=0;r<LADDER_ROWS;r++) for(let c=0;c<n-1;c++){ if(!set.has(r*16+c-1)&&gameRand(100)<45) set.add(r*16+c); }
  for(let c=0;c<n-1;c++){ if([...set].some(v=>v%16===c)) continue;
    const free=[...Array(LADDER_ROWS).keys()].filter(r=>!set.has(r*16+c-1)&&!set.has(r*16+c+1));
    if(free.length) set.add(free[gameRand(free.length)]*16+c); else if(!force) return null; }
  return [...set].sort((a,b)=>a-b);
}
function ladderPath(g, start){   // → {end, pts:[[col,row]…]} (row: 0=맨 위 ~ LADDER_ROWS+1=맨 아래)
  const set=new Set(g.rungs||[]); let c=start; const pts=[[c,0]];
  for(let r=0;r<LADDER_ROWS;r++){
    if(set.has(r*16+c)){ pts.push([c,r+1],[c+1,r+1]); c++; }
    else if(set.has(r*16+c-1)){ pts.push([c,r+1],[c-1,r+1]); c--; }
  }
  pts.push([c,LADDER_ROWS+1]); return {end:c, pts};
}
const LADDER_COLORS=['#e2776e','#5ab0e8','#7ccf8a','#b58be8','#f6a33b','#ff7fa8','#3fb8af','#c9a227','#8a7cf0','#e05d9a'];
function ladderCard(el, m){
  const g=m.game, n=g.names.length, opened=ladderOpened.get(m.id)||new Set(); ladderOpened.set(m.id, opened);
  gameHead(el,'🪜','사다리타기', n+'명');
  const W=Math.max(220, n*52), H=210, top=26, bot=H-26, gap=W/n, x=c=>gap*(c+0.5), y=r=>top+(bot-top)*r/(LADDER_ROWS+1);
  const NS='http://www.w3.org/2000/svg', svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('class','ladderSvg'); svg.style.minWidth=Math.min(W,n*40)+'px';
  const mk=(tag,at)=>{ const e=document.createElementNS(NS,tag); for(const k in at) e.setAttribute(k,at[k]); svg.appendChild(e); return e; };
  for(let c=0;c<n;c++) mk('line',{x1:x(c),y1:y(0),x2:x(c),y2:y(LADDER_ROWS+1),class:'ldBase'});
  (g.rungs||[]).forEach(v=>{ const r=Math.floor(v/16), c=v%16; if(c<n-1) mk('line',{x1:x(c),y1:y(r+1),x2:x(c+1),y2:y(r+1),class:'ldBase'}); });
  const label=(tx,cx,cy,cls)=>{ const t=mk('text',{x:cx,y:cy,class:cls,'text-anchor':'middle','dominant-baseline':'middle'}); t.textContent=tx.length>5?tx.slice(0,5)+'…':tx; return t; };
  const result=document.createElement('div'); result.className='ldResult';
  const ends=g.names.map((_,i)=>ladderPath(g,i));
  const bottoms=g.prizes.map((p,c)=>label(opened.size&&[...opened].some(i=>ends[i].end===c)?p:'?', x(c), H-10, 'ldPrize'));
  const showResult=()=>{ result.replaceChildren(...[...opened].sort((a,b)=>a-b).map(i=>{ const d=document.createElement('div'); d.innerHTML='<i></i><b></b> → <span></span>';
    d.querySelector('i').style.background=LADDER_COLORS[i%10]; d.querySelector('b').textContent=g.names[i]; d.querySelector('span').textContent=g.prizes[ends[i].end]; return d; })); };
  const draw=(i, anim)=>{
    const p=ends[i], pts=p.pts.map(([c,r])=>x(c)+','+y(r)).join(' ');
    const pl=mk('polyline',{points:pts,class:'ldPath',stroke:LADDER_COLORS[i%10]});
    if(anim){ const len=pl.getTotalLength?pl.getTotalLength():1000; pl.style.strokeDasharray=len; pl.style.strokeDashoffset=len; pl.getBoundingClientRect(); pl.style.transition='stroke-dashoffset 1.6s ease-in-out'; pl.style.strokeDashoffset='0';
      setTimeout(()=>{ bottoms[p.end].textContent=g.prizes[p.end].length>5?g.prizes[p.end].slice(0,5)+'…':g.prizes[p.end]; bottoms[p.end].classList.add('on'); showResult(); },1550); }
    else { bottoms[p.end].classList.add('on'); }
  };
  g.names.forEach((nm,i)=>{ const t=label(nm, x(i), 11, 'ldName'); t.style.fill=LADDER_COLORS[i%10];
    t.onclick=e=>{ e.stopPropagation(); if(opened.has(i)) return; opened.add(i); draw(i,true); }; });
  [...opened].forEach(i=>draw(i,false));
  const wrap=document.createElement('div'); wrap.className='ladderWrap'; wrap.appendChild(svg); el.appendChild(wrap);
  const tip=document.createElement('div'); tip.className='gmTags'; tip.textContent='위의 이름을 누르면 사다리를 타요'; el.appendChild(tip);
  el.appendChild(result); showResult();
  const f=document.createElement('div'); f.className='gmFoot';
  const all=document.createElement('button'); all.type='button'; all.className='gmBtn'; all.textContent='🔓 전체 결과';
  all.onclick=e=>{ e.stopPropagation(); g.names.forEach((_,i)=>{ if(!opened.has(i)){ opened.add(i); draw(i,true); } }); };
  f.appendChild(all); el.appendChild(f);
}

// 🎲 주사위
const DICE_FACE=['','⚀','⚁','⚂','⚃','⚄','⚅'];
function diceCard(el, m){
  const g=m.game, vals=(g.vals||[]).map(v=>Math.max(1,Math.min(6,v|0)));
  gameHead(el,'🎲','주사위', vals.length>1?'합 '+vals.reduce((a,b)=>a+b,0):'');
  const row=document.createElement('div'); row.className='diceRow';
  const faces=vals.map(v=>{ const d=document.createElement('span'); d.className='die'; d.textContent=DICE_FACE[v]; d.title=v+''; row.appendChild(d); return d; });
  const nums=document.createElement('div'); nums.className='gmBig'; nums.textContent=vals.join(' · ');
  el.append(row, nums);
  const roll=()=>{ let k=0; nums.style.visibility='hidden'; faces.forEach(d=>d.classList.add('rolling'));
    const t=setInterval(()=>{ faces.forEach(d=>d.textContent=DICE_FACE[1+Math.floor(Math.random()*6)]);
      if(++k>14){ clearInterval(t); faces.forEach((d,i)=>{ d.textContent=DICE_FACE[vals[i]]; d.classList.remove('rolling'); }); nums.style.visibility=''; } },80); };
  gameReplay(el, roll);
  if(gameIsNew(m)){ gamePlayed.add(m.id); roll(); }
}

// 🎡 돌림판 (가운데 위 ▼ 가 가리키는 칸이 결과)
const WHEEL_COLORS=['#f6c3be','#fde3a7','#c7e9c0','#c6dcf5','#e2d1f5','#ffd6e5','#bfe8e4','#f5e0c3','#d6d1f5','#f5c6dc'];
function wheelCard(el, m){
  const g=m.game, n=g.opts.length, pick=Math.max(0,Math.min(n-1,g.pick|0)), seg=360/n;
  gameHead(el,'🎡','돌림판');
  const NS='http://www.w3.org/2000/svg', box=document.createElement('div'); box.className='wheelBox';
  const svg=document.createElementNS(NS,'svg'); svg.setAttribute('viewBox','-100 -100 200 200'); svg.setAttribute('class','wheelSvg');
  const gr=document.createElementNS(NS,'g'); svg.appendChild(gr);
  const pt=(a,r)=>[Math.sin(a*Math.PI/180)*r, -Math.cos(a*Math.PI/180)*r];
  g.opts.forEach((o,i)=>{
    const a0=i*seg, a1=a0+seg, [x0,y0]=pt(a0,96), [x1,y1]=pt(a1,96);
    const p=document.createElementNS(NS,'path'); p.setAttribute('d','M0 0 L'+x0+' '+y0+' A96 96 0 '+(seg>180?1:0)+' 1 '+x1+' '+y1+' Z'); p.setAttribute('fill',WHEEL_COLORS[i%10]); p.setAttribute('stroke','#fff'); p.setAttribute('stroke-width','1.5'); gr.appendChild(p);
    const [tx,ty]=pt(a0+seg/2,58), t=document.createElementNS(NS,'text'); t.setAttribute('x',tx); t.setAttribute('y',ty); t.setAttribute('class','wheelTx');
    t.setAttribute('text-anchor','middle'); t.setAttribute('dominant-baseline','middle'); t.setAttribute('transform','rotate('+(a0+seg/2-90)+' '+tx+' '+ty+')');   // 가운데에서 바깥쪽으로 읽히게
    t.textContent=o.length>6?o.slice(0,6)+'…':o; gr.appendChild(t);
  });
  const hub=document.createElementNS(NS,'circle'); hub.setAttribute('r','10'); hub.setAttribute('class','wheelHub'); svg.appendChild(hub);
  const ptr=document.createElement('div'); ptr.className='wheelPtr'; ptr.textContent='▼';
  box.append(ptr, svg); el.appendChild(box);
  const res=document.createElement('div'); res.className='gmBig'; res.textContent='🎯 '+g.opts[pick]; el.appendChild(res);
  const final=-(pick*seg+seg/2);   // 고른 칸 가운데가 맨 위로
  gr.style.transform='rotate('+final+'deg)';
  const spin=()=>{ res.style.visibility='hidden'; gr.style.transition='none'; gr.style.transform='rotate(0deg)'; gr.getBoundingClientRect();
    gr.style.transition='transform 3.6s cubic-bezier(.17,.67,.2,1)'; gr.style.transform='rotate('+(final-360*5)+'deg)';
    setTimeout(()=>{ res.style.visibility=''; },3600); };
  gameReplay(el, spin);
  if(gameIsNew(m)){ gamePlayed.add(m.id); requestAnimationFrame(spin); }
}

// 🎟️ 제비뽑기
function drawCard(el, m){
  const g=m.game, picked=new Set(g.picked||[]);
  gameHead(el,'🎟️','제비뽑기', picked.size+'명 뽑기');
  const box=document.createElement('div'); box.className='drawBox';
  const chips=g.names.map((nm,i)=>{ const c=document.createElement('span'); c.className='drawChip'+(picked.has(i)?' win':''); c.textContent=nm; box.appendChild(c); return c; });
  const res=document.createElement('div'); res.className='gmBig'; res.textContent='🎉 '+[...picked].map(i=>g.names[i]).join(', ');
  el.append(box, res);
  const run=()=>{ res.style.visibility='hidden'; chips.forEach(c=>c.classList.remove('win','hot')); let k=0;
    const t=setInterval(()=>{ chips.forEach(c=>c.classList.remove('hot')); chips[Math.floor(Math.random()*chips.length)].classList.add('hot');
      if(++k>18){ clearInterval(t); chips.forEach((c,i)=>{ c.classList.remove('hot'); c.classList.toggle('win',picked.has(i)); }); res.style.visibility=''; } },90); };
  gameReplay(el, run);
  if(gameIsNew(m)){ gamePlayed.add(m.id); run(); }
}
