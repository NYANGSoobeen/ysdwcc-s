import { keepSignedIn } from './firebase.ts'

// "로그인 유지"를 끄고 로그인했을 때 (여러 사람이 쓰는 컴퓨터).
// ① 브라우저(앱)를 닫으면 바로 로그아웃 (2026-11-17 사용자 요청 "로그인 유지 안 누른 사람은 브라우저 끄면 바로 로그아웃"):
//    로그인은 세션 저장이라 원래 닫으면 풀리지만, 크롬의 "이전 탭 다시 열기"는 세션까지 되살려 로그인이 살아났다.
//    → 탭을 닫을 때(pagehide) "닫힌 시각"을 남기고, 다시 열었을 때 그 뒤로 열린 탭이 없었고(살아 있음 기록이 그보다 이전)
//      5초 넘게 지났으면(새로고침은 바로 다시 열려서 제외) 로그아웃한다. 닫힘 기록을 못 남기고 꺼진 경우(강제 종료·
//      폰 앱이 정리됨)는 살아 있음 기록이 3분 넘게 끊겼으면 로그아웃.
// ② 열려 있는 동안 컴퓨터가 잠자기로 15분 넘게 끊겨도 로그아웃 (예전 그대로).
// 열린 탭은 10초마다 "살아 있음"을 적는다 (뒤에 있는 탭은 브라우저가 1분에 한 번으로 늦춤 → 3분이면 넉넉).
const ALIVE_KEY = 'alive-at'
const CLOSED_KEY = 'closed-at'
const LIMIT_MS = 15 * 60_000
const GONE_MS = 3 * 60_000
const RELOAD_MS = 5_000
const TICK_MS = 10_000

export const IDLE_NOTICE = '15분 넘게 앱을 쓰지 않아서 로그아웃했습니다. 다시 로그인해 주세요.'
export const CLOSED_NOTICE = '"로그인 유지"를 끄고 로그인해서, 브라우저를 닫을 때 로그아웃했습니다. 다시 로그인해 주세요.'

function readNum(key: string) {
  try {
    return Number(localStorage.getItem(key) ?? 0)
  } catch {
    return 0
  }
}
const readAlive = () => readNum(ALIVE_KEY)

export function markAlive() {
  try {
    localStorage.setItem(ALIVE_KEY, String(Date.now()))
    localStorage.removeItem(CLOSED_KEY)
  } catch {
    // 저장소를 못 쓰면 시간 제한 없이 브라우저를 닫을 때만 로그아웃된다.
  }
}

// 로그인된 화면을 열 때 부른다. 닫혔다 다시 열렸거나 시간이 지났으면 onExpire(알림 글)를, 아니면 기록을 시작한다.
let openedGone: boolean | null = null
export function watchIdle(onExpire: (notice: string) => void) {
  if (keepSignedIn()) return () => {}
  const now = Date.now()
  // 이 페이지를 연 뒤 처음 한 번만 판단한다 (개발 모드에서 두 번 불려도 같은 답)
  if (openedGone === null) {
    const alive = readAlive()
    const closed = readNum(CLOSED_KEY)
    openedGone = Boolean((closed && closed >= alive && now - closed > RELOAD_MS) || (alive && now - alive > GONE_MS))
  }
  const gone = openedGone
  // 다른 탭이 아직 열려 있으면(한 탭만 닫은 경우) 그 탭이 대답한다 → 로그아웃하지 않음
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('app-alive') : null
  let stopped = false
  const me = Math.random().toString(36).slice(2)
  if (bc) bc.onmessage = (e) => e.data?.ping && e.data.ping !== me && bc.postMessage({ pong: e.data.ping })
  if (gone) {
    if (!bc) {
      onExpire(CLOSED_NOTICE)
      return () => {}
    }
    let answered = false
    const probe = new BroadcastChannel('app-alive')
    probe.onmessage = (e) => {
      if (e.data?.pong === me) answered = true
    }
    probe.postMessage({ ping: me })
    setTimeout(() => {
      probe.close()
      if (!answered && !stopped) onExpire(CLOSED_NOTICE)
    }, 500)
  }
  let last = now
  markAlive()
  const timer = setInterval(() => {
    const t = Date.now()
    // 다른 탭이 기록해 준 시각도 인정한다 (뒤에 있는 탭은 타이머가 늦게 돈다).
    if (t - Math.max(last, readAlive()) > LIMIT_MS) {
      clearInterval(timer)
      onExpire(IDLE_NOTICE)
      return
    }
    last = t
    markAlive()
  }, TICK_MS)
  // 탭·브라우저를 닫을 때 (뒤로 가기 캐시에 들어가는 건 닫힌 게 아님)
  const onHide = (e: PageTransitionEvent) => {
    if (e.persisted) return
    try {
      localStorage.setItem(CLOSED_KEY, String(Date.now()))
    } catch {
      // 무시
    }
  }
  // 다른 탭이 아직 열려 있으면 그 탭이 곧 살아 있음을 다시 적어 닫힘 기록을 지운다
  const onShow = () => markAlive()
  window.addEventListener('pagehide', onHide)
  window.addEventListener('pageshow', onShow)
  return () => {
    stopped = true
    bc?.close()
    clearInterval(timer)
    window.removeEventListener('pagehide', onHide)
    window.removeEventListener('pageshow', onShow)
  }
}

// 로그인했던 기록. 기록이 있는데 로그인이 풀려 있으면(토큰 만료, 계정 사용 중지 등)
// 이 기기에 남은 팀 데이터를 지운다. 로그인 유지를 껐으면 브라우저를 닫을 때 같이 사라진다.
const SIGNED_IN_KEY = 'signed-in-uid'
const signedInStore = () => (keepSignedIn() ? localStorage : sessionStorage)

export function rememberSignedIn(uid: string) {
  try {
    signedInStore().setItem(SIGNED_IN_KEY, uid)
  } catch {
    // 기억하지 못해도 로그인은 동작한다.
  }
}

export function forgetSignedIn() {
  try {
    localStorage.removeItem(SIGNED_IN_KEY)
    sessionStorage.removeItem(SIGNED_IN_KEY)
  } catch {
    // 무시
  }
}

export function wasSignedIn() {
  try {
    return Boolean(signedInStore().getItem(SIGNED_IN_KEY))
  } catch {
    return false
  }
}
