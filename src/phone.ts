import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { normalizePhone, toCustomer, type Customer } from './customers.ts'
import { db, keepSignedIn } from './firebase.ts'
import { isAndroidApp } from './native.ts'

// 📞 전화 · ✉️ 문자 (삼성 전화·메시지 앱과 비슷하게).
// - 갤럭시 앱(1.3.0부터): Kotlin Phone 플러그인으로 이 폰의 통화 기록·문자를 읽고, 바로 전화 걸고, 문자를 보낸다.
//   통화 기록과 문자는 폰 안에서 읽기만 하고 서버에는 올리지 않는다 (CLAUDE.md 데이터 저장 규칙).
//   전화가 오고 가는 통화 화면, 받은 문자 알림은 삼성 기본 앱 그대로 (기본 앱을 바꾸지 않음).
// - 아이폰·브라우저: 통화 기록·문자를 읽을 수 없어서, 앱에서 건 전화만 이 기기에 기록하고(tel:) 문자는 기본 문자 앱을 연다(sms:).
// - 업무/개인은 번호로 나눈다: 지금 팀 고객 번호면 업무, 아니면 개인.

export type CallEntry = {
  id: string
  number: string
  name: string // 폰 연락처 이름 (통화 기록에 저장된 것)
  type: number // 1 받은 전화, 2 건 전화, 3 부재중, 5 거절, 6 차단
  date: number
  duration: number // 초
  approx?: boolean // 아이폰·PC: 실제 통화 시간을 알 수 없어, 앱에서 걸고 돌아오기까지 걸린 시간(어림값)
}
export type SmsThread = { threadId: string; address: string; text: string; date: number; mine: boolean; unread: number }
export type SmsMessage = { id: string; text: string; date: number; mine: boolean; failed?: boolean; sending?: boolean; images?: number }
export type DeviceContact = { name: string; number: string; company?: string }
type Perms = { calls: boolean; sms: boolean; contacts: boolean; phonestate?: boolean }
export type OffDayLog = { at: number; number: string; silenced: boolean; sent: boolean }

type PhonePlugin = {
  status(): Promise<Perms>
  requestCalls(): Promise<{ granted: boolean }>
  requestSms(): Promise<{ granted: boolean }>
  requestContacts(): Promise<{ granted: boolean }>
  requestPhoneState(): Promise<{ granted: boolean }>
  offDayConfig(o: { enabled: boolean; dates: string[]; numbers: string[]; message: string }): Promise<void>
  offDayStatus(): Promise<{ phonestate: boolean; sms: boolean; silence: boolean; offToday: boolean; log: OffDayLog[] }>
  openDndSettings(): Promise<void>
  openSettings(): Promise<void>
  callLog(o: { limit?: number; since?: number }): Promise<{ calls: CallEntry[] }>
  dial(o: { number: string }): Promise<{ direct: boolean }>
  threads(o: { limit?: number }): Promise<{ threads: SmsThread[] }>
  messages(o: { threadId: string; limit?: number; before?: number }): Promise<{ messages: SmsMessage[] }>
  threadFor(o: { number: string }): Promise<{ threadId: string }>
  sendSms(o: { number: string; text: string }): Promise<{ parts: number }>
  contacts(): Promise<{ contacts: DeviceContact[] }>
  addListener(event: 'changed', fn: (e: { what: 'calls' | 'sms' }) => void): Promise<PluginListenerHandle>
  // 🔔 전화·문자 알림 (갤럭시 앱 1.4.0, android/.../phone/PhoneAlerts.kt)
  alertsConfig(o: { customers: Record<string, AlertCustomer>; sms: boolean; missed: boolean; caller: boolean }): Promise<void>
  alertsStatus(): Promise<AlertsStatus>
  requestAlerts(): Promise<AlertsStatus>
  clearAlerts(o: { kind: 'sms' | 'missed'; number?: string }): Promise<void>
  alertsOff(): Promise<void>
}
export type AlertCustomer = { n: string; c?: string; o?: string; x?: string }
export type AlertsStatus = { notify: boolean; sms: boolean; phonestate: boolean }

export const PhoneNative = registerPlugin<PhonePlugin>('Phone')
// 갤럭시 앱이지만 1.3.0 전 버전이면 플러그인이 없다 → 업데이트 안내, 그동안은 아이폰과 같은 방식
export const hasPhoneNative = isAndroidApp && Capacitor.isPluginAvailable('Phone')
export const oldAndroidApp = isAndroidApp && !hasPhoneNative

// ── 권한 ──
const PERMS_CHANGED = 'phone-perms-changed'
let perms: Perms = { calls: false, sms: false, contacts: false }
let permsLoaded = false

export function usePhonePerms() {
  const [state, setState] = useState<Perms & { loaded: boolean }>({ ...perms, loaded: permsLoaded || !hasPhoneNative })
  useEffect(() => {
    if (!hasPhoneNative) return
    const refresh = async () => {
      perms = await PhoneNative.status().catch(() => perms)
      permsLoaded = true
      setState({ ...perms, loaded: true })
    }
    void refresh()
    // 설정 화면에서 권한을 켜고 돌아오면 다시 확인
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(PERMS_CHANGED, refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(PERMS_CHANGED, refresh)
    }
  }, [])
  return state
}

// 권한 묻기. 막혀 있으면 false (→ 화면에서 "설정에서 허용" 안내)
export async function askPermission(kind: 'calls' | 'sms' | 'contacts' | 'phonestate') {
  const fn =
    kind === 'calls'
      ? PhoneNative.requestCalls
      : kind === 'sms'
        ? PhoneNative.requestSms
        : kind === 'phonestate'
          ? PhoneNative.requestPhoneState
          : PhoneNative.requestContacts
  const { granted } = await fn.call(PhoneNative).catch(() => ({ granted: false }))
  window.dispatchEvent(new Event(PERMS_CHANGED))
  return granted
}

// 통화 기록·문자가 바뀌면 (전화가 끝남, 문자가 옴) 다시 읽는다.
export function usePhoneChanged(what: 'calls' | 'sms', fn: () => void) {
  useEffect(() => {
    if (!hasPhoneNative) return
    let handle: PluginListenerHandle | undefined
    let alive = true
    void PhoneNative.addListener('changed', (e) => e.what === what && fn()).then((h) => {
      if (alive) handle = h
      else void h.remove()
    })
    const onVisible = () => document.visibilityState === 'visible' && fn()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      void handle?.remove()
      document.removeEventListener('visibilitychange', onVisible)
    }
    // fn은 매번 새로 만들어져도 처음 것을 쓰면 오래된 값을 볼 수 있어 ref 대신 what만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what])
}

// ── 고객 번호로 업무/개인 나누기 ──
// 번호 비교는 숫자만 남겨 국내 형식(+82…)으로 맞춘다.
export const phoneKey = (n: string) => normalizePhone(n)

// ── 번호 → 이름 빨리 바꾸기 (2026-10-30, "이름으로 바뀌는 게 느려요") ──
// 1) 지금 팀 고객은 한 곳(store)에서만 실시간으로 보고 여러 화면이 나눠 쓴다. 휴대폰은 앱을 열 때부터 지켜보므로(App의
//    prefetchPhoneNames) 📞·✉️ 화면을 열면 이미 이름이 있다. 화면을 다 닫아도 10분은 계속 지켜본다(다시 열 때 바로).
// 2) 로그인 유지를 켠 기기는 "번호 → 고객 이름" 이름표를 기기에 기억해 두고(localStorage, 로그아웃하면 지움) 앱을 열자마자
//    서버 응답을 기다리지 않고 그것부터 쓴다.
type CustomerStore = { customers: Customer[] | null; users: number; unsub: (() => void) | null; timer?: ReturnType<typeof setTimeout> }
const customerStores = new Map<string, CustomerStore>()
const CUSTOMERS_EVENT = 'team-customers'
const NAMES_KEY = 'customer-names:'
type NameRow = [id: string, name: string, company: string, phones: string[]]

function savedNames(teamId: string): Customer[] | null {
  if (!keepSignedIn()) return null
  try {
    const rows = JSON.parse(localStorage.getItem(NAMES_KEY + teamId) ?? 'null') as NameRow[] | null
    return rows?.map(([id, name, company, phones]) => toCustomer(id, { teamId, name, company, phones })) ?? null
  } catch {
    return null
  }
}
function saveNames(teamId: string, customers: Customer[]) {
  if (!keepSignedIn()) return
  try {
    const rows: NameRow[] = customers.map((c) => [c.id, c.name, c.company, c.phones])
    localStorage.setItem(NAMES_KEY + teamId, JSON.stringify(rows))
  } catch {
    // 기억 못 하면 서버 응답을 기다릴 뿐
  }
}

function customerStore(teamId: string) {
  let st = customerStores.get(teamId)
  if (!st) {
    st = { customers: savedNames(teamId), users: 0, unsub: null }
    customerStores.set(teamId, st)
  }
  return st
}
function holdCustomers(teamId: string) {
  const st = customerStore(teamId)
  st.users += 1
  clearTimeout(st.timer)
  st.unsub ??= onSnapshot(
    query(collection(db, 'customers'), where('teamId', '==', teamId)),
    (snap) => {
      st.customers = snap.docs.map((d) => toCustomer(d.id, d.data()))
      if (!snap.metadata.fromCache) saveNames(teamId, st.customers)
      window.dispatchEvent(new CustomEvent(CUSTOMERS_EVENT, { detail: teamId }))
    },
    () => {},
  )
  return () => {
    st.users -= 1
    if (st.users > 0) return
    st.timer = setTimeout(() => {
      st.unsub?.()
      st.unsub = null
    }, 10 * 60_000)
  }
}

// 휴대폰: 앱을 열면 지금 팀 고객·폰 연락처 이름을 미리 읽어 둔다 (App에서 부름)
export function usePrefetchPhoneNames(teamId: string | null, enabled: boolean) {
  useEffect(() => (enabled && teamId ? holdCustomers(teamId) : undefined), [teamId, enabled])
  const perms = usePhonePerms()
  useEffect(() => {
    if (enabled && perms.contacts) void loadDeviceContacts()
  }, [enabled, perms.contacts])
}

export function useTeamCustomers(teamId: string) {
  const [customers, setCustomers] = useState<Customer[] | null>(() => customerStore(teamId).customers)
  useEffect(() => {
    const update = (e?: Event) => {
      if (!e || (e as CustomEvent).detail === teamId) setCustomers(customerStore(teamId).customers)
    }
    update()
    window.addEventListener(CUSTOMERS_EVENT, update)
    const release = holdCustomers(teamId)
    return () => {
      window.removeEventListener(CUSTOMERS_EVENT, update)
      release()
    }
  }, [teamId])
  const byPhone = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const c of customers ?? []) for (const p of c.phones) map.set(p, c)
    return map
  }, [customers])
  // 같은 번호를 여러 줄에서 찾으니 번호 → 결과를 기억한다
  const find = useMemo(() => {
    const memo = new Map<string, Customer | undefined>()
    return (n: string) => {
      if (!memo.has(n)) memo.set(n, byPhone.get(phoneKey(n)))
      return memo.get(n)
    }
  }, [byPhone])
  return { customers, byPhone, find }
}

// 폰 연락처(개인) 이름: 갤럭시 앱에서만, 한 번 읽어 메모리에만 둔다 (앱을 열 때 미리 읽음).
let contactsCache: DeviceContact[] | null = null
let contactsLoading: Promise<void> | null = null
const CONTACTS_EVENT = 'device-contacts'
function loadDeviceContacts() {
  if (!hasPhoneNative || contactsCache) return Promise.resolve()
  contactsLoading ??= PhoneNative.contacts()
    .then(({ contacts }) => {
      contactsCache = contacts
      window.dispatchEvent(new Event(CONTACTS_EVENT))
    })
    .catch(() => {})
    .finally(() => (contactsLoading = null))
  return contactsLoading
}
export function useDeviceContacts(enabled: boolean) {
  const [list, setList] = useState<DeviceContact[]>(contactsCache ?? [])
  useEffect(() => {
    if (!hasPhoneNative || !enabled) return
    const update = () => contactsCache && setList(contactsCache)
    update()
    window.addEventListener(CONTACTS_EVENT, update)
    void loadDeviceContacts()
    return () => window.removeEventListener(CONTACTS_EVENT, update)
  }, [enabled])
  const byPhone = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of list) map.set(phoneKey(c.number), c.name)
    return map
  }, [list])
  const nameOf = useMemo(() => {
    const memo = new Map<string, string | undefined>()
    return (n: string) => {
      if (!memo.has(n)) memo.set(n, byPhone.get(phoneKey(n)))
      return memo.get(n)
    }
  }, [byPhone])
  return { contacts: list, nameOf }
}

// ── 전화 걸기 ──
// 아이폰·브라우저는 앱에서 건 전화를 이 기기에만 기록한다 (최근 기록 화면용, 서버에 안 올림).
const APP_CALLS_KEY = 'phone-app-calls'
// 앱 전화 기록이 바뀌면 (통화 시간 어림값을 적었을 때) 최근기록 화면이 다시 읽는다
export const APP_CALLS_EVENT = 'app-calls-changed'
const PENDING_KEY = 'phone-call-pending'
export type PendingCall = { number: string; customerId?: string; at: number; id?: string; approxSec?: number }

export function appCalls(): CallEntry[] {
  try {
    return JSON.parse(localStorage.getItem(APP_CALLS_KEY) ?? '[]') as CallEntry[]
  } catch {
    return []
  }
}

// 마우스로 쓰는 컴퓨터 (아이폰·패드 제외): 전화 회선이 없다
export const isPcDevice = () =>
  !Capacitor.isNativePlatform() &&
  matchMedia('(hover: hover) and (pointer: fine)').matches &&
  !/iPhone|iPad|iPod|Android/.test(navigator.userAgent)

// 💻 이 PC를 휴대폰과 연결했는지 (윈도우 "휴대폰과 연결", 맥 "iPhone에서 통화"). 켜 두면 PC에서도 📞가 바로 걸린다.
const PC_LINK_KEY = 'pc-phone-linked'
export const PC_LINK_CHANGED = 'pc-phone-linked-changed'
export function pcPhoneLinked() {
  try {
    return localStorage.getItem(PC_LINK_KEY) === '1'
  } catch {
    return false
  }
}
export function setPcPhoneLinked(on: boolean) {
  try {
    if (on) localStorage.setItem(PC_LINK_KEY, '1')
    else localStorage.removeItem(PC_LINK_KEY)
  } catch {
    // 기억 못 하면 매번 안내 창
  }
  window.dispatchEvent(new Event(PC_LINK_CHANGED))
}

export async function startCall(number: string, customerId?: string, name?: string) {
  if (isPcDevice() && !pcPhoneLinked()) {
    // PC: "휴대폰으로 걸어주세요" 안내 (src/pcGuide.tsx)
    const { showCallGuide } = await import('./pcGuide.tsx')
    showCallGuide(number, name, customerId)
    return
  }
  if (hasPhoneNative) {
    // 갤럭시 앱은 통화가 끝난 뒤 통화 기록을 보고 메모 창을 띄운다 (CallMemoWatcher).
    await PhoneNative.dial({ number })
    return
  }
  dialByLink(number, customerId)
}

// 아이폰·브라우저: "방금 받은 전화 메모하기"로 고른 받은 전화도 이 기기 최근기록에 남긴다 (갤럭시 앱은 폰 통화 기록이 있음)
export function recordReceivedCall(number: string) {
  if (hasPhoneNative || isPcDevice() || !number) return
  try {
    const list = [{ id: String(Date.now()), number, name: '', type: 1, date: Date.now(), duration: 0 }, ...appCalls()].slice(0, 200)
    localStorage.setItem(APP_CALLS_KEY, JSON.stringify(list))
    window.dispatchEvent(new Event(APP_CALLS_EVENT))
  } catch {
    // 기억 못 하면 최근기록에만 안 보인다
  }
}

// tel: 로 걸기 (아이폰·브라우저, 휴대폰과 연결한 PC). 돌아오면 통화 메모 창이 뜨게 기억해 둔다.
export function dialByLink(number: string, customerId?: string) {
  try {
    const id = String(Date.now())
    const list = [{ id, number, name: '', type: 2, date: Date.now(), duration: 0 }, ...appCalls()].slice(0, 200)
    localStorage.setItem(APP_CALLS_KEY, JSON.stringify(list))
    // 돌아오면 메모 창 (화면 6), 앱 밖에 있던 시간을 통화 시간 어림값으로
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ number, customerId, at: Date.now(), id } satisfies PendingCall))
  } catch {
    // 기억하지 못하면 메모 창만 안 뜬다.
  }
  location.href = `tel:${number}`
}

export function takePendingCall(): PendingCall | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingCall
    // 전화 앱으로 넘어갔다 돌아온 경우만 (바로 돌아오면 아직 통화 전일 수 있어 기다린다)
    if (Date.now() - p.at < 3000) return null
    sessionStorage.removeItem(PENDING_KEY)
    if (Date.now() - p.at >= 3 * 3600 * 1000) return null
    // 통화 시간 어림값 = 앱에서 건 뒤 돌아오기까지 (신호 가는 시간·통화 뒤 다른 일을 한 시간도 들어감)
    const approxSec = Math.round((Date.now() - p.at) / 1000)
    if (p.id) {
      const list = appCalls().map((c) => (c.id === p.id ? { ...c, duration: approxSec, approx: true } : c))
      localStorage.setItem(APP_CALLS_KEY, JSON.stringify(list))
      window.dispatchEvent(new Event(APP_CALLS_EVENT))
    }
    return { ...p, approxSec }
  } catch {
    return null
  }
}

// ── 문자 보내기 (아이폰·브라우저·예전 갤럭시 앱은 기본 문자 앱을 연다) ──
export function smsLink(number: string, body = '') {
  const sep = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? '&' : '?'
  return `sms:${number}${body ? `${sep}body=${encodeURIComponent(body)}` : ''}`
}

// 문자 대화를 이 앱에서 마지막으로 본 시각 (기본 문자 앱의 "읽음"은 바꿀 수 없어서 따로 기억)
const SEEN_KEY = 'sms-seen'
export function smsSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
export function markSmsSeen(threadId: string) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...smsSeen(), [threadId]: Date.now() }))
  } catch {
    // 기억하지 못하면 안 읽은 수가 남을 뿐
  }
  emitPhoneData()
}

// ── 통화 기록·문자 목록 미리 읽어 두기 (2026-10-30, "불러오기가 느려요") ──
// 한 번 읽은 목록은 메모리에 두고 화면을 다시 열면 바로 보여 준 뒤 뒤에서 새로 읽는다.
// 앱을 열면(App의 usePhoneBadges) 바로 읽기 시작하므로 📞·✉️ 화면을 처음 열 때도 대개 이미 읽혀 있다.
// (메모리에만 두고 기기에 저장하지 않는다 — 앱을 닫으면 사라짐)
const DATA_EVENT = 'phone-data'
let callsCache: CallEntry[] | null = null
let threadsCache: SmsThread[] | null = null
let callsLoading: Promise<void> | null = null
let threadsLoading: Promise<void> | null = null
function emitPhoneData() {
  window.dispatchEvent(new Event(DATA_EVENT))
}
export function loadCalls(): Promise<void> {
  if (!hasPhoneNative) return Promise.resolve()
  callsLoading ??= PhoneNative.callLog({ limit: 400 })
    .then(({ calls }) => {
      callsCache = calls
      emitPhoneData()
    })
    .finally(() => (callsLoading = null))
  return callsLoading
}
export function loadThreads(): Promise<void> {
  if (!hasPhoneNative) return Promise.resolve()
  threadsLoading ??= PhoneNative.threads({ limit: 300 })
    .then(({ threads }) => {
      threadsCache = threads
      emitPhoneData()
    })
    .finally(() => (threadsLoading = null))
  return threadsLoading
}
function usePhoneData<T>(get: () => T) {
  const [value, setValue] = useState(get)
  useEffect(() => {
    const update = () => setValue(get)
    update()
    window.addEventListener(DATA_EVENT, update)
    return () => window.removeEventListener(DATA_EVENT, update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}
// 화면용: 미리 읽은 목록을 바로 쓰고, 열 때·바뀔 때 새로 읽는다 (실패는 onError)
export function useCallLog(enabled: boolean, onError: (e: unknown) => void) {
  const calls = usePhoneData(() => callsCache)
  const load = () => void (enabled ? loadCalls().catch(onError) : undefined)
  useEffect(load, [enabled])
  usePhoneChanged('calls', load)
  return calls
}
export function useSmsThreads(enabled: boolean, onError: (e: unknown) => void) {
  const threads = usePhoneData(() => threadsCache)
  const load = () => void (enabled ? loadThreads().catch(onError) : undefined)
  useEffect(load, [enabled])
  usePhoneChanged('sms', load)
  return threads
}

// ── 📛 아래 탭 빨간 숫자: 📞 부재중(최근기록을 마지막으로 본 뒤), ✉️ 안 읽은 문자 대화 ──
const MISSED_SEEN = 'missed-seen'
export function markMissedSeen() {
  try {
    localStorage.setItem(MISSED_SEEN, String(Date.now()))
  } catch {
    // 기억 못 하면 숫자가 남을 뿐
  }
  if (hasPhoneNative) void PhoneNative.clearAlerts({ kind: 'missed' }).catch(() => {})
  emitPhoneData()
}
function missedSeenAt() {
  try {
    // 처음엔 지금부터 센다 (예전 부재중이 모두 숫자로 뜨지 않게)
    const v = localStorage.getItem(MISSED_SEEN)
    if (v) return Number(v)
    localStorage.setItem(MISSED_SEEN, String(Date.now()))
  } catch {
    // 아래 지금 시각
  }
  return Date.now()
}
export function unreadThread(t: SmsThread, seen: Record<string, number>) {
  return t.unread > 0 && !t.mine && t.date > (seen[t.threadId] ?? 0)
}
export function usePhoneBadges(enabled: boolean) {
  const perms = usePhonePerms()
  const on = enabled && hasPhoneNative
  const calls = useCallLog(on && perms.calls, () => {})
  const threads = useSmsThreads(on && perms.sms, () => {})
  // 본 시각이 바뀌어도(최근기록을 봄, 대화를 엶) 다시 센다
  const tick = usePhoneData(() => Date.now())
  return useMemo(() => {
    const since = missedSeenAt()
    const seen = smsSeen()
    return {
      missed: on && calls ? calls.filter((c) => c.type === 3 && c.date > since).length : 0,
      sms: on && threads ? threads.filter((t) => unreadThread(t, seen)).length : 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, calls, threads, tick])
}

// 로그아웃하면 이 기기의 전화·문자 기록(앱에서 건 전화, 본 시각)을 지운다.
export function wipePhoneData() {
  // 🌙 휴무일 자동 응답도 끈다 (다음 사람 폰에서 내 문구가 나가지 않게)
  if (hasPhoneNative) void PhoneNative.offDayConfig({ enabled: false, dates: [], numbers: [], message: '' }).catch(() => {})
  // 🔔 전화·문자 알림: 폰에 넣어 둔 고객 정보와 뜬 알림을 지운다 (1.4.0 전 앱은 이 기능이 없음)
  if (hasPhoneNative) void PhoneNative.alertsOff().catch(() => {})
  callsCache = null
  threadsCache = null
  contactsCache = null
  customerStores.forEach((st) => st.unsub?.())
  customerStores.clear()
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(NAMES_KEY)) localStorage.removeItem(k)
  } catch {
    // 지우지 못하는 환경
  }
  for (const k of [APP_CALLS_KEY, SEEN_KEY, CALL_MEMO_CHECKED, MISSED_SEEN, 'private-phone-notes']) {
    try {
      localStorage.removeItem(k)
    } catch {
      // 지우지 못하는 환경
    }
  }
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // 지우지 못하는 환경
  }
}

// 갤럭시 앱 통화 후 메모 창: 여기까지 확인한 통화 시각
export const CALL_MEMO_CHECKED = 'call-memo-checked'

// ── 보여 주기 ──
export function callTypeLabel(type: number) {
  if (type === 1) return { icon: '↙', label: '받은 전화', kind: 'in' }
  if (type === 2) return { icon: '↗', label: '건 전화', kind: 'out' }
  if (type === 3) return { icon: '↙', label: '부재중 전화', kind: 'missed' }
  if (type === 5) return { icon: '⊘', label: '거절한 전화', kind: 'missed' }
  if (type === 6) return { icon: '⊘', label: '차단한 전화', kind: 'missed' }
  return { icon: '•', label: '통화', kind: 'out' }
}

// 어림값은 분 단위로만: "약 4분", 1분이 안 되면 "약 1분 미만"
export function approxDurationText(sec: number) {
  if (sec <= 0) return ''
  if (sec < 60) return '약 1분 미만'
  const m = Math.round(sec / 60)
  return m >= 60 ? `약 ${Math.floor(m / 60)}시간 ${m % 60}분` : `약 ${m}분`
}

export function durationText(sec: number) {
  if (sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`
  return m > 0 ? `${m}분 ${s}초` : `${s}초`
}

export function dayLabel(ms: number) {
  const d = new Date(ms)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86400000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '어제'
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

export const timeText = (ms: number) => new Date(ms).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })

// 목록에 쓰는 짧은 시각: 오늘이면 시각, 어제, 그 전은 날짜
export function shortWhen(ms: number) {
  const label = dayLabel(ms)
  if (label === '오늘') return timeText(ms)
  if (label === '어제') return '어제'
  const d = new Date(ms)
  return `${d.getMonth() + 1}. ${d.getDate()}.`
}

// 번호 보기 좋게: 01012345678 → 010-1234-5678 (입력 중인 키패드 번호도)
export function prettyNumber(n: string) {
  const digits = n.replace(/[^\d+*#]/g, '')
  if (digits.startsWith('+82')) return prettyNumber(`0${digits.slice(3)}`)
  if (/^02/.test(digits)) {
    if (digits.length <= 2) return digits
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`
  }
  if (/^0\d/.test(digits)) {
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
  }
  if (/^1\d{3}/.test(digits) && digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return digits
}
