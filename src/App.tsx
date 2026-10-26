import type { User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { logOutAndWipe, rememberDisabledReason, toLoginId } from './auth.ts'
import { MAIN_CHANNEL, useChannels } from './chat.ts'
import { useAuthUser, useMemberProfiles, useProfile, useTeam, useTeamNames } from './hooks.ts'
import { useMentionAlerts } from './useMentionAlerts.ts'
import { badgeText, useUnreadCounts } from './reads.ts'
import { MenuBadgeContext, MenuContext, MenuDrawer, Sidebar, type Tab } from './menu.tsx'
import { useNativeContactsSync } from './native.ts'
import { AdminPage } from './pages/AdminPage.tsx'
import { ChatPage, promptCreateChannel } from './pages/ChatPage.tsx'
import { CustomersPage } from './pages/CustomersPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { PasswordForm } from './pages/PasswordForm.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { SchedulePage } from './pages/SchedulePage.tsx'
import { UsagePage } from './pages/UsagePage.tsx'
import { IDLE_NOTICE, rememberSignedIn, wasSignedIn, watchIdle } from './session.ts'
import { SearchContext } from './ui/search.tsx'
import { useIsDesktop } from './useMedia.ts'

const TEAM_KEY = 'selected-team'

function savedTeam() {
  try {
    return localStorage.getItem(TEAM_KEY) ?? undefined
  } catch {
    return undefined
  }
}

// F5(새로 고침)를 눌러도 보던 화면을 유지한다. 앱을 새로 열면(세션이 바뀌면) 첫 화면부터.
const TAB_KEY = 'current-tab'
const TABS: Tab[] = ['customers', 'chat', 'schedule', 'members', 'admin', 'usage', 'profile']

function savedTab(): Tab {
  try {
    const tab = sessionStorage.getItem(TAB_KEY) as Tab | null
    if (tab && TABS.includes(tab)) return tab
  } catch {
    // 기억하지 못하면 첫 화면
  }
  return 'customers'
}

const CHANNEL_KEY = 'chat-channel'

function savedChannel() {
  try {
    const [teamId, id] = (sessionStorage.getItem(CHANNEL_KEY) ?? '').split(':')
    return teamId ? { teamId, id: id || null } : null
  } catch {
    return null
  }
}

const REMOVED_NOTICE = '팀에서 제외되어 더 이상 사용할 수 없습니다. 이 기기에 남은 팀 데이터를 지웠습니다.'

const SIGNED_OUT_NOTICE = '로그인이 끊겼습니다 (로그인 만료 또는 계정 사용 중지). 다시 로그인해 주세요.'

export function App() {
  const { user, loading } = useAuthUser()
  // 로그아웃 버튼을 누르지 않았는데 로그인이 풀렸으면(계정 사용 중지, 비밀번호 초기화 등)
  // 이 기기에 남은 팀 데이터를 지운다.
  const lost = !loading && !user && wasSignedIn()
  useEffect(() => {
    if (lost) void logOutAndWipe(SIGNED_OUT_NOTICE)
  }, [lost])
  if (loading || lost) return <Loading />
  if (!user) return <LoginPage />
  return <SignedIn key={user.uid} user={user} />
}

function disabledNotice(reason: string | undefined) {
  return `관리자가 계정 사용을 중지했습니다.${reason ? `\n이유: ${reason}` : ''}\n이 기기에 남은 팀 데이터를 지웠습니다.`
}

function SignedIn({ user }: { user: User }) {
  const { profile, missing } = useProfile(user.uid)
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(savedTeam)
  const teamIds = profile?.teamIds ?? []
  const teamId = selectedTeamId && teamIds.includes(selectedTeamId) ? selectedTeamId : teamIds[0]
  const { team, denied } = useTeam(teamId)
  const channels = useChannels(team?.id)
  const memberProfiles = useMemberProfiles(Object.keys(team?.members ?? {}))
  const memberNames = Object.fromEntries(Object.entries(memberProfiles).map(([id, p]) => [id, p.name]))
  const teamNames = useTeamNames(teamIds)
  const [tab, setTabState] = useState<Tab>(savedTab)
  const [menuOpen, setMenuOpen] = useState(false)
  const [queries, setQueries] = useState<Partial<Record<Tab, string>>>({})
  // 보고 있는 채팅방 (F5 후에도 유지). 휴대폰에서 null이면 채팅방 목록.
  const [channelState, setChannelState] = useState<{ teamId: string; id: string | null } | null>(savedChannel)
  const [searchFocused, setSearchFocused] = useState(false)
  const desktop = useIsDesktop()

  function setTab(next: Tab) {
    setTabState(next)
    setSearchFocused(false)
    try {
      sessionStorage.setItem(TAB_KEY, next)
    } catch {
      // 기억하지 못해도 동작에는 문제없다.
    }
  }

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

  useEffect(() => rememberSignedIn(user.uid), [user.uid])

  // 공용 컴퓨터(PC): 15분 넘게 앱을 닫아 두었으면 다시 로그인하게 한다.
  useEffect(() => watchIdle(() => void logOutAndWipe(IDLE_NOTICE)), [])

  // 보고 있는 채팅방 (휴대폰에서 null이면 방 목록)
  const channelId = team && channelState?.teamId === team.id ? channelState.id : null
  const roomId = channels?.some((c) => c.id === channelId) ? channelId : desktop ? MAIN_CHANNEL : null
  function openChannel(id: string | null) {
    if (!team) return
    setChannelState({ teamId: team.id, id })
    setQueries((prev) => ({ ...prev, chat: '' }))
    setTab('chat')
    try {
      sessionStorage.setItem(CHANNEL_KEY, `${team.id}:${id ?? ''}`)
    } catch {
      // 기억하지 못해도 동작에는 문제없다.
    }
  }

  // "○○님이 나를 불렀어요" (지금 그 방을 보고 있으면 알리지 않음)
  useMentionAlerts({
    teamId: team?.id,
    channels,
    uid: user.uid,
    names: memberNames,
    viewing: tab === 'chat' ? roomId : null,
    onOpen: openChannel,
  })

  // 방마다 안 읽은 메시지 수 (방 목록, 메뉴, ☰, 아래 채팅 탭에 표시)
  const unread = useUnreadCounts(team?.id, channels, user.uid, tab === 'chat' ? roomId : null)
  const unreadTotal = Object.values(unread).reduce((a, b) => a + b, 0)

  // 모든 팀에서 제외되면 이 기기의 데이터를 지우고 로그아웃한다.
  const removed = missing || (profile !== null && teamIds.length === 0)
  // 관리자가 사용 중지하면 바로 로그아웃하고 로그인 화면에 이유를 보여 준다.
  const disabled = profile?.active === false
  useEffect(() => {
    if (disabled) {
      rememberDisabledReason(user.email ?? '', profile?.disabledReason ?? '')
      void logOutAndWipe(disabledNotice(profile?.disabledReason))
    } else if (removed) void logOutAndWipe(REMOVED_NOTICE)
  }, [removed, disabled, profile?.disabledReason, user.email])

  if (removed || disabled) return <Loading message="로그아웃하는 중…" />
  // 임시 비밀번호(새 계정, 관리자가 초기화)로 들어오면 먼저 비밀번호를 바꾼다.
  if (profile?.mustChangePassword) return <FirstPassword name={profile.name} loginId={toLoginId(user.email)} />
  if (denied) return <Loading message="팀 정보를 확인하는 중…" />
  if (!profile || !team) return <Loading />

  // 용량 관리는 최고 관리자만 본다 (서버 함수도 최고 관리자만 허용).
  const superAdmin = profile.superAdmin === true
  // 관리자 화면은 이 팀의 관리자만 (팀을 바꿨는데 그 팀 관리자가 아니면 고객 화면으로)
  const isAdmin = team.members[user.uid] === 'admin'
  const current = (tab === 'usage' && !superAdmin) || (tab === 'admin' && !isAdmin) ? 'customers' : tab

  const teamSelect =
    teamIds.length > 1 ? (
      <label className="team-select">
        <span className="muted small">팀</span>
        <select value={team.id} onChange={(e) => selectTeam(e.target.value)} aria-label="팀 바꾸기">
          {teamIds.map((id) => (
            <option key={id} value={id}>
              {teamNames[id] || '…'}
            </option>
          ))}
        </select>
      </label>
    ) : null
  const canWrite = team.members[user.uid] !== 'viewer'
  const menuProps = {
    current,
    isAdmin,
    superAdmin,
    teamName: team.name,
    userName: profile.name,
    onSelect: setTab,
    chatRooms: channels ?? [],
    currentRoom: current === 'chat' ? (roomId ?? null) : null,
    onSelectRoom: openChannel,
    unread,
    onCreateRoom: canWrite
      ? async () => {
          const id = await promptCreateChannel(team.id)
          if (id) openChannel(id)
        }
      : undefined,
  }
  const search = {
    query: queries[current] ?? '',
    setQuery: (query: string) => setQueries((prev) => ({ ...prev, [current]: query })),
    setFocused: setSearchFocused,
  }
  // 휴대폰: 검색칸을 누르고 있는 동안 아래 탭과 채팅 입력칸을 숨겨 검색 결과를 넓게 본다.
  const searching = !desktop && searchFocused

  return (
    <MenuContext.Provider value={() => setMenuOpen(true)}>
     <MenuBadgeContext.Provider value={unreadTotal}>
     <SearchContext.Provider value={search}>
      <div className={`shell${desktop ? ' desktop' : ''}${searching ? ' searching' : ''}`}>
        {desktop && <Sidebar {...menuProps}>{teamSelect}</Sidebar>}
        <div className="shell-main">
          {!desktop && teamSelect && <div className="teambar">{teamSelect}</div>}
          <div className="shell-body">
            {current === 'customers' && <CustomersPage team={team} uid={user.uid} desktop={desktop} />}
            {current === 'chat' && (
              <ChatPage
                team={team}
                uid={user.uid}
                channels={channels}
                channelId={roomId}
                desktop={desktop}
                unread={unread}
                onOpenChannel={openChannel}
              />
            )}
            {current === 'schedule' && <SchedulePage team={team} uid={user.uid} />}
            {current === 'members' && <MembersPage team={team} uid={user.uid} onOpenAdmin={() => setTab('admin')} />}
            {current === 'admin' && (
              <AdminPage
                team={team}
                uid={user.uid}
                superAdmin={superAdmin}
                teamIds={teamIds}
                onSelectTeam={selectTeam}
                onOpenUsage={() => setTab('usage')}
              />
            )}
            {current === 'usage' && <UsagePage team={team} />}
            {current === 'profile' && <ProfilePage user={user} profile={profile} team={team} />}
          </div>
          {!desktop && (
            <nav className="tabbar">
              <TabButton active={current === 'customers'} onClick={() => setTab('customers')} icon="📇" label="고객" />
              <TabButton
                active={current === 'chat'}
                // 채팅방 안에서 한 번 더 누르면 방 목록으로
                onClick={() => (current === 'chat' ? openChannel(null) : setTab('chat'))}
                icon="💬"
                label="채팅"
                badge={unreadTotal}
              />
              <TabButton active={current === 'schedule'} onClick={() => setTab('schedule')} icon="📅" label="스케줄" />
              <TabButton active={current === 'members'} onClick={() => setTab('members')} icon="👥" label="팀원" />
              <TabButton active={current === 'profile'} onClick={() => setTab('profile')} icon="⚙️" label="내 정보" />
            </nav>
          )}
        </div>
        {!desktop && <MenuDrawer {...menuProps} open={menuOpen} onClose={() => setMenuOpen(false)} />}
      </div>
     </SearchContext.Provider>
     </MenuBadgeContext.Provider>
    </MenuContext.Provider>
  )
}

function FirstPassword({ name, loginId }: { name: string; loginId: string }) {
  return (
    <main className="login">
      <div className="login-brand">
        <img src="/icons/icon-192.png" alt="" />
        <h1>비밀번호 정하기</h1>
      </div>
      <PasswordForm
        title={`${name || loginId}님, 환영합니다`}
        intro={
          <p className="muted small">
            관리자가 알려 준 임시 비밀번호로 로그인했습니다. 앞으로 쓸 비밀번호를 정해 주세요.
          </p>
        }
        currentLabel="임시 비밀번호"
      />
      <button type="button" className="link" onClick={() => void logOutAndWipe()}>
        로그아웃
      </button>
    </main>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; icon: string; label: string; badge?: number }) {
  return (
    <button
      type="button"
      className={props.active ? 'tab active' : 'tab'}
      onClick={props.onClick}
      aria-current={props.active ? 'page' : undefined}
    >
      <span aria-hidden="true" className="tab-icon">
        {props.icon}
        {(props.badge ?? 0) > 0 && <span className="badge on-icon">{badgeText(props.badge!)}</span>}
      </span>
      {props.label}
    </button>
  )
}

export function Loading({ message = '불러오는 중…' }: { message?: string }) {
  return <div className="center muted">{message}</div>
}
