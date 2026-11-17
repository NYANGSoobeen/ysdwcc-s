import { useEffect, useState } from 'react'
import { errorMessage } from '../auth.ts'
import { api, type LastCall } from '../api.ts'
import { copyText } from './ChatPage.tsx'
import { ask, tell, toast } from '../ui/dialogs.tsx'

// 최고 관리자: 프론트 앱의 "⚙️ 타부서 연동 설정"에 넣을 알림 주소와 비밀값.
// 비밀값은 서버 전용 문서(meta/frontLink)에만 있고, 새로 만들 때 한 번만 보여 준다.
const PUSH_URL = `https://us-west1-${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ysdwcc-s'}.cloudfunctions.net/ydrGuestPush`

export function FrontLinkCard() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [lastCall, setLastCall] = useState<LastCall | null | undefined>(undefined)
  const [lastReject, setLastReject] = useState<number | null>(null)
  useEffect(() => {
    api.frontLinkInfo().then(
      (r) => {
        setConfigured(r.configured)
        setLastCall(r.lastCall ?? null)
        setLastReject(r.lastReject ?? null)
      },
      () => setConfigured(false),
    )
  }, [])

  async function makeSecret() {
    if (configured && !(await ask({ message: '비밀값을 새로 만들까요? 프론트 앱 연동 설정의 비밀값도 새 값으로 바꿔야 알림이 다시 와요.', ok: '새로 만들기' })))
      return
    try {
      const { secret } = await api.setFrontLinkSecret({})
      setConfigured(true)
      await tell({
        title: '알림 비밀값',
        message: (
          <>
            <p>프론트 앱 ⚙️ 타부서 연동 설정의 "알림 비밀값"에 아래 값을 그대로 넣으세요. 이 창을 닫으면 다시 볼 수 없어요.</p>
            <p className="secret-box">{secret}</p>
            <button type="button" onClick={() => void copyText(secret)}>
              📋 복사
            </button>
          </>
        ),
      })
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  return (
    <section className="card">
      <h3>🏌️ 프론트 채팅 알림 연동</h3>
      <p className="muted small">프론트 앱 채팅방 ⋯ → ⚙️ 타부서 연동 설정에 아래 세 가지를 넣으면, 프론트 채팅방 새 말이 우리 직원 폰에 알림으로 와요.</p>
      {configured && lastCall !== undefined && <LinkCheck lastCall={lastCall} lastReject={lastReject} />}
      <dl className="stats">
        <div>
          <dt>Firebase 프로젝트 ID</dt>
          <dd>
            {import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ysdwcc-s'}{' '}
            <button type="button" className="ghost small" onClick={() => void copyText(import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ysdwcc-s')}>
              복사
            </button>
          </dd>
        </div>
        <div>
          <dt>함수 주소</dt>
          <dd className="break">
            {PUSH_URL}{' '}
            <button type="button" className="ghost small" onClick={() => void copyText(PUSH_URL)}>
              복사
            </button>
          </dd>
        </div>
        <div>
          <dt>알림 비밀값</dt>
          <dd>{configured === null ? '확인 중…' : configured ? '설정됨 (보안상 다시 보여 주지 않아요)' : '아직 없음'}</dd>
        </div>
      </dl>
      <button type="button" onClick={() => void makeSecret()}>
        {configured ? '🔑 비밀값 새로 만들기' : '🔑 비밀값 만들기'}
      </button>
    </section>
  )
}

const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// 🔍 프론트 알림이 안 올 때 어디서 막혔는지 (2026-11-17 "여전히 알림이 안 와")
function LinkCheck({ lastCall, lastReject }: { lastCall: LastCall | null; lastReject: number | null }) {
  const rejectNewer = lastReject && (!lastCall || lastReject > lastCall.at)
  let hint: string
  if (rejectNewer) hint = '⛔ 프론트가 알림을 보냈는데 비밀값이 안 맞아 거절했어요. 아래 "비밀값 새로 만들기"로 만든 값을 프론트 앱 ⚙️ 타부서 연동 설정에 다시 넣어 주세요.'
  else if (!lastCall) hint = '⚠️ 아직 프론트에서 알림 요청이 온 적이 없어요. 프론트 앱 ⚙️ 타부서 연동 설정에 함수 주소·비밀값이 들어 있는지, 프론트 서버(함수)가 배포됐는지 확인해 주세요.'
  else if (lastCall.active === 0) hint = '⚠️ 프론트가 알려 준 직원이 우리 앱에 없어요(사용 중지 등).'
  else if (lastCall.devices === 0) hint = '⚠️ 받을 직원 중 알림을 켠 기기가 하나도 없어요. 직원 폰 🔔 알림 설정에서 알림을 켜 주세요 (갤럭시 설치형 앱은 1.8.0부터, 그 전엔 크롬에서).'
  else if (lastCall.frontOn === 0) hint = '⚠️ 알림을 켠 기기는 있지만 "🏌️ 프론트 채팅" 체크가 꺼져 있어요. 🔔 알림 설정 → 받을 알림에서 켜 주세요.'
  else if (lastCall.sent === 0) hint = '⚠️ 보내기는 했는데 하나도 성공하지 못했어요. 그 기기에서 알림을 끄고 다시 켜 주세요.'
  else hint = '✅ 서버까지는 정상이에요. 그래도 안 오면 그 폰의 알림 허용·방해 금지·절전 설정을 확인해 주세요.'
  return (
    <div className="small">
      {lastCall && (
        <p>
          📡 마지막 알림 요청 {when(lastCall.at)} · 받을 직원 {lastCall.people}명
          {lastCall.devices !== null && ` · 그 직원들 기기 ${lastCall.devices}개 · 프론트 알림 켠 기기 ${lastCall.frontOn}개`} · 보낸 기기 {lastCall.sent}개
        </p>
      )}
      {lastReject && <p>⛔ 비밀값이 틀린 요청: {when(lastReject)}</p>}
      <p>{hint}</p>
    </div>
  )
}
