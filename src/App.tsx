import type { User } from 'firebase/auth'
import { collection, doc, getDocs, limit, query, updateDoc, where } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ROLE_LABELS } from './api.ts'
import { logOutAndWipe, rememberDisabledReason, toLoginId } from './auth.ts'
import { MAIN_CHANNEL, useChannels } from './chat.ts'
import { db } from './firebase.ts'
import { useAllTeamIds, useAuthUser, useMemberProfiles, useProfile, useSeenStamp, useSuperAdminUids, useSuperClaim, useTeam, useTeamNames, teamPeople } from './hooks.ts'
import { useMentionAlerts } from './useMentionAlerts.ts'
import { useUnreadCounts } from './reads.ts'
import { FrontChatPage } from './front/FrontChatPage.tsx'
import { resumeFront, useFront, useFrontUnread } from './front/ydr.ts'
import { frontTag, listenOpenRequests, refreshPush, roomTag, setBadge, startPushHeartbeat, tellViewing, type OpenRequest } from './push.ts'
import { MenuBadgeContext, MenuContext, MenuDrawer, Sidebar, type Tab } from './menu.tsx'
import { useNativeContactsAutoOn, useNativeContactsSync } from './native.ts'
import { isPcDevice, usePhoneBadges, usePrefetchPhoneNames } from './phone.ts'
import { useAlertKinds, useAlertsSync } from './phoneAlerts.ts'
import { normalizePhone } from './customers.ts'
import { useOffDaySync } from './offday.ts'
import { AdminPage } from './pages/AdminPage.tsx'
import { ApkUpdateBanner } from './ApkUpdateBanner.tsx'
import { StaffPage } from './pages/StaffPage.tsx'
import { ChatPage, promptCreateChannel } from './pages/ChatPage.tsx'
import { CustomersPage } from './pages/CustomersPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { CallMemoWatcher } from './pages/CallMemo.tsx'
import { MessagesPage, openSmsTo } from './pages/MessagesPage.tsx'
import { PhonePage } from './pages/PhonePage.tsx'
import { NoticesPage } from './pages/NoticesPage.tsx'
import { MembersPage } from './pages/MembersPage.tsx'
import { PasswordForm } from './pages/PasswordForm.tsx'
import { ProfilePage } from './pages/ProfilePage.tsx'
import { AlertsPage } from './pages/AlertsPage.tsx'
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
const TABS: Tab[] = ['notices', 'customers', 'phone', 'messages', 'chat', 'front', 'schedule', 'members', 'staff', 'admin', 'usage', 'profile', 'alerts']

function savedTab(): Tab {
  try {
    const tab = sessionStorage.getItem(TAB_KEY) as Tab | null
    if (tab && TABS.includes(tab)) return tab
  } catch {
    // 기억하지 못하면 첫 화면
  }
  return 'notices'
}

const CHANNEL_KEY = 'chat-channel'
const FRONT_ROOM_KEY = 'front-room'

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
  useSeenStamp(user.uid, profile)
  // 고른 팀: 이 화면에서 고른 것 → 계정에 기억한 것(다른 기기에서 고른 것도) → 이 기기에 기억한 것 → 첫 팀
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>()
  // 내가 속한 팀 (연락처 표시·휴무일처럼 "내 팀"이 필요한 곳)
  const myTeamIds = profile?.teamIds ?? []
  // 👑 최고 관리자는 속하지 않아도 모든 팀을 본다 (로그인 토큰 표시가 준비된 뒤)
  const isSuper = profile?.superAdmin === true
  const superReady = useSuperClaim(user, isSuper)
  const allTeamIds = useAllTeamIds(isSuper && superReady)
  const teamIds = isSuper && allTeamIds ? allTeamIds : myTeamIds
  // 다른 기기에서 팀을 바꾸면 여기도 따라간다.
  const accountTeam = profile?.settings?.team
  useEffect(() => setSelectedTeamId(undefined), [accountTeam])
  const teamId = [selectedTeamId, profile?.settings?.team, savedTeam()].find((id) => id && teamIds.includes(id)) ?? teamIds[0]
  const { team: rawTeam, denied } = useTeam(teamId, superReady ? 1 : 0)
  const superUids = useSuperAdminUids()
  const superKey = superUids.join(',')
  const team = useMemo(
    () =>
      rawTeam
        ? {
            ...rawTeam,
            myRole: rawTeam.members[user.uid] ?? (isSuper ? ('admin' as const) : undefined),
            people: [...new Set([...Object.keys(rawTeam.members), ...(superKey ? superKey.split(',') : [])])],
          }
        : null,
    [rawTeam, user.uid, isSuper, superKey],
  )
  const channels = useChannels(team?.id)
  const memberProfiles = useMemberProfiles(team ? teamPeople(team) : [])
  const memberNames = Object.fromEntries(Object.entries(memberProfiles).map(([id, p]) => [id, p.name]))
  const teamNames = useTeamNames(teamIds)
  const [tab, setTabState] = useState<Tab>(savedTab)
  const [menuOpen, setMenuOpen] = useState(false)
  const [queries, setQueries] = useState<Partial<Record<Tab, string>>>({})
  // 보고 있는 채팅방 (F5 후에도 유지). 휴대폰에서 null이면 채팅방 목록.
  const [channelState, setChannelState] = useState<{ teamId: string; id: string | null } | null>(savedChannel)
  const [searchFocused, setSearchFocused] = useState(false)
  const desktop = useIsDesktop()
  // 📞·✉️ 화면을 알림에서 다시 열 때 새로 그리기 (보던 칸·대화를 알림 내용으로)
  const [phoneNonce, setPhoneNonce] = useState(0)
  // 갤럭시 앱: 앱을 열면 통화 기록·문자 목록을 미리 읽고(화면이 빨리 뜨게) 아래 탭 빨간 숫자를 센다
  const alertKindsNow = useAlertKinds()
  const phoneBadges = usePhoneBadges(!desktop, team?.id ?? null, alertKindsNow.personal)
  // 휴대폰: 지금 팀 고객·폰 연락처 이름을 미리 읽어 📞·✉️ 화면의 번호가 바로 이름으로 보이게
  usePrefetchPhoneNames(team?.id ?? null, !desktop)

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
    // PC와 휴대폰이 같은 팀을 보이게 계정에도 기억한다.
    if (profile?.settings?.team !== id) updateDoc(doc(db, 'users', user.uid), { 'settings.team': id }).catch(() => {})
  }

  // 최고 관리자 표시가 생기기 전에 만든 관리자 계정은 서버에 한 번 물어 표시를 받는다.
  const myRoleHere = team?.members[user.uid]
  useEffect(() => {
    if (profile && profile.superAdmin === undefined && myRoleHere === 'admin') {
      api.getMyAccess().catch(() => {})
    }
  }, [profile, myRoleHere])

  // 갤럭시 앱: 폰 연락처의 "지원팀" 계정을 내 모든 팀의 고객과 맞춘다.
  useNativeContactsSync(myTeamIds)
  // 갤럭시 앱은 "휴대폰 연락처에 고객 표시"를 처음부터 켠다 (걸려 온 전화에 고객 이름, 2026-10-30 사용자가 정함)
  useNativeContactsAutoOn()
  // 🔔 전화·문자 알림: 고객 정보를 폰에 맞추고, 처음 한 번 권한을 묻는다 (갤럭시 앱 1.4.0)
  useAlertsSync(myTeamIds)
  // 🌙 휴무일 자동 응답: 내 휴무 날짜·고객 번호·문구를 폰에 맞춰 둔다 (갤럭시 앱, 켰을 때만)
  useOffDaySync(user.uid, myTeamIds, profile ?? null)

  useEffect(() => rememberSignedIn(user.uid), [user.uid])

  // 공용 컴퓨터(PC): 15분 넘게 앱을 닫아 두었으면 다시 로그인하게 한다.
  useEffect(() => watchIdle(() => void logOutAndWipe(IDLE_NOTICE)), [])

  // 보고 있는 채팅방 (휴대폰에서 null이면 방 목록)
  const channelId = team && channelState?.teamId === team.id ? channelState.id : null
  // 고른 방이 없으면(처음, 지워진 방) 기본 방 (프론트 앱처럼 채팅 화면은 늘 방 하나를 보여 준다)
  const roomId = channels?.some((c) => c.id === channelId) ? channelId : MAIN_CHANNEL
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

  // 🏌️ 프론트 채팅 (프론트 앱 채팅방에 타부서 게스트로): 보던 방은 F5 후에도 유지
  const [frontRoom, setFrontRoomState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(FRONT_ROOM_KEY) || null
    } catch {
      return null
    }
  })
  function openFrontRoom(id: string | null) {
    setFrontRoomState(id)
    setTab('front')
    try {
      sessionStorage.setItem(FRONT_ROOM_KEY, id ?? '')
    } catch {
      // 기억하지 못해도 동작에는 문제없다.
    }
  }
  const frontJoined = profile?.settings?.frontChat === true
  const profileReady = profile !== null
  useEffect(() => {
    if (profileReady) resumeFront(frontJoined)
  }, [user.uid, profileReady, frontJoined])
  // 보던 프론트 방이 없으면(처음, 나간 방) 첫 방
  const front = useFront()
  const frontRoomId = front.rooms.some((r) => r.id === frontRoom) ? frontRoom : (front.rooms[0]?.id ?? null)
  const frontUnread = useFrontUnread(tab === 'front' ? frontRoomId : null)

  // 🔔 푸시 알림: 켜 둔 기기면 등록을 새로 적고, 알림을 눌러 들어오면 그 방을 연다.
  useEffect(() => void refreshPush(), [user.uid])
  const openRequest = useRef<(req: OpenRequest) => void>(() => {})
  openRequest.current = (req) => {
    if (req.kind === 'front') return openFrontRoom(req.ch)
    // 🔔 갤럭시 앱 전화·문자 알림을 누르고 들어옴
    if (req.kind === 'sms') {
      openSmsTo(req.number)
      setPhoneNonce((n) => n + 1)
      return setTab('messages')
    }
    if (req.kind === 'calls') {
      try {
        sessionStorage.setItem('phone-sub', 'recent')
      } catch {
        // 기억 못 하면 보던 칸
      }
      setPhoneNonce((n) => n + 1)
      return setTab('phone')
    }
    if (req.kind === 'caller') return void openCallerCustomer(req.number)
    if (!teamIds.includes(req.teamId)) return
    if (req.teamId !== team?.id) selectTeam(req.teamId)
    if (req.kind === 'notice') return setTab('notices')
    setChannelState({ teamId: req.teamId, id: req.channelId })
    setQueries((prev) => ({ ...prev, chat: '' }))
    setTab('chat')
  }
  useEffect(() => listenOpenRequests((req) => openRequest.current(req)), [])
  const frontUnreadTotal = Object.values(frontUnread).reduce((a, b) => a + b, 0)
  // PC: 앱이 열려 있다고 5분마다 서버에 알린다 (20분 넘게 소식 없는 PC에는 알림을 안 보냄).
  useEffect(() => startPushHeartbeat(), [user.uid])
  // 📛 앱 아이콘 빨간 숫자 = 안 읽은 채팅 수
  const badgeTotal = unreadTotal + frontUnreadTotal
  useEffect(() => setBadge(badgeTotal), [badgeTotal])
  // 지금 보고 있는 방: 그 방 알림은 띄우지 않고, 이미 뜬 알림은 지운다 (앱을 내리면 없음).
  const viewingTag =
    tab === 'chat' && team && roomId ? roomTag(team.id, roomId) : tab === 'front' && frontRoomId ? frontTag(frontRoomId) : tab === 'notices' && team ? `notice-${team.id}` : null
  useEffect(() => {
    const send = () => tellViewing(document.visibilityState === 'visible' ? viewingTag : null)
    send()
    document.addEventListener('visibilitychange', send)
    return () => document.removeEventListener('visibilitychange', send)
  }, [viewingTag])

  // 모든 팀에서 제외되면 이 기기의 데이터를 지우고 로그아웃한다.
  // (최고 관리자는 팀에 속하지 않아도 되므로 제외)
  const removed = missing || (profile !== null && myTeamIds.length === 0 && !isSuper)
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
  if (!profile || !team) return <Loading message={isSuper && allTeamIds?.length === 0 ? '팀이 아직 없어요. (최고 관리자)' : undefined} />

  // 용량 관리는 최고 관리자만 본다 (서버 함수도 최고 관리자만 허용).
  const superAdmin = profile.superAdmin === true
  // 관리자 화면은 이 팀의 관리자만 (팀을 바꿨는데 그 팀 관리자가 아니면 고객 화면으로)
  const isAdmin = team.myRole === 'admin'
  const current = (tab === 'usage' && !superAdmin) || ((tab === 'admin' || tab === 'staff') && !isAdmin) ? 'notices' : tab

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
  const canWrite = team.myRole !== 'viewer'
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
    uid: user.uid,
    roleLabel: [profile.position, superAdmin ? '최고 관리자' : ROLE_LABELS[team.myRole ?? 'viewer']].filter(Boolean).join(' · '),
    members: Object.keys(team.members)
      .filter((m) => m !== user.uid)
      .map((m) => ({ uid: m, name: memberProfiles[m]?.name ?? '', role: memberProfiles[m]?.position || ROLE_LABELS[team.members[m]] }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    unread,
    frontRooms: front.rooms,
    currentFrontRoom: current === 'front' ? frontRoomId : null,
    frontUnread,
    onSelectFrontRoom: openFrontRoom,
    onCreateRoom: canWrite
      ? async () => {
          const id = await promptCreateChannel(team.id)
          if (id) openChannel(id)
        }
      : undefined,
  }
  // 전화·문자 화면에서 고객 정보, 문자 대화로 옮겨 가기
  const openCustomer = (id: string) => {
    try {
      sessionStorage.setItem('open-customer', `${team.id}:${id}`)
    } catch {
      // 기억 못 하면 고객 목록이 열린다
    }
    setTab('customers')
  }
  // 고객 전화 알림을 누르면 그 번호의 고객 (내 팀들에서 찾아, 다른 팀이면 팀도 바꿈). 못 찾으면 최근기록
  const openCallerCustomer = async (number: string) => {
    const phone = normalizePhone(number)
    for (let i = 0; i < myTeamIds.length; i += 30) {
      const snap = await getDocs(
        query(collection(db, 'customers'), where('teamId', 'in', myTeamIds.slice(i, i + 30)), where('phones', 'array-contains', phone), limit(1)),
      ).catch(() => null)
      const hit = snap?.docs[0]
      if (!hit) continue
      const teamId = hit.get('teamId') as string
      if (teamId !== team.id) selectTeam(teamId)
      try {
        sessionStorage.setItem('open-customer', `${teamId}:${hit.id}`)
      } catch {
        // 기억 못 하면 고객 목록이 열린다
      }
      return setTab('customers')
    }
    setTab('phone')
  }
  const openSms = (number: string, name?: string) => {
    // PC: 문자를 보낼 수 없어 "휴대폰으로 보내주세요" 안내 (src/pcGuide.tsx)
    if (isPcDevice()) return void import('./pcGuide.tsx').then((m) => m.showSmsGuide(number, name))
    openSmsTo(number)
    setTab('messages')
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
     <MenuBadgeContext.Provider value={unreadTotal + frontUnreadTotal}>
     <SearchContext.Provider value={search}>
      <div className={`shell${desktop ? ' desktop' : ''}${searching ? ' searching' : ''}`}>
        {desktop && <Sidebar {...menuProps}>{teamSelect}</Sidebar>}
        <div className="shell-main">
          <div className="shell-body">
            {current === 'notices' && <NoticesPage team={team} uid={user.uid} />}
            {current === 'customers' && <CustomersPage team={team} uid={user.uid} desktop={desktop} onOpenSms={openSms} />}
            {current === 'phone' && <PhonePage key={phoneNonce} team={team} uid={user.uid} onOpenCustomer={openCustomer} onOpenSms={openSms} onOpenSettings={() => setTab('profile')} />}
            {current === 'messages' && <MessagesPage key={phoneNonce} team={team} uid={user.uid} onOpenCustomer={openCustomer} />}
            {current === 'chat' && (
              <ChatPage
                team={team}
                uid={user.uid}
                channels={channels}
                channelId={roomId}
                onOpenChannel={openChannel}
              />
            )}
            {current === 'schedule' && <SchedulePage team={team} uid={user.uid} />}
            {current === 'members' && <MembersPage team={team} uid={user.uid} onOpenAdmin={() => setTab('staff')} />}
            {current === 'staff' && <StaffPage team={team} uid={user.uid} teamIds={teamIds} />}
            {current === 'admin' && (
              <AdminPage
                team={team}
                uid={user.uid}
                superAdmin={superAdmin}
                teamIds={teamIds}
                onSelectTeam={selectTeam}
                onOpenUsage={() => setTab('usage')}
                onOpenStaff={() => setTab('staff')}
              />
            )}
            {current === 'usage' && <UsagePage team={team} />}
            {current === 'front' && <FrontChatPage roomId={frontRoomId} onOpenRoom={openFrontRoom} />}
            {current === 'profile' && <ProfilePage user={user} profile={profile} team={team} onOpenAlerts={() => setTab('alerts')} />}
            {current === 'alerts' && <AlertsPage unread={badgeTotal} workSms={phoneBadges.sms} />}
          </div>
          {/* 휴대폰: 맨 아래 자주 쓰는 화면 (전화 · 문자 · 고객 · 설정). 채팅방 안에서는 입력칸 자리라 숨긴다. */}
          {!desktop && current !== 'chat' && current !== 'front' && (
            <nav className="bottom-tabs" aria-label="자주 쓰는 화면">
              {(
                [
                  ['phone', '📞', '전화'],
                  ['messages', '✉️', '문자'],
                  ['customers', '📇', '고객'],
                  ['profile', '⚙️', '설정'],
                ] as const
              ).map(([id, icon, label]) => {
                // 📛 📞 부재중(최근기록을 본 뒤) · ✉️ 안 읽은 문자 대화 (갤럭시 앱)
                const count = id === 'phone' ? phoneBadges.missed : id === 'messages' ? phoneBadges.sms : 0
                return (
                  <button key={id} type="button" className={current === id ? 'selected' : ''} aria-current={current === id ? 'page' : undefined} onClick={() => setTab(id)}>
                    <span aria-hidden="true">{icon}</span>
                    {label}
                    {count > 0 && <b className="tab-badge">{count > 99 ? '99+' : count}</b>}
                  </button>
                )
              })}
            </nav>
          )}
        </div>
        <CallMemoWatcher team={team} uid={user.uid} />
        <ApkUpdateBanner />
        {!desktop && (
          <MenuDrawer {...menuProps} open={menuOpen} onClose={() => setMenuOpen(false)}>
            {teamSelect}
          </MenuDrawer>
        )}
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

export function Loading({ message = '불러오는 중…' }: { message?: string }) {
  return <div className="center muted">{message}</div>
}
