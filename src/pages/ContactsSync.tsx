import { doc, onSnapshot, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { errorMessage } from '../auth.ts'
import { ask, askText } from '../ui/dialogs.tsx'
import { db } from '../firebase.ts'
import {
  APK_URL,
  clearNativeContacts,
  isAndroidApp,
  NativeContacts,
  setNativeContactsEnabled,
  useNativeSyncState,
} from '../native.ts'

type Status = { enabled: boolean; username: string | null; createdAt: Timestamp | null }

// 연락처 구독 서버 주소. 함수 주소는 "함수이름-프로젝트번호.리전.run.app" 형식이다
// (프로젝트 번호 = 웹 앱 설정의 messagingSenderId).
function serverUrl() {
  if (import.meta.env.VITE_USE_EMULATORS === 'true') return 'http://127.0.0.1:5001/demo-workphone/us-west1/carddav'
  const custom = import.meta.env.VITE_CARDDAV_URL
  if (custom) return custom.replace(/\/+$/, '')
  return `https://carddav-${import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID}.us-west1.run.app`
}

const isIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent)

export function ContactsSync({ uid }: { uid: string }) {
  return isAndroidApp ? <NativeContactsSync /> : <CardDavSync uid={uid} />
}

const KAKAO_WARNING = (
  <p className="notice small">
    ⚠️ <strong>카카오톡 자동 친구 추가</strong>를 끄세요. 켜져 있으면 고객이 카카오톡 친구로 자동 추가될 수 있습니다.
    카카오톡 → 설정 → 친구 → <strong>자동 친구 추가</strong> 끄기.
  </p>
)

// 갤럭시 앱: 폰 연락처에 "지원팀" 전용 계정을 만들어 고객을 직접 넣는다. 접속 정보가 필요 없다.
function NativeContactsSync() {
  const { enabled, last } = useNativeSyncState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function turnOn() {
    setBusy(true)
    setError('')
    try {
      const { permission } = await NativeContacts.requestPermission()
      if (!permission) {
        setError('연락처 권한이 필요합니다. 폰 설정 → 애플리케이션 → 양산동원지원팀 → 권한에서 연락처를 허용하세요.')
        return
      }
      setNativeContactsEnabled(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    if (!(await ask({ message: '끄면 이 폰 연락처에서 고객("[업무] 이름")이 모두 지워집니다. 끌까요?', ok: '끄기', danger: true }))) return
    setBusy(true)
    await clearNativeContacts()
    setBusy(false)
  }

  return (
    <section className="card form">
      <h3>휴대폰 연락처에 고객 표시</h3>
      <p className="muted small">
        팀 고객을 이 폰 연락처의 <strong>"지원팀" 계정</strong>에 넣어, 고객에게 전화가 오면 <strong>"[업무] 이름"</strong>으로
        표시합니다. 앱을 열 때마다 고객 목록에 맞춰지고, 로그아웃하거나 팀에서 제외되면 자동으로 지워집니다. 개인 연락처는
        건드리지 않습니다.
      </p>
      <p className={enabled ? 'notice' : 'muted small'}>
        {!enabled
          ? '꺼짐'
          : last && 'count' in last
            ? `켜짐 · 고객 ${last.count}명 · ${last.at.toLocaleTimeString('ko-KR', { timeStyle: 'short' })}에 맞춤`
            : last && 'error' in last
              ? `켜짐 · 마지막 저장 실패: ${last.error}`
              : '켜짐 · 맞추는 중…'}
      </p>
      {error && <p className="error">{error}</p>}
      {enabled ? (
        <button type="button" onClick={turnOff} disabled={busy}>
          끄기 (폰에서 고객 연락처 지우기)
        </button>
      ) : (
        <button type="button" className="primary" onClick={turnOn} disabled={busy}>
          {busy ? '권한 확인 중…' : '켜기'}
        </button>
      )}
      {KAKAO_WARNING}
    </section>
  )
}

function CardDavSync({ uid }: { uid: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [guide, setGuide] = useState<'iphone' | 'android'>(isIPhone ? 'iphone' : 'android')

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'users', uid, 'private', 'contactsSync'),
        (snap) => setStatus(snap.exists() ? (snap.data() as Status) : { enabled: false, username: null, createdAt: null }),
        () => setStatus({ enabled: false, username: null, createdAt: null }),
      ),
    [uid],
  )

  async function enable() {
    if (status?.enabled && !(await ask({ message: '접속 정보를 새로 만들까요?\n예전 접속 정보로 연결된 폰에서는 고객 연락처가 사라지고, 새 정보로 다시 설정해야 합니다.', ok: '새로 만들기' }))) return
    setBusy(true)
    setError('')
    try {
      setCreds(await api.enableContactsSync())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!(await ask({ message: '연락처 표시를 끌까요?\n폰이 다음에 동기화할 때 고객 연락처가 모두 사라집니다. 폰 설정에서 "지원팀" 연락처 계정도 지워 주세요.', ok: '끄기', danger: true }))) return
    setBusy(true)
    setError('')
    try {
      await api.disableContactsSync()
      setCreds(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const url = serverUrl()
  const host = url.replace(/^https?:\/\//, '')

  return (
    <section className="card form">
      <h3>휴대폰 연락처에 고객 표시</h3>
      <p className="muted small">
        팀 고객을 폰 연락처에 <strong>별도 계정</strong>으로 넣어, 고객에게 전화가 오면
        <strong> "[업무] 이름"</strong>으로 표시합니다. 고객이 바뀌면 자동으로 맞춰지고, 팀에서 제외되면 폰에서 자동으로
        사라집니다. 개인 연락처와 섞이지 않습니다.
      </p>
      {status === null ? (
        <p className="muted small">확인하는 중…</p>
      ) : (
        <p className={status.enabled ? 'notice' : 'muted small'}>
          {status.enabled
            ? `켜짐 · ${status.createdAt?.toDate().toLocaleDateString('ko-KR') ?? ''}에 만든 접속 정보 사용 중`
            : '꺼짐'}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {creds && (
        <div className="creds">
          <p className="small">
            <strong>아래 정보는 지금 한 번만 보입니다.</strong> 폰 설정을 마칠 때까지 이 화면을 닫지 마세요.
          </p>
          <CopyField label="서버" value={guide === 'iphone' ? host : url} />
          <CopyField label="사용자 이름" value={creds.username} />
          <CopyField label="암호" value={creds.password} />
        </div>
      )}

      <div className="button-row">
        <button type="button" className="primary" onClick={enable} disabled={busy}>
          {busy ? '처리 중…' : status?.enabled ? '접속 정보 새로 만들기' : '켜기 (접속 정보 만들기)'}
        </button>
        {status?.enabled && (
          <button type="button" onClick={disable} disabled={busy}>
            끄기
          </button>
        )}
      </div>

      <div className="chips" role="tablist" aria-label="폰 종류">
        <button type="button" role="tab" aria-selected={guide === 'iphone'} className={guide === 'iphone' ? 'chip selected' : 'chip'} onClick={() => setGuide('iphone')}>
          아이폰 설정 방법
        </button>
        <button type="button" role="tab" aria-selected={guide === 'android'} className={guide === 'android' ? 'chip selected' : 'chip'} onClick={() => setGuide('android')}>
          갤럭시 설정 방법
        </button>
      </div>

      {guide === 'iphone' ? (
        <ol className="steps">
          <li>위에서 <strong>켜기</strong>를 눌러 접속 정보를 만듭니다.</li>
          <li>
            아이폰 <strong>설정 → 앱 → 연락처 → 연락처 계정 → 계정 추가</strong>로 갑니다.
            <span className="muted small"> (iOS 17 이하: 설정 → 연락처 → 계정 → 계정 추가)</span>
          </li>
          <li><strong>기타 → CardDAV 계정 추가</strong>를 누릅니다.</li>
          <li>
            <strong>서버, 사용자 이름, 암호</strong>를 위 정보로 붙여 넣고, 설명은 <strong>지원팀</strong>으로 적은 뒤
            <strong> 다음</strong>을 누릅니다.
          </li>
          <li>연락처 앱 → 왼쪽 위 <strong>목록</strong>에 "지원팀 고객"이 보이면 완료입니다. 처음에는 몇 분 걸릴 수 있습니다.</li>
          <li>
            <strong>설정 → 앱 → 연락처 → 기본 계정</strong>은 <strong>iCloud</strong>(또는 내 폰)로 두세요. 지원팀 계정은
            읽기 전용이라 여기에 새 연락처를 저장할 수 없습니다.
          </li>
        </ol>
      ) : (
        <>
          <ol className="steps">
            <li>
              갤럭시는 <strong>양산동원지원팀 갤럭시 앱</strong>을 설치하면 접속 정보 없이 바로 고객 이름이 표시됩니다.
              <a className="download-button" href={APK_URL} download>
                갤럭시 앱 받기 (APK)
              </a>
            </li>
            <li>
              받은 파일을 열고, "출처를 알 수 없는 앱" 안내가 나오면 <strong>설정 → 이 출처 허용</strong>을 켠 뒤 설치합니다.
            </li>
            <li>설치한 앱으로 로그인하고 <strong>내 정보 → 휴대폰 연락처에 고객 표시 → 켜기</strong>를 누릅니다.</li>
          </ol>
          <details className="small">
            <summary>앱을 설치할 수 없을 때 (DAVx⁵ 사용)</summary>
            <ol className="steps">
              <li>
                <strong>DAVx⁵</strong> 앱을 설치합니다 (Play 스토어 유료, F-Droid 무료). 이 앱이 고객 목록을 받아 삼성 연락처에
                넣어 줍니다.
              </li>
              <li>위에서 <strong>켜기</strong>를 눌러 접속 정보를 만듭니다.</li>
              <li>
                DAVx⁵에서 <strong>+ → URL 및 사용자 이름으로 로그인</strong>을 고르고, 기본 URL에 <strong>서버</strong>, 그리고
                사용자 이름과 암호를 붙여 넣습니다.
              </li>
              <li>계정 이름을 <strong>지원팀</strong>으로 만들고, CardDAV 탭에서 <strong>지원팀 고객</strong>을 체크합니다.</li>
            </ol>
          </details>
        </>
      )}

      {KAKAO_WARNING}
    </section>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      void askText({ title: label, message: '아래 칸을 길게 눌러 복사하세요.', value, ok: '닫기' })
    }
  }

  return (
    <div className="copy-field">
      <span className="muted small">{label}</span>
      <code>{value}</code>
      <button type="button" className="link" onClick={copy}>
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  )
}
