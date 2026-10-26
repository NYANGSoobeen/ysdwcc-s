import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import {
  createChannel,
  deleteChannel,
  deleteMessage,
  editMessage,
  FILE_EXTS,
  fileProblem,
  isPhotoFile,
  MAIN_CHANNEL,
  MAX_PHOTOS,
  messagesRef,
  photoUrl,
  REACTIONS,
  renameChannel,
  replyPreview,
  sendMessage,
  setReaction,
  type Channel,
  type ChatFile,
  type ReplyTo,
} from '../chat.ts'
import { fileName, saveFile } from '../download.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { useMessages, type Message } from '../useMessages.ts'
import { PhotoGallery } from './PhotoGallery.tsx'
import { MenuButton } from '../menu.tsx'
import { MoreButton, openMenu, useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, askText, isTouchUi, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'


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
  const { messages, hasMore, loaded, loadingOlder, loadOlder, peek } = useMessages(ref)
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
  // 답장할 말 / 고치는 중인 내 말 (입력칸 위에 표시)
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  // 답장 원문으로 이동했을 때 잠깐 반짝일 말
  const [flashId, setFlashId] = useState<string | null>(null)
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
    const ok = await ask({
      message: `이 메시지를 삭제할까요? 내용은 영구 삭제되고 "삭제된 메시지입니다"로 보입니다.${photoNote}`,
      ok: '삭제',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteMessage(team.id, room.id, message)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  async function react(message: Message, emoji: string | null) {
    try {
      await setReaction(team.id, room.id, message.id, uid, emoji)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  // 답장 원문으로 이동: 불러온 메시지에 없으면 이전 메시지를 100개씩 더 불러와 찾는다 (최대 3000개).
  async function jumpTo(id: string) {
    for (let i = 0; i < 30 && !peek().some((m) => m.id === id); i++) {
      if (!(await loadOlder())) break
    }
    if (!peek().some((m) => m.id === id)) {
      toast('원문을 찾지 못했어요. 삭제되었을 수 있어요.', { error: true })
      return
    }
    stickToBottom.current = false
    setFlashId(null)
    requestAnimationFrame(() => setFlashId(id))
  }

  useEffect(() => {
    if (!flashId) return
    listRef.current?.querySelector(`[data-msg="${flashId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = setTimeout(() => setFlashId(null), 2500)
    return () => clearTimeout(t)
  }, [flashId])

  // 사진 크게 보기: 이 방에 불러온 사진 전체를 ← → / 밀어서 넘겨 본다.
  function openPhoto(message: Message, index: number) {
    const photos: ViewerPhoto[] = []
    let start = 0
    for (const m of messages) {
      if (m.deleted) continue
      const author = profiles[m.authorUid]?.name ?? '나간 팀원'
      const createdAt = m.createdAt?.toDate() ?? null
      m.attachments.forEach((attachment, i) => {
        if (m.id === message.id && i === index) start = photos.length
        photos.push({ attachment, author, createdAt })
      })
    }
    setViewer({ photos, index: start })
  }

  // 끌어다 놓기: 채팅 화면 아무 데나 사진·파일을 놓으면 보낼 준비 (PC)
  const addToComposer = useRef<(files: File[]) => void>(() => {})
  const registerAdd = useCallback((add: (files: File[]) => void) => {
    addToComposer.current = add
  }, [])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files')

  return (
    <div
      className="chat"
      onDragEnter={(e) => {
        if (!hasFiles(e) || !canWrite) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (hasFiles(e) && canWrite) e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e) || !canWrite) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        addToComposer.current([...e.dataTransfer.files])
      }}
    >
      {dragging && <div className="drop-overlay">여기에 놓으면 보낼 사진·파일로 추가돼요</div>}
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
                highlight={currentMatch === m.id || flashId === m.id}
                uid={uid}
                canWrite={canWrite}
                profiles={profiles}
                original={m.replyTo ? messages.find((x) => x.id === m.replyTo!.id) : undefined}
                onOpenPhoto={(i) => openPhoto(m, i)}
                onDelete={() => void remove(m)}
                onReply={() => {
                  setEditing(null)
                  setReplyTo({ id: m.id, authorUid: m.authorUid, text: replyPreview(m) })
                }}
                onEdit={() => {
                  setReplyTo(null)
                  setEditing(m)
                }}
                onReact={(emoji) => void react(m, emoji)}
                onJump={(id) => void jumpTo(id)}
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
          replyTo={replyTo}
          replyName={replyTo ? (profiles[replyTo.authorUid]?.name ?? '나간 팀원') : ''}
          editing={editing}
          onCancel={() => {
            setReplyTo(null)
            setEditing(null)
          }}
          onSent={() => {
            stickToBottom.current = true
            setReplyTo(null)
            setEditing(null)
          }}
          registerAdd={registerAdd}
        />
      ) : (
        <p className="composer muted small">보기 권한은 메시지를 보낼 수 없습니다.</p>
      )}
      {showGallery && <PhotoGallery messages={ref} profiles={profiles} onClose={() => setShowGallery(false)} />}
      {viewer && <PhotoViewer photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

const URL_RE = /https?:\/\/[^\s<>"']+/g

function MessageItem(props: {
  message: Message
  mine: boolean
  authorUid: string
  author: string
  showAuthor: boolean
  time: string
  highlight: boolean
  uid: string
  canWrite: boolean
  profiles: Record<string, { name: string }>
  original?: Message
  onOpenPhoto: (index: number) => void
  onDelete: () => void
  onReply: () => void
  onEdit: () => void
  onReact: (emoji: string | null) => void
  onJump: (id: string) => void
}) {
  const { message: m, mine, uid, profiles } = props
  const links = m.body.match(URL_RE) ?? []
  const myReaction = m.reactions[uid] ?? null

  function pickSticker(x: number, y: number) {
    openMenu(
      [
        ...REACTIONS.map((emoji) => ({
          icon: emoji,
          compact: true,
          label: emoji === myReaction ? '떼기' : '붙이기',
          onSelect: () => props.onReact(emoji === myReaction ? null : emoji),
        })),
        ...(myReaction ? [{ icon: '✖️', label: `내 스티커 떼기 (${myReaction})`, onSelect: () => props.onReact(null) }] : []),
      ],
      x,
      y,
      '스티커 붙이기',
    )
  }

  async function savePhotos() {
    const stamp = (m.createdAt?.toDate() ?? new Date()).toISOString().slice(0, 10).replaceAll('-', '')
    for (const [i, a] of m.attachments.entries()) {
      await saveFile(await photoUrl(a.path), fileName(`지원팀_${stamp}_${i + 1}`, a.path.split('.').pop() ?? 'jpg'))
    }
  }

  // 메시지 메뉴: 휴대폰 길게 누르기, PC 오른쪽 클릭
  // 스티커 고르기를 누른 자리 가까이에 띄우려고 마지막으로 누른 자리를 기억한다.
  const point = useRef({ x: innerWidth / 2, y: innerHeight / 2 })
  const actions = (): MenuAction[] =>
    m.deleted || m.pending
      ? []
      : [
          ...(props.canWrite ? [{ icon: '↩️', label: '답장', onSelect: props.onReply }] : []),
          ...(m.body ? [{ icon: '📋', label: '복사', onSelect: () => void copyText(m.body) }] : []),
          ...(mine && m.body ? [{ icon: '✏️', label: '수정', onSelect: props.onEdit }] : []),
          ...(m.attachments.length
            ? [{ icon: '💾', label: m.attachments.length > 1 ? `사진 ${m.attachments.length}장 저장` : '사진 저장', onSelect: () => void savePhotos() }]
            : []),
          ...(m.files.length
            ? [{ icon: '💾', label: m.files.length > 1 ? `파일 ${m.files.length}개 저장` : '파일 저장', onSelect: () => void saveChatFiles(m.files) }]
            : []),
          ...(links.length
            ? [{ icon: '🔗', label: links.length > 1 ? `링크 ${links.length}개 복사` : '링크 복사', onSelect: () => void copyText(links.join('\n')) }]
            : []),
          { icon: '🏷️', label: myReaction ? `스티커 바꾸기 (${myReaction})` : '스티커 붙이기', onSelect: () => setTimeout(() => pickSticker(point.current.x, point.current.y), 0) },
          ...(mine ? [{ icon: '🗑️', label: '삭제', danger: true, onSelect: props.onDelete }] : []),
        ]
  const menu = useItemMenu(actions)

  // 스티커 모아 보기: { "👍": [uid, ...] }
  const counts = new Map<string, string[]>()
  for (const [who, emoji] of Object.entries(m.reactions)) counts.set(emoji, [...(counts.get(emoji) ?? []), who])

  const reply = m.replyTo
  return (
    <div className={`message${mine ? ' mine' : ''}${props.highlight ? ' found' : ''}`}>
      {!mine && (props.showAuthor ? <Avatar uid={props.authorUid} name={props.author} /> : <span className="avatar-space" />)}
      {props.showAuthor && <div className="author">{props.author}</div>}
      <div className="bubble-row">
        {m.deleted ? (
          <div className="bubble deleted">
            <p>삭제된 메시지입니다</p>
          </div>
        ) : (
          <div
            className="bubble has-menu"
            {...menu}
            onPointerDownCapture={(e) => (point.current = { x: e.clientX, y: e.clientY })}
          >
            {reply && (
              <button type="button" className="reply-quote" onClick={() => props.onJump(reply.id)}>
                <strong>↩ {profiles[reply.authorUid]?.name ?? '나간 팀원'}에게 답장</strong>
                <span>{props.original?.deleted ? '삭제된 메시지입니다' : reply.text}</span>
              </button>
            )}
            {m.attachments.length > 0 && (
              // 카톡처럼: 1장은 크게, 2·4장은 2칸, 나머지는 3칸씩
              <div className={`photos cols-${photoCols(m.attachments.length)}`}>
                {m.attachments.map((a, i) => (
                  <StorageImage key={a.thumbPath} path={a.thumbPath} className="photo" onClick={() => props.onOpenPhoto(i)} />
                ))}
              </div>
            )}
            {m.files.map((f) => (
              <button key={f.path} type="button" className="file-card" onClick={() => void openChatFile(f)}>
                <span className="file-icon" aria-hidden="true">
                  {fileIcon(f.name)}
                </span>
                <span className="file-text">
                  <strong>{f.name}</strong>
                  <span>{formatSize(f.size)} · {isTouchUi() || !f.name.toLowerCase().endsWith('.pdf') ? '눌러서 저장' : '눌러서 열기'}</span>
                </span>
              </button>
            ))}
            {m.body && <p>{linkify(m.body)}</p>}
          </div>
        )}
        {(props.time || m.editedAt) && (
          <div className="meta">
            {m.editedAt && !m.deleted && <span>수정됨</span>}
            {props.time && <span>{props.time}</span>}
          </div>
        )}
      </div>
      {!m.deleted && counts.size > 0 && (
        <div className="reactions">
          {[...counts.entries()].map(([emoji, who]) => (
            <button
              key={emoji}
              type="button"
              className={who.includes(uid) ? 'reaction mine' : 'reaction'}
              title={who.map((w) => profiles[w]?.name ?? '나간 팀원').join(', ')}
              onClick={() => props.onReact(who.includes(uid) ? null : emoji)}
            >
              {emoji} {who.length}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 주소는 눌러서 열리게 한다.
function linkify(text: string) {
  const parts: (string | React.ReactElement)[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const i = match.index ?? 0
    if (i > last) parts.push(text.slice(last, i))
    parts.push(
      <a key={i} href={match[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {match[0]}
      </a>,
    )
    last = i + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function photoCols(n: number) {
  if (n === 1) return 1
  if (n === 2 || n === 4) return 2
  return 3
}

// 파일 카드: PC에서 PDF는 새 탭으로 열고, 나머지(그리고 휴대폰)는 저장한다.
async function openChatFile(f: ChatFile) {
  try {
    const url = await photoUrl(f.path)
    if (!isTouchUi() && f.name.toLowerCase().endsWith('.pdf')) window.open(url, '_blank', 'noopener')
    else await saveFile(url, f.name)
  } catch {
    toast('파일을 열지 못했어요. 삭제되었을 수 있어요.', { error: true })
  }
}

async function saveChatFiles(files: ChatFile[]) {
  for (const f of files) {
    try {
      await saveFile(await photoUrl(f.path), f.name)
    } catch {
      toast(`"${f.name}"을(를) 저장하지 못했어요.`, { error: true })
    }
  }
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

function Composer(props: {
  teamId: string
  channelId: string
  replyTo: ReplyTo | null
  replyName: string
  editing: Message | null
  onCancel: () => void
  onSent: () => void
  // 채팅 화면에 끌어다 놓은 파일을 받을 수 있게 붙이는 함수를 알려 준다.
  registerAdd: (add: (files: File[]) => void) => void
}) {
  const { teamId, channelId, replyTo, editing, onSent } = props
  const [body, setBody] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const previews = usePreviews(photos)

  // 사진은 최대 30장, 파일은 엑셀·PDF·한글·워드·압축 등 10MB 이하
  function addFiles(list: File[]) {
    if (editing || list.length === 0) return
    const pics = list.filter(isPhotoFile)
    const others = list.filter((f) => !isPhotoFile(f))
    const problems = others.map(fileProblem).filter(Boolean)
    if (problems.length) toast(problems[0]!, { error: true })
    const okFiles = others.filter((f) => !fileProblem(f))
    if (photos.length + pics.length > MAX_PHOTOS) toast(`사진은 한 번에 ${MAX_PHOTOS}장까지 보낼 수 있어요.`, { error: true })
    setPhotos((prev) => [...prev, ...pics].slice(0, MAX_PHOTOS))
    setFiles((prev) => [...prev, ...okFiles].slice(0, 10))
  }
  const addRef = useRef(addFiles)
  addRef.current = addFiles
  useEffect(() => props.registerAdd((list) => addRef.current(list)), [props.registerAdd])

  // PC: Ctrl+V로 캡처한 그림·복사한 파일을 붙여 넣는다 (입력칸 밖에서 눌러도).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])]
      if (!pasted.length) return
      // 창(입력 창)이나 검색칸에 붙여 넣는 건 그쪽에 맡긴다.
      if (e.target instanceof Element && e.target.closest('.modal, .search-bar')) return
      e.preventDefault()
      addRef.current(pasted)
      textarea.current?.focus()
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  function openAttachMenu(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    openMenu(
      [
        { icon: '🖼️', label: '사진 보관함', onSelect: () => galleryInput.current?.click() },
        ...(isTouchUi() ? [{ icon: '📷', label: '사진 찍기', onSelect: () => cameraInput.current?.click() }] : []),
        { icon: '📁', label: '파일 선택', onSelect: () => fileInput.current?.click() },
      ],
      r.left,
      r.top - 8,
    )
  }

  const pickInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles([...(e.target.files ?? [])])
    e.target.value = ''
  }

  // 입력칸은 글이 길어지면 5줄까지 늘어난다.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [body])

  // 답장·수정을 고르면 입력칸으로 (수정은 원래 글을 채워 둔다)
  const draft = useRef('')
  useEffect(() => {
    if (editing) {
      draft.current = body
      setBody(editing.body)
    }
    if (editing || replyTo) textarea.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, replyTo?.id])

  function cancel() {
    if (editing) setBody(draft.current)
    props.onCancel()
  }

  // 보내기: 입력칸을 바로 비우고(키보드는 그대로 열어 둠) 뒤에서 보낸다. 실패하면 글을 되돌린다.
  async function send() {
    const text = body.trim()
    const pics = photos
    const attach = files
    if (editing) {
      if (!text) return
      const target = editing
      setBody(draft.current)
      draft.current = ''
      onSent()
      if (text === target.body) return
      try {
        await editMessage(teamId, channelId, target.id, text)
      } catch (err) {
        toast(errorMessage(err), { error: true })
      }
      return
    }
    if (!text && pics.length === 0 && attach.length === 0) return
    const reply = replyTo
    onSent()
    setBody('')
    setPhotos([])
    setFiles([])
    const uploads = pics.length + attach.length
    if (uploads) setProgress({ done: 0, total: uploads })
    try {
      await sendMessage(teamId, channelId, text, pics, reply, attach, (done, total) => setProgress({ done, total }))
    } catch (err) {
      setBody((now) => (now ? now : text))
      setPhotos((now) => (now.length ? now : pics))
      setFiles((now) => (now.length ? now : attach))
      toast(errorMessage(err), { error: true })
    } finally {
      if (uploads) setProgress(null)
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
      {files.length > 0 && (
        <div className="file-chips">
          {files.map((f, i) => (
            <button type="button" key={`${f.name}${i}`} className="file-chip" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`${f.name} 빼기`}>
              {fileIcon(f.name)} {f.name} <span>✕</span>
            </button>
          ))}
        </div>
      )}
      {progress && (
        <p className="muted small uploading" role="status">
          올리는 중… {progress.done}/{progress.total}
        </p>
      )}
      {(replyTo || editing) && (
        <div className="composer-context">
          <div>
            <strong>{editing ? '✏️ 메시지 수정' : `↩ ${props.replyName}에게 답장`}</strong>
            <span>{editing ? editing.body : replyTo!.text}</span>
          </div>
          <button type="button" className="ghost icon" onClick={cancel} aria-label={editing ? '수정 취소' : '답장 취소'}
            onPointerDown={(e) => e.preventDefault()}>
            ✕
          </button>
        </div>
      )}
      <div className="composer-row">
        <button type="button" className="ghost icon attach-button" onClick={openAttachMenu} aria-label="사진·파일 보내기" disabled={Boolean(editing)}>
          ＋
        </button>
        <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={pickInput} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={pickInput} />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={['image/*', ...FILE_EXTS.map((e) => `.${e}`)].join(',')}
          onChange={pickInput}
        />
        <textarea
          ref={textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (replyTo || editing)) return cancel()
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
          disabled={editing ? !body.trim() : !body.trim() && photos.length === 0 && files.length === 0}
          // 보내기를 눌러도 입력칸에서 포커스가 빠지지 않게 → 휴대폰 키보드가 닫히지 않는다.
          onPointerDown={(e) => e.preventDefault()}
        >
          {editing ? '수정' : '보내기'}
        </button>
      </div>
    </form>
  )
}

// 파일 종류별 그림
export function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (ext === 'pdf') return '📕'
  if (['hwp', 'hwpx', 'doc', 'docx', 'txt'].includes(ext)) return '📝'
  if (['ppt', 'pptx'].includes(ext)) return '📽️'
  if (ext === 'zip') return '🗜️'
  return '📄'
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
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
