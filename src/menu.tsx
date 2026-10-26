import { createContext, useContext, useEffect, type ReactNode } from 'react'

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
  { tab: 'chat', icon: '💬', label: '채팅', section: 'main' },
  { tab: 'schedule', icon: '📅', label: '스케줄', section: 'main' },
  { tab: 'members', icon: '👥', label: '팀원', section: 'main' },
  { tab: 'profile', icon: '⚙️', label: '내 정보', section: 'main' },
  { tab: 'admin', icon: '🛡️', label: '관리자 (팀원 관리)', section: 'admin', adminOnly: true },
  { tab: 'usage', icon: '📦', label: '용량 관리', section: 'admin', superAdminOnly: true },
]

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
  focusable?: boolean
  children?: ReactNode
}

// 메뉴 내용: 휴대폰의 ☰ 서랍과 PC의 왼쪽 고정 메뉴가 같이 쓴다.
function MenuList({ current, isAdmin, superAdmin, teamName, userName, onSelect, focusable = true, children }: MenuListProps) {
  const items = MENU_ITEMS.filter((i) => (!i.superAdminOnly || superAdmin) && (!i.adminOnly || isAdmin))
  const section = (name: MenuItem['section']) => items.filter((i) => i.section === name)
  return (
    <>
      <div className="drawer-head">
        <img src="/icons/icon-192.png" alt="" />
        <div>
          <strong>양산동원 지원팀</strong>
          <span className="muted small">
            {teamName} · {userName}
          </span>
        </div>
      </div>
      {children}
      {(['main', 'extra', 'admin'] as const).map((name) =>
        section(name).length === 0 ? null : (
          <ul key={name} className="drawer-list">
            {name === 'admin' && <li className="drawer-label">관리자 전용</li>}
            {section(name).map((item) => (
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
        ),
      )}
    </>
  )
}

type DrawerProps = Omit<MenuListProps, 'focusable' | 'children'> & { open: boolean; onClose: () => void }

export function MenuDrawer({ open, onClose, onSelect, ...rest }: DrawerProps) {
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
