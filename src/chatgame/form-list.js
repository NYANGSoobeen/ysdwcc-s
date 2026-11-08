// 📝 폼에 '칸 하나씩' 입력 (type:'list') — 프론트 앱 js/core.js 의 uiForm 안에 있는 갈래 그대로
// 우리 uiForm(제목, 칸 목록, 옵션) 은 칸마다 f.type 을 보고 입력칸을 만들고, getters[f.key]() 로 값을 모아 돌려줌
// → 지원팀 앱 폼 함수에 아래 갈래를 'checkbox' 갈래 바로 앞에 끼워 넣기 (body = 폼 내용 div, enterPressed(e) = 한글 입력 중 Enter 가 아닐 때 true, $('formOk') = 확인 버튼)
// 칸 설정: {key, label, type:'list', min(최소 칸, ✕ 안 보임), max(최대 칸), start(처음 칸 수), value(미리 채울 배열), placeholder('항목' → '항목 1'), addLabel('항목 추가'), maxlength}
// 돌려주는 값: 빈 칸을 뺀 글 배열 ['김치찌개','돈까스']
      if(f.type==='list'){   // 칸을 하나씩: [입력칸 ✕] … + 추가 (예: 투표 항목) → 적은 것들 배열
        el=document.createElement('div'); el.className='formList';
        const max=f.max||10, min=f.min||1, rows=document.createElement('div'), add=document.createElement('button');
        add.type='button'; add.className='formListAdd'; add.textContent='＋ '+(f.addLabel||'추가');
        const sync=()=>{ const n=rows.children.length; add.style.display=n>=max?'none':''; [...rows.children].forEach((r,i)=>{ r.querySelector('input').placeholder=(f.placeholder||'항목')+' '+(i+1); r.querySelector('button').style.visibility=n>min?'':'hidden'; }); };
        const addRow=(v,focus)=>{ if(rows.children.length>=max) return null;
          const r=document.createElement('div'); r.className='formListRow';
          const inp=document.createElement('input'); inp.type='text'; inp.value=v||''; if(f.maxlength) inp.maxLength=f.maxlength;
          inp.addEventListener('keydown',e=>{ if(enterPressed(e)){ e.preventDefault(); const nx=r.nextElementSibling; if(nx) nx.querySelector('input').focus(); else { const nr=addRow('',true); if(!nr) $('formOk').focus(); } } });
          const del=document.createElement('button'); del.type='button'; del.className='formListDel'; del.textContent='✕'; del.title='이 칸 지우기';
          del.onclick=()=>{ if(rows.children.length<=min) return; const nx=r.nextElementSibling||r.previousElementSibling; r.remove(); sync(); if(nx) nx.querySelector('input').focus(); };
          r.append(inp, del); rows.appendChild(r); sync(); if(focus) inp.focus(); return r; };
        const init=(f.value||[]).filter(Boolean); for(let i=0;i<Math.max(f.start||min,init.length);i++) addRow(init[i]||'');
        add.onclick=()=>addRow('',true);
        el.append(rows, add);
        getters[f.key]=()=>[...rows.querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
      }
