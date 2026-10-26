import {
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type CollectionReference,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '../chat.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import type { Profile } from '../hooks.ts'

const PAGE_SIZE = 30

type Props = { messages: CollectionReference; profiles: Record<string, Profile>; onClose: () => void }

// 이 채팅방에 올라온 사진을 최신순으로 모아 월별로 보여 준다.
export function PhotoGallery({ messages, profiles, onClose }: Props) {
  const [photos, setPhotos] = useState<(ViewerPhoto & { authorUid: string })[]>([])
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading || done) return
    setLoading(true)
    const constraints = [where('hasPhotos', '==', true), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)]
    const q = query(
      messages,
      ...(cursor ? [...constraints, startAfter(cursor)] : constraints),
    )
    const snap = await getDocs(q)
    const next = snap.docs.flatMap((d) => {
      const data = d.data()
      const createdAt = data.createdAt?.toDate?.() ?? null
      return ((data.attachments ?? []) as Attachment[]).map((attachment) => ({
        attachment,
        authorUid: data.authorUid as string,
        author: '',
        createdAt,
      }))
    })
    setPhotos((prev) => [...prev, ...next])
    setCursor(snap.docs.at(-1) ?? cursor)
    setDone(snap.size < PAGE_SIZE)
    setLoading(false)
  }, [messages, cursor, loading, done])

  // 맨 아래가 보이면 다음 사진을 불러온다.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) void loadMore()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const named = photos.map((p) => ({ ...p, author: profiles[p.authorUid]?.name ?? '나간 팀원' }))
  const groups = groupByMonth(named)

  return (
    <div className="overlay">
      <header className="page-header">
        <button type="button" className="ghost" onClick={onClose} aria-label="채팅으로 돌아가기">
          ‹
        </button>
        <h2>사진</h2>
        <span />
      </header>
      <div className="overlay-body">
        {groups.map(({ label, items }) => (
          <section key={label}>
            <h3 className="month">{label}</h3>
            <div className="grid">
              {items.map(({ photo, index }) => (
                <button
                  type="button"
                  key={photo.attachment.path}
                  className="grid-cell"
                  onClick={() => setViewing(index)}
                >
                  <StorageImage path={photo.attachment.thumbPath} className="grid-image" />
                </button>
              ))}
            </div>
          </section>
        ))}
        {done && photos.length === 0 && <p className="center muted">아직 올라온 사진이 없습니다.</p>}
        <div ref={sentinel} className="sentinel">
          {loading && <span className="muted small">불러오는 중…</span>}
        </div>
      </div>
      {viewing !== null && <PhotoViewer photos={named} index={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function groupByMonth<T extends ViewerPhoto>(photos: T[]) {
  const groups: { label: string; items: { photo: T; index: number }[] }[] = []
  photos.forEach((photo, index) => {
    const d = photo.createdAt
    const label = d ? `${d.getFullYear()}년 ${d.getMonth() + 1}월` : '날짜 없음'
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] })
    groups.at(-1)!.items.push({ photo, index })
  })
  return groups
}
