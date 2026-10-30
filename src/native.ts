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
// 갤럭시 앱에서만 다르게 할 화면 모양(아래 탭 여백 등)을 위해
if (isAndroidApp) document.documentElement.classList.add('android-app')

// 갤럭시 앱 아래 탭 밑 여백 (2026-10-30, 사용자 요청 "APK에서 탭 아래가 비어 보임"):
// Capacitor가 넣는 --safe-area-inset-bottom은 안드로이드 아래 줄(제스처 막대 또는 ◁ ○ ▢ 버튼) 높이다.
// 제스처 막대(얇음, 32px 미만)면 그 칸은 비어 보이기만 해서 여백을 0으로 → 탭이 화면 맨 아래에 붙는다.
// ◁ ○ ▢ 버튼 줄이면 버튼이 탭을 가리지 않게 그 높이만큼 비운다(그 칸에는 버튼이 보여 비어 보이지 않음).
if (isAndroidApp) {
  const root = document.documentElement
  const apply = () => {
    const inset = parseFloat(root.style.getPropertyValue('--safe-area-inset-bottom')) || 0
    const pad = inset < 32 ? '0px' : `${inset}px`
    if (root.style.getPropertyValue('--tabs-bottom-pad') !== pad) root.style.setProperty('--tabs-bottom-pad', pad)
  }
  apply()
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['style'] })
}
export const isAndroidBrowser = !isAndroidApp && /Android/i.test(navigator.userAgent)
export const NativeContacts = registerPlugin<ContactsSyncPlugin>('ContactsSync')

// 갤럭시 앱 설치 파일 주소. Firebase Hosting은 APK 파일을 올리지 못해(배포 실패) GitHub 저장소에서 받는다.
export const APK_URL = 'https://github.com/NYANGSoobeen/ysdwcc-s/raw/main/release/yangsan-support.apk'
// 저장소에 올린 최신 갤럭시 앱 (release/yangsan-support.apk). APK를 새로 만들면 android/app/build.gradle과 같이 올린다.
export const LATEST_APK = { code: 7, name: '1.3.2' }

// 이 폰에 깔린 갤럭시 앱 버전. 1.3.1부터는 Phone.appInfo로 정확히, 그 전 앱은 들어 있는 기능으로 짐작한다
// (Phone 플러그인 = 1.3.0, FileSaver = 1.2.x, 그 밖 = 1.1 이하).
export async function installedApkCode(): Promise<number> {
  if (!isAndroidApp) return 0
  try {
    const Phone = registerPlugin<{ appInfo(): Promise<{ versionCode: number }> }>('Phone')
    if (Capacitor.isPluginAvailable('Phone')) {
      const info = await Phone.appInfo().catch(() => null)
      return info?.versionCode ?? 5
    }
  } catch {
    // 아래 짐작으로
  }
  return Capacitor.isPluginAvailable('FileSaver') ? 4 : 3
}

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
