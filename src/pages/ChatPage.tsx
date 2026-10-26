import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import {
  createChannel,
  deleteChannel,
  deleteMessage,
  MAIN_CHANNEL,
  messagesRef,
  renameChannel,
  sendMessage,
  type Channel,
} from '../chat.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { useMessages, type Message } from '../useMessages.ts'
import { PhotoGallery } from './PhotoGallery.tsx'
import { MenuButton } from '../menu.tsx'
import { MoreButton, useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, askText, isTouchUi, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'

const MAX_PHOTOS = 10

type ChatProps = {
  team: Team
  uid: string
  channels: Channel[] | null
  channelId: string | null
  desktop: boolean
  onOpenChannel: (id: string | null) => void
}

// 채팅 탭. 휴대폰은 방 목록 → 방, PC는 왼쪽 메뉴에서 방을 고르고 여기에는 방만 보인다.
export function ChatPage({ team, uid, channels, channelId, desktop, onOpenChannel }: ChatProps) {
  if (!channels) return <div className="center muted">불러오는 중…</div>
  if (!channelId && !desktop) return <ChatRoomList team={team} uid={uid} channels={channels} onOpen={onOpenChannel} />
  const room = channels.find((c) => c.id === channelId) ?? channels[0]
  return (
    <ChatRoom
      key={room.id}
      team={team}
      uid={uid}
      room={room}
      onBack={desktop ? undefined : () => onOpenChannel(null)}
      onLeft={() => onOpenChannel(desktop ? MAIN_CHANNEL : null)}
    />
  )
}

// 새 채팅방 만들기 (편집 권한 이상)
export async function promptCreateChannel(teamId: string) {
  const name = await askText({ title: '새 채팅방', label: '채팅방 이름', placeholder: '예: 오전 근무', ok: '만들기', required: '이름을 입력하세요.' })
  if (!name?.trim()) return null
  try {
    return await createChannel(teamId, name.trim().slice(0, 30))
  } catch (err) {
    toast(errorMessage(err), { error: true })
    return null
  }
}

function ChatRoomList({ team, uid, channels, onOpen }: { team: Team; uid: string; channels: Channel[]; onOpen: (id: string) => void }) {
  const canWrite = team.members[uid] !== 'viewer'
  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>채팅</h2>
        {canWrite ? (
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const id = await promptCreateChannel(team.id)
              if (id) onOpen(id)
            }}
          >
            + 새 방
          </button>
        ) : (
          <span />
        )}
      </header>
      <div className="page-body">
        <ul className="list">
          {channels.map((c) => (
            <li key={c.id}>
              <button type="button" className="row row-button" onClick={() => onOpen(c.id)}>
                <span className="room-icon" aria-hidden="true">
                  💬
                </span>
                <div className="row-main">
                  <strong>{c.name}</strong>
                  {c.id === MAIN_CHANNEL && <span className="muted small">팀원 모두 · 기본 방</span>}
                </div>
                <span aria-hidden="true" className="muted">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ChatRoom({ team, uid, room, onBack, onLeft }: { team: Team; uid: string; room: Channel; onBack?: () => void; onLeft: () => void }) {
  const ref = useMemo(() => messagesRef(team.id, room.id), [team.id, room.id])
  const { messages, hasMore, loaded, loadingOlder, loadOlder } = useMessages(ref)
  const [showGallery, setShowGallery] = useState(false)
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)
  const profiles = useMemberProfiles(Object.keys(team.members))
  const myRole = team.members[uid]
  const canWrite = myRole !== 'viewer'
  const isAdmin = myRole === 'admin'
  const canManage = room.id === MAIN_CHANNEL ? isAdmin : isAdmin || (canWrite && room.createdBy === uid)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  // 이전 메시지를 앞에 붙일 때 보던 자리를 유지하기 위한 값
  const restore = useRef<{ height: number; top: number } | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const lastId = messages.at(-1)?.id

  // 새 메시지가 오면, 맨 아래를 보고 있을 때만 따라 내려간다. 위에서 읽는 중이면 "새 메시지" 버튼을 띄운다.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
      return
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!lastId) return
    if (stickToBottom.current) setNewBelow(false)
    else if (messages.at(-1)?.authorUid !== uid) setNewBelow(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId])

  async function showOlder() {
    const el = listRef.current
    // 불러오는 중에 스크롤이 또 와도 처음 기록한 자리를 지키도록 한 번만 부른다.
    if (!el || restore.current) return
    restore.current = { height: el.scrollHeight, top: el.scrollTop }
    const count = await loadOlder()
    if (!count) restore.current = null
  }

  function toBottom() {
    const el = listRef.current
    if (!el) return
    stickToBottom.current = true
    setNewBelow(false)
    el.scrollTop = el.scrollHeight
  }

  async function rename() {
    const name = await askText({ title: '채팅방 이름 바꾸기', label: '채팅방 이름', value: room.name, ok: '바꾸기', required: '이름을 입력하세요.' })
    if (!name?.trim() || name.trim() === room.name) return
    try {
      await renameChannel(team.id, room.id, name.trim().slice(0, 30))
      toast('이름을 바꿨어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  async function removeRoom() {
    const ok = await ask({
      title: '채팅방 삭제',
      message: `"${room.name}" 방을 삭제할까요?\n방의 메시지와 사진이 모두 영구 삭제되며 되돌릴 수 없습니다.`,
      ok: '삭제',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteChannel(team.id, room.id)
      toast('채팅방을 삭제했어요.')
      onLeft()
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const roomActions = (): MenuAction[] => [
    { icon: '🖼️', label: '사진 모아보기', onSelect: () => setShowGallery(true) },
    ...(canManage ? [{ icon: '✏️', label: '방 이름 바꾸기', onSelect: () => void rename() }] : []),
    ...(canManage && room.id !== MAIN_CHANNEL
      ? [{ icon: '🗑️', label: '방 삭제', danger: true, onSelect: () => void removeRoom() }]
      : []),
  ]

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
    if (stickToBottom.current) setNewBelow(false)
    // 위로 올려 맨 위 가까이 오면 이전 메시지를 더 불러온다.
    if (el.scrollTop < 200 && hasMore && !loadingOlder) void showOlder()
  }

  async function remove(message: Message) {
    const photoNote = message.attachments.length ? ` 사진 ${message.attachments.length}장도 함께 지워집니다.` : ''
    if (!(await ask({ message: `이 메시지를 삭제할까요? 되돌릴 수 없습니다.${photoNote}`, ok: '삭제', danger: true }))) return
    try {
      await deleteMessage(team.id, room.id, message.id)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  function openPhoto(message: Message, index: number) {
    const author = profiles[message.authorUid]?.name ?? '나간 팀원'
    const createdAt = message.createdAt?.toDate() ?? null
    setViewer({ photos: message.attachments.map((attachment) => ({ attachment, author, createdAt })), index })
  }

  return (
    <div className="chat">
      <header className="page-header">
        {onBack ? (
          <button type="button" className="ghost menu-button" onClick={onBack} aria-label="채팅방 목록">
            ‹
          </button>
        ) : (
          <MenuButton />
        )}
        <h2>{room.name}</h2>
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
          <MoreButton actions={roomActions} title={room.name} label="채팅방 메뉴" />
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
        {loaded && (
          <div className="history-edge muted small">
            {loadingOlder ? (
              '이전 메시지 불러오는 중…'
            ) : hasMore ? (
              <button type="button" className="ghost more" onClick={() => void showOlder()}>
                이전 메시지 더 보기
              </button>
            ) : (
              messages.length > 0 && '대화의 처음입니다'
            )}
          </div>
        )}
        {loaded && messages.length === 0 && <p className="center muted">첫 메시지를 남겨 보세요.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const next = messages[i + 1]
          const date = m.createdAt?.toDate()
          const day = date ? date.toLocaleDateString('ko-KR', { dateStyle: 'full' }) : ''
          const prevDay = prev?.createdAt?.toDate().toLocaleDateString('ko-KR', { dateStyle: 'full' }) ?? ''
          const showDay = Boolean(day) && day !== prevDay
          // 같은 사람이 같은 1분 안에 보낸 말은 묶는다: 이름·사진은 첫 말에만, 시간은 마지막 말에만.
          const groupedWithPrev = !showDay && sameGroup(prev, m)
          const groupedWithNext = sameGroup(m, next)
          const mine = m.authorUid === uid
          return (
            <div key={m.id} data-msg={m.id} className={groupedWithPrev ? 'msg-wrap grouped' : 'msg-wrap'}>
              {showDay && <div className="day">{day}</div>}
              <MessageItem
                message={m}
                mine={mine}
                authorUid={m.authorUid}
                author={profiles[m.authorUid]?.name ?? '나간 팀원'}
                showAuthor={!mine && !groupedWithPrev}
                time={groupedWithNext ? '' : m.pending ? '보내는 중' : (date?.toLocaleTimeString('ko-KR', { timeStyle: 'short' }) ?? '')}
                highlight={currentMatch === m.id}
                onOpenPhoto={(i) => openPhoto(m, i)}
                onDelete={() => void remove(m)}
              />
            </div>
          )
        })}
      </div>
      {newBelow && (
        <button type="button" className="new-below" onClick={toBottom}>
          새 메시지 ↓
        </button>
      )}
      {canWrite ? (
        <Composer
          teamId={team.id}
          channelId={room.id}
          onSent={() => {
            stickToBottom.current = true
          }}
        />
      ) : (
        <p className="composer muted small">보기 권한은 메시지를 보낼 수 없습니다.</p>
      )}
      {showGallery && <PhotoGallery messages={ref} profiles={profiles} onClose={() => setShowGallery(false)} />}
      {viewer && <PhotoViewer photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

function MessageItem(props: {
  message: Message
  mine: boolean
  authorUid: string
  author: string
  showAuthor: boolean
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
      {!mine && (props.showAuthor ? <Avatar uid={props.authorUid} name={props.author} /> : <span className="avatar-space" />)}
      {props.showAuthor && <div className="author">{props.author}</div>}
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
        {props.time && (
          <div className="meta">
            <span>{props.time}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// 같은 사람, 같은 날 같은 분(시:분)이면 한 묶음
function sameGroup(a: Message | undefined, b: Message | undefined) {
  if (!a || !b || a.authorUid !== b.authorUid || !a.createdAt || !b.createdAt) return false
  return Math.floor(a.createdAt.toMillis() / 60_000) === Math.floor(b.createdAt.toMillis() / 60_000)
}

// 프로필 사진 대신 이름 첫 글자 동그라미 (사람마다 색이 다르다)
const AVATAR_COLORS = ['#16587b', '#3d7fa3', '#5b8a72', '#a0694b', '#7a5c99', '#b0516a', '#4f7d8c']
function Avatar({ uid, name }: { uid: string; name: string }) {
  let hash = 0
  for (const ch of uid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
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

function Composer({ teamId, channelId, onSent }: { teamId: string; channelId: string; onSent: () => void }) {
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
      await sendMessage(teamId, channelId, text, pics)
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
