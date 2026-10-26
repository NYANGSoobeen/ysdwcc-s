import { useEffect, useState } from 'react'
import { isIOS } from '../download.ts'
import { canInstall, isStandalone, onInstallChange, promptInstall } from '../mobile.ts'
import { APK_URL, isAndroidApp, isAndroidBrowser } from '../native.ts'
import { toast } from '../ui/dialogs.tsx'

// 홈 화면에 앱 추가(PWA 설치) 안내. 이미 홈 화면에서 열었거나 갤럭시 앱이면 보이지 않는다.
export function InstallCard() {
  const [installable, setInstallable] = useState(canInstall)
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), [])

  if (isStandalone || isAndroidApp) return null

  return (
    <section className="card form">
      <h3>📲 홈 화면에 앱 추가</h3>
      <p className="muted small">홈 화면 아이콘으로 열면 주소창 없이 앱처럼 넓게 쓰고, 새 버전 알림도 받습니다.</p>
      {installable && (
        <button
          type="button"
          className="primary"
          onClick={async () => {
            if (await promptInstall()) toast('홈 화면에 추가했어요.')
          }}
        >
          앱 설치
        </button>
      )}
      {isIOS ? (
        <ol className="install-steps small">
          <li>
            <strong>Safari</strong>로 이 사이트를 엽니다 (카카오톡 안 브라우저 X)
          </li>
          <li>
            아래쪽 <strong>공유 버튼</strong>(네모에 위쪽 화살표)을 누릅니다
          </li>
          <li>
            <strong>홈 화면에 추가</strong> → <strong>추가</strong>
          </li>
        </ol>
      ) : isAndroidBrowser ? (
        <>
          {!installable && (
            <p className="small">
              크롬 오른쪽 위 <strong>⋮</strong> → <strong>홈 화면에 추가</strong> (또는 <strong>앱 설치</strong>)
            </p>
          )}
          <p className="small">
            갤럭시는 고객 이름 표시와 사진 바로 저장이 되는 <a href={APK_URL}>갤럭시 앱</a>을 추천해요.
          </p>
        </>
      ) : (
        !installable && (
          <p className="small">
            크롬·엣지 주소창 오른쪽의 <strong>설치 아이콘</strong>(⊕ 또는 모니터 모양)을 누르면 PC에도 앱처럼 설치됩니다.
          </p>
        )
      )}
    </section>
  )
}
