import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging'
import { app, auth, db, isNativeApp } from './firebase.ts'

// 푸시 알림 (앱이 꺼져 있어도 새 채팅·나를 부른 말·프론트 채팅 알림).
// - 웹(PC 크롬·엣지, 갤럭시 크롬, 홈 화면에 추가한 아이폰 앱): FCM 웹 푸시. 알림은 서비스 워커(public/push-sw.js)가 그린다.
// - 갤럭시 앱: 설치형 앱 알림이 따로 필요하다 (google-services.json + APK 다시 만들기, 아직 안 함).
// - 기기마다 pushTokens/{sha256(token)} = { uid, token, platform, mode, updatedAt } (서버가 이 목록으로 보낸다)
// - mode: 'all' 모든 새 메시지 / 'mentions' 나를 부른 말만
export type PushMode = 'all' | 'mentions'

const SAVED_KEY = 'push-device' // { token, uid, mode, at } 이 기기에서 켠 알림
// 웹 푸시 공개 키. 비워 두면 Firebase 기본 키를 쓴다 (콘솔 → 클라우드 메시징 → 웹 푸시 인증서에서 만든 키를 넣어도 됨).
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined

type Saved = { token: string; uid: string; mode: PushMode; at: number }

function readSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null')
  } catch {
    return null
  }
}
function writeSaved(v: Saved | null) {
  try {
    if (v) localStorage.setItem(SAVED_KEY, JSON.stringify(v))
    else localStorage.removeItem(SAVED_KEY)
  } catch {
    // 기억하지 못하면 다음에 다시 켜면 된다.
  }
}

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export type PushState =
  | { kind: 'native' } // 갤럭시 앱 (아직 지원 안 함)
  | { kind: 'ios-browser' } // 아이폰 사파리: 홈 화면에 추가해야 알림 가능
  | { kind: 'unsupported' }
  | { kind: 'blocked' } // 브라우저 설정에서 알림을 막아 둠
  | { kind: 'off' }
  | { kind: 'on'; mode: PushMode }

export async function pushState(): Promise<PushState> {
  if (isNativeApp) return { kind: 'native' }
  if (isIOS && !standalone()) return { kind: 'ios-browser' }
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !(await isSupported().catch(() => false))) {
    return { kind: 'unsupported' }
  }
  if (Notification.permission === 'denied') return { kind: 'blocked' }
  const saved = readSaved()
  if (Notification.permission === 'granted' && saved && saved.uid === auth.currentUser?.uid) return { kind: 'on', mode: saved.mode }
  return { kind: 'off' }
}

async function hashId(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function currentToken() {
  // 앱(서비스 워커)이 아직 준비되지 않았으면 기다리다 그만둔다.
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('앱 준비가 아직 안 됐어요. 화면을 새로고침한 뒤 다시 해 주세요.')), 10_000)),
  ])
  return getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
}

async function saveToken(token: string, mode: PushMode) {
  const uid = auth.currentUser!.uid
  await setDoc(doc(db, 'pushTokens', await hashId(token)), { uid, token, platform: 'web', mode, updatedAt: serverTimestamp() })
  writeSaved({ token, uid, mode, at: Date.now() })
}

// 알림 켜기 (버튼을 누를 때 불러야 아이폰이 허락 창을 띄운다)
export async function enablePush(mode: PushMode) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림이 허용되지 않았어요. 브라우저(또는 휴대폰) 설정에서 이 사이트의 알림을 허용해 주세요.')
  const token = await currentToken()
  if (!token) throw new Error('알림 등록에 실패했어요. 잠시 뒤 다시 해 주세요.')
  await saveToken(token, mode)
}

export async function setPushMode(mode: PushMode) {
  const saved = readSaved()
  if (!saved) return enablePush(mode)
  await saveToken(saved.token, mode)
}

// 알림 끄기 / 로그아웃: 서버 목록에서 지우고 기기 등록도 푼다.
export async function disablePush() {
  const saved = readSaved()
  writeSaved(null)
  if (!saved) return
  await deleteDoc(doc(db, 'pushTokens', await hashId(saved.token))).catch(() => {})
  await deleteToken(getMessaging(app)).catch(() => {})
}

// 앱을 열 때: 켜 둔 기기면 토큰이 바뀌었는지 확인하고, 일주일에 한 번은 서버 목록을 새로 적는다.
export async function refreshPush() {
  const saved = readSaved()
  const uid = auth.currentUser?.uid
  if (!saved || !uid || isNativeApp || !('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const token = await currentToken()
    if (!token) return
    if (token !== saved.token || saved.uid !== uid || Date.now() - saved.at > 7 * 24 * 3600 * 1000) {
      if (token !== saved.token) await deleteDoc(doc(db, 'pushTokens', await hashId(saved.token))).catch(() => {})
      await saveToken(token, saved.mode)
    }
  } catch {
    // 인터넷이 끊겼으면 다음에 앱을 열 때 다시 한다.
  }
}

// 알림을 눌러 들어온 주소(/?room=팀:방, /?front=방)나, 앱이 열려 있을 때 서비스 워커가 보낸 주소를 처리한다.
export type OpenRequest = { kind: 'room'; teamId: string; channelId: string } | { kind: 'front'; ch: string }
export function parseOpenUrl(url: string): OpenRequest | null {
  const params = new URL(url, location.origin).searchParams
  const room = params.get('room')
  if (room?.includes(':')) {
    const [teamId, channelId] = room.split(':')
    return { kind: 'room', teamId, channelId }
  }
  const front = params.get('front')
  if (front) return { kind: 'front', ch: front }
  return null
}

export function listenOpenRequests(handle: (req: OpenRequest) => void) {
  const first = parseOpenUrl(location.href)
  if (first) {
    history.replaceState(null, '', location.pathname)
    setTimeout(() => handle(first), 0)
  }
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type !== 'open-url') return
    const req = parseOpenUrl(String(e.data.url))
    if (req) handle(req)
  }
  navigator.serviceWorker?.addEventListener('message', onMessage)
  return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
}
