import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { errorMessage, logIn, takeLoginNotice, toEmail } from '../auth.ts'
import { sharedComputer } from '../firebase.ts'
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
    <main className="login">
      <div className="login-brand">
        <img src="/icons/icon-192.png" alt="" />
        <h1>양산동원 지원팀</h1>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {needsSetup ? <SetupForm /> : <LoginForm />}
    </main>
  )
}

function LoginForm() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await logIn(loginId, password)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>
        아이디
        <input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
      </label>
      <label>
        비밀번호
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? '로그인 중…' : '로그인'}
      </button>
      <p className="muted small">계정은 팀 관리자가 만들어 줍니다. 비밀번호를 잊으면 관리자에게 초기화를 요청하세요.</p>
      {sharedComputer && (
        <p className="muted small">
          공용 컴퓨터 보호: 브라우저를 닫거나 15분 넘게 앱을 닫아 두면 자동으로 로그아웃됩니다.
        </p>
      )}
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
