import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { badgeText } from './reads.ts'
import { Avatar } from './ui/Avatar.tsx'

// 왼쪽 메뉴 (휴대폰 ☰ 서랍, PC 왼쪽 고정 메뉴). 프론트 앱과 같은 구조:
// 내 프로필 → 단체 채팅(우리 방 + 🏌️ 프론트 채팅방, +) → 팀원 → 메뉴 → 관리자 전용. 기능이 늘어나면 MENU_ITEMS에 추가한다.
export type Tab = 'customers' | 'chat' | 'front' | 'schedule' | 'members' | 'admin' | 'usage' | 'profile'

export type MenuItem = {
  tab: Tab
  icon: string
  label: string
  adminOnly?: boolean
  superAdminOnly?: boolean
  section: 'main' | 'admin'
}

// 팀원(팀원 묶음 제목·이름을 누르면)과 내 정보(맨 위 내 이름을 누르면)는 따로 연다.
export const MENU_ITEMS: MenuItem[] = [
  { tab: 'customers', icon: '📇', label: '고객', section: 'main' },
  { tab: 'schedule', icon: '📅', label: '스케줄', section: 'main' },
  { tab: 'admin', icon: '🛡️', label: '관리자 (팀원 관리)', section: 'admin', adminOnly: true },
  { tab: 'usage', icon: '📦', label: '용량 관리', section: 'admin', superAdminOnly: true },
]

// 메뉴 묶음. 제목이 있는 묶음은 제목을 눌러 접고 펼 수 있고, 접은 상태는 기기마다 기억한다.
const SECTIONS: { id: MenuItem['section'] | 'members' | 'chat'; title?: string }[] = [
  { id: 'chat', title: '단체 채팅' },
  { id: 'members', title: '팀원' },
  { id: 'main' },
  { id: 'admin', title: '관리자 전용' },
]

export type ChatRoomItem = { id: string; name: string }
export type MemberItem = { uid: string; name: string; role: string }

const COLLAPSED_KEY = 'menu-collapsed'

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })
  function toggle(id: string) {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
    } catch {
      // 기억하지 못해도 이번에는 접힌다.
    }
  }
  return { collapsed, toggle }
}

export const MenuContext = createContext<() => void>(() => {})
// ☰ 버튼에 붙는 숫자 (안 읽은 채팅 합계)
export const MenuBadgeContext = createContext(0)

export function MenuButton() {
  const open = useContext(MenuContext)
  const badge = useContext(MenuBadgeContext)
  return (
    <button
      type="button"
      className="ghost menu-button"
      onClick={open}
      aria-label={badge > 0 ? `메뉴 열기 (안 읽은 메시지 ${badge}개)` : '메뉴 열기'}
    >
      ☰{badge > 0 && <span className="badge on-icon">{badgeText(badge)}</span>}
    </button>
  )
}

type MenuListProps = {
  current: Tab
  isAdmin: boolean
  superAdmin: boolean
  teamName: string
  userName: string
  uid: string
  roleLabel: string
  members?: MemberItem[] // 나를 뺀 팀원
  onSelect: (tab: Tab) => void
  // 단체 채팅방 (메뉴의 "단체 채팅" 묶음)
  chatRooms?: ChatRoomItem[]
  currentRoom?: string | null
  onSelectRoom?: (id: string) => void
  onCreateRoom?: () => void
  unread?: Record<string, number>
  // 🏌️ 프론트 채팅방 (프론트 앱 방에 타부서 게스트로, src/front/). 단체 채팅 묶음 안에 같이 보인다.
  frontRooms?: ChatRoomItem[]
  currentFrontRoom?: string | null
  frontUnread?: Record<string, number>
  onSelectFrontRoom?: (id: string | null) => void
  // 메뉴 항목 옆 빨간 숫자
  badges?: Partial<Record<Tab, number>>
  focusable?: boolean
  children?: ReactNode
}

// 메뉴 내용: 휴대폰의 ☰ 서랍과 PC의 왼쪽 고정 메뉴가 같이 쓴다.
function MenuList(props: MenuListProps) {
  const { current, isAdmin, superAdmin, onSelect, focusable = true, children } = props
  const tabIndex = focusable ? 0 : -1
  const items = MENU_ITEMS.filter((i) => (!i.superAdminOnly || superAdmin) && (!i.adminOnly || isAdmin))
  const { collapsed, toggle } = useCollapsed()
  return (
    <>
      {/* 내 프로필: 누르면 내 정보 */}
      <button
        type="button"
        className={current === 'profile' ? 'menu-profile active' : 'menu-profile'}
        onClick={() => onSelect('profile')}
        tabIndex={tabIndex}
        aria-label="내 정보"
      >
        <Avatar uid={props.uid} name={props.userName || '나'} />
        <span className="menu-profile-text">
          <strong className="me-name">{props.userName || '이름 없음'}</strong>
          <span className="small">
            {props.roleLabel} · 내 정보 <span aria-hidden="true">✏️</span>
          </span>
        </span>
      </button>
      {children}
      {SECTIONS.map(({ id, title }) => {
        const closed = Boolean(title) && collapsed.includes(id)
        if (id === 'members') return <MembersSection key={id} {...props} closed={closed} onToggle={() => toggle(id)} />
        if (id === 'chat') return <ChatRoomsSection key={id} {...props} title={title!} closed={closed} onToggle={() => toggle(id)} />
        const list = items.filter((i) => i.section === id)
        if (list.length === 0) return null
        // 지금 보고 있는 화면이 든 묶음은 접혀 있어도 그 항목만은 보인다.
        const shown = closed ? list.filter((i) => i.tab === current) : list
        return (
          <ul key={id} className="drawer-list">
            {title && (
              <li>
                <SectionLabel title={title} closed={closed} onToggle={() => toggle(id)} tabIndex={tabIndex} />
              </li>
            )}
            {shown.map((item) => (
              <li key={item.tab}>
                <button
                  type="button"
                  className={item.tab === current ? 'drawer-item active' : 'drawer-item'}
                  aria-current={item.tab === current ? 'page' : undefined}
                  onClick={() => onSelect(item.tab)}
                  tabIndex={tabIndex}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                  {(props.badges?.[item.tab] ?? 0) > 0 && <span className="badge">{badgeText(props.badges![item.tab]!)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      })}
      <p className="app-version">
        <strong className="app-name">양산동원로얄CC 지원팀</strong>
        {props.teamName} · v{__APP_VERSION__}
      </p>
    </>
  )
}

function SectionLabel(props: { title: string; closed: boolean; onToggle: () => void; tabIndex: number; extra?: ReactNode }) {
  return (
    <div className="drawer-label-row">
      <button type="button" className="drawer-label" aria-expanded={!props.closed} onClick={props.onToggle} tabIndex={props.tabIndex}>
        <span aria-hidden="true" className="caret">
          {props.closed ? '▸' : '▾'}
        </span>
        {props.title}
      </button>
      {props.extra}
    </div>
  )
}

// 팀원: 이름과 권한. 누르면 팀원 화면.
function MembersSection(props: MenuListProps & { closed: boolean; onToggle: () => void }) {
  const { members = [], closed, onToggle, onSelect, focusable = true } = props
  const tabIndex = focusable ? 0 : -1
  return (
    <ul className="drawer-list members-list">
      <li>
        <SectionLabel title="팀원" closed={closed} onToggle={onToggle} tabIndex={tabIndex} />
      </li>
      {!closed &&
        members.map((m) => (
          <li key={m.uid}>
            <button
              type="button"
              className={props.current === 'members' ? 'drawer-member active' : 'drawer-member'}
              onClick={() => onSelect('members')}
              tabIndex={tabIndex}
            >
              <Avatar uid={m.uid} name={m.name} />
              <span className="menu-profile-text">
                <strong>{m.name}</strong>
                <span className="small">{m.role}</span>
              </span>
            </button>
          </li>
        ))}
      {!closed && members.length === 0 && (
        <li>
          <button type="button" className="drawer-member" onClick={() => onSelect('members')} tabIndex={tabIndex}>
            <span className="small muted">아직 다른 팀원이 없어요</span>
          </button>
        </li>
      )}
    </ul>
  )
}

function ChatRoomsSection(props: MenuListProps & { title: string; closed: boolean; onToggle: () => void }) {
  const { chatRooms, currentRoom, onSelectRoom, onCreateRoom, focusable = true, closed, onToggle, title, unread = {} } = props
  const { frontRooms = [], currentFrontRoom = null, frontUnread = {}, onSelectFrontRoom } = props
  if (!chatRooms || !onSelectRoom) return null
  const rooms = [
    ...chatRooms.map((r) => ({ ...r, front: false, count: unread[r.id] ?? 0, active: r.id === currentRoom })),
    ...frontRooms.map((r) => ({ ...r, front: true, count: frontUnread[r.id] ?? 0, active: r.id === currentFrontRoom })),
  ]
  const shown = closed ? rooms.filter((r) => r.active) : rooms
  const tabIndex = focusable ? 0 : -1
  // 접어 두면 숨은 방들의 안 읽은 수를 제목 옆에 합쳐 보여 준다.
  const hidden = rooms.filter((r) => !shown.includes(r)).reduce((sum, r) => sum + r.count, 0)
  return (
    <ul className="drawer-list">
      <li>
        <SectionLabel
          title={title}
          closed={closed}
          onToggle={onToggle}
          tabIndex={tabIndex}
          extra={
            <>
              {hidden > 0 && <span className="badge">{badgeText(hidden)}</span>}
              {onCreateRoom && (
                <button type="button" className="ghost section-add" onClick={onCreateRoom} tabIndex={tabIndex} aria-label="새 채팅방" title="새 채팅방">
                  ＋
                </button>
              )}
            </>
          }
        />
      </li>
      {shown.map((room) => (
        <li key={`${room.front ? 'front' : 'team'}-${room.id}`}>
          <button
            type="button"
            className={room.active ? 'drawer-item active' : 'drawer-item'}
            aria-current={room.active ? 'page' : undefined}
            onClick={() => (room.front ? onSelectFrontRoom?.(room.id) : onSelectRoom(room.id))}
            tabIndex={tabIndex}
            title={room.front ? '프론트 앱 채팅방 (타부서로 참여)' : undefined}
          >
            <span aria-hidden="true">{room.front ? '🏌️' : '💬'}</span>
            {room.name}
            {room.count > 0 && (
              <span className="badge" aria-label={`안 읽은 메시지 ${room.count}개`}>
                {badgeText(room.count)}
              </span>
            )}
          </button>
        </li>
      ))}
      {/* 프론트 채팅방에 아직 안 들어갔으면 들어가는 곳 */}
      {!closed && onSelectFrontRoom && frontRooms.length === 0 && (
        <li>
          <button
            type="button"
            className={props.current === 'front' ? 'drawer-item add active' : 'drawer-item add'}
            onClick={() => onSelectFrontRoom(null)}
            tabIndex={tabIndex}
          >
            <span aria-hidden="true">🏌️</span>프론트 채팅 들어가기
          </button>
        </li>
      )}
    </ul>
  )
}

type DrawerProps = Omit<MenuListProps, 'focusable'> & { open: boolean; onClose: () => void }

export function MenuDrawer({ open, onClose, onSelect, onSelectRoom, onCreateRoom, children, ...rest }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div className={open ? 'drawer-root open' : 'drawer-root'} aria-hidden={!open}>
      <div className="drawer-backdrop" onClick={onClose} />
      <nav className="drawer" aria-label="메뉴">
        <MenuList
          {...rest}
          focusable={open}
          onSelect={(tab) => {
            onSelect(tab)
            onClose()
          }}
          onSelectRoom={
            onSelectRoom &&
            ((id) => {
              onSelectRoom(id)
              onClose()
            })
          }
          onCreateRoom={
            onCreateRoom &&
            (() => {
              onClose()
              onCreateRoom()
            })
          }
        >
          {children}
        </MenuList>
      </nav>
    </div>
  )
}

// PC: 왼쪽에 늘 보이는 메뉴. 팀 바꾸기 칸도 여기에 둔다.
export function Sidebar(props: Omit<MenuListProps, 'focusable'>) {
  return (
    <nav className="sidebar" aria-label="메뉴">
      <MenuList {...props} />
    </nav>
  )
}
