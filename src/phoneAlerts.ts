import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { normalizePhone } from './customers.ts'
import { db } from './firebase.ts'
import { hasPhoneNative, PhoneNative, type AlertCustomer, type AlertsStatus } from './phone.ts'

// 🔔 전화·문자 알림 (갤럭시 앱 1.4.0, 폰 쪽은 android/.../phone/PhoneAlerts.kt).
// 삼성 기본 앱 알림은 그대로 두고 우리 앱도 조용한 알림을 띄워, 누르면 우리 앱의 그 화면이 열린다.
//   ✉️ 문자 → 그 대화 · 📞 부재중 전화 → 최근기록 · 고객 전화가 울릴 때 → "[업무] 이름 · 회사 · 다음 연락" 띠 → 그 고객
// 웹앱은 내 모든 팀의 고객(번호 → 이름·회사·다음 연락)과 켜 둔 종류를 폰에 넣어 둔다. 앱이 꺼져 있어도 폰이 혼자 알린다.
export type AlertKinds = { sms: boolean; missed: boolean; caller: boolean }
const KINDS_KEY = 'phone-alerts'
const ASKED_KEY = 'phone-alerts-asked'
const CHANGED = 'phone-alerts-changed'

// 1.4.0 전 갤럭시 앱에는 이 기능이 없다 (부르면 "구현 안 됨"으로 실패)
let supported: boolean | null = null
export async function alertsSupported() {
  if (!hasPhoneNative) return false
  supported ??= await PhoneNative.alertsStatus()
    .then(() => true)
    .catch(() => false)
  return supported
}

export function alertKinds(): AlertKinds {
  try {
    return { sms: true, missed: true, caller: true, ...(JSON.parse(localStorage.getItem(KINDS_KEY) ?? '{}') as Partial<AlertKinds>) }
  } catch {
    return { sms: true, missed: true, caller: true }
  }
}
export function setAlertKinds(kinds: AlertKinds) {
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify(kinds))
  } catch {
    // 기억 못 하면 다음에 앱을 열 때 모두 켜짐
  }
  window.dispatchEvent(new Event(CHANGED))
}

export async function requestAlerts(): Promise<AlertsStatus | null> {
  if (!(await alertsSupported())) return null
  const status = await PhoneNative.requestAlerts().catch(() => null)
  window.dispatchEvent(new Event(CHANGED))
  return status
}

export function useAlertsStatus() {
  const [state, setState] = useState<{ supported: boolean; status: AlertsStatus | null; kinds: AlertKinds }>({
    supported: false,
    status: null,
    kinds: alertKinds(),
  })
  useEffect(() => {
    const refresh = async () => {
      const ok = await alertsSupported()
      const status = ok ? await PhoneNative.alertsStatus().catch(() => null) : null
      setState({ supported: ok, status, kinds: alertKinds() })
    }
    void refresh()
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(CHANGED, refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(CHANGED, refresh)
    }
  }, [])
  return state
}

const shortDate = (t: Timestamp | null | undefined) => {
  if (!t) return ''
  const d = t.toDate()
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// App에서 늘 돈다: 고객 정보·켜 둔 종류를 폰에 맞추고, 처음 한 번은 알림 권한을 묻는다.
export function useAlertsSync(teamIds: string[]) {
  const key = teamIds.join(',')
  const [customers, setCustomers] = useState<Record<string, AlertCustomer> | null>(null)
  const [kinds, setKinds] = useState(alertKinds)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    void alertsSupported().then(setOk)
    const onChange = () => setKinds(alertKinds())
    window.addEventListener(CHANGED, onChange)
    return () => window.removeEventListener(CHANGED, onChange)
  }, [])

  // 처음 한 번: 알림·문자 받기·전화 상태 권한 묻기 (거절하면 설정 화면 🔔 카드에서 다시)
  useEffect(() => {
    if (!ok) return
    try {
      if (localStorage.getItem(ASKED_KEY)) return
      localStorage.setItem(ASKED_KEY, '1')
    } catch {
      return
    }
    const t = setTimeout(() => void requestAlerts(), 1500)
    return () => clearTimeout(t)
  }, [ok])

  // 내 모든 팀의 고객 (휴무일 자동 응답·연락처 표시와 같은 조회라 함께 켜 두면 한 번만 읽는다)
  useEffect(() => {
    if (!ok || !key) return
    const ids = key.split(',')
    const byChunk = new Map<number, Record<string, AlertCustomer>>()
    const subs: (() => void)[] = []
    for (let i = 0; i < ids.length; i += 30) {
      subs.push(
        onSnapshot(query(collection(db, 'customers'), where('teamId', 'in', ids.slice(i, i + 30))), (snap) => {
          const map: Record<string, AlertCustomer> = {}
          for (const d of snap.docs) {
            const c = d.data()
            const next = [shortDate(c.nextContactAt as Timestamp | null), (c.nextContactNote as string | undefined) ?? ''].filter(Boolean).join(' ')
            const info: AlertCustomer = { n: (c.name as string) || (c.company as string) || '고객', c: (c.company as string) || '', x: next }
            for (const p of (c.phones as string[] | undefined) ?? []) map[localNumber(p)] = info
          }
          byChunk.set(i, map)
          setCustomers(Object.assign({}, ...byChunk.values()) as Record<string, AlertCustomer>)
        }),
      )
    }
    return () => subs.forEach((u) => u())
  }, [ok, key])

  useEffect(() => {
    if (!ok || customers === null) return
    const t = setTimeout(() => void PhoneNative.alertsConfig({ customers, ...kinds }).catch(() => {}), 800)
    return () => clearTimeout(t)
  }, [ok, customers, kinds])
}

// +821012345678 → 01012345678 (폰 쪽 OffDay.local과 같은 모양)
function localNumber(p: string) {
  const d = normalizePhone(p).replace(/\D/g, '')
  return d.startsWith('82') && d.length >= 10 ? `0${d.slice(2)}` : d
}

// 알림을 누르고 들어와 그 화면을 보면 알림을 지운다
export function clearSmsAlert(number: string) {
  if (hasPhoneNative) void PhoneNative.clearAlerts({ kind: 'sms', number }).catch(() => {})
}
