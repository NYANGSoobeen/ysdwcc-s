import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { errorMessage } from '../auth.ts'
import { addFrontComment, addFrontNotice, deleteFrontComment, deleteFrontNotice, editFrontNotice, pinFrontNotice, sortFrontNotices, useFrontNotices, type FrontComment, type FrontNotice } from '../frontNotices.ts'
import { GameButton } from '../games/GameButton.tsx'
import { MenuButton } from '../menu.tsx'
import { fixEmoji } from '../ui/emojiFix.ts'
import { ask, Modal, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { useIsDesktop } from '../useMedia.ts'
import { linkifyText } from './NoticesPage.tsx'
import { useMemberProfiles, type Profile } from '../hooks.ts'
import { Avatar, AvatarFace } from '../ui/Avatar.tsx'
import { useFront, useFrontAccounts, type FrontAccount } from '../front/ydr.ts'
import { FrontAvatar } from '../front/FrontChatPage.tsx'

// 🤝 프론트 공지 (2026-11-26, 프론트 GUEST_LINK 10): 모든 팀 직원과 프론트 직원이 같이 보는 게시판 하나.
// 모양은 📢 공지 카드를 그대로 쓰고(사진·스티커·끌어 옮기기는 없음), 고치기·지우기는 쓴 사람만(최고 관리자는 지우기),
// 📌 고정은 쓰기 권한이 있는 사람 누구나. 보기 권한(viewer)은 읽기만.
// 쓴 사람 표시: 우리 직원은 우리 프로필(사진·이름), 프론트 직원(f_{프론트 uid})은 프론트 accounts(이름·사진,
// 🏌️ 프론트 채팅에 들어가 있을 때만 읽을 수 있음), 못 찾으면 글에 적힌 이름 + 첫 글자 동그라미.
type People = Record<string, Profile> & { __front?: Map<string, FrontAccount> }
function frontAccount(id: string, people: People) {
  return id.startsWith('f_') ? people.__front?.get(id.slice(2)) : undefined
}
function personName(id: string, fallback: string, people: People) {
  const p = people[id]
  if (!id.startsWith('f_') && p?.name) return p.name
  const a = frontAccount(id, people)
  if (a?.name) return a.name
  return fallback.replace(/ · (지원팀|프론트)$/, '') || (id.startsWith('f_') ? '프론트' : '지원팀')
}
function PersonFace({ id, name, people }: { id: string; name: string; people: People }) {
  if (id.startsWith('f_')) {
    const a = frontAccount(id, people)
    if (a) return <FrontAvatar authorKey={`acc_${a.loginId}`} name={a.name} avatarAssetId={a.avatarAssetId} />
    return <AvatarFace uid={id} name={name.replace(/ · 프론트$/, '')} className="fn-front-face" />
  }
  return <Avatar uid={id} name={name} card />
}

export function FrontNoticesPage({ uid, name, canWrite, superAdmin }: { uid: string; name: string; canWrite: boolean; superAdmin: boolean }) {
  const list = useFrontNotices()
  const { query } = useTabSearch()
  const q = query.trim().toLowerCase()
  const sorted = sortFrontNotices(list ?? [])
  const ourIds = useMemo(() => {
    const ids = new Set<string>()
    for (const n of list ?? []) {
      if (!n.authorId.startsWith('f_')) ids.add(n.authorId)
      for (const c of n.comments) if (!c.authorId.startsWith('f_')) ids.add(c.authorId)
    }
    return [...ids].sort()
  }, [list])
  const ourPeople = useMemberProfiles(ourIds)
  const frontOn = useFront().status === 'on'
  const accounts = useFrontAccounts(frontOn)
  const people = useMemo<People>(() => {
    const byUid = new Map<string, FrontAccount>()
    for (const a of accounts.values()) if (a.uid) byUid.set(a.uid, a)
    return Object.assign({ ...ourPeople }, { __front: byUid })
  }, [ourPeople, accounts])
  const shown = sorted.filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  const desktop = useIsDesktop()
  const [editing, setEditing] = useState<FrontNotice | null>(null)
  const [viewer, setViewer] = useState<ViewerPhoto[] | null>(null)
  const columns = desktop ? [shown.filter((_, i) => i % 2 === 0), shown.filter((_, i) => i % 2 === 1)] : [shown]

  async function remove(n: FrontNotice) {
    if (!(await ask({ title: '공지 삭제', message: '이 공지를 지울까요? 프론트 앱에서도 사라지고 되돌릴 수 없어요.', ok: '삭제', danger: true }))) return
    deleteFrontNotice(n.id).then(
      () => toast('공지를 지웠어요.'),
      (err) => toast(errorMessage(err), { error: true }),
    )
  }

  function card(n: FrontNotice) {
    const mine = n.authorId === uid
    const when = new Date(n.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    return (
      <div key={n.id} className="notice-anchor">
        <article className={n.pinned ? 'notice-card pinned' : 'notice-card'}>
          {n.pinned && (
            <div className="notice-pin-band">
              <span>📌 상단 고정</span>
            </div>
          )}
          {n.imageUrl && (
            <div className="notice-cover">
              <img
                className="notice-cover-img"
                src={n.imageUrl}
                alt=""
                onClick={() =>
                  setViewer([
                    {
                      attachment: { path: n.imageUrl, thumbPath: n.imageUrl, width: 0, height: 0, size: 0, thumbSize: 0 },
                      author: n.authorName,
                      createdAt: new Date(n.createdAt),
                      load: async () => n.imageUrl,
                    },
                  ])
                }
              />
            </div>
          )}
          <div className="notice-inner">
            {n.title && <h3 className="notice-title">{n.title}</h3>}
            {n.body && <p className="notice-text">{linkifyText(fixEmoji(n.body))}</p>}
            <footer className="notice-foot">
              <span className="muted fn-author">
                <PersonFace id={n.authorId} name={n.authorName} people={people} />
                {personName(n.authorId, n.authorName, people)} · {when}
                {n.editedAt != null && ` · 수정: ${n.editedName || '다른 사람'}`}
              </span>
              <span className="notice-tools">
                {canWrite && (
                  <button
                    type="button"
                    className={n.pinned ? 'ghost on' : 'ghost'}
                    title={n.pinned ? '고정 풀기' : '상단 고정'}
                    aria-label={n.pinned ? '고정 풀기' : '상단 고정'}
                    aria-pressed={n.pinned}
                    onClick={() => pinFrontNotice(n.id, uid, !n.pinned).catch((err) => toast(errorMessage(err), { error: true }))}
                  >
                    📌
                  </button>
                )}
                {mine && canWrite && (
                  <button type="button" className="ghost" title="수정" aria-label="수정" onClick={() => setEditing(n)}>
                    ✏️
                  </button>
                )}
                {(mine || superAdmin) && (
                  <button type="button" className="ghost del" title="삭제" aria-label="삭제" onClick={() => void remove(n)}>
                    ✕
                  </button>
                )}
              </span>
            </footer>
            <FrontComments notice={n} uid={uid} name={name} canWrite={canWrite} people={people} />
          </div>
        </article>
      </div>
    )
  }

  return (
    <div className="page notices">
      <header className="page-header notices-header">
        <MenuButton />
        <h2>📢 프론트 공지</h2>
        <SearchBar placeholder="검색" label="프론트 공지 제목, 내용 검색" inline />
        <GameButton />
      </header>
      <div className="page-body notice-body">
        <p className="muted small">프론트와 같이 보는 공지예요. 여기 쓴 글은 프론트 앱 '🤝 지원팀 공지'에도 보여요.</p>
        {canWrite && <FrontNoticeComposer uid={uid} name={name} />}
        {list === null && <p className="center muted">불러오는 중…</p>}
        {list && list.length === 0 && (
          <div className="notice-empty">
            <div aria-hidden="true">📢</div>
            <p>아직 프론트와 같이 보는 공지가 없어요</p>
          </div>
        )}
        {list && list.length > 0 && shown.length === 0 && <p className="center muted">"{query}"에 맞는 공지가 없어요.</p>}
        <div className={desktop ? 'notice-grid two' : 'notice-grid'}>
          {columns.map((col, i) => (
            <div key={i} className="notice-col">
              {col.map(card)}
            </div>
          ))}
        </div>
      </div>
      {editing && <FrontNoticeEditor notice={editing} uid={uid} name={name} onClose={() => setEditing(null)} />}
      {viewer && <PhotoViewer photos={viewer} index={0} onClose={() => setViewer(null)} />}
    </div>
  )
}

// 📷 사진 한 장 고르기 (프론트 앱은 공지 사진을 하나만 보여 줘서 한 장)
function PhotoPick({ file, keepUrl, onPick, onClear, busy }: { file: File | null; keepUrl: string; onPick: (f: File) => void; onClear: () => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const shown = preview || keepUrl
  return (
    <div className="notice-photos">
      {shown ? (
        <button type="button" className="preview" onClick={onClear} disabled={busy} aria-label="사진 빼기">
          <img src={shown} alt="" />
          <span>✕</span>
        </button>
      ) : (
        <button type="button" className="preview add" onClick={() => input.current?.click()} disabled={busy} aria-label="사진 붙이기">
          🖼️<small>사진</small>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && f.type.startsWith('image/') && !/svg/.test(f.type)) onPick(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// 💬 댓글 (프론트 GUEST_LINK 10-5, 프론트 앱과 같은 모양): 처음엔 접힌 "💬 댓글 달기"/"💬 댓글 N ▾",
// 누르면 펼쳐서 오래된 순 목록(동그라미 프/지 · 이름(내 것은 "나") · 시각 · 내 것만 ✕) + 입력칸·등록.
// PC는 Enter 등록·Ctrl/Shift+Enter 줄바꿈(한글 조합 중 Enter 무시), 휴대폰은 Enter 줄바꿈.
function FrontComments({ notice, uid, name, canWrite, people }: { notice: FrontNotice; uid: string; name: string; canWrite: boolean; people: People }) {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const list = notice.comments
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [text, open])
  async function send(e?: FormEvent) {
    e?.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    if (list.length >= 200) return toast('댓글은 200개까지 달 수 있어요.', { error: true })
    setBusy(true)
    try {
      await addFrontComment(notice.id, uid, name, t)
      setText('')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }
  async function remove(c: FrontComment) {
    if (!(await ask({ title: '댓글 삭제', message: '이 댓글을 지울까요?', ok: '삭제', danger: true }))) return
    deleteFrontComment(notice.id, c).catch((err) => toast(errorMessage(err), { error: true }))
  }
  function toggle() {
    const next = !open
    setOpen(next)
    if (next && desktop) setTimeout(() => inputRef.current?.focus(), 0)
  }
  if (!list.length && !canWrite) return null
  return (
    <div className="fn-comments">
      <button type="button" className={'fn-comments-toggle' + (list.length ? ' has' : '')} aria-expanded={open} onClick={toggle}>
        💬 댓글{list.length ? ` ${list.length}` : ' 달기'}
        {list.length > 0 || open ? (open ? ' ▴' : ' ▾') : ''}
      </button>
      {open && (
        <>
          {list.length > 0 && (
            <div className="fn-comment-list">
              {list.map((c) => {
                const mine = c.authorId === uid
                return (
                  <div key={c.id} className="fn-comment">
                    <span className="fn-comment-av">
                      <PersonFace id={c.authorId} name={c.authorName} people={people} />
                    </span>
                    <div className="fn-comment-body">
                      <div className="fn-comment-who">
                        <b>{mine ? '나' : personName(c.authorId, c.authorName, people)}</b>
                        <span className="muted">
                          ·{' '}
                          {new Date(c.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {mine && (
                          <button type="button" className="ghost fn-comment-del" aria-label="댓글 삭제" title="댓글 삭제" onClick={() => void remove(c)}>
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="fn-comment-text">{linkifyText(fixEmoji(c.text))}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {canWrite && (
            <form className="fn-comment-form" onSubmit={send}>
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                maxLength={1000}
                placeholder={desktop ? '댓글 입력... (Enter 등록 · Ctrl+Enter 줄바꿈)' : '댓글 입력...'}
                aria-label="댓글"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (!desktop || e.key !== 'Enter' || e.nativeEvent.isComposing) return
                  if (e.ctrlKey || e.shiftKey || e.metaKey) {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault()
                      const el = e.currentTarget
                      const at = el.selectionStart
                      const v = text.slice(0, at) + '\n' + text.slice(el.selectionEnd)
                      setText(v)
                      setTimeout(() => el.setSelectionRange(at + 1, at + 1), 0)
                    }
                    return
                  }
                  e.preventDefault()
                  void send()
                }}
              />
              <button type="submit" className="fn-comment-send" disabled={busy || !text.trim()}>
                {busy ? '…' : '등록'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

function FrontNoticeComposer({ uid, name }: { uid: string; name: string }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return toast('공지 내용을 입력하세요.', { error: true })
    setBusy(true)
    try {
      await addFrontNotice(uid, name, title, body, photo)
      setTitle('')
      setBody('')
      setPhoto(null)
      toast('공지를 올렸어요. 프론트 앱에도 보여요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="notice-composer" onSubmit={submit}>
      <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (선택)" aria-label="공지 제목" />
      <textarea value={body} maxLength={5000} rows={3} onChange={(e) => setBody(e.target.value)} placeholder="프론트와 같이 볼 공지를 입력하세요" aria-label="공지 내용" />
      <PhotoPick file={photo} keepUrl="" onPick={setPhoto} onClear={() => setPhoto(null)} busy={busy} />
      <div className="notice-composer-row">
        <span className="muted small">{photo ? '사진 1장' : '사진은 한 장까지'}</span>
        <button type="submit" className="primary post" disabled={busy}>
          {busy ? '올리는 중…' : '게시하기 📌'}
        </button>
      </div>
    </form>
  )
}

function FrontNoticeEditor({ notice, uid, name, onClose }: { notice: FrontNotice; uid: string; name: string; onClose: () => void }) {
  const [title, setTitle] = useState(notice.title)
  const [body, setBody] = useState(notice.body)
  const [photo, setPhoto] = useState<File | null>(null)
  const [dropped, setDropped] = useState(false) // 원래 사진을 뺐는지
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return toast('공지 내용을 입력하세요.', { error: true })
    setBusy(true)
    try {
      await editFrontNotice(notice.id, uid, name, title, body, photo ?? (dropped && notice.imageUrl ? null : undefined))
      toast('공지를 고쳤어요.')
      onClose()
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setBusy(false)
    }
  }
  return (
    <Modal onClose={() => !busy && onClose()} labelledBy="front-notice-editor-title" className="notice-editor" closeOnOutside={false}>
      <form className="form" onSubmit={submit}>
        <h3 id="front-notice-editor-title">✏️ 프론트 공지 수정</h3>
        <label>
          제목 (선택)
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" />
        </label>
        <label>
          내용
          <textarea value={body} maxLength={5000} rows={8} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용" />
        </label>
        <PhotoPick
          file={photo}
          keepUrl={dropped ? '' : notice.imageUrl}
          onPick={(f) => setPhoto(f)}
          onClear={() => {
            setPhoto(null)
            setDropped(true)
          }}
          busy={busy}
        />
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}
