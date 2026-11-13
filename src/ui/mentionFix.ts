// 📱 아이폰 @부르기 보강 (2026-11-13 프론트 mention.js 와 같은 고침, 우리 채팅·🏌️ 프론트 방 입력칸 공통).
// ② 이름을 눌러도 안 골라짐: 아이폰은 누르는 순간 click 이 안 올 때가 있어 손을 뗄 때(pointerup) 바로 고른다.
//    10px 넘게 밀었으면 목록 스크롤로 보고 안 고름. click 도 그대로 두되, 방금 pointerup 으로 고른 건 다시 안 고름.
// ③ 한글 조합 중 고르면 글자가 한 번 더 붙음('@이' 치고 이민지 고르면 '@이민지 이'):
//    고른 직후 0.8초 안에 "조합 중이던 한글 조각"만 끼어들면 고른 그대로 되돌린다(일부러 친 글자는 그대로).
import type { PointerEvent as ReactPointerEvent } from 'react'

let lastPick = 0
export function mentionTapProps(pick: () => void) {
  let y: number | null = null
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault() // 입력칸 포커스(키보드)를 뺏지 않게
      y = e.clientY
    },
    onPointerUp: (e: ReactPointerEvent) => {
      if (y !== null && Math.abs(e.clientY - y) < 10) {
        e.preventDefault()
        lastPick = Date.now()
        pick()
      }
      y = null
    },
    onClick: () => {
      if (Date.now() - lastPick < 500) return // 위에서 이미 골랐음
      pick()
    },
  }
}

export type ImeFix = { val: string; at: number; frag: string; until: number }
export const armImeFix = (val: string, at: number, frag: string): ImeFix => ({ val, at, frag, until: Date.now() + 800 })

// 되돌려야 하면 고른 그대로의 글을, 아니면 null (fix.current 는 시간이 지났거나 일부러 친 글자면 지움)
export function imeUndo(fix: { current: ImeFix | null }, v: string): string | null {
  const f = fix.current
  if (!f) return null
  if (Date.now() > f.until) {
    fix.current = null
    return null
  }
  const a = f.val
  if (v === a || v.length <= a.length) return null
  let p = 0
  while (p < a.length && v[p] === a[p]) p++
  let s = 0
  while (s < a.length - p && v[v.length - 1 - s] === a[a.length - 1 - s]) s++
  const extra = v.slice(p, v.length - s) // 새로 끼어든 글자
  if (!extra || !(f.frag.includes(extra) || /^[ㄱ-ㅎㅏ-ㅣ]$/.test(extra))) {
    fix.current = null
    return null
  }
  return a
}
