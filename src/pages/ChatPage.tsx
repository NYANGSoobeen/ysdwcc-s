import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { deleteMessage, sendMessage, type Attachment } from '../chat.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { db } from '../firebase.ts'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { PhotoGallery } from './PhotoGallery.tsx'
import { MenuButton } from '../menu.tsx'

const PAGE_SIZE = 50
const MAX_PHOTOS = 10

type Message = {
  id: string
  authorUid: string
  body: string
  attachments: Attachment[]
  createdAt: Timestamp | null
  pending: boolean
}

export function ChatPage({ team, uid }: { team: Team; uid: string }) {
  const [count, setCount] = useState(PAGE_SIZE)
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)
  const profiles = useMemberProfiles(Object.keys(team.members))
  const canWrite = team.members[uid] !== 'viewer'
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const q = query(collection(db, 'teams', team.id, 'messages'), orderBy('createdAt', 'desc'), limit(count))
    return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      setHasMore(snap.size >= count)
      setMessages(
        snap.docs
          .map((d) => {
            const data = d.data({ serverTimestamps: 'estimate' })
            return {
              id: d.id,
              authorUid: data.authorUid,
              body: data.body ?? '',
              attachments: data.attachments ?? [],
              createdAt: data.createdAt ?? null,
              pending: d.metadata.hasPendingWrites,
            }
          })
          .reverse(),
      )
    })
  }, [team.id, count])

  // 새 메시지가 오면 맨 아래로 내린다 (위로 스크롤해 읽는 중이면 그대로 둔다).
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = listRef.current!
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  async function remove(message: Message) {
    const photoNote = message.attachments.length ? ` 사진 ${message.attachments.length}장도 함께 지워집니다.` : ''
    if (!confirm(`이 메시지를 삭제할까요? 되돌릴 수 없습니다.${photoNote}`)) return
    try {
      await deleteMessage(team.id, message.id)
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  function openPhoto(message: Message, index: number) {
    const author = profiles[message.authorUid]?.name ?? '나간 팀원'
    const createdAt = message.createdAt?.toDate() ?? null
    setViewer({ photos: message.attachments.map((attachment) => ({ attachment, author, createdAt })), index })
  }

  let lastDay = ''
  return (
    <div className="chat">
      <header className="page-header">
        <MenuButton />
        <h2>{team.name}</h2>
        <button type="button" className="ghost" onClick={() => setShowGallery(true)}>
          사진
        </button>
      </header>
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {hasMore && (
          <button
            type="button"
            className="ghost more"
            onClick={() => {
              stickToBottom.current = false
              setCount((c) => c + PAGE_SIZE)
            }}
          >
            이전 메시지 더 보기
          </button>
        )}
        {messages.length === 0 && <p className="center muted">첫 메시지를 남겨 보세요.</p>}
        {messages.map((m) => {
          const date = m.createdAt?.toDate()
          const day = date ? date.toLocaleDateString('ko-KR', { dateStyle: 'full' }) : ''
          const showDay = day && day !== lastDay
          if (day) lastDay = day
          const mine = m.authorUid === uid
          return (
            <div key={m.id}>
              {showDay && <div className="day">{day}</div>}
              <div className={mine ? 'message mine' : 'message'}>
                {!mine && <div className="author">{profiles[m.authorUid]?.name ?? '나간 팀원'}</div>}
                <div className="bubble-row">
                  <div className="bubble">
                    {m.attachments.length > 0 && (
                      <div className={m.attachments.length === 1 ? 'photos single' : 'photos'}>
                        {m.attachments.map((a, i) => (
                          <StorageImage
                            key={a.thumbPath}
                            path={a.thumbPath}
                            className="photo"
                            onClick={() => openPhoto(m, i)}
                          />
                        ))}
                      </div>
                    )}
                    {m.body && <p>{m.body}</p>}
                  </div>
                  <div className="meta">
                    {mine && !m.pending && (
                      <button type="button" className="link danger" onClick={() => remove(m)}>
                        삭제
                      </button>
                    )}
                    <span>{m.pending ? '보내는 중' : date?.toLocaleTimeString('ko-KR', { timeStyle: 'short' })}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {canWrite ? (
        <Composer
          teamId={team.id}
          onSent={() => {
            stickToBottom.current = true
          }}
        />
      ) : (
        <p className="composer muted small">보기 권한은 메시지를 보낼 수 없습니다.</p>
      )}
      {showGallery && <PhotoGallery teamId={team.id} profiles={profiles} onClose={() => setShowGallery(false)} />}
      {viewer && <PhotoViewer photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

function Composer({ teamId, onSent }: { teamId: string; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const previews = usePreviews(photos)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim() && photos.length === 0) return
    setBusy(true)
    try {
      onSent()
      await sendMessage(teamId, body.trim(), photos)
      setBody('')
      setPhotos([])
    } catch (err) {
      alert(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      {photos.length > 0 && (
        <div className="previews">
          {previews.map((url, i) => (
            <button
              type="button"
              key={url}
              className="preview"
              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
              aria-label="사진 빼기"
            >
              <img src={url} alt="" />
              <span>✕</span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-row">
        <button type="button" className="ghost icon" onClick={() => fileInput.current?.click()} aria-label="사진 추가" disabled={busy}>
          📷
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])]
            setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS))
            e.target.value = ''
          }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="메시지 입력"
          rows={1}
          disabled={busy}
        />
        <button className="primary" disabled={busy || (!body.trim() && photos.length === 0)}>
          {busy ? '…' : '보내기'}
        </button>
      </div>
    </form>
  )
}

function usePreviews(files: File[]) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f))
    setUrls(next)
    return () => next.forEach((u) => URL.revokeObjectURL(u))
  }, [files])
  return urls
}
