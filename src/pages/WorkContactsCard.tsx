import { useEffect, useState } from 'react'
import { errorMessage } from '../auth.ts'
import { PhoneNative, prettyNumber, type WorkDuplicate } from '../phone.ts'
import { ask, toast } from '../ui/dialogs.tsx'

// 🏷️ 폰에 원래 있던 고객 연락처에 "[업무]" 붙이기 (갤럭시 앱 1.6.8, 2026-11-02 사용자가 정함, 폰 쪽 WorkContacts.kt).
// 같은 사람이 폰 연락처 "홍길동"과 지원팀 계정 "[업무] 홍길동"으로 두 번 있으면 전화가 올 때 [업무]가 안 붙은 이름이 뜰 수 있다.
// 직원이 고른 연락처만 이름 앞에 "[업무] "를 붙이고, 원래 이름은 폰 안에 기억해 "되돌리기"로 돌려놓는다. 서버에는 아무것도 안 올린다.
export function WorkContactsCard() {
  const [items, setItems] = useState<WorkDuplicate[] | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const load = () =>
    PhoneNative.workDuplicates()
      .then(({ items }) => {
        setItems(items)
        setPicked(new Set(items.filter((i) => !i.marked).map((i) => i.rawId)))
      })
      .catch((err: Error) => {
        if (/not implemented/i.test(err.message)) setUnsupported(true)
        else setItems([])
      })
  useEffect(() => void load(), [])

  if (unsupported)
    return (
      <section className="card">
        <h3>🏷️ 폰에 원래 있던 고객 연락처</h3>
        <p className="muted small">갤럭시 앱 새 버전(1.6.8)이 필요해요. 아래 "📱 갤럭시 앱 새 버전" 띠에서 업데이트해 주세요.</p>
      </section>
    )
  if (!items) return null
  const todo = items.filter((i) => !i.marked)
  const done = items.filter((i) => i.marked)

  async function mark() {
    const ids = [...picked]
    if (ids.length === 0) return
    const ok = await ask({
      title: `연락처 ${ids.length}개에 [업무] 붙이기`,
      message: '폰 연락처 이름 앞에 "[업무] "를 붙여요. 원래 이름은 이 폰에 기억해 두어 언제든 "되돌리기"로 돌려놓을 수 있어요.',
      ok: '붙이기',
    })
    if (!ok) return
    setBusy(true)
    try {
      const { changed } = await PhoneNative.markWork({ rawIds: ids })
      toast(`${changed}개에 [업무]를 붙였어요`)
      await load()
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  async function undo(item: WorkDuplicate) {
    setBusy(true)
    try {
      await PhoneNative.markWork({ rawIds: [item.rawId], undo: true })
      toast('원래 이름으로 되돌렸어요')
      await load()
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <section className="card">
      <h3>🏷️ 폰에 원래 있던 고객 연락처</h3>
      <p className="muted small">
        고객 번호가 폰 연락처에도 따로 저장돼 있으면, 전화가 올 때 <strong>[업무]가 안 붙은 이름</strong>이 뜰 수 있어요. 골라서 이름 앞에
        "[업무]"를 붙이면 어느 쪽이 떠도 업무 전화로 보여요.
      </p>
      {items.length === 0 ? (
        <p className="notice small">겹치는 연락처가 없어요 👍</p>
      ) : (
        <>
          <p className="small">
            {todo.length > 0 ? <strong>[업무] 안 붙은 연락처 {todo.length}개</strong> : '모두 [업무]가 붙어 있어요'}
            {done.length > 0 && <span className="muted"> · 붙인 연락처 {done.length}개</span>}
          </p>
          <button type="button" className="ghost" onClick={() => setOpen(!open)}>
            {open ? '▾ 목록 접기' : '▸ 목록 보기'}
          </button>
          {open && (
            <ul className="work-dup-list">
              {items.map((i) => (
                <li key={i.rawId}>
                  {i.marked ? (
                    <span className="work-dup-done">✅</span>
                  ) : (
                    <input type="checkbox" checked={picked.has(i.rawId)} onChange={() => toggle(i.rawId)} aria-label={`${i.name} 고르기`} />
                  )}
                  <span className="work-dup-text">
                    <strong>{i.name || '(이름 없음)'}</strong>
                    <span className="muted small">
                      {' '}
                      {prettyNumber(i.number)} · 고객: {i.customer}
                      {i.company ? ` (${i.company})` : ''}
                    </span>
                  </span>
                  {i.marked && i.canUndo && (
                    <button type="button" className="link" disabled={busy} onClick={() => void undo(i)}>
                      되돌리기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {todo.length > 0 && (
            <div className="button-row">
              <button type="button" className="primary" disabled={busy || picked.size === 0} onClick={() => void mark()}>
                {busy ? '고치는 중…' : `🏷️ 고른 ${picked.size}개에 [업무] 붙이기`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
