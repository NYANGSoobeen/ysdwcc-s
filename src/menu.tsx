import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// 왼쪽 위 ☰ 버튼으로 여는 메뉴. 기능이 늘어나면 MENU_ITEMS에 추가한다.
export type Tab = 'customers' | 'chat' | 'schedule' | 'members' | 'admin' | 'usage' | 'profile'

export type MenuItem = {
  tab: Tab
  icon: string
  label: string
  adminOnly?: boolean
  superAdminOnly?: boolean
  section: 'main' | 'extra' | 'admin'
}

export const MENU_ITEMS: MenuItem[] = [
  { tab: 'customers', icon: '📇', label: '고객', section: 'main' },
  { tab: 'schedule', icon: '📅', label: '스케줄', section: 'main' },
  { tab: 'members', icon: '👥', label: '팀원', section: 'main' },
  { tab: 'profile', icon: '⚙️', label: '내 정보', section: 'main' },
  { tab: 'admin', icon: '🛡️', label: '관리자 (팀원 관리)', section: 'admin', adminOnly: true },
  { tab: 'usage', icon: '📦', label: '용량 관리', section: 'admin', superAdminOnly: true },
]

// 메뉴 묶음. 제목이 있는 묶음은 제목을 눌러 접고 펼 수 있고, 접은 상태는 기기마다 기억한다.
// (예: 관리자 전용, 앞으로 생길 단체 채팅방 목록)
const SECTIONS: { id: MenuItem['section'] | 'chat'; title?: string }[] = [
  { id: 'main' },
  { id: 'chat', title: '단체 채팅' },
  { id: 'extra' },
  { id: 'admin', title: '관리자 전용' },
]

export type ChatRoomItem = { id: string; name: string }

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

export function MenuButton() {
  const open = useContext(MenuContext)
  return (
    <button type="button" className="ghost menu-button" onClick={open} aria-label="메뉴 열기">
      ☰
    </button>
  )
}

type MenuListProps = {
  current: Tab
  isAdmin: boolean
  superAdmin: boolean
  teamName: string
  userName: string
  onSelect: (tab: Tab) => void
  // 단체 채팅방 (메뉴의 "단체 채팅" 묶음)
  chatRooms?: ChatRoomItem[]
  currentRoom?: string | null
  onSelectRoom?: (id: string) => void
  onCreateRoom?: () => void
  focusable?: boolean
  children?: ReactNode
}

// 메뉴 내용: 휴대폰의 ☰ 서랍과 PC의 왼쪽 고정 메뉴가 같이 쓴다.
function MenuList(props: MenuListProps) {
  const { current, isAdmin, superAdmin, teamName, userName, onSelect, focusable = true, children } = props
  const items = MENU_ITEMS.filter((i) => (!i.superAdminOnly || superAdmin) && (!i.adminOnly || isAdmin))
  const { collapsed, toggle } = useCollapsed()
  return (
    <>
      <div className="drawer-head">
        <img src="/icons/icon-192.png" alt="" />
        <div>
          <strong>양산동원로얄CC 지원팀</strong>
          <span className="muted small">
            {teamName} · <span className="me-name">{userName}</span>
          </span>
        </div>
      </div>
      {children}
      {SECTIONS.map(({ id, title }) => {
        if (id === 'chat') return <ChatRoomsSection key={id} {...props} title={title!} closed={collapsed.includes(id)} onToggle={() => toggle(id)} />
        const list = items.filter((i) => i.section === id)
        if (list.length === 0) return null
        // 지금 보고 있는 화면이 든 묶음은 접혀 있어도 그 항목만은 보인다.
        const closed = Boolean(title) && collapsed.includes(id)
        const shown = closed ? list.filter((i) => i.tab === current) : list
        return (
          <ul key={id} className="drawer-list">
            {title && (
              <li>
                <button
                  type="button"
                  className="drawer-label"
                  aria-expanded={!closed}
                  onClick={() => toggle(id)}
                  tabIndex={focusable ? 0 : -1}
                >
                  {title}
                  <span aria-hidden="true">{closed ? '▸' : '▾'}</span>
                </button>
              </li>
            )}
            {shown.map((item) => (
              <li key={item.tab}>
                <button
                  type="button"
                  className={item.tab === current ? 'drawer-item active' : 'drawer-item'}
                  aria-current={item.tab === current ? 'page' : undefined}
                  onClick={() => onSelect(item.tab)}
                  tabIndex={focusable ? 0 : -1}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )
      })}
      <p className="app-version">v{__APP_VERSION__}</p>
    </>
  )
}

function ChatRoomsSection(props: MenuListProps & { title: string; closed: boolean; onToggle: () => void }) {
  const { chatRooms, currentRoom, onSelectRoom, onCreateRoom, focusable = true, closed, onToggle, title } = props
  if (!chatRooms || !onSelectRoom) return null
  const shown = closed ? chatRooms.filter((r) => r.id === currentRoom) : chatRooms
  const tabIndex = focusable ? 0 : -1
  return (
    <ul className="drawer-list">
      <li>
        <button type="button" className="drawer-label" aria-expanded={!closed} onClick={onToggle} tabIndex={tabIndex}>
          {title}
          <span aria-hidden="true">{closed ? '▸' : '▾'}</span>
        </button>
      </li>
      {shown.map((room) => (
        <li key={room.id}>
          <button
            type="button"
            className={room.id === currentRoom ? 'drawer-item active' : 'drawer-item'}
            aria-current={room.id === currentRoom ? 'page' : undefined}
            onClick={() => onSelectRoom(room.id)}
            tabIndex={tabIndex}
          >
            <span aria-hidden="true">💬</span>
            {room.name}
          </button>
        </li>
      ))}
      {!closed && onCreateRoom && (
        <li>
          <button type="button" className="drawer-item add" onClick={onCreateRoom} tabIndex={tabIndex}>
            <span aria-hidden="true">＋</span>새 채팅방
          </button>
        </li>
      )}
    </ul>
  )
}

type DrawerProps = Omit<MenuListProps, 'focusable' | 'children'> & { open: boolean; onClose: () => void }

export function MenuDrawer({ open, onClose, onSelect, onSelectRoom, onCreateRoom, ...rest }: DrawerProps) {
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
        />
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
