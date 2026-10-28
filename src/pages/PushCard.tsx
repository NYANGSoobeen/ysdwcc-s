import { useEffect, useState } from 'react'
import { DEFAULT_KINDS, disablePush, enablePush, isPc, pushState, setPushKinds, type PushKinds, type PushState } from '../push.ts'
import { toast } from '../ui/dialogs.tsx'

// 내 정보: 이 기기 알림 (9번). 켜기/끄기 + 종류별(💬 채팅 · 🔔 나를 부른 말 · 📢 공지 · 🏌️ 프론트 채팅) 켜고 끄기.
const KINDS: { key: keyof PushKinds; label: string; hint: string }[] = [
  { key: 'chat', label: '💬 모든 새 채팅', hint: '우리 팀 채팅방의 새 말' },
  { key: 'mention', label: '🔔 나를 부른 말', hint: '@내 이름, @모두 (채팅을 꺼도 받음)' },
  { key: 'notice', label: '📢 새 공지', hint: '공지 게시판에 새 글' },
  { key: 'front', label: '🏌️ 프론트 채팅', hint: '들어가 있는 프론트 채팅방의 새 말' },
]

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
  const kinds = on ? state.kinds : DEFAULT_KINDS
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
      {state.kind === 'off' && (
        <>
          <p className="muted small">앱이 꺼져 있어도 새 채팅·공지를 알려 주고, 앱 아이콘에 안 읽은 수를 보여 줘요.</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void run(() => enablePush(DEFAULT_KINDS), '알림을 켰어요.')}>
            🔔 알림 켜기
          </button>
          <p className="muted small">허용 창이 뜨면 "허용"을 눌러 주세요.</p>
        </>
      )}
      {on && (
        <>
          <ul className="push-kinds">
            {KINDS.map((k) => (
              <li key={k.key}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={kinds[k.key]}
                    disabled={busy}
                    onChange={(e) => void run(() => setPushKinds({ ...kinds, [k.key]: e.target.checked }), '알림 설정을 바꿨어요.')}
                  />
                  <span>
                    {k.label}
                    <small className="muted"> · {k.hint}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="muted small">
            지금 보고 있는 채팅방의 알림은 띄우지 않아요. 알림을 누르면 그 채팅방이 바로 열려요.
            {isPc() && ' 이 컴퓨터는 여러 사람이 쓸 수 있어서, 앱을 열어 둔 동안(마지막으로 연 뒤 20분까지)만 알림을 받아요.'}
          </p>
          <button type="button" disabled={busy} onClick={() => void run(() => disablePush(true), '이 기기 알림을 껐어요.')}>
            알림 끄기
          </button>
        </>
      )}
    </section>
  )
}
