import type { User } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'
import { ROLE_LABELS } from '../api.ts'
import { errorMessage, logOutAndWipe, toLoginId } from '../auth.ts'
import { PasswordForm } from './PasswordForm.tsx'
import { ask, toast } from '../ui/dialogs.tsx'
import { db } from '../firebase.ts'
import { ContactsSync } from './ContactsSync.tsx'
import { InstallCard } from './InstallCard.tsx'
import { PushCard } from './PushCard.tsx'
import type { Profile, Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'

type Props = {
  user: User
  profile: Profile
  team: Team
}

export function ProfilePage({ user, profile, team }: Props) {
  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>내 정보</h2>
        <span />
      </header>
      <div className="page-body two-col">
        <div className="col">
        <InstallCard />
        <PushCard />
        <section className="card">
          <NameForm uid={user.uid} name={profile.name} />
          <dl className="stats">
            <div><dt>아이디</dt><dd>{toLoginId(user.email)}</dd></div>
            <div><dt>팀</dt><dd>{team.name}</dd></div>
            <div><dt>권한</dt><dd>{profile.superAdmin ? '최고 관리자 (모든 팀)' : ROLE_LABELS[team.members[user.uid]]}</dd></div>
          </dl>
        </section>
        <PasswordForm title="비밀번호 바꾸기" />
        </div>
        <div className="col">
        <ContactsSync uid={user.uid} />
        <button
          type="button"
          className="danger-button"
          onClick={async () => {
            if (await ask({ message: '로그아웃할까요? 이 기기에 저장된 팀 데이터가 지워집니다.', ok: '로그아웃' })) void logOutAndWipe()
          }}
        >
          로그아웃
        </button>
        <p className="muted small center">버전 {__APP_VERSION__}</p>
        </div>
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
      toast(errorMessage(err), { error: true })
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

