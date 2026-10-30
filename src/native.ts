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

// 갤럭시 앱 위·아래 여백 (2026-10-30, 사용자 요청 "APK에서 탭 아래가 비어 보임"):
// Capacitor는 --safe-area-inset-top/bottom에 상태 표시줄·안드로이드 아래 줄 높이를 늘 넣는데,
// 안드로이드 14 이하 갤럭시(화면이 상태 표시줄과 ◁ ○ ▢ 줄 "사이"에만 그려짐)에서는 안드로이드가 이미 비켜 줬으므로
// 그 값만큼 또 비우면 머리줄 위와 아래 탭 밑이 빈 칸이 된다(실제 화면으로 확인). 그래서 웹뷰가 실제로 막대 밑까지
// 그려지는지(웹뷰 높이 ≈ 화면 전체 높이) 보고, 아니면 두 값을 0으로 되돌린다.
// 막대 밑까지 그려지는 폰(안드로이드 15+)은: 아래 탭 밑 여백 = 제스처 막대(32px 미만)면 0, ◁ ○ ▢ 버튼 줄이면 그 높이.
if (isAndroidApp) {
  const root = document.documentElement
  const raw = { top: 0, bottom: 0 }
  let tallest = 0
  let screenH = 0
  let zeroed = false
  const read = (name: string) => parseFloat(root.style.getPropertyValue(name)) || 0
  const set = (name: string, v: string) => {
    if (root.style.getPropertyValue(name) !== v) root.style.setProperty(name, v)
  }
  const apply = () => {
    // Capacitor가 새로 넣은 값은 기억해 둔다 (우리가 0으로 되돌린 값은 빼고)
    for (const side of ['top', 'bottom'] as const) {
      const v = root.style.getPropertyValue(`--safe-area-inset-${side}`)
      if (v && v.trim() !== '0px') raw[side] = read(`--safe-area-inset-${side}`)
    }
    if (screen.height !== screenH) {
      screenH = screen.height // 화면을 돌리면 새로 잰다
      tallest = 0
    }
    // 키보드가 열리면 높이가 줄어서, 지금까지 본 가장 큰 높이로 판단한다
    tallest = Math.max(tallest, window.innerHeight)
    const margin = Math.max(raw.top, raw.bottom, 24) / 2
    const edgeToEdge = tallest > screenH - margin
    if (!edgeToEdge) {
      set('--safe-area-inset-top', '0px')
      set('--safe-area-inset-bottom', '0px')
      set('--tabs-bottom-pad', '0px')
      zeroed = true
      return
    }
    // 막대 밑까지 그려지면 값은 Capacitor에 맡긴다 (키보드가 열리면 아래 값을 0으로 바꿔 줌)
    if (zeroed) {
      zeroed = false
      set('--safe-area-inset-top', `${raw.top}px`)
      set('--safe-area-inset-bottom', `${raw.bottom}px`)
    }
    set('--tabs-bottom-pad', raw.bottom < 32 ? '0px' : `${raw.bottom}px`)
  }
  apply()
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['style'] })
  window.addEventListener('resize', apply)
}
export const isAndroidBrowser = !isAndroidApp && /Android/i.test(navigator.userAgent)
export const NativeContacts = registerPlugin<ContactsSyncPlugin>('ContactsSync')

// 갤럭시 앱 설치 파일 주소. Firebase Hosting은 APK 파일을 올리지 못해(배포 실패) GitHub 저장소에서 받는다.
export const APK_URL = 'https://github.com/NYANGSoobeen/ysdwcc-s/raw/main/release/yangsan-support.apk'
// 저장소에 올린 최신 갤럭시 앱 (release/yangsan-support.apk). APK를 새로 만들면 android/app/build.gradle과 같이 올린다.
export const LATEST_APK = { code: 16, name: '1.6.4' }

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

// 갤럭시 앱은 처음부터 켠다 (2026-10-30 사용자가 정함: 걸려 온 전화에 고객 이름이 떠야 함).
// 직원이 직접 끈 적이 있으면(값 'false') 그대로 둔다. 로그아웃하면 기억을 지워 다음 로그인 때 다시 켠다.
export function useNativeContactsAutoOn() {
  useEffect(() => {
    if (!isAndroidApp) return
    try {
      if (localStorage.getItem(ENABLED_KEY) !== null) return
    } catch {
      return
    }
    void NativeContacts.requestPermission()
      .then(({ permission }) => setNativeContactsEnabled(permission))
      .catch(() => {})
  }, [])
}

// 로그아웃, 팀 제외, 끄기: 폰의 "지원팀" 연락처 계정을 통째로 지운다.
// 로그아웃(forget)이면 켜고 끈 기억도 지워, 다음에 로그인하면 다시 저절로 켜진다.
export async function clearNativeContacts(opts: { forget?: boolean } = {}) {
  if (!isAndroidApp) return
  await NativeContacts.clear().catch(() => {})
  setNativeContactsEnabled(false)
  if (opts.forget) {
    try {
      localStorage.removeItem(ENABLED_KEY)
    } catch {
      // 지우지 못하면 다음 로그인 때 설정에서 켜야 한다
    }
  }
}
