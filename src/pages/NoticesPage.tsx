import { doc } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import type { Attachment } from '../chat.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { deleteNotice, MAX_NOTICE_PHOTOS, NOTICE_PAGE, noticesRef, saveNotice, useNotices, type Notice } from '../notices.ts'
import { MAX_STUCK, stick, stuckList, unstick, type StickerChoice } from '../stuck.ts'
import { MoreButton, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, Modal, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { showStickerInfo, StickerPicker, StuckLayer } from '../ui/Stuck.tsx'
import { photoCols } from './ChatPage.tsx'

// 📢 공지 게시판 (7번): 쓰기·수정·삭제(편집 이상, 고치기·지우기는 쓴 사람이나 관리자), 사진 첨부, 🏷️ 스티커(팀원 모두).
// PC(넓은 화면)는 두 칸, 휴대폰은 한 칸.
export function NoticesPage({ team, uid }: { team: Team; uid: string }) {
  const notices = useNotices(team.id)
  const role = team.members[uid]
  const canWrite = role === 'admin' || role === 'editor'
  const profiles = useMemberProfiles(Object.keys(team.members))
  const names = useMemo(() => Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, p.name])), [profiles])
  const { query } = useTabSearch()
  const q = query.trim().toLowerCase()
  const shown = (notices ?? []).filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null)

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
    if (!(await ask({ message: `"${n.title}" 공지를 삭제할까요? 사진과 스티커도 함께 지워지고 되돌릴 수 없어요.`, ok: '삭제', danger: true }))) return
    try {
      await deleteNotice(team.id, n.id)
      toast('공지를 삭제했어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  return (
    <div className="page notices">
      <header className="page-header">
        <MenuButton />
        <h2>📢 공지</h2>
        {canWrite ? (
          <button type="button" className="ghost" onClick={() => setEditing('new')}>
            ＋ 쓰기
          </button>
        ) : (
          <span />
        )}
      </header>
      {placing && (
        <div className="placing-bar" role="status">
          <span>{'e' in placing.choice ? placing.choice.e : '😊'} 공지에서 붙일 자리를 누르세요</span>
          <button type="button" className="ghost" onClick={() => setPlacing(null)}>
            취소
          </button>
        </div>
      )}
      <div className={placing ? 'page-body notice-body placing' : 'page-body notice-body'} ref={bodyRef} onClickCapture={place}>
        <SearchBar placeholder="공지 제목, 내용 검색" />
        {notices === null && <p className="center muted">불러오는 중…</p>}
        {notices && notices.length === 0 && (
          <div className="notice-empty">
            <div aria-hidden="true">📢</div>
            <p>아직 공지가 없어요</p>
            {canWrite && (
              <button type="button" className="primary" onClick={() => setEditing('new')}>
                첫 공지 쓰기
              </button>
            )}
          </div>
        )}
        {notices && notices.length > 0 && shown.length === 0 && <p className="center muted">"{query}"에 맞는 공지가 없어요.</p>}
        <div className="notice-grid">
          {shown.map((n) => {
            const mine = n.authorUid === uid
            const actions = (): MenuAction[] => [
              {
                icon: '🏷️',
                label: '스티커 붙이기',
                onSelect: () => (stuckList(n.stk).length >= MAX_STUCK ? toast(`스티커는 ${MAX_STUCK}개까지 붙일 수 있어요.`, { error: true }) : setStickFor(n.id)),
              },
              ...(canWrite && (mine || role === 'admin')
                ? [
                    { icon: '✏️', label: '수정', onSelect: () => setEditing(n) },
                    { icon: '🗑️', label: '삭제', danger: true, onSelect: () => void remove(n) },
                  ]
                : []),
            ]
            const photos: ViewerPhoto[] = n.photos.map((a) => ({ attachment: a, author: names[n.authorUid] ?? '', createdAt: n.createdAt?.toDate() ?? null }))
            return (
              <div key={n.id} className="stk-anchor notice-anchor" data-notice={n.id}>
                <article className="card notice-card">
                  <header className="notice-head">
                    <div>
                      <h3>{n.title}</h3>
                      <p className="muted small">
                        {names[n.authorUid] ?? '나간 팀원'} · {n.createdAt?.toDate().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) ?? '방금'}
                        {n.editedAt && ' · 수정됨'}
                      </p>
                    </div>
                    <MoreButton actions={actions} title={n.title} label="공지 메뉴" />
                  </header>
                  {n.body && <p className="notice-text">{linkifyText(n.body)}</p>}
                  {n.photos.length > 0 && (
                    <div className={`photos cols-${photoCols(n.photos.length)}`}>
                      {n.photos.map((a, i) => (
                        <StorageImage key={a.thumbPath} path={a.thumbPath} className="photo" onClick={() => setViewer({ photos, index: i })} />
                      ))}
                    </div>
                  )}
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
          })}
        </div>
        {notices && notices.length >= NOTICE_PAGE && <p className="muted small center">최근 공지 {NOTICE_PAGE}개만 보여요.</p>}
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
    if (!title.trim()) return toast('제목을 넣어 주세요.', { error: true })
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
          제목
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" required />
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
          <button type="submit" className="primary" disabled={!!busy || !title.trim()}>
            {notice ? '저장' : '올리기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
