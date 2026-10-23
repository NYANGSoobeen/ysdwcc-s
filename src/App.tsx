import type { User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { logOutAndWipe } from './auth.ts'
import { useAuthUser, useProfile, useTeam } from './hooks.ts'
import { ChatPage } from './pages/ChatPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { UsagePage } from './pages/UsagePage.tsx'

const REMOVED_NOTICE = '팀에서 제외되어 더 이상 사용할 수 없습니다. 이 기기에 남은 팀 데이터를 지웠습니다.'

export function App() {
  const { user, loading } = useAuthUser()
  if (loading) return <Loading />
  if (!user) return <LoginPage />
  return <SignedIn key={user.uid} user={user} />
}

type Tab = 'chat' | 'members' | 'usage' | 'profile'

function SignedIn({ user }: { user: User }) {
  const { profile, missing } = useProfile(user.uid)
  const [selectedTeamId, setSelectedTeamId] = useState<string>()
  const teamIds = profile?.teamIds ?? []
  const teamId = selectedTeamId && teamIds.includes(selectedTeamId) ? selectedTeamId : teamIds[0]
  const { team, denied } = useTeam(teamId)
  const [tab, setTab] = useState<Tab>('chat')

  // 모든 팀에서 제외되면 이 기기의 데이터를 지우고 로그아웃한다.
  const removed = missing || (profile !== null && teamIds.length === 0)
  useEffect(() => {
    if (removed) void logOutAndWipe(REMOVED_NOTICE)
  }, [removed])

  if (removed) return <Loading message="로그아웃하는 중…" />
  if (denied) return <Loading message="팀 정보를 확인하는 중…" />
  if (!profile || !team) return <Loading />

  const myRole = team.members[user.uid]
  const isAdmin = myRole === 'admin'
  const current = tab === 'usage' && !isAdmin ? 'chat' : tab

  return (
    <div className="shell">
      <div className="shell-body">
        {current === 'chat' && <ChatPage team={team} uid={user.uid} />}
        {current === 'members' && <MembersPage team={team} uid={user.uid} />}
        {current === 'usage' && <UsagePage team={team} />}
        {current === 'profile' && (
          <ProfilePage
            user={user}
            profile={profile}
            team={team}
            onSelectTeam={setSelectedTeamId}
          />
        )}
      </div>
      <nav className="tabbar">
        <TabButton active={current === 'chat'} onClick={() => setTab('chat')} icon="💬" label="채팅" />
        <TabButton active={current === 'members'} onClick={() => setTab('members')} icon="👥" label="팀원" />
        {isAdmin && (
          <TabButton active={current === 'usage'} onClick={() => setTab('usage')} icon="📦" label="용량" />
        )}
        <TabButton active={current === 'profile'} onClick={() => setTab('profile')} icon="⚙️" label="내 정보" />
      </nav>
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      type="button"
      className={props.active ? 'tab active' : 'tab'}
      onClick={props.onClick}
      aria-current={props.active ? 'page' : undefined}
    >
      <span aria-hidden="true">{props.icon}</span>
      {props.label}
    </button>
  )
}

export function Loading({ message = '불러오는 중…' }: { message?: string }) {
  return <div className="center muted">{message}</div>
}
