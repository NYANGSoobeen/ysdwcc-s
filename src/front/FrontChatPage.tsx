import { addDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { saveFile } from '../download.ts'
import { MenuButton } from '../menu.tsx'
import { Avatar, copyText, fileIcon, photoCols } from '../pages/ChatPage.tsx'
import { badgeText } from '../reads.ts'
import { MoreButton, useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, askText, isTouchUi, toast } from '../ui/dialogs.tsx'
import {
  assetUrl,
  connectFront,
  frontMessagesQuery,
  leaveFrontRoom,
  markFrontRead,
  messagesCol,
  toFrontMessage,
  useFront,
  useFrontAccounts,
  type FrontAccount,
  type FrontMessage,
  type FrontRoom,
} from './ydr.ts'

// 🏌️ 프론트 채팅 화면: 초대 코드 넣기 → 초대받은 방 목록 → 채팅 (src/front/ydr.ts 참고)
const PAGE = 100
const MAX_TEXT = 4000

export function FrontChatPage(props: { roomId: string | null; onOpenRoom: (id: string | null) => void; unread: Record<string, number> }) {
  const front = useFront()
  if (front.status === 'connecting') return <div className="center muted">프론트 채팅에 연결하는 중…</div>
  if (front.status === 'off' || !front.uid) return <JoinPage />
  const room = front.rooms.find((r) => r.id === props.roomId)
  if (room) return <FrontRoomView key={room.id} room={room} uid={front.uid} onBack={() => props.onOpenRoom(null)} />
  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>프론트 채팅</h2>
        <button type="button" className="ghost" onClick={() => void joinWithCode()}>
          + 초대 코드
        </button>
      </header>
      <div className="page-body">
        <p className="muted small">
          양산동원로얄CC 프론트 채팅방에 <strong>{front.name || '타부서'}</strong>(으)로 들어가 있어요. 프론트 직원이 초대한 방만 보여요.
        </p>
        <ul className="list">
          {front.rooms.map((r) => (
            <li key={r.id}>
              <button type="button" className="row row-button" onClick={() => props.onOpenRoom(r.id)}>
                <span className="room-icon" aria-hidden="true">
                  🏌️
                </span>
                <div className="row-main">
                  <strong>{r.name}</strong>
                  <span className="muted small">프론트 채팅방</span>
                </div>
                {(props.unread[r.id] ?? 0) > 0 && (
                  <span className="badge" aria-label={`안 읽은 메시지 ${props.unread[r.id]}개`}>
                    {badgeText(props.unread[r.id])}
                  </span>
                )}
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

async function joinWithCode() {
  const code = await askText({
    title: '프론트 초대 코드',
    message: '프론트 직원이 보내 준 6자리 초대 코드를 넣으세요.',
    label: '초대 코드',
    placeholder: '예: AB12CD',
    ok: '들어가기',
    required: '초대 코드를 입력하세요.',
  })
  if (!code?.trim()) return
  try {
    await connectFront(code)
    toast('프론트 채팅방에 들어갔어요.')
  } catch (err) {
    toast((err as Error).message, { error: true, long: true })
  }
}

function JoinPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return setError('초대 코드를 입력하세요.')
    setBusy(true)
    setError('')
    try {
      await connectFront(code)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>프론트 채팅</h2>
        <span />
      </header>
      <div className="page-body">
        <form className="card form" onSubmit={submit}>
          <h3>🏌️ 프론트 채팅방 들어가기</h3>
          <p className="muted small">
            양산동원로얄CC 프론트 직원이 채팅방에서 만든 <strong>초대 코드(6자리, 24시간 안에 한 번)</strong>를 넣으면, 그 방의
            채팅을 여기서 보고 쓸 수 있어요. 글과 답장만 보낼 수 있고, 사진·파일은 보기만 해요.
          </p>
          <label>
            초대 코드
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="예: AB12CD"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={12}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? '들어가는 중…' : '들어가기'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 방 ────────────────────────────────────────────────────────
function FrontRoomView({ room, uid, onBack }: { room: FrontRoom; uid: string; onBack: () => void }) {
  const [limitN, setLimitN] = useState(PAGE)
  const [messages, setMessages] = useState<FrontMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [full, setFull] = useState(false) // 더 이전 메시지가 없음
  const accounts = useFrontAccounts(true)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const [replyTo, setReplyTo] = useState<FrontMessage | null>(null)
  const [editing, setEditing] = useState<FrontMessage | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)

  useEffect(() => {
    return onSnapshot(
      frontMessagesQuery(room.id, room.from, limitN),
      (snap) => {
        setMessages(snap.docs.map((d) => toFrontMessage(d.id, d.data())).reverse())
        setFull(snap.size < limitN)
        setLoaded(true)
      },
      () => setLoaded(true),
    )
  }, [room.id, room.from, limitN])

  const nameOf = useCallback((id: string | null) => authorName(id, uid, accounts), [uid, accounts])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
    } else if (stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // 키보드·늦게 뜨는 사진으로 높이가 바뀌어도 맨 아래를 보고 있었으면 맨 아래 유지
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    const mo = new MutationObserver(() => {
      for (const child of el.children) observer.observe(child)
    })
    mo.observe(el, { childList: true })
    return () => {
      observer.disconnect()
      mo.disconnect()
    }
  }, [])

  function showOlder() {
    const el = listRef.current
    if (!el || full || restore.current) return
    restore.current = { height: el.scrollHeight, top: el.scrollTop }
    setLimitN((n) => n + PAGE)
  }

  // 읽음: 맨 아래까지 봤고 남의 새 말이 있으면 읽은 시각을 올린다 (3초에 한 번까지, 방을 나갈 때 남은 것은 바로).
  const lastRead = useRef(0)
  const readTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingRead = useRef(false)
  const writeRead = useCallback(() => {
    clearTimeout(readTimer.current)
    pendingRead.current = false
    lastRead.current = Date.now()
    markFrontRead(room.id, uid).catch(() => {})
  }, [room.id, uid])
  const maybeRead = useCallback(() => {
    if (document.hidden || !stickToBottom.current) return
    const latest = [...messages].reverse().find((m) => m.authorId !== uid && !m.system)
    if (!latest || latest.createdAt <= lastRead.current || pendingRead.current) return
    pendingRead.current = true
    readTimer.current = setTimeout(writeRead, Math.max(0, lastRead.current + 3000 - Date.now()))
  }, [messages, uid, writeRead])
  useEffect(() => {
    maybeRead()
    document.addEventListener('visibilitychange', maybeRead)
    return () => document.removeEventListener('visibilitychange', maybeRead)
  }, [maybeRead])
  const flushRead = useRef(writeRead)
  flushRead.current = writeRead
  useEffect(() => () => void (pendingRead.current && flushRead.current()), [])

  function onScroll() {
    const el = listRef.current!
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (stickToBottom.current) maybeRead()
    if (el.scrollTop < 200 && loaded && !full) showOlder()
  }

  function jumpTo(id: string) {
    const node = listRef.current?.querySelector(`[data-msg="${id}"]`)
    if (!node) return toast('원문이 너무 이전이라 찾지 못했어요. 위로 올려 더 불러온 뒤 다시 눌러 보세요.')
    stickToBottom.current = false
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashId(id)
    setTimeout(() => setFlashId(null), 2500)
  }

  async function leave() {
    const ok = await ask({
      title: '프론트 채팅방 나가기',
      message: `"${room.name}" 방에서 나갈까요?\n다시 들어오려면 프론트에서 새 초대 코드를 받아야 해요.`,
      ok: '나가기',
      danger: true,
    })
    if (!ok) return
    try {
      await leaveFrontRoom(room.id)
      toast('방에서 나왔어요.')
      onBack()
    } catch (err) {
      toast((err as Error).message, { error: true })
    }
  }

  async function remove(m: FrontMessage) {
    const ok = await ask({ message: '이 메시지를 삭제할까요? "삭제된 메시지입니다"로 보입니다.', ok: '삭제', danger: true })
    if (!ok) return
    try {
      await updateDoc(doc(messagesCol(room.id), m.id), { deleted: true, text: '' })
    } catch {
      toast('삭제하지 못했어요.', { error: true })
    }
  }

  // 사진 크게 보기: 이 방에 불러온 사진 전체
  function openPhoto(m: FrontMessage, index: number) {
    const photos: ViewerPhoto[] = []
    let start = 0
    for (const x of messages) {
      if (x.deleted) continue
      x.images.forEach((id, i) => {
        if (x.id === m.id && i === index) start = photos.length
        photos.push({
          attachment: { path: `ydr/${id}`, thumbPath: `ydr/${id}`, width: 0, height: 0, size: 0, thumbSize: 0 },
          author: nameOf(x.authorId),
          createdAt: new Date(x.createdAt),
          load: () => assetUrl(id),
        })
      })
    }
    setViewer({ photos, index: start })
  }

  return (
    <div className="chat front-chat">
      <header className="page-header">
        <button type="button" className="ghost menu-button back-button" onClick={onBack} aria-label="프론트 채팅방 목록">
          ‹
        </button>
        <h2>🏌️ {room.name}</h2>
        <div className="header-actions">
          <MoreButton
            actions={() => [{ icon: '🚪', label: '이 방 나가기', danger: true, onSelect: () => void leave() }]}
            title={room.name}
            label="채팅방 메뉴"
          />
        </div>
      </header>
      <div
        className="messages"
        ref={listRef}
        onScroll={onScroll}
        onPointerDown={(e) => {
          const active = document.activeElement
          if (e.pointerType !== 'mouse' && active instanceof HTMLTextAreaElement && active.closest('.composer')) active.blur()
        }}
      >
        {loaded && (
          <div className="history-edge muted small">
            {full ? (
              messages.length > 0 && (room.from ? '들어온 뒤의 대화부터 보여요' : '대화의 처음입니다')
            ) : (
              <button type="button" className="ghost more" onClick={showOlder}>
                이전 메시지 더 보기
              </button>
            )}
          </div>
        )}
        {!loaded && <p className="center muted">불러오는 중…</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const next = messages[i + 1]
          const day = dayText(m.createdAt)
          const showDay = day !== (prev ? dayText(prev.createdAt) : '')
          if (m.system)
            return (
              <div key={m.id} data-msg={m.id} className="msg-wrap">
                {showDay && <div className="day">{day}</div>}
                <div className="system-line">{m.text}</div>
              </div>
            )
          const groupedWithPrev = !showDay && sameGroup(prev, m)
          const mine = m.authorId === uid
          return (
            <div key={m.id} data-msg={m.id} className={groupedWithPrev ? 'msg-wrap grouped' : 'msg-wrap'}>
              {showDay && <div className="day">{day}</div>}
              <FrontMessageItem
                m={m}
                mine={mine}
                author={nameOf(m.authorId)}
                authorKey={m.authorId ?? '?'}
                showAuthor={!mine && !groupedWithPrev}
                time={sameGroup(m, next) ? '' : new Date(m.createdAt).toLocaleTimeString('ko-KR', { timeStyle: 'short' })}
                highlight={flashId === m.id}
                replyName={m.replyTo ? nameOf(m.replyTo.authorId) : ''}
                onReply={() => {
                  setEditing(null)
                  setReplyTo(m)
                }}
                onEdit={() => {
                  setReplyTo(null)
                  setEditing(m)
                }}
                onDelete={() => void remove(m)}
                onJump={jumpTo}
                onOpenPhoto={(i) => openPhoto(m, i)}
              />
            </div>
          )
        })}
      </div>
      <FrontComposer
        room={room}
        uid={uid}
        replyTo={replyTo}
        replyName={replyTo ? nameOf(replyTo.authorId) : ''}
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
      />
      {viewer && <PhotoViewer photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

function authorName(id: string | null, me: string, accounts: Map<string, FrontAccount>) {
  if (!id) return '프론트'
  if (id === me) return '나'
  if (id.startsWith('g_')) return '타부서'
  const a = accounts.get(id)
  return a ? [a.name, a.position].filter(Boolean).join(' ') || '프론트 직원' : '프론트 직원'
}

const dayText = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { dateStyle: 'full' })
function sameGroup(a: FrontMessage | undefined, b: FrontMessage | undefined) {
  if (!a || !b || a.system || b.system || a.authorId !== b.authorId) return false
  return Math.floor(a.createdAt / 60_000) === Math.floor(b.createdAt / 60_000)
}

function replySnippet(m: FrontMessage) {
  if (m.text) return { text: m.text.replace(/\s+/g, ' ').slice(0, 80), kind: 'text' }
  if (m.images.length) return { text: m.images.length > 1 ? `사진 ${m.images.length}장` : '사진', kind: 'image' }
  if (m.sticker) return { text: '이모티콘', kind: 'sticker' }
  if (m.file) return { text: `📎 ${m.file.name.slice(0, 60)}`, kind: 'text' }
  if (m.link) return { text: `🔎 ${(m.link.title || m.link.site || '링크').slice(0, 60)}`, kind: 'text' }
  return { text: '', kind: 'text' }
}
const replyIcon = (kind?: string) => (kind === 'image' ? '📷 ' : kind === 'sticker' ? '😊 ' : '')

const URL_RE = /https?:\/\/[^\s<>"']+/g
function linkify(text: string) {
  const parts: (string | React.ReactElement)[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    parts.push(text.slice(last, match.index))
    parts.push(
      <a key={match.index} href={match[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {match[0]}
      </a>,
    )
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

function FrontMessageItem(props: {
  m: FrontMessage
  mine: boolean
  author: string
  authorKey: string
  showAuthor: boolean
  time: string
  highlight: boolean
  replyName: string
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onJump: (id: string) => void
  onOpenPhoto: (index: number) => void
}) {
  const { m, mine } = props
  // 게스트는 글만 쓸 수 있어 내 말도 글뿐이다.
  const actions = (): MenuAction[] =>
    m.deleted
      ? []
      : [
          { icon: '↩️', label: '답장', onSelect: props.onReply },
          ...(m.text ? [{ icon: '📋', label: '복사', onSelect: () => void copyText(m.text) }] : []),
          ...(mine && m.text ? [{ icon: '✏️', label: '수정', onSelect: props.onEdit }] : []),
          ...(mine ? [{ icon: '🗑️', label: '삭제', danger: true, onSelect: props.onDelete }] : []),
        ]
  const menu = useItemMenu(actions)
  const reply = m.replyTo
  const link = m.link
  return (
    <div className={`message${mine ? ' mine' : ''}${props.highlight ? ' found' : ''}`}>
      {!mine && (props.showAuthor ? <Avatar uid={props.authorKey} name={props.author} /> : <span className="avatar-space" />)}
      {props.showAuthor && <div className="author">{props.author}</div>}
      <div className="bubble-row">
        {m.deleted ? (
          <div className="bubble deleted">
            <p>삭제된 메시지입니다</p>
          </div>
        ) : (
          <div className="bubble has-menu" {...menu}>
            {reply && (
              <button type="button" className="reply-quote" onClick={() => props.onJump(reply.id)}>
                <strong>↩ {props.replyName}에게 답장</strong>
                <span>
                  {replyIcon(reply.kind)}
                  {reply.text}
                </span>
              </button>
            )}
            {m.images.length > 0 && (
              <div className={`photos cols-${photoCols(m.images.length)}`}>
                {m.images.map((id, i) => (
                  <StorageImage key={id} path={`ydr/${id}`} load={() => assetUrl(id)} className="photo" onClick={() => props.onOpenPhoto(i)} />
                ))}
              </div>
            )}
            {m.sticker && <StorageImage path={`ydr/${m.sticker}`} load={() => assetUrl(m.sticker!)} alt="이모티콘" className="front-sticker" />}
            {m.file && (
              <button
                type="button"
                className="file-card"
                onClick={async () => {
                  try {
                    await saveFile(await assetUrl(m.file!.assetId), m.file!.name)
                  } catch {
                    toast('파일을 받지 못했어요.', { error: true })
                  }
                }}
              >
                <span className="file-icon" aria-hidden="true">
                  {fileIcon(m.file.name)}
                </span>
                <span className="file-text">
                  <strong>{m.file.name}</strong>
                  <span>눌러서 저장</span>
                </span>
              </button>
            )}
            {m.text && <p>{linkify(m.text)}</p>}
            {link?.url && (
              <a className="link-card" href={link.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                {link.thumb && /^https?:/.test(link.thumb) && (
                  <img src={link.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
                )}
                <span className="link-text">
                  {link.title && <strong>{link.title}</strong>}
                  {link.desc && <span className="link-desc">{link.desc}</span>}
                  <span className="link-site">{link.site || hostOf(link.url)}</span>
                </span>
              </a>
            )}
          </div>
        )}
        {(props.time || m.edited) && (
          <div className="meta">
            {m.edited && !m.deleted && <span>수정됨</span>}
            {props.time && <span>{props.time}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function FrontComposer(props: {
  room: FrontRoom
  uid: string
  replyTo: FrontMessage | null
  replyName: string
  editing: FrontMessage | null
  onCancel: () => void
  onSent: () => void
}) {
  const { room, uid, replyTo, editing, onSent } = props
  const [body, setBody] = useState('')
  const draft = useRef('')
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      draft.current = body
      setBody(editing.text)
    }
    if (editing || replyTo) textarea.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, replyTo?.id])

  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [body])

  function cancel() {
    if (editing) setBody(draft.current)
    props.onCancel()
  }

  const preview = useMemo(() => (replyTo ? replySnippet(replyTo) : null), [replyTo])

  async function send() {
    const text = body.trim()
    if (!text) return
    if (text.length > MAX_TEXT) return toast(`글은 ${MAX_TEXT}자까지 보낼 수 있어요.`, { error: true })
    if (editing) {
      const target = editing
      setBody(draft.current)
      draft.current = ''
      onSent()
      if (text === target.text) return
      try {
        await updateDoc(doc(messagesCol(room.id), target.id), { text, edited: true })
      } catch {
        toast('수정하지 못했어요.', { error: true })
      }
      return
    }
    const reply = replyTo && preview ? { id: replyTo.id, authorId: replyTo.authorId, ...preview } : null
    setBody('')
    onSent()
    try {
      // 프론트 규칙: text, authorId, createdAt, replyTo 말고는 넣으면 거절된다.
      await addDoc(messagesCol(room.id), { text, authorId: uid, createdAt: Date.now(), ...(reply ? { replyTo: reply } : {}) })
    } catch {
      setBody((now) => now || text)
      toast('보내지 못했어요. 이 방에서 내보내졌거나 인터넷이 끊겼을 수 있어요.', { error: true })
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      {(replyTo || editing) && (
        <div className="composer-context">
          <div>
            <strong>{editing ? '✏️ 메시지 수정' : `↩ ${props.replyName}에게 답장`}</strong>
            <span>{editing ? editing.text : `${replyIcon(preview?.kind)}${preview?.text ?? ''}`}</span>
          </div>
          <button type="button" className="ghost icon" onClick={cancel} aria-label={editing ? '수정 취소' : '답장 취소'}
            onPointerDown={(e) => e.preventDefault()}>
            ✕
          </button>
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && (replyTo || editing)) return cancel()
            // PC: Enter = 보내기, Shift/Ctrl+Enter = 줄바꿈. 휴대폰: Enter = 줄바꿈(보내기는 버튼).
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || isTouchUi() || e.shiftKey) return
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
          placeholder="프론트 채팅방에 메시지 입력"
          rows={1}
          enterKeyHint={isTouchUi() ? 'enter' : 'send'}
        />
        <button className="primary" disabled={!body.trim()} onPointerDown={(e) => e.preventDefault()}>
          {editing ? '수정' : '보내기'}
        </button>
      </div>
    </form>
  )
}

