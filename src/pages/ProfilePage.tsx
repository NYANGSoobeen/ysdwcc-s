import type { User } from 'firebase/auth'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { useEffect, useState, type FormEvent } from 'react'
import { ROLE_LABELS } from '../api.ts'
import { changePassword, errorMessage, logOutAndWipe, toLoginId } from '../auth.ts'
import { db } from '../firebase.ts'
import { ContactsSync } from './ContactsSync.tsx'
import type { Profile, Team } from '../hooks.ts'

type Props = {
  user: User
  profile: Profile
  team: Team
  onSelectTeam: (teamId: string) => void
}

export function ProfilePage({ user, profile, team, onSelectTeam }: Props) {
  return (
    <div className="page">
      <header className="page-header">
        <span />
        <h2>내 정보</h2>
        <span />
      </header>
      <div className="page-body">
        <section className="card">
          <NameForm uid={user.uid} name={profile.name} />
          <dl className="stats">
            <div><dt>아이디</dt><dd>{toLoginId(user.email)}</dd></div>
            <div><dt>팀</dt><dd>{team.name}</dd></div>
            <div><dt>권한</dt><dd>{ROLE_LABELS[team.members[user.uid]]}</dd></div>
          </dl>
          {profile.teamIds.length > 1 && (
            <TeamSwitcher teamIds={profile.teamIds} current={team.id} onSelect={onSelectTeam} />
          )}
        </section>
        <ContactsSync uid={user.uid} />
        <PasswordForm />
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            if (confirm('로그아웃할까요? 이 기기에 저장된 팀 데이터가 지워집니다.')) void logOutAndWipe()
          }}
        >
          로그아웃
        </button>
        <p className="muted small center">버전 {__APP_VERSION__}</p>
      </div>
    </div>
  )
}

function NameForm({ uid, name }: { uid: string; name: string }) {
  const [value, setValue] = useState(name)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await updateDoc(doc(db, 'users', uid), { name: value.trim() })
      setSaved(true)
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        이름
        <input value={value} onChange={(e) => { setValue(e.target.value); setSaved(false) }} maxLength={30} required />
      </label>
      <button disabled={!value.trim() || value.trim() === name}>{saved ? '저장됨' : '저장'}</button>
    </form>
  )
}

function TeamSwitcher({ teamIds, current, onSelect }: { teamIds: string[]; current: string; onSelect: (id: string) => void }) {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    void Promise.all(teamIds.map((id) => getDoc(doc(db, 'teams', id)).catch(() => null))).then((snaps) =>
      setNames(Object.fromEntries(snaps.flatMap((s) => (s?.exists() ? [[s.id, s.get('name') as string]] : [])))),
    )
  }, [teamIds])
  return (
    <label className="form">
      팀 바꾸기
      <select value={current} onChange={(e) => onSelect(e.target.value)}>
        {teamIds.map((id) => (
          <option key={id} value={id}>{names[id] ?? '…'}</option>
        ))}
      </select>
    </label>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmNext, setConfirmNext] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (next !== confirmNext) return setMessage('새 비밀번호가 서로 다릅니다.')
    setBusy(true)
    setMessage('')
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirmNext('')
      setMessage('비밀번호를 바꿨습니다.')
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>비밀번호 바꾸기</h3>
      <label>
        지금 비밀번호
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        새 비밀번호 (6자 이상)
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={6} required />
      </label>
      <label>
        새 비밀번호 확인
        <input type="password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} autoComplete="new-password" required />
      </label>
      {message && <p className="notice">{message}</p>}
      <button disabled={busy}>{busy ? '바꾸는 중…' : '바꾸기'}</button>
    </form>
  )
}
