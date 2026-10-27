import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { errorMessage, logIn, takeLoginNotice, toEmail } from '../auth.ts'
import { isNativeApp, keepSignedIn } from '../firebase.ts'
import { PASSWORD_HINT, passwordProblem } from '../password.ts'

// 페이지를 열 때 한 번만 읽는다 (읽으면 지워지므로 렌더링마다 읽으면 안 된다).
const notice = takeLoginNotice()

export function LoginPage() {
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    // 오프라인 등으로 확인하지 못하면 일반 로그인 화면을 보여 준다.
    api.setupStatus().then((s) => setNeedsSetup(s.needsSetup), () => {})
  }, [])

  return (
    // 프론트 앱과 같은 모양: 가운데 카드(⛳ · 이름 · 안내 · 입력칸 · 로그인), 색만 우리 앱 색
    <main className="login login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo" aria-hidden="true">
            ⛳
          </span>
          <h1>양산동원로얄CC 지원팀</h1>
          <p className="login-sub">{needsSetup ? '처음 시작하기: 첫 관리자와 팀을 만들어요' : '관리자가 등록한 직원만 로그인할 수 있어요'}</p>
        </div>
        {notice && <p className="notice">{notice}</p>}
        {needsSetup ? <SetupForm /> : <LoginForm />}
      </div>
    </main>
  )
}

// 아이디 저장: 이 기기(브라우저)에만 아이디를 기억한다. 비밀번호는 저장하지 않는다.
const SAVED_ID_KEY = 'saved-login-id'

function savedLoginId() {
  try {
    return localStorage.getItem(SAVED_ID_KEY)
  } catch {
    return null
  }
}

function saveLoginId(loginId: string | null) {
  try {
    if (loginId) localStorage.setItem(SAVED_ID_KEY, loginId)
    else localStorage.removeItem(SAVED_ID_KEY)
  } catch {
    // 저장소를 못 쓰면 매번 입력한다.
  }
}

function LoginForm() {
  const [loginId, setLoginId] = useState(() => savedLoginId() ?? '')
  const [remember, setRemember] = useState(() => savedLoginId() !== null)
  const [keep, setKeep] = useState(keepSignedIn)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await logIn(loginId, password, keep)
      saveLoginId(remember ? loginId.trim() : null)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <input
        aria-label="아이디"
        placeholder="아이디"
        value={loginId}
        onChange={(e) => setLoginId(e.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoFocus={!loginId}
        required
      />
      <input
        aria-label="비밀번호"
        placeholder="비밀번호"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        autoFocus={Boolean(loginId)}
        required
      />
      <div className="login-checks">
        {!isNativeApp && (
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            로그인 유지
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          아이디 저장
        </label>
      </div>
      {!isNativeApp && (
        <p className="login-hint">
          <span aria-hidden="true">🔒</span>{' '}
          {keep
            ? '로그아웃할 때까지 로그인이 유지돼요. 여러 사람이 쓰는 컴퓨터에서는 꺼 주세요.'
            : '브라우저를 닫거나 15분 넘게 앱을 닫아 두면 자동으로 로그아웃돼요.'}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary login-submit" disabled={busy}>
        {busy ? '로그인 중…' : '로그인'}
      </button>
      <p className="login-foot">아이디나 비밀번호를 잊었다면 관리자에게 초기화를 요청하세요.</p>
    </form>
  )
}

// 프로젝트에 팀이 하나도 없을 때만 보이는 첫 관리자 만들기
function SetupForm() {
  const [form, setForm] = useState({ teamName: '', name: '', loginId: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(form.password, form.loginId)
    if (problem) return setError(problem)
    if (form.password !== form.confirm) return setError('비밀번호가 서로 다릅니다.')
    setBusy(true)
    setError('')
    try {
      await api.createFirstAdmin({
        teamName: form.teamName,
        name: form.name,
        email: toEmail(form.loginId),
        password: form.password,
      })
      await logIn(form.loginId, form.password)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <p>
        <strong>처음 시작하기</strong>
        <br />
        <span className="muted small">팀과 관리자 계정을 만듭니다. 이 화면은 처음 한 번만 나옵니다.</span>
      </p>
      <label>
        팀 이름
        <input value={form.teamName} onChange={set('teamName')} placeholder="예: 영업1팀" required />
      </label>
      <label>
        내 이름
        <input value={form.name} onChange={set('name')} required />
      </label>
      <label>
        아이디
        <input value={form.loginId} onChange={set('loginId')} autoCapitalize="none" required />
      </label>
      <label>
        비밀번호
        <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
      </label>
      <p className="rule-check muted">{PASSWORD_HINT}</p>
      <label>
        비밀번호 확인
        <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? '만드는 중…' : '팀 만들고 시작하기'}
      </button>
    </form>
  )
}
