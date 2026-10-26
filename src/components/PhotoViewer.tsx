import { useEffect, useRef, useState } from 'react'
import { photoUrl, type Attachment } from '../chat.ts'
import { fileName, prepareFile, saveFile } from '../download.ts'
import { StorageImage } from './StorageImage.tsx'

export type ViewerPhoto = { attachment: Attachment; author: string; createdAt: Date | null }

type Props = { photos: ViewerPhoto[]; index: number; onClose: () => void }

// 카카오톡처럼 사진 한 장을 크게 보고, 좌우로 넘긴다.
export function PhotoViewer({ photos, index: start, onClose }: Props) {
  const [index, setIndex] = useState(start)
  const touchX = useRef<number | null>(null)
  const photo = photos[index]

  const go = (delta: number) => setIndex((i) => Math.min(photos.length - 1, Math.max(0, i + delta)))

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
    if (photo) photoUrl(photo.attachment.path).then(prepareFile).catch(() => {})
  }, [photo])

  async function save() {
    const d = photo.createdAt ?? new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
    const ext = photo.attachment.path.split('.').pop() ?? 'jpg'
    await saveFile(await photoUrl(photo.attachment.path), fileName(`지원팀_${stamp}_${index + 1}`, ext))
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
        className="viewer-stage"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return
          const dx = e.changedTouches[0].clientX - touchX.current
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
          touchX.current = null
        }}
      >
        <StorageImage key={photo.attachment.path} path={photo.attachment.path} className="viewer-image" />
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
