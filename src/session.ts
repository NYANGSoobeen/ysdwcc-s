import { sharedComputer } from './firebase.ts'

// 공용 컴퓨터(PC)의 로그인 시간 제한.
// 앱이 열려 있는 동안 1분마다 "아직 열려 있음" 시각을 기록하고, 앱을 다시 열었을 때
// 그 시각이 15분보다 오래됐으면 로그아웃한다 (브라우저가 탭을 복원해 로그인이 살아난 경우 대비).
// 컴퓨터가 잠자기에 들어가 1분 기록이 15분 넘게 끊겨도 로그아웃한다.
const ALIVE_KEY = 'alive-at'
const LIMIT_MS = 15 * 60_000
const TICK_MS = 60_000

export const IDLE_NOTICE = '15분 넘게 앱을 닫아 두어서 로그아웃했습니다. 다시 로그인해 주세요.'

function readAlive() {
  try {
    return Number(localStorage.getItem(ALIVE_KEY) ?? 0)
  } catch {
    return 0
  }
}

export function markAlive() {
  try {
    localStorage.setItem(ALIVE_KEY, String(Date.now()))
  } catch {
    // 저장소를 못 쓰면 시간 제한 없이 브라우저를 닫을 때만 로그아웃된다.
  }
}

// 로그인된 화면을 열 때 부른다. 시간이 지났으면 onExpire를 부르고, 아니면 기록을 시작한다.
export function watchIdle(onExpire: () => void) {
  if (!sharedComputer) return () => {}
  const alive = readAlive()
  if (alive && Date.now() - alive > LIMIT_MS) {
    onExpire()
    return () => {}
  }
  let last = Date.now()
  markAlive()
  const timer = setInterval(() => {
    const now = Date.now()
    // 다른 탭이 기록해 준 시각도 인정한다 (뒤에 있는 탭은 타이머가 늦게 돈다).
    if (now - Math.max(last, readAlive()) > LIMIT_MS) {
      clearInterval(timer)
      onExpire()
      return
    }
    last = now
    markAlive()
  }, TICK_MS)
  return () => clearInterval(timer)
}

// 로그인했던 기록. 기록이 있는데 로그인이 풀려 있으면(토큰 만료, 계정 사용 중지 등)
// 이 기기에 남은 팀 데이터를 지운다. 공용 컴퓨터는 브라우저를 닫으면 같이 사라진다.
const SIGNED_IN_KEY = 'signed-in-uid'
const signedInStore = () => (sharedComputer ? sessionStorage : localStorage)

export function rememberSignedIn(uid: string) {
  try {
    signedInStore().setItem(SIGNED_IN_KEY, uid)
  } catch {
    // 기억하지 못해도 로그인은 동작한다.
  }
}

export function forgetSignedIn() {
  try {
    signedInStore().removeItem(SIGNED_IN_KEY)
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
