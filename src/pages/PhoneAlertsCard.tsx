import { hasPhoneNative, PhoneNative } from '../phone.ts'
import { requestAlerts, setAlertKinds, useAlertsStatus, type AlertKinds } from '../phoneAlerts.ts'
import { tell } from '../ui/dialogs.tsx'

// 내 정보: 🔔 전화·문자 알림 카드 (갤럭시 앱만, src/phoneAlerts.ts)
export function PhoneAlertsCard() {
  const { supported, status, kinds } = useAlertsStatus()
  if (!hasPhoneNative) return null
  if (!supported)
    return (
      <section className="card form">
        <h3>🔔 전화·문자 알림</h3>
        <p className="muted small">갤럭시 앱 1.4.0부터 쓸 수 있어요. 아래 "📱 갤럭시 앱 새 버전" 띠에서 업데이트해 주세요.</p>
      </section>
    )
  const ready = status?.notify && status.sms && status.phonestate
  const toggle = (k: keyof AlertKinds) => setAlertKinds({ ...kinds, [k]: !kinds[k] })

  async function turnOn() {
    const s = await requestAlerts()
    if (s && !(s.notify && s.sms && s.phonestate))
      await tell({
        title: '권한을 허용해 주세요',
        message:
          '앱 정보 → 권한에서 "알림", "SMS", "전화"를 허용해 주세요. 회색으로 막혀 있으면 앱 정보 오른쪽 위 ⋮ → "제한된 설정 허용"을 먼저 눌러 주세요.',
      }).then(() => PhoneNative.openSettings().catch(() => {}))
  }

  return (
    <section className="card form">
      <h3>🔔 전화·문자 알림</h3>
      <p className="muted small">
        삼성 전화·메시지 앱 알림은 그대로 오고, 우리 앱도 <strong>소리 없이</strong> 알림을 띄워요. 누르면 우리 앱의 그 화면이 열려요. 앱을 보고
        있을 때는 문자·부재중 알림 대신 아래 탭에 빨간 숫자로 보여요.
      </p>
      <div className="alert-kinds">
        <label>
          <input type="checkbox" checked={kinds.sms} onChange={() => toggle('sms')} />
          <span>✉️ 문자가 오면 (누르면 그 대화)</span>
        </label>
        <label>
          <input type="checkbox" checked={kinds.missed} onChange={() => toggle('missed')} />
          <span>📞 부재중 전화 (누르면 최근기록)</span>
        </label>
        <label>
          <input type="checkbox" checked={kinds.caller} onChange={() => toggle('caller')} />
          <span>📇 고객 전화가 울릴 때 고객 정보 (이름 · 회사 · 다음 연락, 누르면 고객 화면)</span>
        </label>
      </div>
      {ready ? (
        <p className="notice">켜짐 · 권한 모두 허용됨</p>
      ) : (
        <>
          <p className="error">
            {!status?.notify ? '알림 ' : ''}
            {!status?.sms ? '문자 받기 ' : ''}
            {!status?.phonestate ? '전화 상태 ' : ''}권한이 없어 일부 알림이 안 떠요.
          </p>
          <button type="button" className="primary" onClick={() => void turnOn()}>
            권한 허용하기
          </button>
        </>
      )}
    </section>
  )
}
