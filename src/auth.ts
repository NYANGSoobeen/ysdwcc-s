import { EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore'
import { api } from './api.ts'
import { applyKeepSignedIn, auth, db, keepSignedIn } from './firebase.ts'
import { clearNativeContacts } from './native.ts'
import { passwordProblem } from './password.ts'
import { disconnectFront } from './front/ydr.ts'
import { disablePush } from './push.ts'
import { wipePhoneData } from './phone.ts'
import { forgetSignedIn, markAlive } from './session.ts'

// 이메일이 없는 직원도 쓸 수 있게, "@"가 없는 아이디는 이 도메인을 붙여 계정을 만든다.
// 실제로 메일이 가는 주소가 아니므로 비밀번호 분실 시 관리자가 초기화한다.
const LOGIN_DOMAIN = 'workphone.local'

export function toEmail(loginId: string) {
  const id = loginId.trim().toLowerCase()
  return id.includes('@') ? id : `${id}@${LOGIN_DOMAIN}`
}

export function toLoginId(email: string | null | undefined) {
  if (!email) return ''
  return email.endsWith(`@${LOGIN_DOMAIN}`) ? email.slice(0, -(LOGIN_DOMAIN.length + 1)) : email
}

export async function logIn(loginId: string, password: string, keep = keepSignedIn()) {
  const email = toEmail(loginId)
  await applyKeepSignedIn(keep)
  markAlive()
  try {
    await signInWithEmailAndPassword(auth, email, password)
    forgetDisabledReason(email)
  } catch (error) {
    // 사용 중지된 계정: 이 기기에서 로그아웃될 때 받아 둔 이유가 있으면 같이 보여 준다.
    if ((error as { code?: string }).code === 'auth/user-disabled') {
      const reason = disabledReason(email)
      throw new LoginError(`사용이 중지된 계정입니다.${reason ? `\n이유: ${reason}` : ''}\n관리자에게 문의하세요.`)
    }
    throw error
  }
}

export class LoginError extends Error {}

// 비밀번호 규칙은 서버(changeMyPassword)도 검사한다. 서버가 비밀번호를 바꾸면 이 기기의 로그인도
// 끊길 수 있어, 바꾼 비밀번호로 바로 다시 로그인한다.
export async function changePassword(current: string, next: string) {
  const user = auth.currentUser!
  const problem = passwordProblem(next, user.email ?? '')
  if (problem) throw new LoginError(problem)
  if (next === current) throw new LoginError('지금 비밀번호와 다른 비밀번호를 정하세요.')
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, current))
  await api.changeMyPassword({ password: next })
  await signInWithEmailAndPassword(auth, user.email!, next)
}

const DISABLED_KEY = 'disabled-reason:'

export function rememberDisabledReason(email: string, reason: string) {
  try {
    localStorage.setItem(DISABLED_KEY + email, reason)
  } catch {
    // 무시
  }
}

function disabledReason(email: string) {
  try {
    return localStorage.getItem(DISABLED_KEY + email)
  } catch {
    return null
  }
}

function forgetDisabledReason(email: string) {
  try {
    localStorage.removeItem(DISABLED_KEY + email)
  } catch {
    // 무시
  }
}

const NOTICE_KEY = 'login-notice'

// 로그아웃하거나 팀에서 제외되면 이 기기에 남은 팀 데이터(오프라인 캐시)를 지운다.
export async function logOutAndWipe(notice?: string) {
  try {
    if (notice) sessionStorage.setItem(NOTICE_KEY, notice)
  } catch {
    // 저장소를 못 쓰는 환경이면 안내만 생략한다.
  }
  forgetSignedIn()
  // 앱에서 건 전화 기록, 문자 본 시각 (이 기기에만 있던 것)
  wipePhoneData()
  // 갤럭시 앱이면 폰 연락처에 넣은 고객도 지운다 (데이터 저장 규칙: 계정째 삭제).
  await clearNativeContacts()
  // 이 기기 알림을 끈다 (다음 사람에게 내 알림이 가지 않게).
  await disablePush().catch(() => {})
  // 프론트 채팅(게스트) 로그인도 끊는다.
  await disconnectFront()
  await signOut(auth).catch(() => {})
  await terminate(db)
  await clearIndexedDbPersistence(db).catch(() => {})
  location.reload()
}

export function takeLoginNotice() {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY)
    sessionStorage.removeItem(NOTICE_KEY)
    return notice
  } catch {
    return null
  }
}

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': '아이디 또는 비밀번호가 맞지 않습니다.',
  // 아이디가 있는지 없는지 드러나지 않도록 같은 문구를 쓴다.
  'auth/wrong-password': '아이디 또는 비밀번호가 맞지 않습니다.',
  'auth/user-not-found': '아이디 또는 비밀번호가 맞지 않습니다.',
  'auth/user-disabled': '사용이 중지된 계정입니다. 관리자에게 문의하세요.',
  'auth/user-token-expired': '로그인이 만료되었습니다. 다시 로그인하세요.',
  'auth/requires-recent-login': '지금 비밀번호를 다시 확인해 주세요.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
  'auth/network-request-failed': '인터넷 연결을 확인하세요.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
}


export function errorMessage(error: unknown) {
  if (error instanceof LoginError) return error.message
  const { code, message } = error as { code?: string; message?: string }
  if (code && AUTH_ERRORS[code]) return AUTH_ERRORS[code]
  // Functions에서 보낸 HttpsError는 한국어 메시지를 그대로 보여 준다.
  if (code?.startsWith('functions/') && message && code !== 'functions/internal') return message
  if (code === 'permission-denied') return '권한이 없습니다.'
  return '문제가 생겼습니다. 잠시 후 다시 시도하세요.'
}
