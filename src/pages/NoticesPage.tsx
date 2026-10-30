import { doc } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import type { Attachment } from '../chat.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { teamPeople, useMemberProfiles, type Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { deleteNotice, MAX_NOTICE_PHOTOS, NOTICE_PAGE, noticesRef, saveNotice, setNoticeOrder, setNoticePinned, useNotices, type Notice } from '../notices.ts'
import { MAX_STUCK, stick, stuckList, unstick, type StickerChoice } from '../stuck.ts'
import { ask, Modal, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { showStickerInfo, StickerPicker, StuckLayer } from '../ui/Stuck.tsx'
import { useIsDesktop } from '../useMedia.ts'

// 📢 공지 게시판 (7번): 쓰기·수정·삭제(편집 이상, 고치기·지우기는 쓴 사람이나 관리자), 사진 첨부, 🏷️ 스티커(팀원 모두).
// PC(넓은 화면)는 두 칸, 휴대폰은 한 칸.
export function NoticesPage({ team, uid }: { team: Team; uid: string }) {
  const notices = useNotices(team.id)
  const role = team.myRole
  const canWrite = role === 'admin' || role === 'editor'
  const profiles = useMemberProfiles(teamPeople(team))
  const names = useMemo(() => Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.name])), [profiles])
  const { query } = useTabSearch()
  const q = query.trim().toLowerCase()
  const shown = (notices ?? []).filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)
  const desktop = useIsDesktop()

  // 🏷️ 공지 위에 스티커: 고르기 → 붙일 자리 누르기 (공지 카드 안 비율 0~1)
  const [stickFor, setStickFor] = useState<string | null>(null)
  const [placing, setPlacing] = useState<{ id: string; choice: StickerChoice } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  function place(e: React.MouseEvent) {
    if (!placing) return
    e.preventDefault()
    e.stopPropagation()
    const box = bodyRef.current?.querySelector(`[data-notice="${placing.id}"]`)?.getBoundingClientRect()
    if (!box) return setPlacing(null)
    if (e.clientX < box.left - 8 || e.clientX > box.right + 8 || e.clientY < box.top - 8 || e.clientY > box.bottom + 8)
      return toast('공지 위를 눌러 주세요. (그만두려면 취소)')
    const { id, choice } = placing
    setPlacing(null)
    stick(doc(noticesRef(team.id), id), 'stk', choice, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height).catch((err) =>
      toast(`붙이지 못했어요. ${errorMessage(err)}`, { error: true }),
    )
  }

  async function remove(n: Notice) {
    if (!(await ask({ message: `"${n.title || n.body.slice(0, 20)}" 공지를 삭제할까요? 사진과 스티커도 함께 지워지고 되돌릴 수 없어요.`, ok: '삭제', danger: true }))) return
    try {
      await deleteNotice(team.id, n.id)
      toast('공지를 삭제했어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  // ⠿ 끌어서 순서 바꾸기 (편집 이상, 같은 묶음(고정/보통) 안에서만). 놓은 자리의 카드 앞으로 간다.
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null)
  function dragStart(e: React.PointerEvent, id: string) {
    if (!canWrite || q) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag({ id, over: null })
  }
  function dragMove(e: React.PointerEvent) {
    if (!drag) return
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-notice]') as HTMLElement | null
    const over = el?.dataset.notice ?? null
    if (over !== drag.over) setDrag({ ...drag, over })
  }
  async function dragEnd() {
    if (!drag) return
    const { id, over } = drag
    setDrag(null)
    const list = notices ?? []
    const me = list.find((n) => n.id === id)
    const target = list.find((n) => n.id === over)
    if (!me || !target || me.id === target.id || me.pinned !== target.pinned) return
    const group = list.filter((n) => n.pinned === me.pinned && n.id !== me.id)
    const i = group.findIndex((n) => n.id === target.id)
    const before = group[i - 1]?.order ?? target.order - 1000
    try {
      await setNoticeOrder(team.id, me.id, (before + target.order) / 2)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  async function togglePin(n: Notice) {
    try {
      await setNoticePinned(team.id, n.id, !n.pinned)
      toast(n.pinned ? '상단 고정을 풀었어요.' : '📌 상단에 고정했어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  // PC는 두 칸: 순서대로 왼쪽·오른쪽 번갈아 (고정 공지가 맨 위 줄에 나란히)
  const columns = desktop ? [shown.filter((_, i) => i % 2 === 0), shown.filter((_, i) => i % 2 === 1)] : [shown]

  const card = (n: Notice) => {
    const mine = n.authorUid === uid
    const canChange = canWrite && (mine || role === 'admin')
    const photos: ViewerPhoto[] = n.photos.map((a) => ({ attachment: a, author: names[n.authorUid] ?? '', createdAt: n.createdAt?.toDate() ?? null }))
    const when = (t: Notice['createdAt']) =>
      t?.toDate().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '방금'
    const handle = canWrite && !q && (
      <span className="notice-handle" onPointerDown={(e) => dragStart(e, n.id)} aria-label="끌어서 순서 바꾸기" title="끌어서 순서 바꾸기">
        <span className="grip-dots" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    )
    return (
      <div
        key={n.id}
        className={['stk-anchor notice-anchor', drag?.over === n.id && drag.id !== n.id && 'drop-target', drag?.id === n.id && 'dragging'].filter(Boolean).join(' ')}
        data-notice={n.id}
      >
        <article className={n.pinned ? 'notice-card pinned' : 'notice-card'}>
          {n.pinned ? (
            <div className="notice-pin-band">
              <span>📌 상단 고정</span>
              {handle}
            </div>
          ) : (
            handle && <div className="notice-handle-row">{handle}</div>
          )}
          {n.photos.length > 0 && <NoticePhotos photos={n.photos} onOpen={(i) => setViewer({ photos, index: i })} />}
          <div className="notice-inner">
            {n.title && <h3 className="notice-title">{n.title}</h3>}
            {n.body && <p className="notice-text">{linkifyText(n.body)}</p>}
            <footer className="notice-foot">
              <span className="muted">
                {names[n.authorUid] ?? '나간 팀원'} · {when(n.createdAt)}
                {n.editedAt && ` · 수정: ${names[n.editedBy ?? ''] ?? ''}`}
              </span>
              <span className="notice-tools">
                <button
                  type="button"
                  className="ghost"
                  title="스티커 붙이기"
                  aria-label="스티커 붙이기"
                  onClick={() => (stuckList(n.stk).length >= MAX_STUCK ? toast(`스티커는 ${MAX_STUCK}개까지 붙일 수 있어요.`, { error: true }) : setStickFor(n.id))}
                >
                  🏷️
                </button>
                {canWrite && (
                  <button type="button" className={n.pinned ? 'ghost on' : 'ghost'} title={n.pinned ? '고정 풀기' : '상단 고정'} aria-label={n.pinned ? '고정 풀기' : '상단 고정'} aria-pressed={n.pinned} onClick={() => void togglePin(n)}>
                    📌
                  </button>
                )}
                {canChange && (
                  <button type="button" className="ghost" title="수정" aria-label="수정" onClick={() => setEditing(n)}>
                    ✏️
                  </button>
                )}
                {canChange && (
                  <button type="button" className="ghost del" title="삭제" aria-label="삭제" onClick={() => void remove(n)}>
                    ✕
                  </button>
                )}
              </span>
            </footer>
          </div>
        </article>
        <StuckLayer
          stickers={stuckList(n.stk)}
          onTap={(s) =>
            void showStickerInfo(s, names, uid, () =>
              unstick(doc(noticesRef(team.id), n.id), 'stk', s.id).catch((err) => toast(errorMessage(err), { error: true })),
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="page notices">
      <header className="page-header notices-header">
        <MenuButton />
        <h2>📢 공지</h2>
        <SearchBar placeholder="검색" label="공지 제목, 내용 검색" inline />
      </header>
      {placing && (
        <div className="placing-bar" role="status">
          <span>{'e' in placing.choice ? placing.choice.e : '😊'} 공지에서 붙일 자리를 누르세요</span>
          <button type="button" className="ghost" onClick={() => setPlacing(null)}>
            취소
          </button>
        </div>
      )}
      <div
        className={placing ? 'page-body notice-body placing' : 'page-body notice-body'}
        ref={bodyRef}
        onClickCapture={place}
        onPointerMove={dragMove}
        onPointerUp={() => void dragEnd()}
        onPointerCancel={() => setDrag(null)}
      >
        {canWrite && <NoticeComposer teamId={team.id} />}
        {notices === null && <p className="center muted">불러오는 중…</p>}
        {notices && notices.length === 0 && (
          <div className="notice-empty">
            <div aria-hidden="true">📢</div>
            <p>아직 공지가 없어요</p>
          </div>
        )}
        {notices && notices.length > 0 && shown.length === 0 && <p className="center muted">"{query}"에 맞는 공지가 없어요.</p>}
        <div className={desktop ? 'notice-grid two' : 'notice-grid'}>
          {columns.map((col, i) => (
            <div key={i} className="notice-col">
              {col.map(card)}
            </div>
          ))}
        </div>
        {notices && notices.length >= NOTICE_PAGE && <p className="muted small center">최근 공지 {NOTICE_PAGE}개(+ 고정 공지)만 보여요.</p>}
      </div>
      {editing && <NoticeEditor teamId={team.id} notice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {stickFor && (
        <StickerPicker
          onClose={() => setStickFor(null)}
          onPick={(choice) => {
            setPlacing({ id: stickFor, choice })
            setStickFor(null)
          }}
        />
      )}
      {viewer && <PhotoViewer photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

// 맨 위 글쓰기 칸 (프론트 앱 공지와 같은 모양): 제목(선택) · 내용 · 파일 선택 · 게시하기 📌
function NoticeComposer({ teamId }: { teamId: string }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim() && !title.trim() && files.length === 0) return toast('공지 내용을 입력하세요.', { error: true })
    setBusy(files.length ? `사진 올리는 중… 0/${files.length}` : '올리는 중…')
    try {
      await saveNotice(teamId, null, { title, body, keep: [], files }, (d, t) => setBusy(`사진 올리는 중… ${d}/${t}`))
      setTitle('')
      setBody('')
      setFiles([])
      toast('공지를 올렸어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <form className="notice-composer" onSubmit={submit}>
      <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (선택)" aria-label="공지 제목" />
      <textarea value={body} maxLength={5000} rows={3} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용을 입력하세요" aria-label="공지 내용" />
      {previews.length > 0 && (
        <div className="notice-photos">
          {previews.map((url, i) => (
            <button key={url} type="button" className="preview" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="사진 빼기">
              <img src={url} alt="" />
              <span>✕</span>
            </button>
          ))}
        </div>
      )}
      <div className="notice-composer-row">
        <button type="button" className="file-pick" onClick={() => input.current?.click()} disabled={!!busy}>
          파일 선택
        </button>
        <span className="muted small">{busy ?? (files.length ? `사진 ${files.length}장` : '선택된 파일 없음')}</span>
        <button type="submit" className="primary post" disabled={!!busy}>
          게시하기 📌
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const pics = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/') && !/svg/.test(f.type))
          e.target.value = ''
          if (files.length + pics.length > MAX_NOTICE_PHOTOS) toast(`사진은 ${MAX_NOTICE_PHOTOS}장까지 붙일 수 있어요.`, { error: true })
          setFiles([...files, ...pics].slice(0, MAX_NOTICE_PHOTOS))
        }}
      />
    </form>
  )
}

const LINK_RE = /(https?:\/\/[^\s<>"']+)/g
function linkifyText(text: string) {
  return text.split(LINK_RE).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

function NoticeEditor({ teamId, notice, onClose }: { teamId: string; notice: Notice | null; onClose: () => void }) {
  const [title, setTitle] = useState(notice?.title ?? '')
  const [body, setBody] = useState(notice?.body ?? '')
  const [keep, setKeep] = useState<Attachment[]>(notice?.photos ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  const count = keep.length + files.length

  function add(list: File[]) {
    const pics = list.filter((f) => f.type.startsWith('image/') && !/svg/.test(f.type))
    if (count + pics.length > MAX_NOTICE_PHOTOS) toast(`사진은 ${MAX_NOTICE_PHOTOS}장까지 붙일 수 있어요.`, { error: true })
    setFiles([...files, ...pics].slice(0, MAX_NOTICE_PHOTOS - keep.length))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() && !body.trim() && count === 0) return toast('공지 내용을 입력하세요.', { error: true })
    setBusy(files.length ? `사진 올리는 중… 0/${files.length}` : '저장하는 중…')
    try {
      await saveNotice(teamId, notice, { title, body, keep, files }, (d, t) => setBusy(`사진 올리는 중… ${d}/${t}`))
      toast(notice ? '공지를 고쳤어요.' : '공지를 올렸어요.')
      onClose()
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setBusy(null)
    }
  }

  return (
    <Modal onClose={() => !busy && onClose()} labelledBy="notice-editor-title" className="notice-editor" closeOnOutside={false}>
      <form className="form" onSubmit={submit}>
        <h3 id="notice-editor-title">{notice ? '✏️ 공지 수정' : '📢 새 공지'}</h3>
        <label>
          제목 (선택)
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" />
        </label>
        <label>
          내용
          <textarea value={body} maxLength={5000} rows={8} onChange={(e) => setBody(e.target.value)} placeholder="공지 내용" />
        </label>
        <div className="notice-photos">
          {keep.map((a) => (
            <button key={a.thumbPath} type="button" className="preview" onClick={() => setKeep(keep.filter((k) => k !== a))} aria-label="사진 빼기">
              <StorageImage path={a.thumbPath} />
              <span>✕</span>
            </button>
          ))}
          {previews.map((url, i) => (
            <button key={url} type="button" className="preview" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="사진 빼기">
              <img src={url} alt="" />
              <span>✕</span>
            </button>
          ))}
          {count < MAX_NOTICE_PHOTOS && (
            <button type="button" className="preview add" onClick={() => input.current?.click()} aria-label="사진 붙이기">
              🖼️<small>사진</small>
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        {busy && <p className="notice">{busy}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={!!busy}>
            취소
          </button>
          <button type="submit" className="primary" disabled={!!busy}>
            {notice ? '저장' : '올리기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 카드 맨 위 사진 칸 (프론트 앱 공지처럼): 칸 높이는 같고 사진은 가운데에 잘리지 않게. 여러 장이면 옆으로 밀어 넘김.
function NoticePhotos({ photos, onOpen }: { photos: Attachment[]; onOpen: (i: number) => void }) {
  const [at, setAt] = useState(0)
  return (
    <div className="notice-cover">
      <div className="notice-cover-track" onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {photos.map((a, i) => (
          <StorageImage key={a.thumbPath} path={a.thumbPath} className="notice-cover-img" onClick={() => onOpen(i)} />
        ))}
      </div>
      {photos.length > 1 && (
        <span className="notice-cover-count">
          📷 {at + 1} / {photos.length}
        </span>
      )}
    </div>
  )
}
