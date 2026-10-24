import { Capacitor, registerPlugin } from '@capacitor/core'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase.ts'

// 갤럭시용 설치형 앱(android/)에서만 쓰는 기능. 웹 브라우저나 아이폰에서는 isAndroidApp이 false다.
type ContactsSyncPlugin = {
  status(): Promise<{ available: boolean; permission: boolean; count: number }>
  requestPermission(): Promise<{ permission: boolean }>
  sync(options: { contacts: NativeContact[] }): Promise<{ added: number; updated: number; removed: number; count: number }>
  clear(): Promise<void>
}

type NativeContact = { id: string; name: string; company: string; phones: string[] }

export const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export const isAndroidBrowser = !isAndroidApp && /Android/i.test(navigator.userAgent)
export const NativeContacts = registerPlugin<ContactsSyncPlugin>('ContactsSync')

// 갤럭시 앱 설치 파일 주소 (Firebase Hosting)
export const APK_URL = '/download/yangsan-support.apk'

const ENABLED_KEY = 'native-contacts-enabled'
const CHANGED = 'native-contacts-changed'

export function nativeContactsEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true'
  } catch {
    return false
  }
}

export function setNativeContactsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled))
  } catch {
    // 기억하지 못하면 다음에 앱을 열 때 다시 켜야 한다.
  }
  window.dispatchEvent(new Event(CHANGED))
}

export type NativeSyncState = { at: Date; count: number } | { error: string } | null
let lastSync: NativeSyncState = null

export function useNativeSyncState() {
  const [state, setState] = useState<{ enabled: boolean; last: NativeSyncState }>({
    enabled: nativeContactsEnabled(),
    last: lastSync,
  })
  useEffect(() => {
    const update = () => setState({ enabled: nativeContactsEnabled(), last: lastSync })
    window.addEventListener(CHANGED, update)
    return () => window.removeEventListener(CHANGED, update)
  }, [])
  return state
}

// 켜져 있으면 내가 속한 모든 팀의 고객을 실시간으로 지켜보다가, 바뀌면 폰 연락처의 "지원팀" 계정을 맞춘다.
export function useNativeContactsSync(teamIds: string[]) {
  const { enabled } = useNativeSyncState()
  const key = teamIds.join(',')

  useEffect(() => {
    if (!isAndroidApp || !enabled || !key) return
    const ids = key.split(',')
    const byTeam = new Map<string, NativeContact[]>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const push = () => {
      clearTimeout(timer)
      // 여러 고객이 한꺼번에 바뀌어도 한 번만 맞추도록 잠깐 기다린다.
      timer = setTimeout(async () => {
        const contacts = [...byTeam.values()].flat()
        try {
          const result = await NativeContacts.sync({ contacts })
          lastSync = { at: new Date(), count: result.count }
        } catch (err) {
          lastSync = { error: (err as Error).message }
        }
        window.dispatchEvent(new Event(CHANGED))
      }, 1500)
    }

    const unsubscribes: (() => void)[] = []
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30)
      unsubscribes.push(
        onSnapshot(query(collection(db, 'customers'), where('teamId', 'in', chunk)), (snap) => {
          for (const t of chunk) byTeam.set(t, [])
          for (const d of snap.docs) {
            const c = d.data()
            byTeam.get(c.teamId)?.push({
              id: d.id,
              name: c.name ?? '',
              company: c.company ?? '',
              phones: c.phones ?? [],
            })
          }
          push()
        }),
      )
    }
    return () => {
      clearTimeout(timer)
      unsubscribes.forEach((u) => u())
    }
  }, [enabled, key])
}

// 로그아웃, 팀 제외, 끄기: 폰의 "지원팀" 연락처 계정을 통째로 지운다.
export async function clearNativeContacts() {
  if (!isAndroidApp) return
  await NativeContacts.clear().catch(() => {})
  setNativeContactsEnabled(false)
}
