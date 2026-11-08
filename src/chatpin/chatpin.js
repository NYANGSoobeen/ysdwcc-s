// 📌 채팅방 위 고정 공지 (카톡 채팅방 공지처럼)
// - 메시지를 길게 누르거나(PC 우클릭) ⋯ → "📌 채팅방 위에 고정" → 그 방 맨 위에 띠로 계속 보임 (방마다 하나)
// - channels/{방}.pin = {mid(메시지 id), text(요약 200자), authorId(쓴 사람), by(고정한 사람), at(고정 시각), msgAt(메시지 시각)}
//   채팅방 문서에 같이 저장 → 방 목록을 이미 실시간으로 받고 있어서 읽기가 더 늘지 않음
// - 띠를 누르면 그 말로 이동 (안 불러온 옛날 말이면 글 전체를 창으로)
// - 접기는 이 기기에서만 (새로 고정하면 다시 펼쳐짐) · 내리기는 모두에게서
function chatPinOf(ch){ const c=(channels||[]).find(x=>x.id===ch); return c&&c.pin&&c.pin.mid?c.pin:null; }
function chatPinSummary(m){
  if(m.text) return String(m.text).replace(/\s+/g,' ').trim().slice(0,200);
  const n=typeof msgImageIds==='function'?msgImageIds(m).length:0;
  if(n) return n>1?'📷 사진 '+n+'장':'📷 사진';
  if(m.video) return '🎬 동영상';
  if(m.file) return '📎 '+(m.file.name||'파일');
  if(m.stickerAssetId) return '😊 이모티콘';
  if(m.link&&m.link.title) return '🔎 '+m.link.title;
  return '메시지';
}
async function chatPinSet(m){
  const ch=currentChannel, cur=chatPinOf(ch);
  if(cur&&cur.mid===m.id){ toast('이미 고정된 말이에요'); return; }
  if(cur&&!await uiConfirm('지금 고정된 말을 내리고 이 말로 바꿀까요?')) return;
  try{
    await db.doc('channels/'+ch).set({pin:{mid:m.id, text:chatPinSummary(m), authorId:m.authorId||null, by:myId||null, at:Date.now(), msgAt:m.createdAt||0}},{merge:true});
    toast('📌 채팅방 위에 고정했어요');
  }catch(e){ fail(e,'고정'); }
}
async function chatPinClear(ch, ask=true){
  if(ask&&!await uiConfirm('고정을 내릴까요?\n모두에게서 내려가요.')) return;
  try{ await db.doc('channels/'+ch).update({pin:firebase.firestore.FieldValue.delete()}); if(ask) toast('고정을 내렸어요'); }catch(e){ if(ask) fail(e,'고정 내리기'); }
}
// 고정된 말을 고치거나 지웠을 때 띠도 같이
function chatPinOnEdit(m, text){ const p=chatPinOf(currentChannel); if(p&&p.mid===m.id) db.doc('channels/'+currentChannel).update({'pin.text':String(text).replace(/\s+/g,' ').trim().slice(0,200)}).catch(()=>{}); }
function chatPinOnDelete(m){ const p=chatPinOf(currentChannel); if(p&&p.mid===m.id) chatPinClear(currentChannel,false); }
function chatPinMenuItems(m){
  const p=chatPinOf(currentChannel);
  return p&&p.mid===m.id?[{label:'📌 고정 내리기', action:()=>chatPinClear(currentChannel)}]:[{label:'📌 채팅방 위에 고정', action:()=>chatPinSet(m)}];
}
const chatPinFoldKey=(ch,p)=>'ydr_pinfold_'+ch+'_'+p.at;
function chatPinFolded(ch,p){ try{ return localStorage.getItem(chatPinFoldKey(ch,p))==='1'; }catch(e){ return false; } }
function chatPinFold(ch,p,v){ try{ if(v) localStorage.setItem(chatPinFoldKey(ch,p),'1'); else localStorage.removeItem(chatPinFoldKey(ch,p)); }catch(e){} chatPinRender(); }
function chatPinRender(){
  const bar=$('chatPinBar'); if(!bar) return;
  const ch=currentChannel, p=currentView==='chat'&&ch?chatPinOf(ch):null;
  if(!p){ bar.style.display='none'; bar.replaceChildren(); return; }
  const folded=chatPinFolded(ch,p);
  bar.style.display='flex'; bar.className='chatPinBar'+(folded?' folded':'');
  bar.replaceChildren();
  if(folded){   // 접힌 모양: 오른쪽 위 작은 📌 (누르면 펼침)
    const b=document.createElement('button'); b.type='button'; b.className='cpPill'; b.textContent='📌 고정된 말'; b.title='펼치기';
    b.onclick=e=>{ e.stopPropagation(); chatPinFold(ch,p,false); };
    bar.appendChild(b); return;
  }
  const ic=document.createElement('span'); ic.className='cpIc'; ic.textContent='📌';
  const body=document.createElement('div'); body.className='cpBody'; body.title='누르면 그 말로 이동해요';
  const tx=document.createElement('div'); tx.className='cpText'; tx.textContent=p.text||'';
  const sub=document.createElement('div'); sub.className='cpSub';
  sub.textContent=displayNameFor(p.authorId)+(p.by&&p.by!==p.authorId?' · 고정: '+displayNameFor(p.by):'');
  body.append(tx, sub); body.onclick=()=>chatPinGo(p);
  const fold=document.createElement('button'); fold.type='button'; fold.className='cpBtn'; fold.textContent='⌃'; fold.title='접기 (이 기기에서만)';
  fold.onclick=e=>{ e.stopPropagation(); chatPinFold(ch,p,true); };
  const more=menuButton('⋯', ()=>[
    {label:'↪️ 그 말로 이동', action:()=>chatPinGo(p)},
    {label:'📋 복사', action:()=>copyText(p.text||'')},
    {label:'⌃ 접기 (이 기기에서만)', action:()=>chatPinFold(ch,p,true)},
    {label:'📌 고정 내리기', action:()=>chatPinClear(ch)}
  ]);
  more.classList.add('cpBtn');
  bar.append(ic, body, fold, more);
}
async function chatPinGo(p){
  const box=$('messages'), r=box&&box.querySelector('.msgRow[data-mid="'+p.mid+'"]');
  if(r){   // 화면에 있으면 그 말로 옮기고 잠깐 반짝 (휴대폰 키보드가 닫히며 맨 아래로 내려가지 않게 chatFindPin 으로)
    chatFindPin(p.mid);
    r.classList.remove('pinFlash'); void r.offsetWidth; r.classList.add('pinFlash'); setTimeout(()=>r.classList.remove('pinFlash'),1800);
    return;
  }
  // 아직 안 불러온 옛날 말 → 글 전체를 창으로 (가입 전 말이라 못 읽으면 요약만)
  let text=p.text||'';
  try{ const s=await db.doc('channels/'+currentChannel+'/messages/'+p.mid).get(); if(s.exists){ const m=s.data(); if(m.deleted){ toast('지워진 말이에요'); return; } text=m.text||chatPinSummary(m); } else { toast('지워진 말이에요'); return; } }catch(e){}
  await uiForm('📌 고정된 말',[],{message:displayNameFor(p.authorId)+(p.msgAt?' · '+fmtTime(p.msgAt):'')+'\n\n'+text, okLabel:'닫기'});
}
