import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api.ts'
import { errorMessage } from '../auth.ts'
import { isIOS } from '../download.ts'
import { MenuButton } from '../menu.tsx'
import { isAndroidBrowser } from '../native.ts'
import { hasPhoneNative, oldAndroidApp, PhoneNative } from '../phone.ts'
import { requestAlerts, setAlertKinds, useAlertsStatus, type AlertKinds } from '../phoneAlerts.ts'
import {
  DEFAULT_KINDS,
  disablePush,
  enablePush,
  isPc,
  pushSound,
  pushState,
  setPushKinds,
  setPushSound,
  testPushHere,
  type PushKinds,
  type PushSound,
  type PushState,
} from '../push.ts'
import { tell, toast } from '../ui/dialogs.tsx'

// 🔔 알림 설정 (2026-10-30, 프론트 앱 "알림 설정" 화면과 같은 모양, 색은 우리 앱). 메뉴 맨 아래 따로.
// 설정은 기기마다: 이 기기의 알림(상태 확인) → 받을 알림(종류) → 알림 방식(소리·조용히·숫자만) + 테스트.
// 갤럭시 앱은 전화·문자 알림(src/phoneAlerts.ts, 폰이 직접 띄움)을, 그 밖(아이폰 홈 화면 앱·크롬·PC)은 웹 푸시를 설정한다.
const CHAT_KINDS: { key: keyof PushKinds; icon: string; label: string; desc: string }[] = [
  { key: 'chat', icon: '💬', label: '채팅 메시지', desc: '단체 채팅방에 새 메시지가 오면' },
  { key: 'mention', icon: '📣', label: '나를 부른 메시지 (@멘션)', desc: '채팅에서 누가 @내 이름이나 @모두로 부르면 (채팅 알림을 꺼도 와요)' },
  { key: 'notice', icon: '📢', label: '공지 새 글', desc: '공지에 새 글이 올라오면' },
  { key: 'front', icon: '🏌️', label: '프론트 채팅', desc: '들어가 있는 프론트 채팅방에 새 메시지가 오면' },
]
const PHONE_KINDS: { key: keyof AlertKinds; icon: string; label: string; desc: string }[] = [
  { key: 'sms', icon: '✉️', label: '업무 문자', desc: '고객이 보낸 문자·채팅+ (개인 문자는 삼성 메시지 알림만). 앱 아이콘 빨간 숫자도 업무 문자만 세요' },
  { key: 'missed', icon: '📞', label: '부재중 전화', desc: '못 받은 전화가 있으면 (누르면 최근기록)' },
  { key: 'caller', icon: '📇', label: '고객 전화 정보', desc: '고객 번호로 전화가 울릴 때 이름·회사·다음 연락을 띠로 (누르면 고객 화면)' },
]
const SOUNDS: { id: PushSound; icon: string; label: string; desc: string }[] = [
  { id: 'sound', icon: '🔔', label: '소리 + 알림창', desc: '새 채팅이 오면 소리(진동)와 함께 알림창이 떠요.' },
  { id: 'quiet', icon: '🔕', label: '소리 없이 알림창만', desc: '알림창만 조용히 떠요. 소리·진동은 없어요.' },
  { id: 'badge', icon: '🔇', label: '무음 (숫자만)', desc: '알림창 없이 앱 아이콘의 빨간 숫자만 올라가요.' },
]

export function AlertsPage({ unread, workSms }: { unread: number; workSms: number }) {
  return (
    <div className="page alerts-page">
      <header className="page-header">
        <MenuButton />
        <h2>🔔 알림 설정</h2>
        <span />
      </header>
      <div className="page-body">
        {hasPhoneNative || oldAndroidApp ? <GalaxyAlerts workSms={workSms} /> : <WebAlerts unread={unread} />}
      </div>
    </div>
  )
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div>
      {ok ? '✅' : '⚠️'} {children}
    </div>
  )
}

function Opt(props: { type: 'checkbox' | 'radio'; on: boolean; disabled?: boolean; icon: string; label: string; desc: string; onChange: (on: boolean) => void }) {
  return (
    <label className={`nt-opt${props.on ? ' on' : ''}`}>
      <input type={props.type} name={props.type === 'radio' ? 'nt-mode' : undefined} checked={props.on} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <div>
        <div className="nt-lbl">
          {props.icon} {props.label}
        </div>
        <div className="nt-desc">{props.desc}</div>
      </div>
    </label>
  )
}

// ── 아이폰(홈 화면 앱)·크롬·PC: 웹 푸시 ──
function WebAlerts({ unread }: { unread: number }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [sound, setSound] = useState(pushSound)
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
  async function serverTest() {
    try {
      const r = await api.sendTestPush()
      toast(r.devices ? `서버가 내 기기 ${r.devices}곳에 보냈어요 (${r.sent}곳 성공).` : '알림을 켠 기기가 없어요.', { long: true })
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  if (!state) return <p className="center muted">확인하는 중…</p>
  const on = state.kind === 'on'
  const kinds = on ? state.kinds : DEFAULT_KINDS
  const badgeOk = 'setAppBadge' in navigator
  return (
    <>
      <section className="card">
        <h3>이 기기의 알림</h3>
        {state.kind === 'ios-browser' ? (
          <p className="nt-status">
            아이폰은 <strong>홈 화면에 추가한 앱</strong>에서만 알림을 받을 수 있어요 (iOS 16.4 이상). Safari 아래쪽 공유 버튼(□↑) → "홈 화면에 추가" →
            홈 화면의 앱을 열고 여기서 알림을 켜 주세요.
          </p>
        ) : state.kind === 'unsupported' ? (
          <p className="nt-status">이 브라우저에서는 알림을 쓸 수 없어요. {isIOS ? '' : '크롬이나 엣지에서 열어 주세요.'}</p>
        ) : (
          <>
            <p className="nt-status">
              {on ? (
                <>
                  <strong>🟢 켜짐</strong> · 새 채팅·공지를 이 기기로 알려 드려요
                </>
              ) : state.kind === 'blocked' ? (
                <>
                  <strong>⛔ 차단됨</strong> · 기기(브라우저) 설정에서 이 앱의 알림을 허용해 주세요
                </>
              ) : (
                <>
                  <strong>⚪ 꺼짐</strong> · 켜면 앱을 닫아 두어도 새 소식을 알려 드려요
                </>
              )}
            </p>
            <div className="nt-check">
              <Check ok={state.kind !== 'blocked' && Notification.permission === 'granted'}>
                기기 알림 허용: {Notification.permission === 'granted' ? '허용됨' : Notification.permission === 'denied' ? '차단됨' : '아직 안 물어봄'}
              </Check>
              <Check ok={on}>이 기기 등록: {on ? '됨' : '안 됨'}</Check>
              <Check ok>기기 종류: {isPc() ? 'PC (앱을 열어 둔 동안 · 마지막으로 연 뒤 20분까지만 알림)' : '휴대폰·태블릿'}</Check>
              <Check ok>빨간 숫자: 안 읽은 채팅 {unread}</Check>
              {!isPc() && (
                <Check ok={badgeOk || isAndroidBrowser}>
                  앱 아이콘 숫자: {isAndroidBrowser ? '알림창에 쌓인 알림 개수로 표시돼요' : badgeOk ? '지원됨' : '이 기기에서는 지원 안 됨'}
                </Check>
              )}
            </div>
            {on ? (
              <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => disablePush(true), '이 기기 알림을 껐어요.')}>
                알림 끄기
              </button>
            ) : (
              state.kind === 'off' && (
                <button type="button" className="primary" disabled={busy} onClick={() => void run(() => enablePush(DEFAULT_KINDS), '알림을 켰어요.')}>
                  🔔 알림 켜기
                </button>
              )
            )}
          </>
        )}
      </section>

      <section className={on ? 'card' : 'card nt-disabled'}>
        <h3>받을 알림</h3>
        {CHAT_KINDS.map((k) => (
          <Opt
            key={k.key}
            type="checkbox"
            on={kinds[k.key]}
            disabled={!on || busy}
            icon={k.icon}
            label={k.label}
            desc={k.desc}
            onChange={(v) => void run(() => setPushKinds({ ...kinds, [k.key]: v }), `${k.label} 알림을 ${v ? '켰어요' : '껐어요'}`)}
          />
        ))}
        <p className="muted small">지금 보고 있는 채팅방의 알림은 띄우지 않아요. 알림을 누르면 그 채팅방이 바로 열려요.</p>
      </section>

      <section className={on ? 'card' : 'card nt-disabled'}>
        <h3>알림 방식</h3>
        {SOUNDS.map((m) => (
          <Opt
            key={m.id}
            type="radio"
            on={sound === m.id}
            disabled={!on}
            icon={m.icon}
            label={m.label}
            desc={m.desc}
            onChange={() => {
              setPushSound(m.id)
              setSound(m.id)
              toast(`알림 방식: ${m.icon} ${m.label}`)
            }}
          />
        ))}
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={!on}
            onClick={() => {
              testPushHere()
              toast(sound === 'badge' ? '무음이라 알림창은 뜨지 않아요' : '테스트 알림을 보냈어요')
            }}
          >
            🔔 이 기기에서 테스트
          </button>
          <button type="button" className="ghost" disabled={!on} onClick={() => void serverTest()}>
            📡 서버로 테스트 보내기
          </button>
        </div>
        <p className="muted small">
          {isIOS
            ? '아이폰은 소리를 앱이 정할 수 없어서, 소리·잠금화면 표시는 아이폰 설정 → 알림 → 양산동원지원팀에서도 바꿀 수 있어요. 무음은 알림창이 아주 잠깐 보였다가 바로 사라질 수 있어요.'
            : isAndroidBrowser
              ? '갤럭시(크롬): 소리는 폰 설정이 우선해요. 소리 없이 받으려면 설정 → 애플리케이션 → Chrome → 알림에서 소리를 꺼 주세요. 알림이 안 오면 설정 → 배터리 → 백그라운드 사용 한도에서 Chrome을 "절전 예외"로 해 주세요.'
              : '설정은 이 기기에만 적용돼요. 다른 폰·PC는 각각 설정해 주세요.'}
        </p>
      </section>
    </>
  )
}

// ── 갤럭시 앱: 전화·문자 알림 (폰이 직접 띄움) ──
function GalaxyAlerts({ workSms }: { workSms: number }) {
  const { supported, status, kinds } = useAlertsStatus()
  const [chat, setChat] = useState<boolean | null>(null)
  useEffect(() => {
    const check = () => void PhoneNative.status().then((s) => setChat(s.chat ?? false)).catch(() => setChat(false))
    check()
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (oldAndroidApp || !supported)
    return (
      <section className="card">
        <h3>이 기기의 알림</h3>
        <p className="nt-status">전화·문자 알림은 갤럭시 앱 새 버전에서 쓸 수 있어요. 아래 "📱 갤럭시 앱 새 버전" 띠에서 업데이트해 주세요.</p>
      </section>
    )
  const ready = !!(status?.notify && status.sms && status.phonestate)
  async function allow() {
    const s = await requestAlerts()
    if (s && !(s.notify && s.sms && s.phonestate))
      await tell({
        title: '권한을 허용해 주세요',
        message: '앱 정보 → 권한에서 "알림", "SMS", "전화"를 허용해 주세요. 회색으로 막혀 있으면 앱 정보 오른쪽 위 ⋮ → "제한된 설정 허용"을 먼저 눌러 주세요.',
      }).then(() => PhoneNative.openSettings().catch(() => {}))
  }
  async function openChat() {
    await tell({
      title: '💬 채팅+ 문자 받기',
      message:
        '삼성 메시지의 "채팅+"(파란 말풍선)로 온 문자는 다른 앱이 읽을 수 없어요. 다음 화면에서 양산동원로얄CC지원팀의 "알림 접근"을 켜면, 메시지 앱 알림에서 받은 글을 이 폰 안에서만 읽어 목록에 보여 드려요(서버에 안 올려요).\n\n회색으로 막혀 있으면: 설정 → 애플리케이션 → 양산동원로얄CC지원팀 → 오른쪽 위 ⋮ → "제한된 설정 허용" 뒤 다시 해 주세요.',
    })
    await PhoneNative.openChatAccess().catch(() => {})
  }
  return (
    <>
      <section className="card">
        <h3>이 기기의 알림</h3>
        <p className="nt-status">
          {ready && chat ? (
            <>
              <strong>🟢 켜짐</strong> · 업무 문자·부재중·고객 전화를 이 폰으로 알려 드려요
            </>
          ) : (
            <>
              <strong>⚠️ 일부 꺼짐</strong> · 아래 ⚠️를 허용하면 모두 알려 드려요
            </>
          )}
        </p>
        <div className="nt-check">
          <Check ok={!!status?.notify}>기기 알림 허용: {status?.notify ? '허용됨' : '꺼짐'}</Check>
          <Check ok={!!status?.sms}>문자 받기: {status?.sms ? '허용됨' : '꺼짐'}</Check>
          <Check ok={!!status?.phonestate}>전화 상태(부재중·고객 전화): {status?.phonestate ? '허용됨' : '꺼짐'}</Check>
          <Check ok={!!chat}>💬 채팅+ 문자 받기(알림 접근): {chat ? '켜짐' : '꺼짐 — 채팅+로 온 문자가 안 보여요'}</Check>
          <Check ok>앱 아이콘 숫자: 업무 문자 {workSms} (개인 문자는 안 셈)</Check>
        </div>
        <div className="button-row">
          {!ready && (
            <button type="button" className="primary" onClick={() => void allow()}>
              권한 허용하기
            </button>
          )}
          {!chat && (
            <button type="button" className={ready ? 'primary' : 'ghost'} onClick={() => void openChat()}>
              💬 채팅+ 받기 켜기
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h3>받을 알림</h3>
        {PHONE_KINDS.map((k) => (
          <Opt key={k.key} type="checkbox" on={kinds[k.key]} icon={k.icon} label={k.label} desc={k.desc} onChange={(v) => setAlertKinds({ ...kinds, [k.key]: v })} />
        ))}
        <p className="muted small">
          소리는 삼성 전화·메시지 앱이 내고, 우리 알림은 소리 없이 떠요. 누르면 우리 앱의 그 화면이 열려요. 알림이 늦거나 안 오면 설정 → 배터리 → 백그라운드 사용
          한도에서 이 앱을 "절전 예외"로 해 주세요.
        </p>
      </section>

      <section className="card">
        <h3>💬 채팅·공지 알림</h3>
        <p className="muted small">
          갤럭시 앱의 팀 채팅·공지 알림은 준비 중이에요. 그동안 필요하면 크롬에서 ysdwcc-s.web.app을 열어 🔔 알림 설정에서 켜 주세요.
        </p>
      </section>
    </>
  )
}
