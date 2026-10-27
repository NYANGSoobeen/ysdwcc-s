# 업무폰 앱 (가칭) — 프로젝트 안내

폰 하나를 투폰처럼 쓰는 영업팀용 앱. 고객 연락과 개인 연락을 나눠 관리하고, 고객 정보와 상담 메모, 팀 채팅을 동료와 공유한다.

- 화면 목업 (화면 번호 1~11): https://claude.ai/artifact/Nf3MKtZBdjBizFweVcGeKV
- 팀원 안내 문서: https://claude.ai/artifact/Ukf7MJKokz2oCo7wUmDBHU
- **답변 언어: 항상 한국어.** 사용자와 앱 사용자 모두 한국인이다. 설명, 안내, 진행 상황, 오류 설명까지 모두 한국어로 쓴다 (명령어와 코드, 파일 이름만 원래대로).
- 지금은 기획에서 개발로 넘어가는 단계. 아래 "정해진 것"은 바꾸기 전에 사용자에게 확인한다.

## 정해진 것

- **대상:** 회사 영업팀. 안드로이드와 아이폰 사용자가 섞여 있다.
- **전제:** 직원 대부분이 번호 1개, SIM 1개. 회선으로 업무/개인을 나눌 수 없어서 **연락처 기준으로 분류**한다.
- **방향 (B안):** 팀이 공유하는 데이터와 기능은 두 플랫폼이 똑같다. 안드로이드만 통화기록 자동 분류를 추가로 제공한다.
- **백엔드:** Firebase **새 프로젝트** (회사가 이미 쓰는 웹앱 프로젝트와 분리). Firestore, Cloud Storage, Cloud Functions 모두 `us-west1`(Oregon).
- **운영 계정:** 개발자 개인 Google 계정의 Firebase 프로젝트로 운영한다 (이미 개인 계정으로 쓰는 프론트 앱이 있음). 저장하는 연락처는 고객보다 협력사 직원이 많다.
- **비용 원칙:** 개인이 만들어 제공하는 앱이라 **무료 사용량 안에서 운영**한다. Storage와 Functions 때문에 Blaze 요금제가 필요하지만, 미국 리전의 무료 사용량을 넘지 않게 설계한다 (사진 압축, 예산 알림). 비용이 생기는 설계는 사용자에게 먼저 확인한다.
- **개인정보 국외 이전:** 서버가 미국이므로 개인정보 처리방침에 이전 국가(미국), 업체(Google LLC), 항목, 목적, 보관 기간을 적는다.
- **안드로이드:** 갤럭시 앱은 **Capacitor로 웹앱을 감싼 설치형 앱**(`android/`, 앱 ID `kr.yangsan.support`) + Kotlin 네이티브 기능. 화면은 배포된 웹앱(`https://ysdwcc-s.web.app`)을 그대로 불러오므로(`capacitor.config.ts`의 `server.url`), 웹앱 배포만으로 갤럭시 앱 화면도 바뀐다. APK는 안드로이드 쪽 코드를 바꿨을 때만 다시 만든다. 통화기록 자동 분류는 켜고 끄는 옵션이며, 켜면 `ROLE_DIALER`(기본 전화 앱)를 요청하고 `InCallService`로 통화 화면을 직접 제공한다. 꺼져 있어도 아이폰과 같은 방식으로 모든 공통 기능이 동작해야 한다.
- **아이폰:** 통화 기록을 읽을 수 없다. 대신
  - 앱에서 건 전화(`tel:`)는 앱으로 돌아오면 메모 창을 띄운다 (화면 6)
  - 받은 전화는 "방금 받은 전화 메모하기" 버튼으로 기록한다 (화면 7)
  - Call Directory Extension으로 전화 올 때 고객 이름을 표시한다
- **앱 이름과 아이콘:** 홈 화면 이름 "양산동원지원팀"(정식 "양산동원로얄CC 지원팀": 메뉴 맨 아래(버전 위), 로그인 화면, 설치 이름). 브라우저 탭 제목(`index.html`의 `<title>`)은 "양산동원로얄CC지원팀" (프론트 앱 "양산동원로얄CC프론트"와 맞춤). 아이콘은 프론트 앱(양산동원프론트, 코랄색)과 같은 구성(원 테두리, 왕관, YANGSAN, 동원로얄 지원팀)에 앱 색상(Venice Blue 그라데이션 바탕, Merino 글씨)을 쓴다. 원본 `design/icon.svg`, PNG는 `public/icons/`와 `android/app/src/main/res/`(갤럭시 앱 1.1.0부터, 시작 화면은 Merino 바탕). 지금 갤럭시 앱은 1.2.1(versionCode 4), 갤럭시 앱 이름은 "양산동원로얄CC지원팀"(`strings.xml`, `capacitor.config.ts`).
- **앱 색상:** Merino `#F5EEDD`(바탕) · Rock Blue `#84B3CE`(보조) · Venice Blue `#16587B`(주색, 버튼·내 말풍선·메뉴 바탕). `src/style.css` 맨 위 `:root` 토큰에서 바꾼다 (어두운 모드는 Venice 계열 바탕 + Rock Blue 강조). 메뉴(☰, PC 왼쪽 메뉴)는 Venice Blue 바탕에 Merino 글씨. 채팅방 바탕은 Rock Blue를 Merino 쪽으로 누그러뜨린 `#BED3DC`(`--chat-bg`), 남의 말풍선은 미색, 내 말풍선은 Venice Blue, 날짜 줄은 짙은 남색 반투명.
- **글꼴:** 본문 Noto Sans KR(400·500·700, 기본 16px), 제목·화면 이름·내 이름 Noto Serif KR(500·700, 내 이름 14px), 채팅 말풍선 14.5px·줄 간격 1.55, 메뉴 14px, 작은 안내 10.5~12.5px. 구글 폰트를 `index.html`에서 불러오고 서비스 워커가 기기에 저장(`google-fonts` 캐시). 입력칸은 아이폰 확대 방지로 16px 유지. 토큰은 `style.css`의 `--font-sans`, `--font-serif`.
- **웹앱:** React + Vite + TypeScript PWA (`src/`). Firebase Hosting으로 배포한다. 새 버전이 나오면 하단 알림을 띄우고 누르면 업데이트한다 (`src/update.ts`).
- **로그인 화면 (`src/pages/LoginPage.tsx`):** 프론트 앱과 같은 모양(화면 가로·세로 가운데 카드: ⛳ · 앱 이름 · "관리자가 등록한 직원만 로그인할 수 있어요" · 아이디/비밀번호 칸 · 로그인 유지/아이디 저장 체크칸(16px, 한 줄) · 🔒 안내 · 로그인 버튼 · 초기화 안내), 색만 우리 앱 색(바탕 Merino→Rock Blue 그라데이션).
- **로그인과 계정:** 이메일/비밀번호 로그인. 계정은 관리자만 만든다 (콘솔에서 가입 기능을 끈다). "@" 없는 아이디는 `아이디@workphone.local`로 저장하며 실제 메일이 아니므로 비밀번호 분실 시 관리자가 초기화한다. 프로젝트에 팀이 없을 때만 로그인 화면에 "처음 시작하기"(첫 관리자 만들기)가 나온다.
- **로그인 보안 (공통 기능 1번):**
  - 비밀번호 규칙: 8자 이상, 영문+숫자, 1234·abcd·qwer·aaaa처럼 4글자 이상 이어지거나 반복 금지, 아이디 포함 금지. 규칙 파일은 `src/password.ts`와 `functions/src/password.ts` 두 곳에 똑같이 두며(테스트가 같은지 확인), 서버(`changeMyPassword`, `createFirstAdmin`)도 검사한다.
  - 관리자가 정한 비밀번호(새 계정, 초기화)는 임시 비밀번호(6자 이상)이고 `users.mustChangePassword`가 붙어, 처음 로그인하면 "비밀번호 정하기" 화면이 먼저 나온다. 비밀번호 바꾸기는 재인증 후 `changeMyPassword`(5분 안 재인증만 허용) → 새 비밀번호로 다시 로그인.
  - 로그인 화면 **"로그인 유지" 체크칸**(사용자가 고름, localStorage `keep-signed-in`에 기억). 기본값은 휴대폰 켬, PC(마우스 기기) 끔. 갤럭시 앱은 칸 없이 항상 유지. (지원팀은 각자 자기 컴퓨터를 써서 선택으로 바꿈.)
    - 켬: 로그인 유지(IndexedDB), 오프라인 캐시.
    - 끔(여러 사람이 쓰는 컴퓨터): 세션 저장(브라우저 닫으면 로그아웃), Firestore 메모리 캐시(디스크에 고객 정보 안 남김, 앱을 다시 열 때부터 적용), 1분마다 localStorage `alive-at` 기록 → 15분 넘게 끊겼으면 로그아웃(`src/session.ts`).
    - 구현: `src/firebase.ts`의 `keepSignedIn()`, `applyKeepSignedIn()`(로그인 직전 `setPersistence`).
  - 계정 사용 중지(`setMemberActive`, 이유 필수): `users.active=false` + 이유, Auth 계정 disabled + 토큰 폐기. 열린 앱은 바로 로그아웃하고 로그인 화면에 이유를 보여 준다. Firestore/Storage 규칙(`isActive`)과 CardDAV도 막는다. 팀 소속과 데이터는 그대로이며 "다시 사용"으로 푼다. 자기 자신, 최고 관리자, 마지막 관리자는 중지할 수 없다. (요청서의 `uids/{uid}` 문서 대신 기존 `users/{uid}`를 쓴다.)
  - 로그인 화면 "아이디 저장": 체크하면 아이디만 이 기기에 기억한다 (비밀번호는 저장 안 함, localStorage `saved-login-id`).
  - 로그아웃 버튼 없이 로그인이 풀리면(만료, 중지) 기기에 남은 팀 데이터를 지운다.
- **팀원 관리:** 팀 생성, 팀원 추가, 권한 변경, 삭제, 비밀번호 초기화, **부서(팀) 이동**은 모두 Functions(callable)로만 한다.
  - 부서 이동(`moveMember`, 관리자 화면 팀원 ⋯ → 🔀 부서 이동, `MoveMemberDialog`): 두 부서 모두의 관리자 또는 최고 관리자만. 원래 부서에서 빼고 옮길 부서에 넣는 것을 한 번에(트랜잭션, 소속이 0개인 순간 없음 → 그 사람 앱은 로그아웃 없이 새 부서로). 옮길 부서에서의 권한을 고르고(기본은 원래 권한), 원래 부서에서 담당하던 고객은 원래 부서에 남는 사람에게 넘긴다(고객은 원래 부서에 그대로). 최고 관리자, 자기 자신, 원래 부서의 마지막 관리자는 옮길 수 없다. 옮길 수 있는 부서 목록은 내가 속한 다른 팀. 테스트 `tests/move.test.mjs`.
  마지막 관리자는 강등하거나 삭제할 수 없다. 팀에서 삭제하면 보안 규칙상 즉시 접근이 막히고, 그 사람 앱은 로그아웃하면서 기기 캐시를 지운다. 속한 팀이 없어지면 Auth 계정도 지운다.
- **여러 팀과 최고 관리자:** 처음 만든 관리자는 최고 관리자(`users.superAdmin`, `meta/setup.ownerUid`, Functions만 씀)다. 최고 관리자만 새 팀을 만들 수 있고(`createTeam`), 만든 팀에 관리자로 자동으로 들어가 모든 팀을 본다. 다른 관리자는 최고 관리자를 빼거나 강등할 수 없다. 팀이 2개 이상이면 팀 바꾸기 칸이 나온다 (메뉴 맨 위 내 프로필 아래, 휴대폰·PC 같음). 관리자는 관리자 화면에서 팀 이름을 바꾼다.
- **PC와 휴대폰 화면:** 가로 1024px 이상(`src/useMedia.ts`의 `useIsDesktop`)은 PC 화면: 왼쪽 고정 메뉴(`Sidebar`, 팀 바꾸기 포함), 하단 탭과 ☰ 없음, 고객은 왼쪽 목록 | 오른쪽 상세 2단, 내 정보·관리자는 2열(`.page-body.two-col` + `.col`), 용량은 카드 여러 열(`.masonry`), 채팅·스케줄은 넓게. 스타일은 `src/style.css` 끝의 `.shell.desktop` 규칙에 모아 둔다. 그보다 좁으면 휴대폰 화면.
- **화면 구성 (프론트 앱과 같은 구조, 2026-10):** 아래 탭은 없다. 휴대폰은 머리줄 왼쪽 ☰(테두리 있는 네모, 안 읽은 합계 빨간 숫자)로 서랍 메뉴를 열고, PC는 같은 메뉴가 왼쪽에 고정. 메뉴(`src/menu.tsx` `MenuList`) 순서: **내 프로필**(이름, "권한 · 내 정보 ✏️", 누르면 내 정보) → 팀 바꾸기(팀 2개 이상) → **단체 채팅**(우리 방 💬 + 프론트 채팅방 🏌️, 제목 줄 ＋ = 새 채팅방, 프론트 방이 없으면 "🏌️ 프론트 채팅 들어가기") → **팀원**(나를 뺀 팀원 이름·권한, 누르면 팀원 화면) → 메뉴(`MENU_ITEMS`: 고객, 스케줄) → **관리자 전용**(관리자 화면, 용량 관리) → 맨 아래 앱 이름·팀·버전. 제목 있는 묶음은 접고 편다. 새 기능은 `MENU_ITEMS`에 추가한다.
  - 채팅 화면은 늘 방 하나를 보여 준다(고른 방이 없으면 기본 방, 휴대폰 "방 목록" 화면은 없앰). 머리줄: ☰ · 💬 방 이름 · ⋯(방 메뉴) · 🔍 검색칸(머리줄 안, 휴대폰은 누르면 넓어짐, 찾은 결과 "1 / 3건 ▲ ▼"는 머리줄 아래 줄). 그 아래 안내줄 "💡 메시지를 길게 누르거나(PC는 오른쪽 클릭) …"(키보드 열리면 숨김), 빈 방은 "아직 메시지가 없어요 🎈".
  - 입력칸: 둥근 ＋(사진·파일) · 😊(자주 쓰는 이모지 고르기, `EmojiButton`) · 둥근 입력칸(PC 안내 "Enter 전송 · Ctrl+Enter 줄바꿈") · 둥근 ↑ 보내기(수정 중엔 ✓). 프론트 채팅방도 같은 입력칸(＋ 없음).
  - 색은 우리 앱 색 그대로(메뉴 Venice Blue, 채팅 바탕 `--chat-bg`). 프론트 앱 오른쪽 위 게임·씨앗 버튼은 만들지 않는다.
  - 관리자 화면(그 팀 관리자만), 용량 관리(최고 관리자만), 팀원 화면(보기 전용 목록)은 그대로.
- **화면 기본 틀 (공통 기능 2번):**
  - 브라우저 기본 `alert/confirm/prompt`는 쓰지 않는다. `src/ui/dialogs.tsx`의 `ask()`(확인), `askText()`(입력), `tell()`(꼭 읽어야 할 알림), `toast()`(잠깐 뜨는 알림, 오류는 `{ error: true }`)를 쓴다. 창 틀은 `Modal`.
  - 바깥을 눌러 닫기는 휴대폰(터치)만. PC는 바깥 클릭·창 안에서 끌다 바깥에서 놓기로 닫히지 않고 Esc나 버튼으로 닫는다.
  - 항목 메뉴(`src/ui/ContextMenu.tsx`): PC 오른쪽 클릭, 휴대폰 길게 누르기(0.5초), ⋯ 버튼(`MoreButton`). `useItemMenu(() => actions)`를 항목에 펼쳐 붙이고 `has-menu` 클래스를 단다. 길게 누른 뒤 손을 뗀 자리의 클릭은 막는다. PC는 누른 자리에 작은 메뉴, 휴대폰은 아래에서 올라오는 메뉴. 지금 붙은 곳: 채팅 메시지(복사, 내 것 삭제), 관리자 화면 팀원(권한, 비밀번호 초기화, 사용 중지, 삭제).
  - 메뉴 묶음: 제목 있는 묶음(지금은 "관리자 전용")은 제목을 눌러 접고 편다. 기기마다 기억(localStorage `menu-collapsed`). 새 묶음은 `src/menu.tsx`의 `SECTIONS`에 추가.
  - F5를 눌러도 보던 탭(sessionStorage `current-tab`)과 열어 둔 고객(`open-customer`)을 유지. 앱을 새로 열면 첫 화면(고객). 요청서의 "공지" 탭이 생기면 그것을 첫 화면으로 바꾼다.
  - 위쪽 검색칸(`src/ui/search.tsx`의 `SearchBar`): 지금 탭 안에서만 찾는다 (고객, 팀원, 관리자, 채팅). 검색어는 탭마다 기억. 휴대폰은 검색칸을 누르고 있는 동안 아래 탭과 채팅 입력칸을 숨긴다. 채팅 검색은 거르지 않고 찾은 말로 이동(가운데, 주황 테두리 반짝, "2 / 5건 ▲ ▼", Enter = 이전, 지우면 맨 아래). 자세한 동작은 아래 4-6.
  - 앱 버전: 메뉴 맨 아래(`팀 · v0.5.0 · 빌드 날짜 · 커밋`, `vite.config.ts`의 `buildVersion`). 기능을 크게 바꾸면 `package.json`의 version을 올린다.
- **휴대폰 최적화 (공통 기능 3번):**
  - 입력칸 글자는 16px 이상 (아이폰이 입력칸을 누를 때 화면을 확대하지 않게, `style.css` 끝 `@media (hover: none)` 규칙).
  - 키보드: `.shell`은 `position: fixed` + 높이 `--vv-height`, 위치 `--vv-top`(`src/mobile.ts`가 visualViewport로 넣음) → 아이폰에서 머리줄이 밀려 올라가지 않고 입력칸이 키보드 바로 위. 갤럭시 크롬은 `index.html`의 `interactive-widget=resizes-content`, 갤럭시 앱은 Capacitor 8 SystemBars가 키보드만큼 화면을 줄인다(별도 코드 없음). 입력칸을 누르고 있는 동안 `html.keyboard-open` → 휴대폰 아래 탭 숨김.
  - 채팅 입력: 보내기 버튼은 `onPointerDown preventDefault`로 포커스를 뺏지 않아 키보드가 열린 채로 남고, 입력칸은 바로 비운 뒤 뒤에서 보낸다(실패하면 글을 되돌림). 대화 영역을 누르면 키보드를 닫는다. Enter: PC는 보내기(Shift/Ctrl+Enter 줄바꿈, 한글 조합 중 Enter 무시), 휴대폰은 줄바꿈. 입력칸은 5줄까지 늘어난다. 키보드로 화면이 줄거나 사진이 늦게 떠도 맨 아래를 보고 있었으면 맨 아래 유지(ResizeObserver).
  - 저장(`src/download.ts`의 `saveFile`): 갤럭시 앱은 Kotlin `FileSaver` 플러그인(`android/.../files/FileSaverPlugin.kt`, 갤럭시 앱 1.2.0부터)으로 Download 폴더에 바로 저장(사진은 갤러리 Download 앨범), 아이폰은 공유 창(이미지 저장/파일에 저장, 보이는 사진을 미리 받아 둠), PC·갤럭시 브라우저는 일반 다운로드. 예전 갤럭시 앱이면 업데이트 안내. 붙은 곳: 사진 크게 보기 💾, 근무표 크게 보기 💾, 근무표 파일 메뉴.
  - 노치·홈 바: `env(safe-area-inset-*)`는 모두 `var(--safe-area-inset-*, env(...))`로 쓴다 (갤럭시 앱은 Capacitor가 변수를 넣어 줌).
  - 홈 화면 추가: 내 정보 맨 위 `InstallCard`(이미 홈 화면 앱이거나 갤럭시 앱이면 안 보임). 크롬은 "앱 설치" 버튼(beforeinstallprompt), 아이폰은 Safari 공유 → 홈 화면에 추가 안내.
- **단체 채팅방 (공통 기능 4-1):**
  - 기본 방(`main`, 이름 기본 "전체 채팅"): 메시지는 처음부터 쓰던 `teams/{teamId}/messages`. 지울 수 없고 이름은 관리자만 바꾼다(`channels/main` 문서가 그때 생김).
  - 만든 방: `teams/{teamId}/channels/{channelId}` {name, createdBy, createdAt}, 메시지는 그 아래 `messages`. 사진은 방과 상관없이 `teams/{teamId}/chat/{msgId}/`. 만들기는 편집 이상, 이름 변경·삭제는 만든 사람이나 관리자. 방을 지우면 `onChannelDeleted`가 메시지를, `onChannelMessageDeleted`가 사진을 지운다. 용량 보기와 기간 삭제는 모든 방을 합친다(`messageCollections`).
  - 화면: 휴대폰 채팅 탭 = 방 목록(방 안에서 탭을 한 번 더 누르면 목록), 방 머리줄 ‹ 목록, ⋯(사진 모아보기, 이름 바꾸기, 삭제). ☰·PC 왼쪽 메뉴에 "단체 채팅" 묶음(방 목록 + 새 채팅방). 보던 방은 sessionStorage `chat-channel`.
  - 불러오기(`src/useMessages.ts`): 최근 100개는 실시간, 위로 올리면 이전 100개를 한 번만 읽어 앞에 붙이고 보던 자리 유지. 100개 밖으로 밀려난 메시지는 화면에 남긴다. 새 메시지는 맨 아래를 보고 있을 때만 따라 내려가고, 위에서 읽는 중이면 "새 메시지 ↓" 버튼.
  - 말 묶음: 같은 사람이 같은 분(시:분)에 보낸 말은 이름·동그라미(이름 첫 글자)는 첫 말에만, 시간은 마지막 말에만. 날짜가 바뀌면 날짜 줄.
- **메시지 메뉴와 답장 (공통 기능 4-2):** 메시지를 길게 누르기/오른쪽 클릭 → ↩️ 답장, 📋 복사, ✏️ 수정(내 것), 💾 사진 저장, 🔗 링크 복사(글에 주소가 있을 때), 🏷️ 스티커 붙이기, 🗑️ 삭제(내 것).
  - 답장: `replyTo {id, authorUid, text(원문 앞 80자)}`를 메시지에 같이 저장해 원문을 안 불러와도 미리보기. 누르면 원문으로 이동해 반짝이고, 아직 안 불러온 옛 원문이면 100개씩 더 불러와 찾는다(최대 3000개).
  - 수정: 입력칸에 원래 글을 채워 고친다 → `editedAt`, 말풍선 옆 "수정됨".
  - 삭제: 글·사진은 바로 영구 삭제(사진 파일은 올린 사람이 지움)하고 `deleted: true`인 빈 메시지가 "삭제된 메시지입니다"로 남는다 (대화 흐름 유지). 용량 관리의 기간 삭제는 문서째 지운다.
  - 스티커(공감): `reactions {uid: 이모지}`, 한 사람에 하나(👍 ❤️ 😂 😮 😢 🙏 ✅, `REACTIONS`). 팀원 누구나(보기 권한 포함) 자기 것만 바꿀 수 있다(규칙 `canUpdateMessage`). 말풍선 아래 개수 표시, 누르면 내 것 붙이기/떼기.
  - 글 속 주소는 눌러서 새 탭으로 열린다.
- **사진 여러 장과 파일 (공통 기능 4-3):**
  - 입력칸 ＋ 메뉴: 🖼️ 사진 보관함 / 📷 사진 찍기(휴대폰만) / 📁 파일 선택. PC는 Ctrl+V로 캡처 붙여넣기, 채팅 화면 아무 데나 끌어다 놓기.
  - 사진은 한 번에 최대 30장(`MAX_PHOTOS`)을 한 메시지로, 줄여서(긴 쪽 1600px + 썸네일 400px) 3장씩 동시에 올리며 "올리는 중… 3/12" 표시. 말풍선 격자: 1장은 크게, 2·4장은 2칸, 나머지는 3칸(`photoCols`).
  - 파일: 엑셀·CSV·PDF·한글·워드·파워포인트·압축·텍스트(`FILE_EXTS`), 10MB 이하. Storage `teams/{teamId}/chat/{msgId}/f_{번호}.{확장자}`(규칙도 같은 목록·크기), 메시지 `files[{path, name, size, type}]`. 파일 카드: PC에서 PDF는 새 탭, 나머지와 휴대폰은 저장(`saveFile`). 메시지 메뉴 💾 파일 저장.
  - 크게 보기(`PhotoViewer`): 이 방에 불러온 사진 전체를 ← → / 밀어서 넘김, 두 손가락 확대, 두 번 눌러 확대/원래대로, 확대 중엔 한 손가락으로 이동(밀어도 안 넘어감), PC는 휠 확대.
  - 용량 관리: 사진 장수는 원본(`숫자.jpg`)만 세고, 파일은 용량에만 넣는다. 기간 삭제는 파일도 함께 지운다.
- **링크 미리보기와 @멘션 (공통 기능 4-4):**
  - 링크: 보낸 뒤 앱이 서버 함수 `linkPreview`(`functions/src/linkPreview.ts`)를 불러 그 페이지의 og:title·description·image(없으면 <title>)를 읽어 메시지 `link {url, title, desc, image, site}`에 붙인다. 팀원만 부를 수 있고, 같은 주소는 7일 동안 `linkPreviews/{sha1}`(앱 접근 불가)에 저장해 다시 쓴다. 내부망·서버 주소(localhost, 10.x, 192.168.x, 169.254.x 등)와 80/443 외 포트는 읽지 않고(넘겨 주는 주소도 매번 검사), 6초·512KB까지만 읽는다. euc-kr 페이지도 읽는다.
  - @멘션: 입력칸에서 "@"를 치면 직원 목록(맨 위 @모두)이 뜨고 글자로 걸러진다. ↑↓·Enter·Tab·Esc, 휴대폰은 눌러서 고른다. 보낼 때 글 속 "@이름"/"@모두"로 `mentions[uid]`를 만든다(@모두 = 나를 뺀 팀원 전부). 말풍선의 @이름은 색칠, 나를 부른 말은 노란 테두리와 내 이름 노란 칠.
  - 알림 "○○님이 나를 불렀어요"(`src/useMentionAlerts.ts`): 앱이 열려 있으면 방마다 나를 부른 최신 메시지 1개만 지켜보다가(읽기 절약) 새로 오면 화면 아래 알림, 누르면 그 방으로. 지금 그 방을 보고 있으면 알리지 않는다. PC는 다른 창을 보고 있고 브라우저 알림을 허용해 두었으면 바탕화면 알림도. 앱이 꺼져 있을 때는 아래 "푸시 알림".
  - 색인: `firestore.indexes.json`에 messages `mentions`(배열 포함) + `createdAt` 내림차순.
- **읽음 표시 (공통 기능 4-5, `src/reads.ts`):**
  - 방마다 `teams/{teamId}/channels/{channelId}/reads/{uid} = {at}`(기본 방은 `channels/main/reads`). 팀원은 모두 읽고, 자기 것만 지금까지의 시각으로 쓴다(규칙). 방을 지우면 `onChannelDeleted`가 같이 지운다.
  - 방을 보고 있고(앱이 앞에 있고) 맨 아래까지 봤을 때, 남의 새 말이 있으면 내 `at`을 올린다 (3초에 한 번까지, 쓰기 절약).
  - 말풍선 옆 노란 숫자 = 보낸 사람을 뺀 팀원 중 `at`이 그 말보다 이른 사람 수(0이면 안 보임). 읽음 기록이 없는 팀원(앱을 아직 안 연 사람)은 안 읽은 것으로 센다.
  - 안 읽은 수(빨간 동그라미): 방 목록, ☰·PC 왼쪽 메뉴의 방마다(접으면 제목 옆 합계), ☰ 버튼과 아래 채팅 탭은 합계. 방마다 "내 `at` 이후 남의 말"만 최대 100개 지켜본다(99+). 지금 보고 있는 방은 지켜보지 않는다. 지금 고른 팀만 센다.
  - 처음(읽음 기록 없음): 기본 방과 2026-10-26 전에 만든 방은 "지금"부터, 그 뒤에 만든 방은 방을 만든 때부터 센다 (예전 대화가 전부 안 읽음으로 뜨지 않게).
- **채팅 검색 보강 (공통 기능 4-6, `ChatRoom` in `src/pages/ChatPage.tsx`):**
  - 불러온 메시지에 없으면(0.4초 기다렸다가) 또는 가장 오래된 결과에서 ▲/Enter를 누르면, 이전 메시지를 **300개씩(`SEARCH_PAGE`) 최대 3000개(`SEARCH_MAX`)**까지 불러오며 찾는다. 찾는 동안 "이전 메시지에서 찾는 중…". 3000개까지 없으면 "0건 (최근 3000개)", 결과가 있으면 안내 후 가장 최근 결과로 돌아간다. 읽기 횟수가 늘어나는 기능이라 300개씩 필요할 때만 읽는다.
  - 찾은 말(답장 원문 이동 포함)은 **4초(`PIN_MS`) 동안 가운데에 고정**한다. 키보드가 닫히거나 사진이 늦게 떠 높이가 바뀌어도, 이전 메시지가 앞에 붙어도 그 말을 다시 가운데로. 휠·손가락으로 밀기·마우스 누르기·키보드로 직접 움직이면 바로 푼다 (휴대폰에서 대화 영역을 눌러 키보드를 닫는 건 풀지 않음).
  - 찾은 말이 불러온 것 중 맨 앞이면 가운데에 오도록 위로 50개를 더 불러 둔다. 검색을 지우면 맨 아래(최신).
  - `useMessages`의 `loadOlder(n)`은 이미 불러오는 중이면 끝난 뒤 이어서 불러온다 (검색·답장 원문·스크롤이 겹쳐도 빠짐없이).
- **🔎 채팅 #검색 (`src/pages/WebSearchPanel.tsx`, `functions/src/search.ts`, 프론트 앱과 같은 방식):**
  - 입력칸에 "#검색어"를 치면 입력칸 위에 다음(Daum) 검색 결과(웹·이미지·동영상 탭). 0.9초 멈추거나 Enter·↑를 누르면 검색(검색어를 쓰는 중엔 보내지 않음). 결과를 누르면 글 없이 `link` 카드 메시지로 보낸다(`sendLinkMessage`, 답장 중이면 답장). "# 그대로 보내기"는 글자 그대로, ✕로 닫으면 그 글은 다시 검색 안 함. 사진·파일을 고른 중이나 수정 중엔 안 뜬다. 같은 검색은 화면에서 다시 묻지 않는다.
  - 서버 함수 `webSearch`(팀원만, 사용 중지 제외)가 카카오 검색 API(`dapi.kakao.com/v2/search/{web|image|vclip}`)를 부른다. 결과는 http(s) 주소만, 태그 지움. 무료 사용량 안(하루 횟수는 카카오 앱 기준, 프론트와 같은 키를 쓰면 같이 씀).
  - **카카오 REST API 키는 코드·저장소에 넣지 않는다:** 최고 관리자가 관리자 화면 → "🔎 채팅 #검색" 카드에서 넣으면 한 번 검색해 맞는 키인지 확인하고 서버 전용 문서 `meta/kakaoSearch.key`에만 둔다(`setSearchKey`, 빈 값이면 지움, `searchKeyInfo`는 설정 여부만). 키 받는 곳: developers.kakao.com → 앱 만들기 → 앱 키의 REST API 키.
  - 푸시 알림 내용은 "🔎 제목". 테스트: `tests/search.test.mjs`(가짜 카카오 서버, `KAKAO_API_BASE`로 바꿈).
- **🏌️ 프론트 채팅 (프론트 앱 채팅방에 타부서 게스트로, `src/front/`):** 요구사항은 프론트 저장소(`ysdwcc-f`)의 `GUEST_LINK.md`. 프론트 저장소는 읽기만 하고 고치지 않는다.
  - 프론트 Firebase(`ysdwcc-f`)에 이름 붙인 두 번째 앱 `'ydr'`로 접속(`src/front/ydr.ts`, 웹 설정은 공개 값). 프론트 데이터는 메모리 캐시만(기기에 안 남김), 로그인 유지를 끈 컴퓨터는 프론트 로그인도 세션 저장.
  - 입장: 우리 ID 토큰 + 초대 코드(6자리) → 프론트 함수 `guestAuth`(us-west1) → 커스텀 토큰으로 프론트에 로그인(아이디 `g_{우리 uid}`). **한 번 들어가면 내보내지거나 나가기 전까지 코드 없이 계속 쓴다:** 앱을 열 때마다 `{ idToken }`만으로 다시 로그인한다. 들어간 사실은 계정(`users/{uid}.settings.frontChat`, 다시 로그인·다른 기기용)과 기기(localStorage `front-chat`)에 기억하고, 둘 다 없어도 프론트 채팅 화면을 열면 로그인당 한 번 코드 없이 연결해 본다(`tryResume`). 로그아웃은 계정 기억을 남기고, 초대받은 방이 없어지면(permission-denied, 방 0개) 계정 기억도 지운다.
  - `guests/{g_uid}`를 지켜보다 방이 빠지면 "내보냈어요" 안내(내가 나간 방은 제외), 방이 하나도 없으면 프론트 로그아웃(`disconnectFront({ forget: true })`). 캐시 값(fromCache)으로는 판단하지 않는다.
  - 메시지 읽기는 꼭 `createdAt >= from`(입장 시각, 0이면 전부) 조건 + 100개씩(프론트 규칙). 쓰기는 `{text, authorId, createdAt(ms), replyTo?}`만(4000자), 내 글만 `{text, edited}` 수정·`{deleted, text:''}` 삭제. 사진·이모티콘·파일은 프론트 Storage `assets/{id}`를 `getBlob`으로 보기만(사진 크게 보기도 됨), 이름은 `accounts/{아이디}`(authorId `acc_아이디`), 다른 게스트는 "타부서".
  - 읽음 `channels/{방}/reads/{g_uid} = {at: ms}`(맨 아래까지 봤을 때, 3초에 한 번, 방을 나갈 때 남은 것은 바로). 안 읽은 수는 방 목록·메뉴 "프론트 채팅"·☰ 합계.
  - 화면: 프론트 채팅방은 메뉴 "단체 채팅" 묶음에 우리 방과 같이 🏌️로 보인다(탭 `front`, 보던 방 sessionStorage `front-room`, 없으면 첫 방). 들어간 방이 없으면 "🏌️ 프론트 채팅 들어가기" → 초대 코드 입력. 방 머리줄은 우리 방과 같은 모양(☰ · 🏌️ 방 이름 · ⋯ 다른 방 초대 코드 넣기 / 이 방 나가기 = `guestLeave`). 안 읽은 수는 그 방 옆과 ☰ 합계.
  - 로그아웃(`logOutAndWipe`)하면 프론트 로그인도 끊는다(`disconnectFront`).
  - 알림(GUEST_LINK 7번): 우리 함수 `ydrGuestPush`(아래 "푸시 알림"). 프론트 앱 ⚙️ 타부서 연동 설정에 프로젝트 ID `ysdwcc-s`, 함수 주소, 알림 비밀값(관리자 화면 → 🏌️ 프론트 채팅 알림 연동에서 만듦)을 넣는다. 프론트 프로젝트 IAM(서비스 계정 토큰 생성자)도 필요.
  - 사용량은 프론트 프로젝트의 읽기·쓰기로 잡힌다(우리 무료 사용량과 무관).
  - 테스트: 에뮬레이터에 `demo-ydr` 프로젝트로 프론트 규칙을 올리고, 프론트의 `functions/guest.js`를 그대로 돌려 확인함.
- **🔔 푸시 알림 (FCM, `src/push.ts`, `functions/src/push.ts`, `public/push-sw.js`):**
  - 기기마다 `pushTokens/{sha256(token)}` = {uid, token, platform 'web'|'android', mode 'all'|'mentions', updatedAt}. 본인만 만들고 지운다(규칙), 같은 기기(같은 토큰)를 다른 사람이 로그인해 쓰면 그 사람 것으로 바뀐다. 로그아웃하면 지운다.
  - 켜기: 내 정보 → 🔔 알림(`PushCard`)에서 "모든 새 메시지 / 나를 부른 말만"을 누르면 허용 창 → 토큰 저장. 앱을 열 때 토큰이 바뀌었는지 확인하고 일주일에 한 번 다시 적는다(`refreshPush`). 웹 푸시 공개 키는 비우면 Firebase 기본 키, 바꾸려면 `VITE_FIREBASE_VAPID_KEY`.
  - 아이폰은 **홈 화면에 추가한 앱**에서만 알림 가능(Safari에서는 안내만). 갤럭시 앱은 아직 안 됨: Firebase 콘솔에 안드로이드 앱(`kr.yangsan.support`)을 추가해 받은 `google-services.json` + 알림 플러그인 + APK 다시 만들기가 필요하다. 그동안 크롬으로 열면 알림 가능.
  - 서버: `onMessageCreatedPush`/`onChannelMessageCreatedPush`가 새 메시지마다 보낸 사람을 뺀 팀원(사용 중지·팀 제외 빼고)에게 보낸다. 제목 = 방 이름, 내용 = "이름: 글"(사진·파일은 📷/📎). 나를 부른 말은 "🔔 ○○님이 나를 불렀어요 · 방". 'mentions' 기기는 나를 부른 말만. 보낼 수 없는 토큰은 지운다. 읽기: 메시지 1개에 팀 문서·방·팀원 프로필·토큰 정도(10명 팀이면 약 25번).
  - 웹은 데이터만 보내고 서비스 워커(`push-sw.js`, workbox `importScripts`)가 알림을 그린다. **앱을 보고 있으면 알림을 띄우지 않는다.** 알림을 누르면 열린 앱을 앞으로 가져와 그 방(`/?room=팀:방`, 프론트는 `/?front=방`)을 연다(`listenOpenRequests`).
  - 🏌️ 프론트 채팅 알림 `ydrGuestPush`(onRequest, 누구나 호출 가능, POST, 머리글 `x-ydr-secret`): 비밀값은 **코드·저장소에 넣지 않고** 최고 관리자가 관리자 화면 → "🏌️ 프론트 채팅 알림 연동"에서 만들고(`setFrontLinkSecret`, 한 번만 보여 줌) 서버 전용 문서 `meta/frontLink.secret`에만 둔다. 함수 주소 `https://us-west1-ysdwcc-s.cloudfunctions.net/ydrGuestPush`. 'mentions' 기기는 프론트 알림도 안 받는다.
  - 테스트: `tests/push.test.mjs`(보내는 부분을 바꿔 끼워 내용 확인), 규칙 테스트. 실제 FCM 전달은 배포 후 실제 기기로 확인한다.
- **스케줄(근무표):** 팀마다 하나(`teams/{teamId}/schedule/current`). 사진 또는 PDF만 받고(엑셀은 PDF/캡처 안내), PDF는 pdf.js 3.11.174로 쪽마다 그림(긴 쪽 2400px, 1400만 픽셀 이하, PNG/JPEG 작은 쪽, 최대 10쪽)으로 바꿔 저장한다. 원본 PDF는 1MB 이하만 보관. 새로 올리거나 지우면 Functions(`onScheduleWritten`)가 이전 파일 폴더(`teams/{teamId}/schedule/{uploadId}/`)를 지운다. 올리기/이름 변경/삭제는 편집 이상, **수정 표시 스티커는 팀원 모두**. 스티커 종류는 `src/schedule/stickers.ts`의 `STICKERS` 배열에서 바꾼다 (지원팀: **B0, 휴** 두 가지). 칸 찾기는 `src/schedule/cells.ts`(누른 곳에서 8% 안의 표 테두리선을 찾음 → 월 근무표처럼 칸이 좁은 표에 맞춤). 붙이기 모드에서 스티커를 누르면, 같은 종류면 떼고 다른 종류면 바꿔 붙인다 (스티커가 칸을 덮기 때문). 스티커 글자는 칸 가로·세로 정가운데: 한글 글꼴은 위아래 여백이 달라 그냥 가운데 맞춤하면 아래로 쏠리므로, 글자 모양을 재서(`inkOffsetEm`, 크게 보기 PNG는 `drawSticker`의 `measureText`) 맞춘다. 글꼴 `STICKER_FONT`(Noto Sans KR)를 받은 뒤 다시 그린다.
- **Storage CORS:** 칸 찾기와 스티커 합성 그림을 위해 쪽 그림 픽셀을 읽으므로 버킷에 CORS가 필요하다 (`cors.json`, 한 번만 `npm run storage:cors`). 없으면 그림은 보이지만 칸 찾기 대신 누른 자리에 기본 크기로 붙는다.
- **용량 탭(최고 관리자):** 사진 용량(무료 5GB 대비), 월별 사진 용량, 메시지와 고객 수를 보여 주고, 기간을 정해 채팅과 사진을 한꺼번에 영구 삭제한다 (미리 보기 후 삭제).
- **휴대폰 연락처에 표시 (걸려 온 전화에 고객 이름):** 비용 없이 하기 위해 읽기 전용 **CardDAV 서버**(`functions/src/carddav.ts`, 함수 `carddav`)로 팀 고객을 폰 연락처의 별도 계정에 넣는다. 아이폰은 설정 → 연락처 계정 → CardDAV, 갤럭시는 DAVx⁵ 앱으로 구독한다. 이름은 `[업무] 이름`으로 보낸다. 접속 정보는 앱 "내 정보"에서 발급하며(비밀번호는 한 번만 표시, 서버에는 해시만 저장), 팀에서 제외되거나 끄면 빈 주소록을 돌려줘 폰에서 자동으로 지워진다. 서버 주소는 `https://carddav-<프로젝트 번호>.us-west1.run.app` (다르면 `VITE_CARDDAV_URL`). 배포 출력에 나오는 `cloudfunctions.net/carddav` 주소는 쓰지 않는다: 그 주소는 함수 이름 경로를 떼고 전달해서 응답 속 주소(href)가 틀어진다 (배포 후 확인함).
- **아이폰 설치형 앱은 보류:** Apple 개발자 계정(연 $99)과 Mac이 필요해 비용 원칙에 맞지 않는다. 아이폰은 웹앱 + 연락처 구독(CardDAV)으로 쓴다.
- **갤럭시 앱의 연락처 표시:** Kotlin 플러그인 `ContactsSync`(`android/app/src/main/java/kr/yangsan/support/contacts/`)가 폰에 "지원팀" 전용 연락처 계정(`kr.yangsan.support.account`)을 만들고 내 모든 팀의 고객을 `[업무] 이름`으로 넣는다. 웹앱(`src/native.ts`)이 고객을 실시간으로 지켜보다 바뀌면 맞춘다. 내 정보에서 켜고 끄며, 끄기/로그아웃/팀 제외 시 계정째 지운다. 개인 연락처는 읽지 않는다. 갤럭시는 DAVx⁵ 대신 이 앱을 쓴다 (DAVx⁵는 앱을 못 깔 때의 대안).
- **갤럭시 앱 배포:** 서명된 APK를 `release/yangsan-support.apk`에 커밋하고 **GitHub에서 받게 한다** (`https://github.com/NYANGSoobeen/ysdwcc-s/raw/main/release/yangsan-support.apk`). Firebase Hosting(`public/`)에 APK를 넣으면 업로드가 매번 실패해 배포 전체가 멈춘다 (실제로 겪음). Play 스토어는 쓰지 않는다. **서명 키(`yangsan-support.jks`)와 비밀번호는 저장소(공개)에 넣지 않고 사용자가 보관한다.** 새 APK를 만들 때는 사용자에게 키 파일을 받아 `android/keystore.properties`(커밋 금지)에 경로와 비밀번호를 적고 `npm run android:apk`로 만든다. 같은 키로 서명해야 기존 앱 위에 업데이트 설치가 된다. 버전을 올릴 때 `android/app/build.gradle`의 `versionCode`를 1씩 올린다.
- **저장소는 공개(public)다.** 비밀값(서명 키, 서비스 계정 키 등)은 절대 커밋하지 않는다.
- **고객 화면:** 목록(이름, 회사, 번호 검색), "오늘까지 연락할 고객", 추가(같은 번호면 기존 고객으로 연결), 상세(전화 걸기 후 돌아오면 메모 창, 담당자 넘기기, 다음 연락), 상담 메모(종류, 수정 기록, 삭제).
- **웹앱 한계:** 웹앱은 폰 연락처를 일괄로 읽을 수 없다. 연락처 불러오기와 전화 관련 기능은 설치형 앱에서만 한다.

## 기능 목록

| 기능 | 안드로이드 | 아이폰 | 목업 |
| --- | --- | --- | --- |
| 업무/개인 통화기록 탭 | 폰 전체 통화 자동 분류 | 앱에서 건 전화와 메모한 통화만 | 1, 2, 7 |
| 통화 후 분류/메모 창 | 모든 통화 후 자동 | 앱에서 건 전화만 자동 | 3, 6 |
| 고객 상세, 상담 이력, 다음 연락 알림 | O | O | 4 |
| 메모 작성자, 수정자, 수정 날짜, 수정 기록 | O | O | 4 |
| 고객별 "내 폰에도 저장" | O | O | 4 |
| 동료 공유, 권한(관리자/편집/보기), 담당자 넘기기 | O | O | 5 |
| 팀 채팅: 답장, 수정, 삭제, 검색, @동료, #고객 태그 | O | O | 9, 10 |
| 처음 설치 시 고객 골라 오기 | O | O | 11 |
| 퇴근 모드 (업무 전화 무음) | O | 집중 모드 안내 | 2, 8 |
| 휴대폰 연락처에 표시 (고객 전체 동기화) | O | O | 8 |

**담당자 넘기기**는 고객의 담당자(메모, 알림 책임)를 바꾸는 기능이다. 전화를 다른 번호로 돌리는 기능이 아니다 (앱이 특정 전화만 골라 착신전환하는 건 불가능).

## 데이터 저장 규칙

| 데이터 | 저장 위치 | 로그아웃/퇴사 시 |
| --- | --- | --- |
| 통화 기록, 통화 시간 | 기기 로컬만 (서버 업로드 금지) | 삭제 |
| 번호 → 업무/개인 분류표 | 기기 로컬 | 삭제 |
| 개인 연락처 | 폰 기본 연락처 (앱은 읽기만) | 그대로 |
| 고객 연락처, 상담 메모, 채팅 | Firestore | 기기에서 삭제, 팀에는 유지 |
| 채팅 사진 | Cloud Storage `teams/{teamId}/chat/{msgId}/` (압축본 + 썸네일, 메시지 문서에는 경로만) | 기기 캐시 삭제, 팀에는 유지 |
| "휴대폰 연락처에 표시"로 동기화한 고객 | 폰의 CardDAV 연락처 계정 (읽기 전용) | 팀 제외/끄기 시 빈 주소록이 되어 자동 삭제 |
| "내 폰에도 저장"한 고객 | 폰 기본 연락처 (일반 연락처) | 그대로 |

- **삭제는 즉시 영구 삭제:** 고객, 메모, 채팅 메시지를 지우면 보관 없이 바로 지운다. 하위 데이터(메모, 수정 기록)와 채팅 사진은 Cloud Functions(`functions/src/index.ts`)가 함께 지운다. 되돌릴 수 없으므로 화면에서 확인 창을 띄운다.
- 개인 연락처와 개인 통화는 어떤 설정에서도 서버로 올리거나 동료에게 보이지 않는다.
- 연락처 동기화를 켜면 카카오톡이 고객을 친구로 자동 추가할 수 있다. 설정 화면에 경고를 표시한다.

## Firestore 데이터 구조 초안

```
users/{uid}                      name, email, teamIds[], superAdmin, platform, settings{},
                                 active, disabledReason, disabledAt, disabledBy, mustChangePassword, passwordChangedAt
                                 (Functions가 생성, 본인은 name/platform/settings만 수정)
users/{uid}/private/contactsSync enabled, username, createdAt   (본인만 읽기, Functions가 씀)
pushTokens/{sha256(token)}      uid, token, platform, mode('all'|'mentions'), updatedAt   (푸시 받을 기기, 본인만)
meta/frontLink                   secret, updatedAt, updatedBy   (프론트 알림 비밀값, 앱에서 접근 불가)
meta/kakaoSearch                 key, updatedAt, updatedBy   (채팅 #검색 카카오 키, 앱에서 접근 불가)
meta/setup                       firstTeamId, ownerUid(최고 관리자). 첫 관리자를 만들었는지 표시 (앱에서 접근 불가)
carddavTokens/{username}         uid, secretHash, disabled, createdAt, lastUsedAt   (앱에서 접근 불가)
linkPreviews/{sha1(url)}         preview, at   (링크 미리보기 7일 저장, 앱에서 접근 불가)
teams/{teamId}                   name, members{uid: "admin"|"editor"|"viewer"}, autoShare, shareNotes,
                                 contactsVersion (고객이 바뀔 때마다 Functions가 올림, CardDAV ctag용)
customers/{customerId}           teamId, name, company, phones[] (E.164), ownerUid,
                                 nextContactAt, nextContactNote, createdBy, createdAt, updatedAt
customers/{id}/notes/{noteId}    kind ("수신 통화"|"발신 통화"|"방문 미팅"|...), body, authorUid,
                                 createdAt, editedBy, editedAt, editCount
customers/{id}/notes/{id}/revisions/{revId}   body, editedBy, editedAt
teams/{teamId}/schedule/current  uploadId, fileName, assetId(원본 경로|null), size, pdfDropped,
                                 images[{assetId(경로), name:'1쪽', w, h, scale}],
                                 marks[{p(쪽 0부터), x, y, w?, h?, t}], marksAt, marksBy, authorId, createdAt
teams/{teamId}/channels/{channelId}  name, createdBy, createdAt   (단체 채팅방, main은 기본 방 이름만)
teams/{teamId}/channels/{c}/messages/{msgId}  기본 방 메시지와 같은 모양
teams/{teamId}/channels/{c}/reads/{uid}       at (마지막으로 읽은 시각, 기본 방은 c = main)
teams/{teamId}/messages/{msgId}  (기본 방) authorUid, body, mentions[uid], customerTags[customerId],
                                 replyTo{id, authorUid, text}, attachments[{path, thumbPath, width, height, size, thumbSize}], files[{path, name, size, type}],
                                 reactions{uid: 이모지}, deleted, editedAt, link{url, title, desc, image, site},
                                 hasPhotos (사진 모아보기 조회용), createdAt, editedAt
```

- 보안 규칙: 팀 멤버만 해당 팀의 `customers`, `messages`에 접근. `viewer`는 읽기만. 메시지 수정/삭제는 작성자만. 고객 삭제는 관리자 또는 담당자(`ownerUid`)만, 메모 삭제는 관리자 또는 작성자만. Storage 규칙도 `teams/{teamId}.members`를 조회해 같은 기준을 적용한다.
- 팀 문서는 관리자가 `name`, `autoShare`, `shareNotes`만 직접 바꿀 수 있다. `members`는 Functions만 바꾼다.
- 같은 번호의 고객이 팀에 이미 있으면 새로 만들지 않고 기존 고객에 연결한다 (가져오기, 분류 창 모두).
- 검색: 채팅과 고객 검색은 초기에는 클라이언트 필터로 시작하고, 규모가 커지면 검색 서비스 도입을 검토한다.

## 개발 순서

1. Firebase 새 프로젝트, 인증, Firestore 구조와 보안 규칙
2. 공통 기능 (고객, 메모, 수정 기록, 다음 연락 알림, 동료 공유, 팀 채팅) — 두 플랫폼
3. 안드로이드 앱: 공통 기능 + 발신자 이름 표시 + 고객 골라 오기
4. 아이폰 앱: 공통 기능 + Call Directory + 앱 발신 후 메모 창
5. 안드로이드 기본 전화 앱 모드: 통화 화면, 통화기록 자동 분류, 통화 후 분류 창 → 소수 인원 2~3주 시범 운영

## 아직 정하지 않은 것 (구현 전 사용자에게 확인)

- 상담 이력에 통화 시간(예: "수신 통화 · 4분")을 공유할지. 저장 규칙상 통화 시간은 기기 로컬만이라, 지금은 통화 종류만 서버에 올리는 것으로 가정.
- "내 폰에도 저장" 버튼을 관리자가 켜고 끌 수 있게 할지 (퇴사 후 고객 정보 유출 경로).
- 통화 녹음과 통신사 앱(익시오, 에이닷) 요약을 "공유하기"로 메모에 붙이는 기능 포함 여부, 그리고 회사 녹음 방침.
- 휴가 모드 (고객 전화가 오면 지정 동료에게 대신 연락 알림) 포함 여부.
- 안드로이드와 아이폰을 각각 네이티브로 만들지, 공통 부분을 크로스플랫폼(예: Kotlin Multiplatform, Flutter)으로 묶을지.

## 개발과 테스트

- `npm run emulators` 후 다른 터미널에서 `npm run dev:emulators`: 로컬 에뮬레이터(Auth, Firestore, Storage, Functions)로 앱 실행
- `npm test`: 보안 규칙과 Functions 테스트 (에뮬레이터에서 실행)
- `npm run release`: 최신 코드 받기(git pull) → 설치 → 빌드 → 전체 배포(`scripts/deploy.mjs`). 사용자는 Windows cmd에서 이것만 실행한다. 함수가 많아 한꺼번에 올리면 분당 요청 수 제한으로 몇 개만 실패하는 일이 있어(실제로 겪음), 실패하면 1분 쉬고 최대 3번 다시 배포한다(바뀌지 않은 함수는 Firebase가 건너뜀). 항상 `--project ysdwcc-s`로, `GOOGLE_CLOUD_QUOTA_PROJECT`는 빼고 배포한다.
- 자동 배포: `.github/workflows/deploy.yml`이 main에 올라갈 때마다 배포한다 (Actions 탭에서 수동 실행도 가능). 저장소 Secret `FIREBASE_SERVICE_ACCOUNT`(배포용 서비스 계정 키 JSON)가 있어야 동작하고, 없으면 건너뛴다.
- 설치 없이 배포: Google Cloud Shell(브라우저 터미널)에서 `git clone` → `npx firebase login --no-localhost` → `npm run release`. **Cloud Shell 줄 끝이 `(ysdwcc-s)`인지 먼저 확인**한다. 다른 프로젝트면 `gcloud config set project ysdwcc-s` 후 `unset GOOGLE_CLOUD_QUOTA_PROJECT`.
- Cloud Shell은 파일을 한 번에 많이 올리면 12개쯤에서 끊긴다 (실제로 겪음). 그래서 배포 파일 수를 적게 유지한다: pdf.js 한글 글꼴 정보(cMap, 약 170개)는 사이트에 넣지 않고 jsDelivr CDN에서 받는다 (`src/schedule/data.ts`의 `PDFJS_CDN`). 끊기면 같은 명령을 다시 실행하면 이어서 올라간다.
- Firebase 웹 설정은 `.env.production`, 프로젝트 연결은 `.firebaserc`에 커밋되어 있다 (공개 값). 따로 복사할 필요 없음.
- 연락처 구독은 배포 후 실제 폰으로 한 번 확인한다 (테스트는 tsdav 클라이언트로만 함). 함수 주소가 다르면 `VITE_CARDDAV_URL`에 적는다.
- 앱에서 부르는 함수(onCall)는 처음 만들어질 때만 "누구나 호출 가능"으로 설정되고 이후 배포로는 고쳐지지 않는다(onCall에는 `invoker` 옵션도 안 먹음). 이 설정이 실패하면 앱 콘솔에 CORS 오류(실제로는 403)가 난다(2026-10 새 함수 6개에서 실제로 겪음). 그래서 `scripts/deploy.mjs`가 배포 뒤 onCall 함수를 모두 밖에서 두드려 보고 403이면 `gcloud run services add-iam-policy-binding <함수이름 소문자> --region=us-west1 --project=ysdwcc-s --member=allUsers --role=roles/run.invoker`로 고친다(gcloud가 없으면 명령을 출력).
- 안드로이드 빌드 환경: JDK 21, Android SDK(platform 36, build-tools 36), `android/local.properties`에 `sdk.dir`. 이 클라우드 환경에는 KVM이 없어 에뮬레이터로 실행 확인을 못 하므로, 연락처 기능은 실제 갤럭시로 확인한다.
- 배포 전 콘솔 설정: Authentication → 이메일/비밀번호 사용, 사용자 가입(create) 끄기. 예산 알림 설정.
