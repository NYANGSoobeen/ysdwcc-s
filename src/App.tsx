import type { User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { logOutAndWipe } from './auth.ts'
import { useAuthUser, useProfile, useTeam, useTeamNames } from './hooks.ts'
import { useNativeContactsSync } from './native.ts'
import { ChatPage } from './pages/ChatPage.tsx'
import { CustomersPage } from './pages/CustomersPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { UsagePage } from './pages/UsagePage.tsx'

const TEAM_KEY = 'selected-team'

function savedTeam() {
  try {
    return localStorage.getItem(TEAM_KEY) ?? undefined
  } catch {
    return undefined
  }
}

const REMOVED_NOTICE = '팀에서 제외되어 더 이상 사용할 수 없습니다. 이 기기에 남은 팀 데이터를 지웠습니다.'

export function App() {
  const { user, loading } = useAuthUser()
  if (loading) return <Loading />
  if (!user) return <LoginPage />
  return <SignedIn key={user.uid} user={user} />
}

type Tab = 'customers' | 'chat' | 'members' | 'usage' | 'profile'

function SignedIn({ user }: { user: User }) {
  const { profile, missing } = useProfile(user.uid)
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(savedTeam)
  const teamIds = profile?.teamIds ?? []
  const teamId = selectedTeamId && teamIds.includes(selectedTeamId) ? selectedTeamId : teamIds[0]
  const { team, denied } = useTeam(teamId)
  const teamNames = useTeamNames(teamIds)
  const [tab, setTab] = useState<Tab>('customers')

  function selectTeam(id: string) {
    setSelectedTeamId(id)
    try {
      localStorage.setItem(TEAM_KEY, id)
    } catch {
      // 기억하지 못해도 동작에는 문제없다.
    }
  }

  // 최고 관리자 표시가 생기기 전에 만든 관리자 계정은 서버에 한 번 물어 표시를 받는다.
  const myRoleHere = team?.members[user.uid]
  useEffect(() => {
    if (profile && profile.superAdmin === undefined && myRoleHere === 'admin') {
      api.getMyAccess().catch(() => {})
    }
  }, [profile, myRoleHere])

  // 갤럭시 앱: 폰 연락처의 "지원팀" 계정을 내 모든 팀의 고객과 맞춘다.
  useNativeContactsSync(teamIds)

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
  const current = tab === 'usage' && !isAdmin ? 'customers' : tab

  return (
    <div className="shell">
      {teamIds.length > 1 && (
        <div className="teambar">
          <label>
            <span className="muted small">팀</span>
            <select value={team.id} onChange={(e) => selectTeam(e.target.value)} aria-label="팀 바꾸기">
              {teamIds.map((id) => (
                <option key={id} value={id}>
                  {teamNames[id] || '…'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="shell-body">
        {current === 'customers' && <CustomersPage team={team} uid={user.uid} />}
        {current === 'chat' && <ChatPage team={team} uid={user.uid} />}
        {current === 'members' && (
          <MembersPage team={team} uid={user.uid} superAdmin={profile.superAdmin === true} onSelectTeam={selectTeam} />
        )}
        {current === 'usage' && <UsagePage team={team} />}
        {current === 'profile' && (
          <ProfilePage user={user} profile={profile} team={team} />
        )}
      </div>
      <nav className="tabbar">
        <TabButton active={current === 'customers'} onClick={() => setTab('customers')} icon="📇" label="고객" />
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
