import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { deleteMessage, sendMessage, type Attachment } from '../chat.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { db } from '../firebase.ts'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { PhotoGallery } from './PhotoGallery.tsx'
import { MenuButton } from '../menu.tsx'
import { useItemMenu } from '../ui/ContextMenu.tsx'
import { ask, isTouchUi, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'

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

  // 🔍 채팅 검색: 대화는 그대로 두고 찾은 말 위치로 이동한다 (▲ 이전, ▼ 다음, Enter = 이전).
  // 지금은 불러온 메시지 안에서 찾는다.
  const { query: searchQuery } = useTabSearch()
  const [searchOpen, setSearchOpen] = useState(() => Boolean(searchQuery))
  const q = searchQuery.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? messages.filter((m) => m.body.toLowerCase().includes(q)).map((m) => m.id) : []),
    [messages, q],
  )
  // 고른 말(없거나 결과에서 빠지면 가장 최근에 찾은 말)
  const [picked, setPicked] = useState<string | null>(null)
  const currentMatch = picked && matches.includes(picked) ? picked : (matches.at(-1) ?? null)
  const matchIndex = currentMatch ? matches.indexOf(currentMatch) : -1
  useEffect(() => setPicked(null), [q])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (!q) {
      // 검색을 지우면 맨 아래(최신)로
      stickToBottom.current = true
      el.scrollTop = el.scrollHeight
      return
    }
    if (!currentMatch) return
    stickToBottom.current = false
    el.querySelector(`[data-msg="${currentMatch}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [q, currentMatch])

  const older = () => matches.length && setPicked(matches[matchIndex <= 0 ? matches.length - 1 : matchIndex - 1])
  const newer = () => matches.length && setPicked(matches[matchIndex >= matches.length - 1 ? 0 : matchIndex + 1])

  // 키보드가 열려 화면이 줄거나 사진이 늦게 떠서 길어져도, 맨 아래를 보고 있었으면 맨 아래를 유지한다.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const keep = () => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight
    }
    const observer = new ResizeObserver(keep)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    const mo = new MutationObserver(() => {
      for (const child of el.children) observer.observe(child)
    })
    mo.observe(el, { childList: true })
    return () => {
      observer.disconnect()
      mo.disconnect()
    }
  }, [])

  function onScroll() {
    const el = listRef.current!
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  async function remove(message: Message) {
    const photoNote = message.attachments.length ? ` 사진 ${message.attachments.length}장도 함께 지워집니다.` : ''
    if (!(await ask({ message: `이 메시지를 삭제할까요? 되돌릴 수 없습니다.${photoNote}`, ok: '삭제', danger: true }))) return
    try {
      await deleteMessage(team.id, message.id)
    } catch (err) {
      toast(errorMessage(err), { error: true })
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
        <div className="header-actions">
          <button
            type="button"
            className={searchOpen ? 'ghost icon active' : 'ghost icon'}
            onClick={() => setSearchOpen(!searchOpen)}
            aria-label="채팅 검색"
            aria-pressed={searchOpen}
          >
            🔍
          </button>
          <button type="button" className="ghost" onClick={() => setShowGallery(true)}>
            사진
          </button>
        </div>
      </header>
      {searchOpen && (
        <SearchBar placeholder="대화 내용 검색" autoFocus onEnter={older} onCancel={() => setSearchOpen(false)}>
          {q && (
            <span className="search-nav">
              <span className="small muted" aria-live="polite">
                {matches.length ? `${matchIndex + 1} / ${matches.length}건` : '0건'}
              </span>
              <button type="button" className="ghost icon" onClick={older} disabled={!matches.length} aria-label="이전 찾기"
                onPointerDown={(e) => e.preventDefault()}>
                ▲
              </button>
              <button type="button" className="ghost icon" onClick={newer} disabled={!matches.length} aria-label="다음 찾기"
                onPointerDown={(e) => e.preventDefault()}>
                ▼
              </button>
            </span>
          )}
        </SearchBar>
      )}
      <div
        className="messages"
        ref={listRef}
        onScroll={onScroll}
        // 휴대폰: 대화 영역을 누르면 키보드를 닫는다.
        onPointerDown={(e) => {
          const active = document.activeElement
          if (e.pointerType !== 'mouse' && active instanceof HTMLTextAreaElement && active.closest('.composer')) active.blur()
        }}
      >
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
            <div key={m.id} data-msg={m.id}>
              {showDay && <div className="day">{day}</div>}
              <MessageItem
                message={m}
                mine={mine}
                author={profiles[m.authorUid]?.name ?? '나간 팀원'}
                time={m.pending ? '보내는 중' : (date?.toLocaleTimeString('ko-KR', { timeStyle: 'short' }) ?? '')}
                highlight={currentMatch === m.id}
                onOpenPhoto={(i) => openPhoto(m, i)}
                onDelete={() => void remove(m)}
              />
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

function MessageItem(props: {
  message: Message
  mine: boolean
  author: string
  time: string
  highlight: boolean
  onOpenPhoto: (index: number) => void
  onDelete: () => void
}) {
  const { message: m, mine } = props
  // 메시지 메뉴: 휴대폰 길게 누르기, PC 오른쪽 클릭
  const menu = useItemMenu(() => [
    ...(m.body
      ? [{ icon: '📋', label: '복사', onSelect: () => void copyText(m.body) }]
      : []),
    ...(mine && !m.pending ? [{ icon: '🗑️', label: '삭제', danger: true, onSelect: props.onDelete }] : []),
  ])
  return (
    <div className={`message${mine ? ' mine' : ''}${props.highlight ? ' found' : ''}`}>
      {!mine && <div className="author">{props.author}</div>}
      <div className="bubble-row">
        <div className="bubble has-menu" {...menu}>
          {m.attachments.length > 0 && (
            <div className={m.attachments.length === 1 ? 'photos single' : 'photos'}>
              {m.attachments.map((a, i) => (
                <StorageImage key={a.thumbPath} path={a.thumbPath} className="photo" onClick={() => props.onOpenPhoto(i)} />
              ))}
            </div>
          )}
          {m.body && <p>{m.body}</p>}
        </div>
        <div className="meta">
          <span>{props.time}</span>
        </div>
      </div>
    </div>
  )
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('복사했습니다.')
  } catch {
    toast('복사하지 못했습니다.', { error: true })
  }
}

function Composer({ teamId, onSent }: { teamId: string; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [uploading, setUploading] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const previews = usePreviews(photos)

  // 입력칸은 글이 길어지면 5줄까지 늘어난다.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [body])

  // 보내기: 입력칸을 바로 비우고(키보드는 그대로 열어 둠) 뒤에서 보낸다. 실패하면 글을 되돌린다.
  async function send() {
    const text = body.trim()
    const pics = photos
    if (!text && pics.length === 0) return
    onSent()
    setBody('')
    setPhotos([])
    if (pics.length) setUploading((n) => n + 1)
    try {
      await sendMessage(teamId, text, pics)
    } catch (err) {
      setBody((now) => (now ? now : text))
      setPhotos((now) => (now.length ? now : pics))
      toast(errorMessage(err), { error: true })
    } finally {
      if (pics.length) setUploading((n) => n - 1)
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void send()
      }}
    >
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
      {uploading > 0 && <p className="muted small uploading">사진 올리는 중…</p>}
      <div className="composer-row">
        <button type="button" className="ghost icon" onClick={() => fileInput.current?.click()} aria-label="사진 추가">
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
          ref={textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // PC: Enter = 보내기, Shift/Ctrl+Enter = 줄바꿈. 휴대폰: Enter = 줄바꿈(보내기는 버튼).
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || isTouchUi()) return
            if (e.shiftKey) return
            e.preventDefault()
            if (e.ctrlKey || e.metaKey) {
              const el = e.currentTarget
              const { selectionStart: a, selectionEnd: b } = el
              setBody(body.slice(0, a) + '\n' + body.slice(b))
              requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1))
              return
            }
            void send()
          }}
          placeholder="메시지 입력"
          rows={1}
          enterKeyHint={isTouchUi() ? 'enter' : 'send'}
        />
        <button
          className="primary"
          disabled={!body.trim() && photos.length === 0}
          // 보내기를 눌러도 입력칸에서 포커스가 빠지지 않게 → 휴대폰 키보드가 닫히지 않는다.
          onPointerDown={(e) => e.preventDefault()}
        >
          보내기
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
