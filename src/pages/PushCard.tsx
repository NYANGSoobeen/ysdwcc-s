import { useEffect, useState } from 'react'
import { disablePush, enablePush, pushState, setPushMode, type PushMode, type PushState } from '../push.ts'
import { toast } from '../ui/dialogs.tsx'

// 내 정보: 이 기기 알림 켜기/끄기 (앱이 꺼져 있어도 새 채팅·나를 부른 말·프론트 채팅 알림)
export function PushCard() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = () => void pushState().then(setState)
  useEffect(reload, [])

  async function run(job: () => Promise<void>, done: string) {
    setBusy(true)
    try {
      await job()
      toast(done)
    } catch (err) {
      toast((err as Error).message || '알림 설정을 바꾸지 못했어요.', { error: true, long: true })
    } finally {
      setBusy(false)
      reload()
    }
  }

  if (!state) return null
  const on = state.kind === 'on'
  return (
    <section className="card">
      <h3>🔔 알림 (이 기기)</h3>
      {state.kind === 'native' && (
        <p className="muted small">
          갤럭시 앱 알림은 준비 중이에요. 그동안 알림이 필요하면 크롬에서 앱 주소(ysdwcc-s.web.app)를 열어 알림을 켜 주세요.
        </p>
      )}
      {state.kind === 'ios-browser' && (
        <p className="muted small">
          아이폰은 <strong>홈 화면에 추가한 앱</strong>에서만 알림을 받을 수 있어요. Safari 아래쪽 공유 버튼 → "홈 화면에 추가" 후, 홈 화면의
          앱을 열어 여기서 알림을 켜 주세요.
        </p>
      )}
      {state.kind === 'unsupported' && <p className="muted small">이 브라우저는 알림을 지원하지 않아요. 크롬이나 엣지에서 열어 주세요.</p>}
      {state.kind === 'blocked' && (
        <p className="muted small">
          이 기기에서 알림이 막혀 있어요. 브라우저 주소창 왼쪽 자물쇠(또는 휴대폰 설정 → 앱 → 알림)에서 이 사이트의 알림을 허용한 뒤 다시 와
          주세요.
        </p>
      )}
      {(state.kind === 'off' || on) && (
        <>
          <p className="muted small">앱이 꺼져 있어도 새 채팅을 알려 줘요. 앱을 보고 있을 때는 알림 대신 화면의 빨간 숫자로 보여요.</p>
          <div className="segmented" role="radiogroup" aria-label="알림 받을 것">
            {(
              [
                ['all', '모든 새 메시지'],
                ['mentions', '나를 부른 말만'],
              ] as [PushMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on && state.mode === mode}
                className={on && state.mode === mode ? 'active' : ''}
                disabled={busy}
                onClick={() => void run(() => (on ? setPushMode(mode) : enablePush(mode)), on ? '알림 설정을 바꿨어요.' : '알림을 켰어요.')}
              >
                {label}
              </button>
            ))}
          </div>
          {on ? (
            <button type="button" disabled={busy} onClick={() => void run(disablePush, '이 기기 알림을 껐어요.')}>
              알림 끄기
            </button>
          ) : (
            <p className="muted small">위에서 받을 알림을 고르면 알림이 켜져요. (허용 창이 뜨면 "허용")</p>
          )}
          <p className="muted small">"나를 부른 말만"이면 프론트 채팅 알림도 받지 않아요.</p>
        </>
      )}
    </section>
  )
}
