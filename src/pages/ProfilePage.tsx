import type { User } from 'firebase/auth'
import { useState } from 'react'
import { ROLE_LABELS } from '../api.ts'
import { logOutAndWipe, toLoginId } from '../auth.ts'
import { PasswordForm } from './PasswordForm.tsx'
import { ask } from '../ui/dialogs.tsx'
import { AvatarFace } from '../ui/Avatar.tsx'
import { ProfileEditor } from './ProfileEditor.tsx'
import { ContactsSync } from './ContactsSync.tsx'
import { InstallCard } from './InstallCard.tsx'
import { PushCard } from './PushCard.tsx'
import { OffDayCard } from './OffDayCard.tsx'
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
        <h2>👤 내 정보</h2>
        <span />
      </header>
      <div className="page-body two-col">
        <div className="col">
        <InstallCard />
        <PushCard />
        <section className="card">
          <ProfileSummary uid={user.uid} profile={profile} />
          <dl className="stats">
            <div><dt>아이디</dt><dd>{toLoginId(user.email)}</dd></div>
            <div><dt>팀</dt><dd>{team.name}</dd></div>
            <div><dt>권한</dt><dd>{profile.superAdmin ? '최고 관리자 (모든 팀)' : ROLE_LABELS[team.members[user.uid]]}</dd></div>
          </dl>
        </section>
        <PasswordForm title="비밀번호 바꾸기" />
        </div>
        <div className="col">
        <OffDayCard uid={user.uid} profile={profile} />
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

// 👤 내 프로필: 사진·이름·직급, ✏️ 누르면 바꾸기 창
function ProfileSummary({ uid, profile }: { uid: string; profile: Profile }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="profile-summary">
      <AvatarFace uid={uid} name={profile.name || '나'} avatar={profile.avatar} className="big" />
      <div>
        <strong className="me-name">{profile.name || '이름 없음'}</strong>
        <span className="muted">{profile.position || '직급 없음'}</span>
      </div>
      <button type="button" onClick={() => setEditing(true)}>
        ✏️ 프로필 수정
      </button>
      {editing && <ProfileEditor uid={uid} profile={profile} onClose={() => setEditing(false)} />}
    </div>
  )
}
