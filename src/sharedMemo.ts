// 📝 통신사 앱(에이닷 등) 통화 요약 → 상담 메모.
// 요약 글이 들어오는 길:
//   - 아이폰: 단축어 "지원팀 메모"(공유 시트) → https://ysdwcc-s.web.app/?memo=요약
//   - 갤럭시 앱: 공유 → 양산동원로얄CC지원팀 (MainActivity가 같은 주소로 연다)
//   - 갤럭시 크롬 홈 화면 앱: 공유 대상(manifest share_target, ?memo=&memo_title=)
//   - 어디서나: 요약을 복사한 뒤 앱의 "📋 붙여넣기"
// 녹음 파일은 받지 않고 요약 글만 상담 이력에 저장한다 (사용자가 정함, 2026-10-29).
const KEY = 'shared-memo'
const EVENT = 'shared-memo'
export const MEMO_MAX = 4000

// 앱을 열자마자 주소에서 꺼내 둔다 (로그인 화면을 거쳐도 남게, 주소창에서는 지운다).
export function captureSharedMemo() {
  try {
    const url = new URL(location.href)
    const text = url.searchParams.get('memo')
    const title = url.searchParams.get('memo_title')
    if (text === null && title === null) return
    url.searchParams.delete('memo')
    url.searchParams.delete('memo_title')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
    const body = [title, text].filter((s) => s && s.trim()).join('\n').trim()
    if (body) sessionStorage.setItem(KEY, body.slice(0, MEMO_MAX))
  } catch {
    // 주소를 못 읽으면 붙여넣기로
  }
}

export function takeSharedMemo() {
  try {
    const v = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return v
  } catch {
    return null
  }
}

// 앱 안에서 바로 넘길 때 (붙여넣기)
export function pushSharedMemo(text: string) {
  try {
    sessionStorage.setItem(KEY, text.slice(0, MEMO_MAX))
  } catch {
    // 저장 못 하면 아래 이벤트만
  }
  window.dispatchEvent(new Event(EVENT))
}

export function onSharedMemo(fn: () => void) {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

// 클립보드 읽기 (아이폰은 "붙여넣기" 확인 말풍선이 한 번 뜬다)
export async function readClipboard() {
  try {
    return (await navigator.clipboard.readText()).trim()
  } catch {
    return ''
  }
}

// 요약에 "발신"이 있으면 발신 통화, 아니면 수신 통화
export const guessKind = (text: string) => (/발신|건 전화|걸었/.test(text) && !/수신|받은 전화/.test(text) ? '발신 통화' : '수신 통화')
