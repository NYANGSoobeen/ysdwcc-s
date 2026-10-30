import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging'
import { app, auth, db, isNativeApp } from './firebase.ts'

// 🔔 푸시 알림 (9번). 앱이 꺼져 있어도 새 채팅·나를 부른 말·공지·프론트 채팅 알림.
// - 웹(PC 크롬·엣지, 갤럭시 크롬, 홈 화면에 추가한 아이폰 앱): FCM 웹 푸시. 알림은 서비스 워커(public/push-sw.js)가 그린다.
// - 갤럭시 앱: 설치형 앱 알림이 따로 필요하다 (google-services.json + APK 다시 만들기, 아직 안 함).
// - 기기마다 pushTokens/{sha256(token)} = { uid, token, platform, mode, kinds, pc, seenAt, updatedAt } (서버가 이 목록으로 보낸다)
// - kinds: 종류별 켜기/끄기 {chat 모든 새 채팅, mention 나를 부른 말, notice 공지, front 프론트 채팅} (mode는 예전 기기용)
// - PC(여러 사람이 쓰는 컴퓨터)는 앱이 열려 있는 동안 5분마다 seenAt을 적고, 서버는 20분 넘게 소식 없는 PC에는 안 보낸다.
// - 로그아웃하면 서버 목록에서 지우지만, 직접 끈 게 아니면 같은 사람이 다시 로그인할 때 저절로 다시 켠다(push-wanted).
export type PushKinds = { chat: boolean; mention: boolean; notice: boolean; front: boolean }
export type PushMode = 'all' | 'mentions'
export const DEFAULT_KINDS: PushKinds = { chat: true, mention: true, notice: true, front: true }

const SAVED_KEY = 'push-device' // { token, uid, kinds, at } 이 기기에서 켠 알림
const WANTED_KEY = 'push-wanted' // { uid, kinds } 로그아웃해도 기억 (직접 끄면 지움)
const HEARTBEAT_MS = 5 * 60 * 1000
// 웹 푸시 공개 키. 비워 두면 Firebase 기본 키를 쓴다 (콘솔 → 클라우드 메시징 → 웹 푸시 인증서에서 만든 키를 넣어도 됨).
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined

type Saved = { token: string; uid: string; kinds: PushKinds; at: number }

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function write(key: string, v: unknown) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v))
    else localStorage.removeItem(key)
  } catch {
    // 기억하지 못하면 다음에 다시 켜면 된다.
  }
}
const readSaved = () => {
  const s = read<Saved & { mode?: PushMode }>(SAVED_KEY)
  if (s && !s.kinds) s.kinds = s.mode === 'mentions' ? { chat: false, mention: true, notice: false, front: false } : DEFAULT_KINDS
  return s
}

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
// 마우스로 쓰는 컴퓨터 = PC (여러 사람이 쓰는 컴퓨터일 수 있어 열려 있을 때만 받는다)
export const isPc = () => matchMedia('(hover: hover) and (pointer: fine)').matches && !isIOS

export type PushState =
  | { kind: 'native' } // 갤럭시 앱 (아직 지원 안 함)
  | { kind: 'ios-browser' } // 아이폰 사파리: 홈 화면에 추가해야 알림 가능
  | { kind: 'unsupported' }
  | { kind: 'blocked' } // 브라우저 설정에서 알림을 막아 둠
  | { kind: 'off' }
  | { kind: 'on'; kinds: PushKinds }

export async function pushState(): Promise<PushState> {
  if (isNativeApp) return { kind: 'native' }
  if (isIOS && !standalone()) return { kind: 'ios-browser' }
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !(await isSupported().catch(() => false))) {
    return { kind: 'unsupported' }
  }
  if (Notification.permission === 'denied') return { kind: 'blocked' }
  const saved = readSaved()
  if (Notification.permission === 'granted' && saved && saved.uid === auth.currentUser?.uid) return { kind: 'on', kinds: saved.kinds }
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

const modeOf = (k: PushKinds): PushMode => (k.chat ? 'all' : 'mentions')

async function saveToken(token: string, kinds: PushKinds) {
  const uid = auth.currentUser!.uid
  await setDoc(doc(db, 'pushTokens', await hashId(token)), {
    uid,
    token,
    platform: 'web',
    mode: modeOf(kinds),
    kinds,
    pc: isPc(),
    seenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  write(SAVED_KEY, { token, uid, kinds, at: Date.now() })
  write(WANTED_KEY, { uid, kinds })
}

// 알림 켜기 (버튼을 누를 때 불러야 아이폰이 허락 창을 띄운다)
export async function enablePush(kinds: PushKinds = DEFAULT_KINDS) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림이 허용되지 않았어요. 브라우저(또는 휴대폰) 설정에서 이 사이트의 알림을 허용해 주세요.')
  const token = await currentToken()
  if (!token) throw new Error('알림 등록에 실패했어요. 잠시 뒤 다시 해 주세요.')
  await saveToken(token, kinds)
}

export async function setPushKinds(kinds: PushKinds) {
  const saved = readSaved()
  if (!saved) return enablePush(kinds)
  await saveToken(saved.token, kinds)
}

// 알림 끄기. byUser: 사용자가 직접 껐으면 다시 로그인해도 켜지 않는다. 로그아웃(byUser=false)이면 기억해 두었다가 다시 켠다.
export async function disablePush(byUser = false) {
  const saved = readSaved()
  write(SAVED_KEY, null)
  if (byUser) write(WANTED_KEY, null)
  if (!saved) return
  await deleteDoc(doc(db, 'pushTokens', await hashId(saved.token))).catch(() => {})
  await deleteToken(getMessaging(app)).catch(() => {})
}

// 앱을 열 때: 켜 둔 기기면 토큰이 바뀌었는지 확인하고, 일주일에 한 번은 서버 목록을 새로 적는다.
// 로그아웃 때문에 꺼졌던 기기면(직접 끈 게 아니면) 같은 사람이 로그인했을 때 다시 켠다.
export async function refreshPush() {
  const uid = auth.currentUser?.uid
  if (!uid || isNativeApp || !('Notification' in window) || Notification.permission !== 'granted') return
  const saved = readSaved()
  const wanted = read<{ uid: string; kinds: PushKinds }>(WANTED_KEY)
  try {
    if (!saved) {
      if (wanted?.uid === uid) await enablePush(wanted.kinds)
      return
    }
    const token = await currentToken()
    if (!token) return
    if (token !== saved.token || saved.uid !== uid || Date.now() - saved.at > 7 * 24 * 3600 * 1000) {
      if (token !== saved.token) await deleteDoc(doc(db, 'pushTokens', await hashId(saved.token))).catch(() => {})
      await saveToken(token, saved.uid === uid ? saved.kinds : DEFAULT_KINDS)
    }
  } catch {
    // 인터넷이 끊겼으면 다음에 앱을 열 때 다시 한다.
  }
}

// PC: 앱이 열려 있는 동안 5분마다 "여기 있어요"를 서버에 알린다 (화면을 다시 볼 때도).
export function startPushHeartbeat() {
  const beat = async () => {
    const saved = readSaved()
    if (!saved || !isPc() || saved.uid !== auth.currentUser?.uid || document.visibilityState === 'hidden') return
    await updateDoc(doc(db, 'pushTokens', await hashId(saved.token)), { seenAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(() => {})
  }
  void beat()
  const timer = setInterval(() => void beat(), HEARTBEAT_MS)
  const onVisible = () => document.visibilityState === 'visible' && void beat()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

// ── 서비스 워커와 이야기하기 ──
async function toWorker(message: unknown) {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  reg?.active?.postMessage(message)
}

// 지금 보고 있는 방(알림 tag)을 알려 주면, 그 방의 알림은 띄우지 않고 이미 뜬 알림은 지운다.
export function tellViewing(tag: string | null) {
  void toWorker({ type: 'viewing', tag })
  if (tag) void clearNotifications(tag)
}
export async function clearNotifications(tag: string) {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  const list = (await reg?.getNotifications({ tag }).catch(() => [])) ?? []
  list.forEach((n) => n.close())
}
export const roomTag = (teamId: string, channelId: string) => `room-${teamId}-${channelId}`
export const frontTag = (ch: string) => `front-${ch}`

// 📛 앱 아이콘 빨간 숫자 = 안 읽은 채팅 수. 앱이 열려 있으면 앱이 정확한 수로 맞추고,
// 꺼져 있을 때는 서비스 워커가 알림이 올 때마다 하나씩 올린다.
export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (count > 0) nav.setAppBadge?.(count).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
  void toWorker({ type: 'badge', count })
}

// 알림을 눌러 들어온 주소(/?room=팀:방, /?front=방, /?notice=팀)나, 앱이 열려 있을 때 서비스 워커가 보낸 주소를 처리한다.
export type OpenRequest =
  | { kind: 'room'; teamId: string; channelId: string }
  | { kind: 'front'; ch: string }
  | { kind: 'notice'; teamId: string }
  // 갤럭시 앱 🔔 전화·문자 알림 (android/.../phone/PhoneAlerts.kt): ✉️ 그 번호 대화, 📞 최근기록, 📇 그 번호 고객
  | { kind: 'sms'; number: string }
  | { kind: 'calls' }
  | { kind: 'caller'; number: string }
export function parseOpenUrl(url: string): OpenRequest | null {
  const params = new URL(url, location.origin).searchParams
  const room = params.get('room')
  if (room?.includes(':')) {
    const [teamId, channelId] = room.split(':')
    return { kind: 'room', teamId, channelId }
  }
  const front = params.get('front')
  if (front) return { kind: 'front', ch: front }
  const notice = params.get('notice')
  if (notice) return { kind: 'notice', teamId: notice }
  const sms = params.get('sms')
  if (sms) return { kind: 'sms', number: sms }
  if (params.get('calls')) return { kind: 'calls' }
  const caller = params.get('customer')
  if (caller) return { kind: 'caller', number: caller }
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
  // 갤럭시 앱이 열려 있을 때 알림을 누르면 MainActivity가 이 이벤트로 알려 준다 (다시 불러오지 않음)
  const onNative = (e: Event) => {
    const req = parseOpenUrl(String((e as CustomEvent).detail))
    if (req) handle(req)
  }
  navigator.serviceWorker?.addEventListener('message', onMessage)
  window.addEventListener('native-open', onNative)
  return () => {
    navigator.serviceWorker?.removeEventListener('message', onMessage)
    window.removeEventListener('native-open', onNative)
  }
}
