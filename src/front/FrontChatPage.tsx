import { addDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { GameButton } from '../games/GameButton.tsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { saveFile } from '../download.ts'
import { MenuButton } from '../menu.tsx'
import { copyText, EmojiButton, fileIcon, photoCols, VideoBox } from '../pages/ChatPage.tsx'
import { frontGames, gameMenu, GameCardView } from '../chatgame/index.tsx'
import { frontPins, PinBar, useFrontPin } from '../chatpin/index.tsx'
import { photoUrl } from '../chat.ts'
import { ClipboardChip, insertAt } from '../ui/ClipboardChip.tsx'
import { Avatar, rememberedPerson, showProfileCard } from '../ui/Avatar.tsx'
import { chatFxOf } from '../chatfx.ts'
import { ChatFxPick, FxTag, useChatFx } from '../ui/ChatFx.tsx'
import { MoreButton, openMenu, useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, askText, isTouchUi, toast } from '../ui/dialogs.tsx'
import {
  assetLink,
  assetUrl,
  connectFront,
  tryResume,
  frontMessagesQuery,
  leaveFrontRoom,
  markFrontRead,
  messagesCol,
  toFrontMessage,
  useFront,
  useFrontAccounts,
  useFrontRoomReads,
  frontUnreadBy,
  type FrontAccount,
  type FrontMessage,
  type FrontRoom,
} from './ydr.ts'
import { badgeText } from '../reads.ts'
import { openPets, petsInit, refreshPets, setPetRoom } from '../pets/index.ts'
import { armImeFix, imeUndo, mentionTapProps, type ImeFix } from '../ui/mentionFix.ts'

// 🏌️ 프론트 채팅 화면: 초대 코드 넣기 → 초대받은 방 목록 → 채팅 (src/front/ydr.ts 참고)
const PAGE = 100
const MAX_TEXT = 4000

// 프론트 채팅방은 우리 단체 채팅방과 같이 메뉴의 "단체 채팅" 묶음에 보인다. 여기서는 고른 방(없으면 첫 방)을 보여 준다.
export function FrontChatPage(props: { roomId: string | null; onOpenRoom: (id: string | null) => void }) {
  const front = useFront()
  if (front.status === 'connecting') return <div className="center muted">프론트 채팅에 연결하는 중…</div>
  if (front.status === 'off' || !front.uid) return <JoinPage />
  const room = front.rooms.find((r) => r.id === props.roomId) ?? front.rooms[0]
  if (!room) return <JoinPage />
  return <FrontRoomView key={room.id} room={room} uid={front.uid} myName={front.name} onLeft={() => props.onOpenRoom(null)} />
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
  // 예전에 들어간 적이 있으면(이 기능 전에 들어간 사람, 기억이 없는 기기) 코드 없이 한 번 다시 연결해 본다.
  useEffect(() => tryResume(), [])
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
        <h2>🏌️ 프론트 채팅</h2>
        <span />
        <GameButton />
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
function FrontRoomView({ room, uid, myName, onLeft }: { room: FrontRoom; uid: string; myName: string; onLeft: () => void }) {
  const [limitN, setLimitN] = useState(PAGE)
  const [messages, setMessages] = useState<FrontMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [full, setFull] = useState(false) // 더 이전 메시지가 없음
  const accounts = useFrontAccounts(true)
  const reads = useFrontRoomReads(room.id)
  const listRef = useRef<HTMLDivElement>(null)
  // 🎉 채팅 효과 (/축하 등): 프론트 앱과 같은 글이라 양쪽 다 효과가 나온다
  const fxList = useMemo(() => messages.map((m) => ({ id: m.id, text: m.text, at: m.createdAt || null, deleted: m.deleted })), [messages])
  useChatFx(listRef, fxList)
  const stickToBottom = useRef(true)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const [replyTo, setReplyTo] = useState<FrontMessage | null>(null)
  const [editing, setEditing] = useState<FrontMessage | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)
  // 📌 채팅방 위 고정: 프론트 방 문서의 pin 을 띠로 (게스트는 보기·이동만, 고정·내리기는 프론트 직원)
  const pin = useFrontPin(room.id)
  const pinBar = useRef<HTMLDivElement>(null)
  const pins = frontPins({
    roomId: room.id,
    pin,
    myId: uid,
    nameOf: (id) => (id === uid ? myName || '나' : authorName(id, uid, accounts)),
    copyText: (t) => void copyText(t),
    bar: () => pinBar.current,
    list: () => listRef.current,
    findPin: (id) => jumpTo(id),
  })
  // 🎲 미니 게임: 프론트 메시지 그대로 (게스트 = 내 id g_{우리 uid}), 말풍선 카드가 그려지기 전에 이어 준다
  const games = frontGames({
    channelId: room.id,
    myId: uid,
    nameOf: (id) => (id === uid ? myName : authorName(id, uid, accounts)),
    recent: messages.filter((m) => !m.system).map((m) => ({ authorId: m.authorId, createdAt: m.createdAt })),
    takeReply: () => {
      const r = replyTo
      if (!r) return null
      setReplyTo(null)
      return { id: r.id, authorId: r.authorId, ...replySnippet(r) }
    },
  })

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
  // 🐾 우리 펫: 이 방 화면에서만 돌아다님 (프론트 pets/petFx 를 같이 씀)
  const petNames = useRef({ myName, accounts })
  petNames.current = { myName, accounts }
  useEffect(() => {
    setPetRoom({
      list: () => listRef.current,
      myName: () => petNames.current.myName,
      ownerName: (id) => {
        if (id.startsWith('g_')) return rememberedPerson(id.slice(2))?.name || '지원팀'
        return petNames.current.accounts.get(`acc_${id}`)?.name || '프론트'
      },
    })
    petsInit()
    return () => setPetRoom(null)
  }, [])
  useEffect(() => refreshPets(), [accounts])
  // 📣 @부를 수 있는 사람: 프론트 직원(사용 중) + 이 방에서 말한 적 있는 다른 지원팀 직원(g_…). 이름만(직급 없이) = 프론트 mention.js 와 같은 글자
  const people = useMemo(() => {
    const out: MentionPerson[] = []
    for (const [id, a] of accounts) if (a.active && a.name) out.push({ id, name: a.name, sub: a.position || '프론트' })
    const seen = new Set<string>()
    for (const m of messages) {
      const id = m.authorId ?? ''
      if (!id.startsWith('g_') || id === uid || seen.has(id)) continue
      seen.add(id)
      const p = rememberedPerson(id.slice(2))
      if (p?.name) out.push({ id, name: p.name, sub: '지원팀' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [accounts, messages, uid])
  const plainName = useCallback(
    (id: string) => (id === uid ? myName : people.find((p) => p.id === id)?.name ?? accounts.get(id)?.name ?? ''),
    [uid, myName, people, accounts],
  )

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
      onLeft()
    } catch (err) {
      toast((err as Error).message, { error: true })
    }
  }

  async function remove(m: FrontMessage) {
    const ok = await ask({ message: '이 메시지를 삭제할까요? "삭제된 메시지입니다"로 보입니다.', ok: '삭제', danger: true })
    if (!ok) return
    try {
      // 🎲 게임 메시지는 게임도 지운다 (프론트 규칙: 게스트는 text·edited·deleted·game 만 바꿀 수 있음)
      await updateDoc(doc(messagesCol(room.id), m.id), { deleted: true, text: '', ...(m.game ? { game: null } : {}) })
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
      <header className="page-header chat-header">
        <MenuButton />
        <h2>
          <span aria-hidden="true">💬</span> <span className="room-title">{room.name}</span>
        </h2>
        <div className="header-actions">
          <button type="button" className="ghost more-button" title="🐾 우리 펫 (프론트와 같이 키워요)" aria-label="우리 펫" onClick={() => openPets()}>
            🐾
          </button>
          <MoreButton
            actions={() => [
              { icon: '＋', label: '다른 방 초대 코드 넣기', onSelect: () => void joinWithCode() },
              { icon: '🚪', label: '이 방 나가기', danger: true, onSelect: () => void leave() },
            ]}
            title={`${room.name} · ${myName || '타부서'}(으)로 참여 중`}
            label="채팅방 메뉴"
          />
        </div>
        <GameButton />
      </header>
      <PinBar api={pins} pin={pin} roomId={room.id} barRef={pinBar} />
      <div
        className="messages"
        data-pet-room=""
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
            <div key={m.id} data-msg={m.id} data-mid={m.id} className={groupedWithPrev ? 'msg-wrap msgRow grouped' : 'msg-wrap msgRow'}>
              {showDay && <div className="day">{day}</div>}
              <FrontMessageItem
                m={m}
                mine={mine}
                author={nameOf(m.authorId)}
                authorKey={m.authorId ?? '?'}
                avatarAssetId={accounts.get(m.authorId ?? '')?.avatarAssetId ?? null}
                showAuthor={!mine && !groupedWithPrev}
                time={sameGroup(m, next) ? '' : new Date(m.createdAt).toLocaleTimeString('ko-KR', { timeStyle: 'short' })}
                highlight={flashId === m.id}
                unread={m.deleted ? 0 : frontUnreadBy(accounts, reads, m.authorId, m.createdAt)}
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
                games={games}
                mentionNames={m.mentions.map(plainName).filter(Boolean)}
                myName={myName}
                mentionedMe={!mine && !m.deleted && (m.mentionAll || m.mentions.includes(uid))}
              />
            </div>
          )
        })}
      </div>
      <FrontComposer
        gameItems={gameMenu(games)}
        room={room}
        uid={uid}
        people={people}
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
  // 같이 들어간 게스트는 우리 앱 직원(g_{우리 uid}) → 불러 둔 우리 직원이면 이름 (2026-11-02)
  if (id.startsWith('g_')) {
    const p = rememberedPerson(id.slice(2))
    return p?.name ? [p.name, p.position].filter(Boolean).join(' ') : '타부서'
  }
  const a = accounts.get(id)
  return a ? [a.name, a.position].filter(Boolean).join(' ') || '프론트 직원' : '프론트 직원'
}

// 보낸 사람 사진 (2026-11-02 "프론트랑 서로 프사가 안 보여"): 프론트 직원은 프론트 accounts의 avatarAssetId 사진
// (프론트 Storage assets/{id}, 게스트도 보기만 가능), 같이 들어간 우리 직원(g_{uid})은 우리 프로필 사진.
function FrontAvatar({ authorKey, name, avatarAssetId }: { authorKey: string; name: string; avatarAssetId: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!avatarAssetId) return
    let alive = true
    assetUrl(avatarAssetId).then(
      (u) => alive && setUrl(u),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [avatarAssetId])
  if (authorKey.startsWith('g_')) return <Avatar uid={authorKey.slice(2)} name={name} card />
  // 누르면 프로필 카드(사진이면 눌러서 크게)
  return (
    <button
      type="button"
      className="avatar-button"
      aria-label={`${name} 프로필 보기`}
      onClick={(e) => {
        e.stopPropagation()
        showProfileCard(authorKey, name, { imageUrl: url ?? undefined })
      }}
    >
      {url ? (
        <span className="avatar photo" aria-hidden="true">
          <img src={url} alt="" />
        </span>
      ) : (
        <Avatar uid={authorKey} name={name} />
      )}
    </button>
  )
}

const dayText = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { dateStyle: 'full' })
function sameGroup(a: FrontMessage | undefined, b: FrontMessage | undefined) {
  if (!a || !b || a.system || b.system || a.authorId !== b.authorId) return false
  return Math.floor(a.createdAt / 60_000) === Math.floor(b.createdAt / 60_000)
}

function replySnippet(m: FrontMessage) {
  if (m.text) return { text: m.text.replace(/\s+/g, ' ').slice(0, 80), kind: 'text' }
  if (m.images.length) return { text: m.images.length > 1 ? `사진 ${m.images.length}장` : '사진', kind: 'image' }
  if (m.sticker || m.stickerUrl) return { text: '이모티콘', kind: 'sticker' }
  if (m.video) return { text: '🎬 동영상', kind: 'text' }
  if (m.file) return { text: `📎 ${m.file.name.slice(0, 60)}`, kind: 'text' }
  if (m.link) return { text: `🔎 ${(m.link.title || m.link.site || '링크').slice(0, 60)}`, kind: 'text' }
  return { text: '', kind: 'text' }
}
const replyIcon = (kind?: string) => (kind === 'image' ? '📷 ' : kind === 'sticker' ? '😊 ' : '')

const URL_RE = /https?:\/\/[^\s<>"']+/g
const MENTION_ALL = '모두'
type MentionPerson = { id: string; name: string; sub: string }
// 글 속 주소는 눌러서 열리게, 부른 "@이름"·"@모두"는 색칠 (나를 부른 건 더 진하게)
function linkify(text: string, names: string[] = [], myName = '', mine = false) {
  const words = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  const escaped = words.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`${URL_RE.source}${escaped.length ? `|@(?:${escaped.join('|')})` : ''}`, 'g')
  const parts: (string | React.ReactElement)[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const i = match.index ?? 0
    parts.push(text.slice(last, i))
    const token = match[0]
    if (token.startsWith('@')) {
      const who = token.slice(1)
      const me = !mine && (who === MENTION_ALL || (!!myName && who === myName))
      parts.push(
        <span key={i} className={me ? 'mention me' : 'mention'}>
          {token}
        </span>,
      )
    } else
      parts.push(
        <a key={i} href={token} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {token}
        </a>,
      )
    last = i + token.length
  }
  parts.push(text.slice(last))
  return parts
}
// 보낼 글에서 부른 사람: "@이름"이 들어 있는 사람, "@모두"
function findFrontMentions(text: string, people: MentionPerson[], me: string) {
  const ids = new Set<string>()
  for (const p of people) if (p.id !== me && p.name && text.includes(`@${p.name}`)) ids.add(p.id)
  return { mentions: [...ids].slice(0, 50), all: text.includes(`@${MENTION_ALL}`) }
}
let mentionDeniedTold = false

function FrontMessageItem(props: {
  m: FrontMessage
  mine: boolean
  author: string
  authorKey: string
  avatarAssetId: string | null
  showAuthor: boolean
  time: string
  highlight: boolean
  unread: number
  replyName: string
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onJump: (id: string) => void
  onOpenPhoto: (index: number) => void
  games: ReturnType<typeof frontGames>
  mentionNames: string[]
  myName: string
  mentionedMe: boolean
}) {
  const { m, mine } = props
  // 게스트는 글만 쓸 수 있어 내 말도 글뿐이다.
  const actions = (): MenuAction[] =>
    m.deleted
      ? []
      : [
          { icon: '↩️', label: '답장', onSelect: props.onReply },
          ...(m.text ? [{ icon: '📋', label: '복사', onSelect: () => void copyText(m.text) }] : []),
          ...(mine && m.text && !m.game ? [{ icon: '✏️', label: '수정', onSelect: props.onEdit }] : []),
          ...(mine ? [{ icon: '🗑️', label: '삭제', danger: true, onSelect: props.onDelete }] : []),
        ]
  const menu = useItemMenu(actions)
  const reply = m.replyTo
  const link = m.link
  return (
    <div className={`message${mine ? ' mine' : ''}${props.highlight ? ' found' : ''}${props.mentionedMe ? ' mentioned-me' : ''}`}>
      {!mine && (props.showAuthor ? <FrontAvatar authorKey={props.authorKey} name={props.author} avatarAssetId={props.avatarAssetId} /> : <span className="avatar-space" />)}
      {props.showAuthor && <div className="author">{props.author}</div>}
      <div className="bubble-row">
        {m.deleted ? (
          <div className="bubble deleted">
            <p>삭제된 메시지입니다</p>
          </div>
        ) : (
          <div
            className={
              m.game ? 'bubble has-menu game' : (m.sticker || m.stickerUrl) && !m.text && !reply ? 'bubble has-menu emoticon-bubble' : 'bubble has-menu'
            }
            {...menu}
          >
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
            {m.video && (
              <VideoBox
                video={{ name: m.video.name || '동영상', size: m.video.size ?? 0, w: m.video.w, h: m.video.h, dur: m.video.dur }}
                loadSrc={() => assetLink(m.video!.assetId)}
                poster={m.video.poster && <StorageImage path={`ydr/${m.video.poster}`} load={() => assetUrl(m.video!.poster!)} className="chat-video-poster" />}
                onSave={async () => {
                  try {
                    toast('🎬 동영상 받는 중…')
                    await saveFile(await assetUrl(m.video!.assetId), m.video!.name || '동영상.mp4')
                  } catch {
                    toast('동영상을 저장하지 못했어요.', { error: true })
                  }
                }}
              />
            )}
            {m.stickerUrl && <img src={m.stickerUrl} alt="이모티콘" className="front-sticker chat-emoticon" loading="lazy" />}
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
            {m.game ? (
              <GameCardView api={props.games} msg={{ id: m.id, game: m.game, votes: m.votes, authorId: m.authorId, createdAt: m.createdAt, text: m.text }} />
            ) : m.text && (chatFxOf(m.text) ? <FxTag fx={chatFxOf(m.text)!} /> : <p>{linkify(m.text, [...props.mentionNames, ...(m.mentionAll ? [MENTION_ALL] : [])], props.myName, mine)}</p>)}
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
        {(props.time || m.edited || props.unread > 0) && (
          <div className="meta">
            {props.unread > 0 && (
              <span className="unread-count" title={`프론트 직원 ${props.unread}명이 아직 안 읽었어요`}>
                {badgeText(props.unread)}
              </span>
            )}
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
  gameItems: MenuAction[] // 🎲 미니 게임 (게스트는 사진 없는 투표만)
  room: FrontRoom
  uid: string
  people: MentionPerson[]
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

  // 📣 @부르기: "@"를 치면 목록(맨 위 @모두 · 프론트 직원 · 지원팀), 고르면 "@이름 "
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const candidates = mention
    ? [{ id: 'all', name: MENTION_ALL, sub: '이 방 사람 모두' }, ...props.people]
        .filter((c) => c.name.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 8)
    : []
  function updateMention(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart)
    const found = before.match(/(^|\s)@([^\s@]*)$/)
    setMention(found ? { start: el.selectionStart - found[2].length - 1, query: found[2] } : null)
    setMentionIndex(0)
  }
  const pendingCaret = useRef<number | null>(null)
  const imeFix = useRef<ImeFix | null>(null) // 📱 한글 조합 중 고르면 조각이 또 붙는 것 되돌리기
  function undoIme(v: string) {
    const back = imeUndo(imeFix, v)
    if (back === null) return false
    const at = imeFix.current?.at ?? back.length
    setBody(back)
    requestAnimationFrame(() => textarea.current?.setSelectionRange(at, at))
    return true
  }
  function pickMention(name: string) {
    const el = textarea.current
    if (!el || !mention) return
    const end = el.selectionStart
    setBody(`${body.slice(0, mention.start)}@${name} ${body.slice(end)}`)
    pendingCaret.current = mention.start + name.length + 2
    imeFix.current = armImeFix(`${body.slice(0, mention.start)}@${name} ${body.slice(end)}`, pendingCaret.current, mention.query)
    setMention(null)
  }
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null) return
    pendingCaret.current = null
    textarea.current?.focus()
    textarea.current?.setSelectionRange(at, at)
  }, [body])

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

  // 😊 우리 앱 이모티콘 보내기 (2026-11-09 사용자 요청 "프론트&지원팀 방에서도"): 게스트는 프론트 Storage에 못 올리므로
  // 우리 Storage 그림(stickers/…)의 내려받기 주소를 stickerUrl 로 보낸다. 프론트 규칙·화면이 stickerUrl 을 받아야 동작.
  async function sendSticker(assetId: string) {
    const reply = replyTo && preview ? { id: replyTo.id, authorId: replyTo.authorId, ...preview } : null
    if (replyTo) onSent()
    try {
      const stickerUrl = await photoUrl(assetId)
      await addDoc(messagesCol(room.id), { text: '', authorId: uid, createdAt: Date.now(), stickerUrl, ...(reply ? { replyTo: reply } : {}) })
    } catch (err) {
      const denied = (err as { code?: string }).code === 'permission-denied'
      toast(denied ? '프론트 앱이 아직 우리 이모티콘을 받지 못해요. 프론트 앱 업데이트 뒤에 보낼 수 있어요.' : '이모티콘을 보내지 못했어요.', {
        error: true,
      })
    }
  }

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
    const base = { text, authorId: uid, createdAt: Date.now(), ...(reply ? { replyTo: reply } : {}) }
    const mn = findFrontMentions(text, props.people, uid)
    const called = { ...(mn.mentions.length ? { mentions: mn.mentions } : {}), ...(mn.all ? { mentionAll: true } : {}) }
    try {
      try {
        await addDoc(messagesCol(room.id), { ...base, ...called })
      } catch (err) {
        // 프론트 규칙이 아직 게스트의 mentions 를 안 받으면: 글만 다시 보낸다 (색칠·"나를 불렀어요" 알림은 프론트 업데이트 뒤)
        if (!Object.keys(called).length || (err as { code?: string }).code !== 'permission-denied') throw err
        await addDoc(messagesCol(room.id), base)
        if (!mentionDeniedTold) {
          mentionDeniedTold = true
          toast('글은 보냈어요. 프론트 앱이 업데이트되면 부른 사람에게 "나를 불렀어요" 알림이 가요.')
        }
      }
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
      {!props.editing && (
        <ChatFxPick
          text={body}
          onPick={(v) => {
            setBody(v)
            textarea.current?.focus()
          }}
        />
      )}
      {mention && candidates.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="부를 사람">
          {candidates.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                className={i === mentionIndex ? 'mention-option active' : 'mention-option'}
                {...mentionTapProps(() => pickMention(c.name))}
              >
                {c.id === 'all' ? '👥 @모두 (이 방 사람 모두)' : `@${c.name}`}
                {c.id !== 'all' && <span className="muted small"> · {c.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ClipboardChip inputRef={textarea} onPaste={(t) => insertAt(textarea.current, body, t, setBody)} />
      <div className="composer-row">
        <button
          type="button"
          className="round-button attach-button"
          aria-label="미니 게임"
          disabled={Boolean(editing)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openMenu(props.gameItems, r.left, r.top - 8)
          }}
        >
          ＋
        </button>
        <EmojiButton
          onSticker={editing ? undefined : (assetId) => void sendSticker(assetId)}
          onPick={(emoji) => {
            const el = textarea.current
            const a = el?.selectionStart ?? body.length
            const b = el?.selectionEnd ?? body.length
            setBody(body.slice(0, a) + emoji + body.slice(b))
            requestAnimationFrame(() => {
              el?.focus()
              el?.setSelectionRange(a + emoji.length, a + emoji.length)
            })
          }}
        />
        <textarea
          ref={textarea}
          value={body}
          onChange={(e) => {
            if (undoIme(e.target.value)) return
            setBody(e.target.value)
            updateMention(e.target)
          }}
          onCompositionEnd={() => setTimeout(() => textarea.current && undoIme(textarea.current.value), 0)}
          onKeyUp={(e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && updateMention(e.currentTarget)}
          onClick={(e) => updateMention(e.currentTarget)}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onKeyDown={(e) => {
            // @목록이 떠 있으면: ↑↓ 고르기, Enter·Tab 넣기, Esc 닫기
            if (mention && candidates.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                setMentionIndex((i) => (i + step + candidates.length) % candidates.length)
                return
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                e.preventDefault()
                pickMention(candidates[mentionIndex]?.name ?? candidates[0].name)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMention(null)
                return
              }
            }
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
          placeholder={isTouchUi() ? '메시지 입력...' : '메시지 입력... (Enter 전송 · Ctrl+Enter 줄바꿈)'}
          rows={1}
          enterKeyHint={isTouchUi() ? 'enter' : 'send'}
        />
        <button
          className="send-button"
          aria-label={editing ? '수정' : '보내기'}
          title={editing ? '수정' : '보내기'}
          disabled={!body.trim()}
          onPointerDown={(e) => e.preventDefault()}
        >
          {editing ? '✓' : '↑'}
        </button>
      </div>
    </form>
  )
}

