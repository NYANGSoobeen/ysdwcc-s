import { useState, type FormEvent, type ReactNode } from 'react'
import { changePassword, errorMessage } from '../auth.ts'
import { auth } from '../firebase.ts'
import { PASSWORD_HINT, passwordProblem } from '../password.ts'

// 비밀번호 바꾸기 (내 정보, 처음 로그인할 때 임시 비밀번호 바꾸기)
export function PasswordForm(props: { title: string; intro?: ReactNode; currentLabel?: string; onDone?: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmNext, setConfirmNext] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = next ? passwordProblem(next, auth.currentUser?.email ?? '') : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (problem) return setMessage(problem)
    if (next !== confirmNext) return setMessage('새 비밀번호가 서로 다릅니다.')
    setBusy(true)
    setMessage('')
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirmNext('')
      setMessage('비밀번호를 바꿨습니다.')
      props.onDone?.()
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>{props.title}</h3>
      {props.intro}
      <label>
        {props.currentLabel ?? '지금 비밀번호'}
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        새 비밀번호
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
      </label>
      <p className={!next ? 'rule-check muted' : problem ? 'rule-check error' : 'rule-check ok'}>
        {next ? (problem ?? '✓ 쓸 수 있는 비밀번호입니다.') : PASSWORD_HINT}
      </p>
      <label>
        새 비밀번호 확인
        <input type="password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} autoComplete="new-password" required />
      </label>
      {message && <p className="notice">{message}</p>}
      <button className="primary" disabled={busy}>{busy ? '바꾸는 중…' : '바꾸기'}</button>
    </form>
  )
}
