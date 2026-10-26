import { useEffect, useState } from 'react'

// PC 화면(가로 1024px 이상)이면 왼쪽 고정 메뉴와 2단 화면을 쓴다. 휴대폰·좁은 창은 하단 탭.
const DESKTOP = '(min-width: 1024px)'

export function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP).matches)
  useEffect(() => {
    const query = window.matchMedia(DESKTOP)
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return desktop
}
