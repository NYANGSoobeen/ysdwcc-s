# 🎲 채팅 미니 게임 옮기기 (지원팀 앱 등 다른 앱용)

채팅 ＋ 버튼에서 **📊 투표 · 🪜 사다리타기 · 🎲 주사위 · 🎡 돌림판 · 🎟️ 제비뽑기**를 만들어 메시지 하나로 올리는 기능이에요.

| 파일 | 내용 |
|---|---|
| `chatgame.js` | 게임 전부 (만들기 폼 · 말풍선 안 카드 · 애니메이션 · 투표) — 프론트 앱 `js/chatgame.js` 그대로 |
| `chatgame.css` | 카드 모양 + 폼의 "칸 하나씩" 입력 모양 |
| `form-list.js` | 폼 함수에 넣을 **칸 하나씩 입력**(`type:'list'`: 칸마다 ✕ 지우기 · ＋ 추가 · Enter=다음 칸) |
| `demo.html` | 견본 — 열면 5가지 카드가 보여요 (서버 없이 모양만) |

## 다른 앱의 Claude Code에 이렇게 부탁하세요 (4개 파일 첨부)
> 첨부한 `chatgame.js`·`chatgame.css`·`form-list.js`·`demo.html` 은 다른 앱(양산동원로얄CC 프론트)의 **채팅 미니 게임** 기능이야. 우리 앱 채팅에도 **똑같이** 넣어 줘.
> - `chatgame.js`·`chatgame.css` 를 그대로 쓰고, 아래 "연결할 곳"을 우리 앱 채팅 코드에 맞게 연결해 줘
> - 폼 함수에 `form-list.js` 의 `type:'list'` 갈래를 넣어서, 항목·참가자·결과·후보를 **한 칸에 하나씩** 적고 ✕ 로 지우고 ＋ 로 추가하게 해 줘
> - 게임 종류·데이터 모양(`game`, `votes`)·결과 정하는 방법은 바꾸지 말고 그대로 (프론트와 같은 방에서 서로 똑같이 보여야 해)
> - 프론트 방(게스트로 들어간 방)에서도 같은 카드가 보이고 만들기·투표가 되게 해 줘 (README 아래 "프론트 방에서" 참고)
> - 휴대폰(아이폰·갤럭시)과 PC에서 확인하는 방법도 알려 줘

## 연결할 곳 (`chatgame.js` 가 기대하는 것)
1. **전역 값·함수** (이름이 다르면 `chatgame.js` 위쪽에서 맞춰 주기)
   - `db`(Firestore compat), `firebase`(compat: `firebase.firestore.FieldPath`·`FieldValue.delete()`), `currentChannel`(지금 방 id), `myId`(내 id = 메시지 `authorId` 와 같은 값)
   - `uiForm(제목, 칸들, {okLabel})` → 값 객체 또는 취소면 `null` (칸 종류: 글 · `textarea` · `checkbox` · `number` · `datetime-local` · `file` · **`list`**)
   - `uiConfirm(글)` → true/false · `toast(글)` · `fail(에러, '하던 일')` · `displayNameFor(id)` → 이름
   - 투표 사진용: `assets.upload(파일)` → `{id}`, `compressImage(파일, CHAT_IMG)`, `dropAsset(id)` (사진을 메시지 `imageAssetId` 로 → 채팅 사진처럼 보이고 지워짐) — 지원팀 앱의 사진 올리기 함수로 바꿔 주기
   - 있으면 씀(없어도 됨): `takeReply()`(답장 중이면 `{replyTo}`), `chatLinkify(el, 글, m)`, `viewDocs`(지금 방 메시지들 → 참가자 이름 미리 채우기), `renderMessages`·`chatRowCache`(투표 마감 시각이 되면 다시 그리기)
2. **＋ 버튼 메뉴**에 `...gameMenuItems()` 추가 (`[{label:'📊 투표', action}, …]`)
3. **말풍선 그릴 때**: 메시지에 `game` 이 있으면 글 대신 카드
   ```js
   if (m.game && !m.deleted) { bubbleDiv.classList.add('game'); bubbleDiv.appendChild(gameCard(m)); }
   else /* 원래처럼 글 그리기 */;
   ```
   - 다시 그릴지 비교하는 값이 있으면 `m.game`, `m.votes` 도 넣기 (투표하면 바로 바뀌게)
   - 게임 메시지엔 ✏️ 수정 메뉴 빼기 (결과가 바뀌면 안 됨) · 삭제할 땐 `game:null, votes:null` 도 같이
4. **보안 규칙**: 직원이 메시지를 고칠 수 있으면 투표(`votes.{내 id}`)도 그대로 됨. 직원이 **자기 글만** 고칠 수 있게 막혀 있다면, 투표 글은 `votes` 안의 자기 칸만 바꾸는 것 허용 추가:
   ```
   allow update: if 직원() && resource.data.get('game', {}).get('type', '') == 'poll'
     && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['votes'])
     && request.resource.data.get('votes', {}).diff(resource.data.get('votes', {})).affectedKeys().hasOnly([내 id]);
   ```
5. **알림·검색**: 메시지 `text` 에 요약 글(`📊 투표: 질문…`)이 같이 들어가서 푸시 알림·검색은 고칠 것 없음

## 데이터 모양 (프론트와 똑같이)
메시지 하나 = 게임 하나: `{ text: '요약 글', game: {...}, authorId, createdAt }` (+ 투표 사진이면 `imageAssetId`)

| type | game 내용 |
|---|---|
| `poll` 📊 | `q` 질문 · `opts` 항목 2~10 · `multi` 여러 개 · `anon` 익명 · `until` 마감 ms(0=없음) · `closed` · `link`(선택) / 메시지 `votes: {사람id: [고른 번호…]}` |
| `ladder` 🪜 | `names` 참가자 2~10 · `prizes` 결과(참가자 수만큼, 섞어서) · `rungs` 가로줄(줄번호*16+왼쪽 세로줄번호, 10줄) |
| `dice` 🎲 | `vals` 1~3개 (1~6) |
| `wheel` 🎡 | `opts` 2~10 · `pick` 뽑힌 번호 |
| `draw` 🎟️ | `names` 2~10 · `picked` 뽑힌 번호들 |

- 결과는 **만드는 사람이 정해서 같이 저장** → 누가 봐도 같음. 방금(20초 안) 올라온 주사위·돌림판·제비뽑기는 저절로 굴러가고, "↻ 다시 보기"로 다시 봄
- 사다리는 위의 이름을 누르면 그 줄이 내려가고(보는 사람마다 따로), "🔓 전체 결과"로 한 번에

## 프론트 방에서 (게스트로 들어간 방)
프론트 Firebase 의 방도 같은 카드로 그리면 돼요. 게스트 규칙은 이미 열려 있어요 (프론트 `GUEST_LINK.md` 5-1).
- 만들기: `{text, game, authorId: 게스트uid, createdAt}` (+ `replyTo`) — 이 항목들만 허용. **게스트는 사진 업로드가 막혀 있어서 사진 없는 투표만**
- 투표: `updateDoc(ref, new FieldPath('votes', 게스트uid), [번호들])` · 취소는 `deleteField()` — **자기 칸만** 허용 (다른 항목과 같이 바꾸면 거절)
- 내 투표 마감: 내 글이면 `updateDoc(ref, { game: { ...game, closed: true } })`
- 이름은 그 방 사람들 이름(프론트 직원 이름은 프론트 `profiles`/`guestLabel` 방식대로) 으로 보여 주기
