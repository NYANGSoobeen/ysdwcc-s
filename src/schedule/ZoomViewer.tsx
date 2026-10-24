import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { StickerLayer } from './StickerLayer.tsx'
import type { SchedulePage } from './data.ts'
import type { Mark } from './stickers.ts'

type Props = {
  src: string
  page: SchedulePage
  // 그림에 스티커를 합성하지 못했을 때(Storage CORS 미설정)만 위에 따로 얹는다.
  marks: Mark[]
  title: string
  onClose: () => void
}

const MAX_SCALE = 8

// 전체 화면 크게 보기: 두 손가락으로 확대/축소, 한 손가락으로 이동, 두 번 눌러 확대, PC는 휠.
export function ZoomViewer({ src, page, marks, title, onClose }: Props) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  const stage = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })

  // 화면에 꼭 맞는 크기(확대 1)를 계산한다.
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const update = () => {
      const k = Math.min(el.clientWidth / page.w, el.clientHeight / page.h)
      setFit({ w: page.w * k, h: page.h * k })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [page.w, page.h])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const zoomTo = (scale: number) =>
    setView((v) => {
      const s = Math.min(MAX_SCALE, Math.max(1, scale))
      return s === 1 ? { scale: 1, x: 0, y: 0 } : { scale: s, x: (v.x * s) / v.scale, y: (v.y * s) / v.scale }
    })

  function down(e: PointerEvent) {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }
    } else if (pointers.current.size === 1) {
      const now = Date.now()
      if (now - lastTap.current < 300) zoomTo(view.scale > 1 ? 1 : 2.5)
      lastTap.current = now
    }
  }

  function move(e: PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      zoomTo((pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist)
    } else if (pointers.current.size === 1 && view.scale > 1) {
      setView((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }))
    }
  }

  function up(e: PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  function wheel(e: WheelEvent) {
    zoomTo(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`근무표 ${title} 크게 보기`}>
      <header className="viewer-bar">
        <button type="button" className="ghost light" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <div className="viewer-info">
          <strong>{title}</strong>
          <span>두 손가락으로 확대 · 두 번 눌러 확대/원래대로 · 길게 눌러 저장</span>
        </div>
      </header>
      <div
        className="viewer-stage zoom-stage"
        ref={stage}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
      >
        <div
          className="zoom-content"
          style={{
            width: fit.w,
            height: fit.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <img src={src} alt={`근무표 ${title}`} draggable={false} />
          {marks.length > 0 && <StickerLayer page={page} marks={marks} />}
        </div>
      </div>
      <footer className="viewer-bar zoom-buttons">
        <button type="button" className="ghost light" onClick={() => zoomTo(view.scale / 1.5)} aria-label="축소">
          −
        </button>
        <button type="button" className="ghost light" onClick={() => zoomTo(1)}>
          화면맞춤
        </button>
        <button type="button" className="ghost light" onClick={() => zoomTo(view.scale * 1.5)} aria-label="확대">
          ＋
        </button>
      </footer>
    </div>
  )
}
