import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  limit,
  memoryLocalCache,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { connectStorageEmulator, getBlob, getStorage, ref } from 'firebase/storage'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { auth, db, keepSignedIn } from '../firebase.ts'
import { toast } from '../ui/dialogs.tsx'

// 🏌️ 프론트 채팅: 양산동원로얄CC 프론트 앱(다른 Firebase 프로젝트 ysdwcc-f)의 채팅방에 "타부서 게스트"로 들어간다.
// 요구사항은 프론트 저장소의 GUEST_LINK.md.
// - 프론트 프로젝트에 이름 붙인 두 번째 앱('ydr')으로 접속한다 (우리 앱과 섞이지 않게).
// - 입장: 우리 로그인 토큰 + 초대 코드 → 프론트 함수 guestAuth → 프론트 로그인 토큰(게스트) → 그쪽에 로그인.
// - 게스트는 초대받은 방의 채팅만 읽고 쓴다 (프론트 보안 규칙이 막음). 글·답장만 보내고, 사진·파일은 보기만.
// - 프론트 쪽 데이터는 기기에 남기지 않는다 (메모리 캐시).

const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true'

// 프론트 앱의 웹 설정 (공개 값, 프론트 저장소 js/firebase-config.js)
const FRONT_CONFIG = {
  apiKey: 'AIzaSyBCpwZx7fd7t4wd5SBr2-Tf3fYjGjqntVU',
  authDomain: 'ysdwcc-f.firebaseapp.com',
  projectId: 'ysdwcc-f',
  storageBucket: 'ysdwcc-f.firebasestorage.app',
  messagingSenderId: '51800064294',
  appId: '1:51800064294:web:641f92bb19163a3f7401e7',
}

const ydrApp = initializeApp(
  useEmulators ? { apiKey: 'demo', projectId: 'demo-ydr', storageBucket: 'demo-ydr.appspot.com' } : FRONT_CONFIG,
  'ydr',
)
// 로그인 유지를 끈 컴퓨터는 프론트 로그인도 브라우저를 닫으면 사라진다.
const ydrAuth = initializeAuth(ydrApp, {
  persistence: keepSignedIn() ? [indexedDBLocalPersistence, browserLocalPersistence] : browserSessionPersistence,
})
export const ydrDb = initializeFirestore(ydrApp, { localCache: memoryLocalCache() })
const ydrStorage = getStorage(ydrApp)
const ydrFunctions = getFunctions(ydrApp, 'us-west1')
if (useEmulators) {
  connectAuthEmulator(ydrAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(ydrDb, '127.0.0.1', 8080)
  connectStorageEmulator(ydrStorage, '127.0.0.1', 9199)
  connectFunctionsEmulator(ydrFunctions, '127.0.0.1', 5001)
}

// ── 상태 ───────────────────────────────────────────────────────
export type FrontRoom = { id: string; name: string; from: number }
export type FrontState = {
  status: 'off' | 'connecting' | 'on'
  uid: string | null // 프론트 쪽 내 아이디 (g_…)
  name: string // 프론트 직원이 초대할 때 적은 내 이름
  rooms: FrontRoom[]
}

const FLAG_KEY = 'front-chat' // 프론트 채팅에 들어가 있는 기기 (앱을 열 때 로그인을 다시 받는다)
let state: FrontState = { status: 'off', uid: null, name: '', rooms: [] }
const listeners = new Set<() => void>()
function set(next: Partial<FrontState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
export function useFront() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

function setFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG_KEY, '1')
    else localStorage.removeItem(FLAG_KEY)
  } catch {
    // 기억하지 못하면 다음에 앱을 열 때 프론트 채팅 화면에서 다시 연결한다.
  }
}
function hasFlag() {
  try {
    return localStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}

const roomNames = new Map<string, string>()
const leaving = new Set<string>() // 내가 나가기를 누른 방 ("내보냈어요" 안내를 띄우지 않게)
let stopGuest = () => {}

function watchGuest(uid: string) {
  stopGuest()
  let known: string[] | null = null
  stopGuest = onSnapshot(
    doc(ydrDb, 'guests', uid),
    async (snap) => {
      // 기기에 남아 있던 예전 값(방이 없던 때)으로 판단하지 않는다: 서버 값을 기다린다.
      if (snap.metadata.fromCache) return
      const g = snap.data() ?? {}
      const channels: string[] = g.active === false ? [] : (g.channels ?? [])
      // 방에서 빠졌으면(내가 나간 게 아니면) 내보내졌다고 알린다.
      for (const ch of known ?? []) {
        if (channels.includes(ch)) continue
        if (leaving.delete(ch)) continue
        toast(`프론트에서 "${roomNames.get(ch) ?? '채팅방'}" 방에서 내보냈어요.`, { long: true })
      }
      known = channels
      await Promise.all(
        channels
          .filter((ch) => !roomNames.has(ch))
          .map((ch) =>
            getDoc(doc(ydrDb, 'channels', ch)).then(
              (d) => void roomNames.set(ch, String(d.get('name') ?? '프론트 채팅방')),
              () => void roomNames.set(ch, '프론트 채팅방'),
            ),
          ),
      )
      if (channels.length === 0) return void disconnectFront({ forget: true })
      set({
        status: 'on',
        uid,
        name: [g.name, g.dept].filter(Boolean).join(' · '),
        rooms: channels.map((id) => ({ id, name: roomNames.get(id) ?? '프론트 채팅방', from: Number(g.from?.[id] ?? 0) })),
      })
    },
    () => {},
  )
}

type AuthResult = { token: string; uid: string; channels: string[] }

// 입장(초대 코드) 또는 다시 로그인. 초대 코드로 들어갈 때의 오류는 화면에 보여 주도록 던진다.
export async function connectFront(code?: string) {
  const me = auth.currentUser
  if (!me) return
  // 앱을 열 때 다시 로그인하는 동안만 "연결하는 중" (초대 코드를 넣을 때는 입력 화면을 그대로 둔다)
  if (!code && state.status === 'off') set({ status: 'connecting' })
  try {
    const idToken = await me.getIdToken()
    const res = await httpsCallable<{ idToken: string; code?: string }, AuthResult>(ydrFunctions, 'guestAuth')(
      code ? { idToken, code: code.trim().toUpperCase() } : { idToken },
    )
    await signInWithCustomToken(ydrAuth, res.data.token)
    setFlag(true)
    rememberOnAccount(true)
    watchGuest(res.data.uid)
  } catch (err) {
    const codeName = (err as { code?: string }).code ?? ''
    if (!code && codeName.endsWith('permission-denied')) {
      // 초대받은 방이 하나도 없음 (모두 나갔거나 내보내짐)
      await disconnectFront({ forget: true })
      return
    }
    // 다시 로그인이 실패해도(인터넷 끊김 등) 남아 있는 프론트 로그인으로 계속 본다.
    if (!code && ydrAuth.currentUser) watchGuest(ydrAuth.currentUser.uid)
    else if (state.status === 'connecting') set({ status: 'off' })
    if (code) throw new Error(frontError(err))
  }
}

// "프론트 채팅에 들어가 있음"을 내 계정(users/{uid}.settings.frontChat)에도 기억한다.
// → 로그아웃했다 다시 로그인해도, 다른 기기에서 열어도 코드 없이 다시 연결된다 (내보내지거나 나가기 전까지).
let accountJoined = false
function rememberOnAccount(on: boolean) {
  const me = auth.currentUser
  if (!me || accountJoined === on) return
  accountJoined = on
  updateDoc(doc(db, 'users', me.uid), { 'settings.frontChat': on }).catch(() => {})
}

// 앱을 열 때: 프론트 채팅에 들어가 있던 계정·기기면 코드 없이 다시 로그인한다 (내보내졌으면 정리).
export function resumeFront(joinedOnAccount: boolean) {
  accountJoined = joinedOnAccount
  if (joinedOnAccount || hasFlag()) tryResume()
}

// 한 번 로그인해 있는 동안 자동 연결은 한 번만 해 본다 (안 되면 초대 코드 입력 화면).
let triedFor: string | null = null
export function tryResume() {
  const me = auth.currentUser
  if (!me || triedFor === me.uid || state.status !== 'off') return
  triedFor = me.uid
  void connectFront()
}

// 로그아웃할 때(계정 기억은 남김), 또는 초대받은 방이 없어졌을 때(forget: 계정 기억도 지움)
export async function disconnectFront(opts: { forget?: boolean } = {}) {
  stopGuest()
  stopGuest = () => {}
  setFlag(false)
  if (opts.forget) rememberOnAccount(false)
  else triedFor = null
  set({ status: 'off', uid: null, name: '', rooms: [] })
  await signOut(ydrAuth).catch(() => {})
}

export async function leaveFrontRoom(ch: string) {
  leaving.add(ch)
  try {
    await httpsCallable<{ ch: string }, unknown>(ydrFunctions, 'guestLeave')({ ch })
  } catch (err) {
    leaving.delete(ch)
    throw new Error(frontError(err))
  }
}

function frontError(err: unknown) {
  const e = err as { code?: string; message?: string }
  // 프론트 함수의 오류는 한국어로 온다.
  if (e.message && /[가-힣]/.test(e.message)) return e.message
  if (e.code?.endsWith('unavailable') || e.code?.endsWith('internal')) return '프론트 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.'
  return '프론트 채팅에 들어가지 못했어요.'
}

// ── 사진·이모티콘·파일 (프론트 Storage assets/{id}, 보기만) ──────
const assetUrls = new Map<string, Promise<string>>()
export function assetUrl(id: string) {
  let url = assetUrls.get(id)
  if (!url) {
    url = getBlob(ref(ydrStorage, `assets/${id}`)).then((b) => URL.createObjectURL(b))
    url.catch(() => assetUrls.delete(id))
    assetUrls.set(id, url)
  }
  return url
}

// ── 프론트 직원 이름 (accounts/{아이디}, authorId = acc_아이디) ────
export type FrontAccount = {
  loginId: string
  name: string
  position: string
  avatarAssetId: string | null
  active: boolean
  admin: boolean
  chatFrom: number // 이 시각(ms)부터의 채팅만 보이는 직원 (0 = 전부)
}
let accountsCache: Promise<Map<string, FrontAccount>> | null = null
export function useFrontAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<Map<string, FrontAccount>>(new Map())
  useEffect(() => {
    if (!enabled) return
    accountsCache ??= getDocs(collection(ydrDb, 'accounts')).then(
      (snap) =>
        new Map(
          snap.docs.map((d) => [
            `acc_${d.id}`,
            {
              loginId: d.id,
              name: String(d.get('name') ?? ''),
              position: String(d.get('position') ?? ''),
              avatarAssetId: d.get('avatarAssetId') ?? null,
              active: d.get('active') !== false,
              admin: d.get('role') === 'admin',
              chatFrom: Number(d.get('chatFrom')) || 0,
            },
          ]),
        ),
      (err) => {
        accountsCache = null
        throw err
      },
    )
    let active = true
    accountsCache.then((m) => active && setAccounts(m)).catch(() => {})
    return () => {
      active = false
    }
  }, [enabled])
  return accounts
}

// ── 메시지 ─────────────────────────────────────────────────────
export type FrontMessage = {
  id: string
  text: string
  authorId: string | null
  createdAt: number
  replyTo: { id: string; authorId: string | null; text: string; kind?: string } | null
  images: string[]
  sticker: string | null
  file: { name: string; assetId: string } | null
  link: { url: string; title?: string; desc?: string; site?: string; thumb?: string } | null
  deleted: boolean
  edited: boolean
  system: boolean
}

export const messagesCol = (ch: string) => collection(ydrDb, 'channels', ch, 'messages')

// 프론트 규칙: 게스트는 "들어온 때(from)부터"의 메시지만 읽을 수 있어 조건을 꼭 붙인다.
export function frontMessagesQuery(ch: string, from: number, n: number) {
  return from
    ? query(messagesCol(ch), where('createdAt', '>=', from), orderBy('createdAt', 'desc'), limit(n))
    : query(messagesCol(ch), orderBy('createdAt', 'desc'), limit(n))
}

export function toFrontMessage(id: string, d: Record<string, unknown>): FrontMessage {
  const ids = Array.isArray(d.imageAssetIds) && d.imageAssetIds.length ? (d.imageAssetIds as string[]) : d.imageAssetId ? [String(d.imageAssetId)] : []
  return {
    id,
    text: String(d.text ?? ''),
    authorId: (d.authorId as string) ?? null,
    createdAt: Number(d.createdAt ?? 0),
    replyTo: (d.replyTo as FrontMessage['replyTo']) ?? null,
    images: ids,
    sticker: (d.stickerAssetId as string) ?? null,
    file: (d.file as FrontMessage['file']) ?? null,
    link: (d.link as FrontMessage['link']) ?? null,
    deleted: d.deleted === true,
    edited: d.edited === true,
    system: d.system === true,
  }
}

// 방마다 내가 안 읽은 메시지 수 (프론트 앱과 같은 channels/{방}/reads/{내 아이디} {at: 밀리초})
export function useFrontUnread(viewing: string | null) {
  const { uid, rooms } = useFront()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const key = rooms.map((r) => `${r.id}:${r.from}`).join('|')
  useEffect(() => {
    if (!uid) return
    const stops = rooms
      .filter((r) => r.id !== viewing)
      .map((room) => {
        let stopMessages = () => {}
        const myRead = doc(ydrDb, 'channels', room.id, 'reads', uid)
        const stopRead = onSnapshot(
          myRead,
          (snap) => {
            stopMessages()
            const at = Number(snap.get('at') ?? 0)
            if (!at) {
              // 처음: 지금부터 센다.
              setDoc(myRead, { at: Date.now() }).catch(() => {})
              return
            }
            const start = Math.max(at + 1, room.from)
            stopMessages = onSnapshot(
              query(messagesCol(room.id), where('createdAt', '>=', start), orderBy('createdAt'), limit(100)),
              (msgs) => {
                const n = msgs.docs.filter((d) => d.get('authorId') !== uid && !d.get('system') && !d.get('deleted')).length
                setCounts((prev) => (prev[room.id] === n ? prev : { ...prev, [room.id]: n }))
              },
              () => {},
            )
          },
          () => {},
        )
        return () => {
          stopRead()
          stopMessages()
          setCounts((prev) => {
            if (!(room.id in prev)) return prev
            const next = { ...prev }
            delete next[room.id]
            return next
          })
        }
      })
    return () => stops.forEach((s) => s())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key, viewing])
  return counts
}

export function markFrontRead(ch: string, uid: string) {
  return setDoc(doc(ydrDb, 'channels', ch, 'reads', uid), { at: Date.now() })
}

// 이 방 사람들이 어디까지 읽었는지 (channels/{방}/reads/{아이디} = {at: ms}). 프론트 직원은 아이디, 게스트는 g_uid.
export function useFrontRoomReads(ch: string) {
  const [reads, setReads] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    setReads(new Map())
    return onSnapshot(
      query(collection(ydrDb, 'channels', ch, 'reads'), limit(500)),
      (snap) => setReads(new Map(snap.docs.map((d) => [d.id, Number(d.get('at')) || 0]))),
      () => {},
    )
  }, [ch])
  return reads
}

// 말풍선 옆 노란 숫자: 프론트 앱과 같은 기준으로, 보낸 사람을 뺀 프론트 직원 중 아직 안 읽은 사람 수
// (사용 중지된 직원, 가입 전이라 이 말을 못 보는 직원은 뺀다)
export function frontUnreadBy(accounts: Map<string, FrontAccount>, reads: Map<string, number>, authorId: string | null | undefined, at: number) {
  const author = String(authorId ?? '').replace(/^acc_/, '')
  let n = 0
  for (const a of accounts.values()) {
    if (!a.active || a.loginId === author) continue
    if (!a.admin && a.chatFrom > at) continue
    if ((reads.get(a.loginId) ?? 0) < at) n++
  }
  return n
}
