import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth'
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore'
import { auth, db } from './firebase.ts'

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

export async function logIn(loginId: string, password: string) {
  await signInWithEmailAndPassword(auth, toEmail(loginId), password)
}

export async function changePassword(current: string, next: string) {
  const user = auth.currentUser!
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, current))
  await updatePassword(user, next)
}

const NOTICE_KEY = 'login-notice'

// 로그아웃하거나 팀에서 제외되면 이 기기에 남은 팀 데이터(오프라인 캐시)를 지운다.
export async function logOutAndWipe(notice?: string) {
  try {
    if (notice) sessionStorage.setItem(NOTICE_KEY, notice)
  } catch {
    // 저장소를 못 쓰는 환경이면 안내만 생략한다.
  }
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
  'auth/user-disabled': '사용이 중지된 계정입니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
  'auth/network-request-failed': '인터넷 연결을 확인하세요.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
}

export function errorMessage(error: unknown) {
  const { code, message } = error as { code?: string; message?: string }
  if (code && AUTH_ERRORS[code]) return AUTH_ERRORS[code]
  // Functions에서 보낸 HttpsError는 한국어 메시지를 그대로 보여 준다.
  if (code?.startsWith('functions/') && message && code !== 'functions/internal') return message
  if (code === 'permission-denied') return '권한이 없습니다.'
  return '문제가 생겼습니다. 잠시 후 다시 시도하세요.'
}
