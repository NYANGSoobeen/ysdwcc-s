import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type TouchEvent } from 'react'
import { isTouchUi } from './dialogs.tsx'

// 항목 메뉴: PC는 오른쪽 클릭, 휴대폰은 길게 누르기, 둘 다 ⋯ 버튼으로 연다.
// PC는 누른 자리에 작은 메뉴, 휴대폰은 화면 아래에서 올라오는 메뉴.

export type MenuAction = {
  label: string
  icon?: string
  danger?: boolean
  // true면 아이콘만 한 줄로 늘어놓는다 (스티커 고르기)
  compact?: boolean
  onSelect: () => void
}

type OpenMenu = { actions: MenuAction[]; x: number; y: number; title?: string }

let current: OpenMenu | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function openMenu(actions: MenuAction[], x: number, y: number, title?: string) {
  if (actions.length === 0) return
  current = { actions, x, y, title }
  emit()
}

function closeMenu() {
  current = null
  emit()
}

// 길게 누른 뒤 손을 떼면 브라우저가 그 자리의 버튼/링크 클릭을 만들어 낸다. 그 클릭 하나를 막는다.
// (손을 뗀 바로 그 자리에서 0.8초 안에 생긴 클릭만 막는다. 메뉴의 다른 항목을 누르는 건 그대로 둔다.)
let swallow: { until: number; x: number; y: number } | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (e) => {
      if (swallow && Date.now() < swallow.until && Math.hypot(e.clientX - swallow.x, e.clientY - swallow.y) < 30) {
        e.preventDefault()
        e.stopPropagation()
        swallow = null
      }
    },
    true,
  )
  // 다음 터치가 시작되면 막기를 푼다 (메뉴 항목을 바로 눌러도 동작하게).
  window.addEventListener('touchstart', () => (swallow = null), true)
}

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10

// 항목에 붙이는 이벤트 묶음: <div {...useItemMenu(() => actions)}>
export function useItemMenu(getActions: () => MenuAction[], title?: string) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(0)

  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = () => {
    clearTimeout(timer.current)
    start.current = null
  }

  return {
    onContextMenu(e: MouseEvent) {
      e.preventDefault()
      // 안드로이드는 길게 누를 때 contextmenu도 보내므로, 방금 길게 누르기로 열었으면 무시한다.
      if (Date.now() - fired.current < 1000) return
      openMenu(getActions(), e.clientX, e.clientY, title)
    },
    onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return cancel()
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const at = start.current
        if (!at) return
        fired.current = Date.now()
        swallow = { until: Date.now() + 800, x: at.x, y: at.y }
        navigator.vibrate?.(10)
        openMenu(getActions(), at.x, at.y, title)
      }, LONG_PRESS_MS)
    },
    onTouchMove(e: TouchEvent) {
      const at = start.current
      const t = e.touches[0]
      if (at && t && Math.hypot(t.clientX - at.x, t.clientY - at.y) > MOVE_TOLERANCE) cancel()
    },
    onTouchEnd(e: TouchEvent) {
      if (Date.now() - fired.current < 1000) e.preventDefault()
      cancel()
    },
    onTouchCancel: cancel,
  }
}

// ⋯ 버튼
export function MoreButton({
  actions,
  label = '더 보기',
  title,
  className = 'ghost more-button',
  children = '⋯',
}: {
  actions: () => MenuAction[]
  label?: string
  title?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openMenu(actions(), r.right, r.bottom, title)
      }}
    >
      {children}
    </button>
  )
}

export function ContextMenuHost() {
  const menu = useSyncExternalStore(subscribe, () => current)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const sheet = menu ? isTouchUi() : false

  // PC: 화면 밖으로 나가지 않게 자리를 맞춘다.
  useLayoutEffect(() => {
    if (!menu || sheet || !ref.current) return setPos(null)
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(menu.x, innerWidth - width - 8)),
      top: Math.max(8, Math.min(menu.y, innerHeight - height - 8)),
    })
  }, [menu, sheet])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    // PC 메뉴는 바깥을 누르거나 화면을 굴리면 닫는다.
    const onDown = (e: PointerEvent) => {
      if (!sheet && ref.current && !ref.current.contains(e.target as Node)) closeMenu()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu, sheet])

  if (!menu) return null
  const list = (
    <div
      ref={ref}
      className={sheet ? 'item-menu sheet' : 'item-menu'}
      role="menu"
      style={sheet ? undefined : { left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
    >
      {menu.title && <div className="item-menu-title">{menu.title}</div>}
      {menu.actions.some((a) => a.compact) && (
        <div className="item-menu-row">
          {menu.actions
            .filter((a) => a.compact)
            .map((a) => (
              <button
                key={a.icon}
                type="button"
                role="menuitem"
                className="item-menu-emoji"
                aria-label={`${a.icon} ${a.label}`}
                title={a.label}
                onClick={() => {
                  closeMenu()
                  a.onSelect()
                }}
              >
                {a.icon}
              </button>
            ))}
        </div>
      )}
      {menu.actions.filter((a) => !a.compact).map((a) => (
        <button
          key={`${a.icon}${a.label}`}
          type="button"
          role="menuitem"
          className={a.danger ? 'item-menu-item danger' : 'item-menu-item'}
          onClick={() => {
            closeMenu()
            a.onSelect()
          }}
        >
          {a.icon && <span aria-hidden="true">{a.icon}</span>}
          {a.label}
        </button>
      ))}
      {sheet && (
        <button type="button" className="item-menu-item cancel" onClick={closeMenu}>
          닫기
        </button>
      )}
    </div>
  )
  // 휴대폰: 아래에서 올라오는 메뉴. 바깥(어두운 곳)을 누르면 닫는다.
  return sheet ? (
    <div className="item-menu-backdrop" onClick={(e) => e.target === e.currentTarget && closeMenu()}>
      {list}
    </div>
  ) : (
    list
  )
}
