import { useEffect, useState } from 'react'
import { APK_URL, installedApkCode, isAndroidApp, LATEST_APK } from './native.ts'

// 📱 갤럭시 앱 새 버전 알림 (사용자가 고른 ①, 2026-10-30). 안드로이드는 스토어 밖 앱을 저절로 깔 수 없어서,
// 새 APK가 있으면 아래에 띠를 띄우고 "업데이트"를 누르면 APK를 받는다(받은 파일을 눌러 덮어 설치).
// "나중에"는 하루 동안 안 띄운다 (이 기기 localStorage).
const LATER_KEY = 'apk-update-later'

export function ApkUpdateBanner() {
  const [old, setOld] = useState(false)
  useEffect(() => {
    if (!isAndroidApp) return
    try {
      if (Date.now() - Number(localStorage.getItem(LATER_KEY) ?? 0) < 24 * 3600 * 1000) return
    } catch {
      // 기억 못 하면 그냥 띄운다
    }
    void installedApkCode().then((code) => setOld(code > 0 && code < LATEST_APK.code))
  }, [])
  if (!old) return null
  return (
    <div className="apk-update-banner" role="status">
      <span>📱 갤럭시 앱 새 버전({LATEST_APK.name})이 있어요</span>
      <span className="apk-update-actions">
        <button
          type="button"
          className="later"
          onClick={() => {
            try {
              localStorage.setItem(LATER_KEY, String(Date.now()))
            } catch {
              // 기억 못 하면 다음에 또 뜬다
            }
            setOld(false)
          }}
        >
          나중에
        </button>
        <a className="button" href={APK_URL}>
          업데이트
        </a>
      </span>
    </div>
  )
}
