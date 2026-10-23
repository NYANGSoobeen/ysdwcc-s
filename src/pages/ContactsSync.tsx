import { doc, onSnapshot, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { errorMessage } from '../auth.ts'
import { db } from '../firebase.ts'

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
    if (status?.enabled && !confirm('접속 정보를 새로 만들까요?\n예전 접속 정보로 연결된 폰에서는 고객 연락처가 사라지고, 새 정보로 다시 설정해야 합니다.')) return
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
    if (!confirm('연락처 표시를 끌까요?\n폰이 다음에 동기화할 때 고객 연락처가 모두 사라집니다. 폰 설정에서 "업무폰" 연락처 계정도 지워 주세요.')) return
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
            <strong>서버, 사용자 이름, 암호</strong>를 위 정보로 붙여 넣고, 설명은 <strong>업무폰</strong>으로 적은 뒤
            <strong> 다음</strong>을 누릅니다.
          </li>
          <li>연락처 앱 → 왼쪽 위 <strong>목록</strong>에 "업무폰 고객"이 보이면 완료입니다. 처음에는 몇 분 걸릴 수 있습니다.</li>
          <li>
            <strong>설정 → 앱 → 연락처 → 기본 계정</strong>은 <strong>iCloud</strong>(또는 내 폰)로 두세요. 업무폰 계정은
            읽기 전용이라 여기에 새 연락처를 저장할 수 없습니다.
          </li>
        </ol>
      ) : (
        <ol className="steps">
          <li>
            <strong>DAVx⁵</strong> 앱을 설치합니다. F-Droid에서는 무료, Play 스토어에서는 유료입니다. 나중에 나올 갤럭시용
            업무폰 앱에서는 이 과정 없이 바로 표시됩니다.
          </li>
          <li>위에서 <strong>켜기</strong>를 눌러 접속 정보를 만듭니다.</li>
          <li>
            DAVx⁵에서 <strong>+ → URL 및 사용자 이름으로 로그인</strong>을 고르고, 기본 URL에 <strong>서버</strong>, 그리고
            사용자 이름과 암호를 붙여 넣습니다.
          </li>
          <li>계정 이름을 <strong>업무폰</strong>으로 만들고, CardDAV 탭에서 <strong>업무폰 고객</strong>을 체크합니다.</li>
          <li>삼성 연락처 앱에서 고객이 "[업무] 이름"으로 보이면 완료입니다.</li>
        </ol>
      )}

      <p className="notice small">
        ⚠️ <strong>카카오톡 자동 친구 추가</strong>를 끄세요. 켜져 있으면 고객이 카카오톡 친구로 자동 추가될 수 있습니다.
        카카오톡 → 설정 → 친구 → <strong>자동 친구 추가</strong> 끄기.
      </p>
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
      prompt(`${label} (길게 눌러 복사하세요)`, value)
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
