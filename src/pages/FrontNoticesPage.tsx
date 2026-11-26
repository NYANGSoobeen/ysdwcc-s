import { useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { addFrontNotice, deleteFrontNotice, editFrontNotice, pinFrontNotice, sortFrontNotices, useFrontNotices, type FrontNotice } from '../frontNotices.ts'
import { GameButton } from '../games/GameButton.tsx'
import { MenuButton } from '../menu.tsx'
import { fixEmoji } from '../ui/emojiFix.ts'
import { ask, Modal, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { useIsDesktop } from '../useMedia.ts'
import { linkifyText } from './NoticesPage.tsx'

// 🤝 프론트 공지 (2026-11-26, 프론트 GUEST_LINK 10): 모든 팀 직원과 프론트 직원이 같이 보는 게시판 하나.
// 모양은 📢 공지 카드를 그대로 쓰고(사진·스티커·끌어 옮기기는 없음), 고치기·지우기는 쓴 사람만(최고 관리자는 지우기),
// 📌 고정은 쓰기 권한이 있는 사람 누구나. 보기 권한(viewer)은 읽기만.
export function FrontNoticesPage({ uid, name, canWrite, superAdmin }: { uid: string; name: string; canWrite: boolean; superAdmin: boolean }) {
  const list = useFrontNotices()
  const { query } = useTabSearch()
  const q = query.trim().toLowerCase()
  const sorted = sortFrontNotices(list ?? [])
  const shown = sorted.filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
  const desktop = useIsDesktop()
  const [editing, setEditing] = useState<FrontNotice | null>(null)
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
              <img className="notice-cover-img" src={n.imageUrl} alt="" />
            </div>
          )}
          <div className="notice-inner">
            {n.title && <h3 className="notice-title">{n.title}</h3>}
            {n.body && <p className="notice-text">{linkifyText(fixEmoji(n.body))}</p>}
            <footer className="notice-foot">
              <span className="muted">
                {n.authorName || (n.authorId.startsWith('f_') ? '프론트' : '지원팀')} · {when}
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
    </div>
  )
}

function FrontNoticeComposer({ uid, name }: { uid: string; name: string }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return toast('공지 내용을 입력하세요.', { error: true })
    setBusy(true)
    try {
      await addFrontNotice(uid, name, title, body)
      setTitle('')
      setBody('')
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
      <div className="notice-composer-row">
        <span className="muted small">사진은 아직 못 붙여요</span>
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
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return toast('공지 내용을 입력하세요.', { error: true })
    setBusy(true)
    try {
      await editFrontNotice(notice.id, uid, name, title, body)
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
