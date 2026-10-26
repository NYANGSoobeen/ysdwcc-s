import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { photoUrl, type Attachment } from '../chat.ts'
import { fileName, prepareFile, saveFile } from '../download.ts'
import { StorageImage } from './StorageImage.tsx'

// load: 우리 Storage가 아닌 곳의 사진(프론트 채팅)은 주소를 얻는 방법을 따로 준다.
export type ViewerPhoto = { attachment: Attachment; author: string; createdAt: Date | null; load?: () => Promise<string> }
const urlOf = (p: ViewerPhoto) => (p.load ? p.load() : photoUrl(p.attachment.path))

type Props = { photos: ViewerPhoto[]; index: number; onClose: () => void }

const MAX_SCALE = 6

// 카카오톡처럼 사진을 크게 보고, 이 방의 사진을 ← → / 밀어서 넘긴다.
// 두 손가락으로 확대·축소, 두 번 눌러 확대/원래대로, 확대한 상태에서는 한 손가락으로 이동, PC는 휠로 확대.
export function PhotoViewer({ photos, index: start, onClose }: Props) {
  const [index, setIndex] = useState(start)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const lastTap = useRef(0)
  const photo = photos[index]

  const go = (delta: number) => {
    setView({ scale: 1, x: 0, y: 0 })
    setIndex((i) => Math.min(photos.length - 1, Math.max(0, i + delta)))
  }

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
      swipe.current = null
    } else if (pointers.current.size === 1) {
      swipe.current = { x: e.clientX, y: e.clientY }
      const now = Date.now()
      if (now - lastTap.current < 300) {
        zoomTo(view.scale > 1 ? 1 : 2.5)
        lastTap.current = 0 // 세 번째 누르기가 다시 두 번 누르기로 세지 않게
      } else {
        lastTap.current = now
      }
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
    // 확대하지 않은 상태에서 옆으로 민 경우만 다음/이전 사진
    const from = swipe.current
    swipe.current = null
    if (!from) return
    // 움직인 터치(밀기, 끌기)는 "누르기"가 아니므로 두 번 누르기로 세지 않는다.
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) lastTap.current = 0
    if (view.scale > 1 || e.pointerType === 'mouse') return
    const dx = e.clientX - from.x
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - from.y)) go(dx < 0 ? 1 : -1)
  }

  function wheel(e: WheelEvent) {
    zoomTo(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 아이폰 공유 창은 누른 직후에만 열리므로, 보고 있는 사진을 미리 받아 둔다.
  useEffect(() => {
    if (photo) urlOf(photo).then(prepareFile).catch(() => {})
  }, [photo])

  async function save() {
    const d = photo.createdAt ?? new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    const ext = photo.attachment.path.split('.').pop() ?? 'jpg'
    await saveFile(await urlOf(photo), fileName(`지원팀_${stamp}_${index + 1}`, photo.load ? 'jpg' : ext))
  }

  if (!photo) return null
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="사진 보기">
      <header className="viewer-bar">
        <button type="button" className="ghost light" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <div className="viewer-info">
          <strong>{photo.author}</strong>
          <span>{photo.createdAt ? photo.createdAt.toLocaleString('ko-KR') : ''}</span>
        </div>
        <span className="viewer-count">
          {index + 1} / {photos.length}
        </span>
      </header>
      <div
        className="viewer-stage zoomable"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
      >
        <div
          className="viewer-zoom"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <StorageImage key={photo.attachment.path} path={photo.attachment.path} load={photo.load} className="viewer-image" />
        </div>
        {index > 0 && (
          <button type="button" className="viewer-nav prev" onClick={() => go(-1)} aria-label="이전 사진">
            ‹
          </button>
        )}
        {index < photos.length - 1 && (
          <button type="button" className="viewer-nav next" onClick={() => go(1)} aria-label="다음 사진">
            ›
          </button>
        )}
      </div>
      <footer className="viewer-bar">
        <button type="button" className="ghost light" onClick={() => void save()}>
          💾 저장
        </button>
      </footer>
    </div>
  )
}
