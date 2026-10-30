import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { APK_URL, installedApkCode, isAndroidApp, LATEST_APK } from './native.ts'
import { ask, toast } from './ui/dialogs.tsx'

// 📱 갤럭시 앱 새 버전 알림 (2026-10-30). 새 APK가 있으면 아래 탭 위에 띠를 띄운다.
// - 1.3.2부터(Updater 플러그인): "업데이트"를 누르면 앱이 직접 받아 바로 안드로이드 설치 화면을 연다
//   (인터넷 앱·Download 폴더를 거치지 않음). 처음 한 번은 "이 앱에서 설치 허용"을 켜야 한다.
// - 그 전 앱: APK 주소를 열어 받게 한다(받은 파일을 눌러 덮어 설치).
// 스토어 밖 앱이라 마지막 "설치"는 사용자가 누른다. "나중에"는 이번에 앱을 쓰는 동안만 숨기고(sessionStorage),
// 앱을 완전히 닫았다 다시 열면 또 띄운다 (사용자 요청 2026-10-30).
const LATER_KEY = 'apk-update-later'

type UpdaterPlugin = {
  canInstall(): Promise<{ allowed: boolean }>
  openInstallSettings(): Promise<void>
  downloadAndInstall(o: { url: string }): Promise<void>
  addListener(e: 'progress', cb: (d: { percent: number }) => void): Promise<PluginListenerHandle>
}
const Updater = registerPlugin<UpdaterPlugin>('Updater')

export function ApkUpdateBanner() {
  const [old, setOld] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  useEffect(() => {
    if (!isAndroidApp) return
    try {
      if (sessionStorage.getItem(LATER_KEY)) return
    } catch {
      // 기억 못 하면 그냥 띄운다
    }
    void installedApkCode().then((code) => setOld(code > 0 && code < LATEST_APK.code))
  }, [])
  if (!old) return null
  const inApp = Capacitor.isPluginAvailable('Updater')

  async function update() {
    try {
      if (!(await Updater.canInstall()).allowed) {
        const ok = await ask({
          title: '설치 허용이 필요해요 (처음 한 번)',
          message: '다음 화면에서 "이 출처 허용"(또는 "이 앱에서 설치 허용")을 켜고 뒤로 돌아와 "업데이트"를 다시 눌러 주세요.',
          ok: '허용하러 가기',
        })
        if (ok) await Updater.openInstallSettings()
        return
      }
      setPercent(0)
      const sub = await Updater.addListener('progress', (d) => setPercent(d.percent))
      try {
        await Updater.downloadAndInstall({ url: APK_URL })
      } finally {
        void sub.remove()
      }
      // 설치 화면이 열렸다: "업데이트"를 누르면 앱이 새로 열린다
      setPercent(100)
    } catch (err) {
      setPercent(null)
      toast(`업데이트를 받지 못했어요: ${(err as Error).message ?? err}`, { error: true, long: true })
    }
  }

  return (
    <div className="apk-update-banner" role="status">
      <span>
        {percent === null
          ? `📱 갤럭시 앱 새 버전(${LATEST_APK.name})이 있어요`
          : percent < 100
            ? `📥 받는 중… ${percent}%`
            : '설치 화면에서 "업데이트"를 눌러 주세요'}
      </span>
      {percent === null && (
        <span className="apk-update-actions">
          <button
            type="button"
            className="later"
            onClick={() => {
              try {
                sessionStorage.setItem(LATER_KEY, '1')
              } catch {
                // 기억 못 하면 다음에 또 뜬다
              }
              setOld(false)
            }}
          >
            나중에
          </button>
          {inApp ? (
            <button type="button" className="button" onClick={() => void update()}>
              업데이트
            </button>
          ) : (
            <a className="button" href={APK_URL}>
              업데이트
            </a>
          )}
        </span>
      )}
    </div>
  )
}
