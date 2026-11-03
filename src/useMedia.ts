import { useEffect, useState } from 'react'

// PC 화면이면 왼쪽 고정 메뉴와 2단 화면을 쓴다. 휴대폰·좁은 창은 하단 탭.
// 가로 1024px 이상이거나, 마우스 컴퓨터는 760px 이상(2026-11-03 사용자 요청 "모니터 반 정도로 줄여도 PC 화면").
// 태블릿(터치)은 그대로 1024px부터.
const DESKTOP = '(min-width: 1024px), (min-width: 760px) and (hover: hover) and (pointer: fine)'

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
