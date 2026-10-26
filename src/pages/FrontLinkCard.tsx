import { useEffect, useState } from 'react'
import { errorMessage } from '../auth.ts'
import { api } from '../api.ts'
import { copyText } from './ChatPage.tsx'
import { ask, tell, toast } from '../ui/dialogs.tsx'

// 최고 관리자: 프론트 앱의 "⚙️ 타부서 연동 설정"에 넣을 알림 주소와 비밀값.
// 비밀값은 서버 전용 문서(meta/frontLink)에만 있고, 새로 만들 때 한 번만 보여 준다.
const PUSH_URL = `https://us-west1-${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ysdwcc-s'}.cloudfunctions.net/ydrGuestPush`

export function FrontLinkCard() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => {
    api.frontLinkInfo().then((r) => setConfigured(r.configured), () => setConfigured(false))
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
