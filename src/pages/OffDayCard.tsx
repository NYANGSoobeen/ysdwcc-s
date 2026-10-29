import { useEffect, useState } from 'react'
import { errorMessage } from '../auth.ts'
import { formatPhone, normalizePhone } from '../customers.ts'
import type { Profile } from '../hooks.ts'
import { defaultOffDayMessage, saveOffDayReply, useMyOffDates, type OffDayReply } from '../offday.ts'
import { askPermission, hasPhoneNative, oldAndroidApp, PhoneNative, timeText, type OffDayLog } from '../phone.ts'
import { dateKey } from '../schedule/roster.ts'
import { tell, toast } from '../ui/dialogs.tsx'

// 내 정보: 🌙 휴무일 자동 응답 카드
type Status = { phonestate: boolean; sms: boolean; silence: boolean; offToday: boolean; log: OffDayLog[] }

export function OffDayCard({ uid, profile }: { uid: string; profile: Profile }) {
  const reply = (profile.settings as { offDayReply?: OffDayReply } | undefined)?.offDayReply ?? {}
  const saved = reply.enabled === true
  // 누르는 즉시 바뀌게 (저장되면 서버 값을 따름)
  const [enabled, setEnabled] = useState(saved)
  useEffect(() => setEnabled(saved), [saved])
  const fallback = defaultOffDayMessage(profile.name)
  const [message, setMessage] = useState(reply.message || fallback)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const dates = useMyOffDates(uid, profile.teamIds ?? [])
  const today = dateKey(new Date())
  const upcoming = dates.filter((d) => d >= today).slice(0, 6)

  const refresh = () => {
    if (hasPhoneNative) void PhoneNative.offDayStatus().then(setStatus).catch(() => setStatus(null))
  }
  useEffect(() => {
    refresh()
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  async function toggle(on: boolean) {
    setBusy(true)
    setEnabled(on)
    try {
      if (on && hasPhoneNative) {
        // 걸려 온 번호 알기 + 문자 보내기 권한
        if (!(await askPermission('phonestate')) || !(await askPermission('sms'))) {
          await tell({
            title: '권한이 필요해요',
            message: '전화 상태(걸려 온 번호)와 문자 보내기 권한을 허용해야 해요. 회색으로 막혀 있으면 앱 정보 → ⋮ → "제한된 설정 허용" 후 다시 켜 주세요.',
            ok: '설정 열기',
          })
          void PhoneNative.openSettings()
          setEnabled(saved)
          return
        }
      }
      await saveOffDayReply(uid, { enabled: on, message: reply.message ? undefined : message })
      toast(on ? '휴무일 자동 응답을 켰어요.' : '휴무일 자동 응답을 껐어요.')
    } catch (err) {
      setEnabled(saved)
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
      refresh()
    }
  }

  async function saveMessage() {
    if (!message.trim()) return toast('문구를 넣어 주세요.', { error: true })
    setBusy(true)
    try {
      await saveOffDayReply(uid, { message: message.trim() })
      toast('자동 문자 문구를 저장했어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  const fmt = (d: string) => {
    const [, m, day] = d.split('-').map(Number)
    const wd = '일월화수목금토'[new Date(Number(d.slice(0, 4)), m - 1, day).getDay()]
    return `${m}/${day}(${wd})`
  }

  return (
    <section className="card offday-card">
      <h3>🌙 휴무일 자동 응답</h3>
      <p className="muted small">
        📋 근무표에서 내가 <strong>휴</strong>인 날, <strong>업무 고객</strong> 번호로 전화가 오면 벨을 무음으로 하고 아래 문구로 문자를 보내요 (전화 올 때마다). 개인 번호는 그대로 울려요.
      </p>
      <p className="small">
        {upcoming.length > 0 ? (
          <>
            다음 휴무: {upcoming.map(fmt).join(', ')}
            {dates.includes(today) && <strong> · 오늘 휴무</strong>}
          </>
        ) : (
          <span className="muted">근무표에 내 휴무가 아직 없어요.</span>
        )}
      </p>

      {!hasPhoneNative ? (
        <p className="muted small">
          {oldAndroidApp
            ? '갤럭시 앱 새 버전(1.3.0)에서 쓸 수 있어요.'
            : '전화를 무음으로 하고 문자를 자동으로 보내는 건 갤럭시 앱에서만 돼요. 아이폰은 휴무일에 설정 → 집중 모드 → 업무 시간 외를 켜 주세요. 문구는 여기서 정해 두면 갤럭시로 바꿨을 때 그대로 써요.'}
        </p>
      ) : (
        <label className="check-row">
          <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
          <span>휴무일에 고객 전화 무음 + 자동 문자</span>
        </label>
      )}

      <label className="offday-message">
        자동 문자 문구 <small className="muted">({message.length}/300자)</small>
        <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 300))} rows={3} />
      </label>
      <div className="offday-buttons">
        <button type="button" onClick={() => void saveMessage()} disabled={busy || message.trim() === (reply.message || fallback)}>
          문구 저장
        </button>
        <button type="button" className="ghost" onClick={() => setMessage(fallback)} disabled={busy}>
          기본 문구로
        </button>
      </div>

      {hasPhoneNative && enabled && status && (
        <div className="offday-status small">
          <div>{status.phonestate ? '✅' : '⚠️'} 걸려 온 번호 알기 {status.phonestate ? '' : '— 권한 필요'}</div>
          <div>{status.sms ? '✅' : '⚠️'} 문자 보내기 {status.sms ? '' : '— 권한 필요'}</div>
          <div>
            {status.silence ? '✅ 무음 모드로 바꾸기' : '⚠️ 무음: 방해 금지 접근을 허용하면 확실하게 무음이 돼요 (안 하면 벨소리 볼륨만 잠깐 끔)'}
            {!status.silence && (
              <button type="button" className="link" onClick={() => void PhoneNative.openDndSettings()}>
                허용하러 가기
              </button>
            )}
          </div>
          <div className="muted">
            💡 삼성 폰: 설정 → 배터리 → 백그라운드 사용 제한에서 이 앱을 "사용 안 하는 앱 절전"에서 빼 두세요 (앱이 꺼져 있어도 동작하게).
          </div>
          {status.log.length > 0 && (
            <details>
              <summary>최근 자동 응답 {status.log.length}건</summary>
              <ul className="offday-log">
                {status.log.slice(0, 20).map((l) => (
                  <li key={l.at}>
                    {new Date(l.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} {timeText(l.at)} · {formatPhone(normalizePhone(l.number))} ·{' '}
                    {l.silenced ? '무음' : '무음 실패'} · {l.sent ? '문자 보냄' : '문자 실패'}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
