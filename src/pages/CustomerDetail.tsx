import { collection, doc, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ROLE_LABELS } from '../api.ts'
import { errorMessage } from '../auth.ts'
import {
  addNote,
  deleteCustomer,
  deleteNote,
  editNote,
  findCustomerByPhone,
  formatPhone,
  loadRevisions,
  NOTE_KINDS,
  toCustomer,
  toNote,
  updateCustomer,
  type Customer,
  type Note,
  type Revision,
} from '../customers.ts'
import { db } from '../firebase.ts'
import type { Profile, Team } from '../hooks.ts'
import { cleanPhones, PhoneFields } from './CustomersPage.tsx'

type Props = {
  customerId: string
  team: Team
  uid: string
  profiles: Record<string, Profile>
  onClose: () => void
  onOpenOther: (customerId: string) => void
}

export function CustomerDetail({ customerId, team, uid, profiles, onClose, onOpenOther }: Props) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [editing, setEditing] = useState(false)
  const [callPrompt, setCallPrompt] = useState(false)
  const calling = useRef(false)
  const role = team.members[uid]
  const canWrite = role !== 'viewer'
  const isAdmin = role === 'admin'
  const nameOf = (id: string | null | undefined) => (id && profiles[id]?.name) || '나간 팀원'

  useEffect(
    () =>
      onSnapshot(doc(db, 'customers', customerId), (snap) => {
        // 다른 팀원이 삭제하면 화면을 닫는다.
        if (!snap.exists()) return snap.metadata.fromCache ? undefined : onClose()
        setCustomer(toCustomer(snap.id, snap.data()))
      }),
    [customerId, onClose],
  )

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'customers', customerId, 'notes'), orderBy('createdAt', 'desc')),
        (snap) => setNotes(snap.docs.map((d) => toNote(d.id, d.data({ serverTimestamps: 'estimate' })))),
      ),
    [customerId],
  )

  // 앱에서 전화를 걸고 돌아오면 메모 창을 띄운다 (화면 6).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && calling.current) {
        calling.current = false
        setCallPrompt(true)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!customer) {
    return (
      <div className="overlay">
        <p className="center muted">불러오는 중…</p>
      </div>
    )
  }

  const canDelete = isAdmin || (canWrite && customer.ownerUid === uid)

  async function remove() {
    if (!customer) return
    if (!confirm(`"${customer.name}" 고객을 삭제할까요?\n상담 메모 ${notes.length}개도 함께 영구 삭제되며 되돌릴 수 없습니다.`)) return
    try {
      await deleteCustomer(customer.id)
      onClose()
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  return (
    <div className="overlay">
      <header className="page-header">
        <button type="button" className="ghost" onClick={onClose} aria-label="고객 목록으로">
          ‹
        </button>
        <h2>{customer.name}</h2>
        {canWrite ? (
          <button type="button" className="ghost" onClick={() => setEditing(!editing)}>
            {editing ? '닫기' : '수정'}
          </button>
        ) : (
          <span />
        )}
      </header>
      <div className="overlay-body page-body">
        {editing ? (
          <EditCustomerForm customer={customer} onDone={() => setEditing(false)} onOpenOther={onOpenOther} />
        ) : (
          <section className="card">
            {customer.company && <p className="muted">{customer.company}</p>}
            <ul className="phone-list">
              {customer.phones.map((p) => (
                <li key={p}>
                  <span>{formatPhone(p)}</span>
                  <a className="call-button" href={`tel:${p}`} onClick={() => (calling.current = true)}>
                    📞 전화
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card form">
          <OwnerField team={team} customer={customer} canWrite={canWrite} profiles={profiles} />
          <NextContactField customer={customer} canWrite={canWrite} />
        </section>

        {callPrompt && canWrite && (
          <p className="notice">방금 통화한 내용을 메모해 두세요.</p>
        )}
        {canWrite && (
          <NoteComposer
            key={callPrompt ? 'call' : 'normal'}
            customerId={customer.id}
            initialKind={callPrompt ? '발신 통화' : '메모'}
            autoFocus={callPrompt}
            onSaved={() => setCallPrompt(false)}
          />
        )}

        <section>
          <h3>상담 이력 {notes.length > 0 && <span className="muted">{notes.length}</span>}</h3>
          {notes.length === 0 ? (
            <p className="muted small">아직 기록이 없습니다.</p>
          ) : (
            <ul className="notes">
              {notes.map((n) => (
                <NoteItem
                  key={n.id}
                  customerId={customer.id}
                  note={n}
                  nameOf={nameOf}
                  canEdit={canWrite}
                  canDelete={isAdmin || (canWrite && n.authorUid === uid)}
                />
              ))}
            </ul>
          )}
        </section>

        <p className="muted small">
          등록 {nameOf(customer.createdBy)} · {customer.createdAt?.toDate().toLocaleDateString('ko-KR') ?? ''}
        </p>
        {canDelete && (
          <button type="button" className="danger-button" onClick={remove}>
            고객 삭제
          </button>
        )}
      </div>
    </div>
  )
}

// 담당자 넘기기: 메모와 다음 연락을 책임질 사람을 바꾼다 (전화를 돌리는 기능이 아님).
function OwnerField(props: { team: Team; customer: Customer; canWrite: boolean; profiles: Record<string, Profile> }) {
  const { team, customer, canWrite, profiles } = props
  const members = Object.keys(team.members).filter((m) => team.members[m] !== 'viewer')

  async function change(ownerUid: string) {
    const name = profiles[ownerUid]?.name ?? ''
    if (!confirm(`담당자를 ${name}님으로 넘길까요?`)) return
    try {
      await updateCustomer(customer.id, { ownerUid })
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  if (!canWrite) {
    return (
      <div className="field-row">
        <span className="muted">담당자</span>
        <strong>{profiles[customer.ownerUid]?.name ?? '나간 팀원'}</strong>
      </div>
    )
  }
  return (
    <label>
      담당자
      <select value={customer.ownerUid} onChange={(e) => change(e.target.value)}>
        {!members.includes(customer.ownerUid) && <option value={customer.ownerUid}>나간 팀원</option>}
        {members.map((m) => (
          <option key={m} value={m}>
            {profiles[m]?.name ?? '…'} ({ROLE_LABELS[team.members[m]]})
          </option>
        ))}
      </select>
    </label>
  )
}

function dateValue(ts: Timestamp | null) {
  if (!ts) return ''
  const d = ts.toDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function NextContactField({ customer, canWrite }: { customer: Customer; canWrite: boolean }) {
  const [date, setDate] = useState(dateValue(customer.nextContactAt))
  const [note, setNote] = useState(customer.nextContactNote)
  const changed = date !== dateValue(customer.nextContactAt) || note !== customer.nextContactNote

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      await updateCustomer(customer.id, {
        // 날짜만 고르므로 그 날 오전 9시(기기 시간)로 저장한다.
        nextContactAt: date ? Timestamp.fromDate(new Date(`${date}T09:00:00`)) : null,
        nextContactNote: date ? note.trim() : '',
      })
      if (!date) setNote('')
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  if (!canWrite) {
    return (
      <div className="field-row">
        <span className="muted">다음 연락</span>
        <strong>{customer.nextContactAt ? `${dateValue(customer.nextContactAt)} ${customer.nextContactNote}` : '없음'}</strong>
      </div>
    )
  }
  return (
    <form className="form" onSubmit={save}>
      <label>
        다음 연락
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {date && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="무엇을 할지 (예: 견적서 회신 확인)"
          maxLength={100}
          aria-label="다음 연락 내용"
        />
      )}
      {(changed || date) && (
        <div className="button-row">
          {changed && <button className="primary">저장</button>}
          {date && (
            <button type="button" onClick={() => { setDate(''); setNote('') }}>
              지우기
            </button>
          )}
        </div>
      )}
    </form>
  )
}

function EditCustomerForm(props: { customer: Customer; onDone: () => void; onOpenOther: (id: string) => void }) {
  const { customer, onDone, onOpenOther } = props
  const [name, setName] = useState(customer.name)
  const [company, setCompany] = useState(customer.company)
  const [phones, setPhones] = useState(customer.phones.map(formatPhone))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const cleaned = cleanPhones(phones)
    if (cleaned.error) return setError(cleaned.error)
    setBusy(true)
    setError('')
    try {
      const added = cleaned.phones.filter((p) => !customer.phones.includes(p))
      const existing = added.length ? await findCustomerByPhone(customer.teamId, added) : null
      if (existing && existing.id !== customer.id) {
        if (confirm(`${formatPhone(existing.phone)} 번호는 이미 "${existing.name}" 고객으로 등록되어 있습니다.\n그 고객을 열까요?`)) {
          onOpenOther(existing.id)
        }
        return
      }
      await updateCustomer(customer.id, { name: name.trim(), company: company.trim(), phones: cleaned.phones })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>
        이름
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
      </label>
      <label>
        회사 (선택)
        <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={50} />
      </label>
      <PhoneFields phones={phones} onChange={setPhones} />
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !name.trim()}>
        {busy ? '저장하는 중…' : '저장'}
      </button>
    </form>
  )
}

function NoteComposer(props: { customerId: string; initialKind: string; autoFocus: boolean; onSaved: () => void }) {
  const [kind, setKind] = useState(props.initialKind)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await addNote(props.customerId, kind, body.trim())
      setBody('')
      props.onSaved()
    } catch (err) {
      alert(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <div className="chips" role="radiogroup" aria-label="기록 종류">
        {NOTE_KINDS.map((k) => (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'chip selected' : 'chip'}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="상담 내용을 적어 주세요"
        rows={3}
        autoFocus={props.autoFocus}
        aria-label="상담 메모"
      />
      <button className="primary" disabled={busy || !body.trim()}>
        {busy ? '저장하는 중…' : '메모 저장'}
      </button>
    </form>
  )
}

function NoteItem(props: {
  customerId: string
  note: Note
  nameOf: (uid: string | null | undefined) => string
  canEdit: boolean
  canDelete: boolean
}) {
  const { customerId, note, nameOf, canEdit, canDelete } = props
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(note.body)
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const when = (ts: Timestamp | null) =>
    ts?.toDate().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) ?? ''

  async function save(e: FormEvent) {
    e.preventDefault()
    if (body.trim() === note.body) return setEditing(false)
    try {
      await editNote(customerId, note, body.trim())
      setEditing(false)
      setRevisions(null)
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  async function remove() {
    if (!confirm('이 메모를 삭제할까요? 수정 기록도 함께 영구 삭제됩니다.')) return
    try {
      await deleteNote(customerId, note.id)
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  async function toggleHistory() {
    if (revisions) return setRevisions(null)
    try {
      setRevisions(await loadRevisions(customerId, note.id))
    } catch (err) {
      alert(errorMessage(err))
    }
  }

  return (
    <li className="note card">
      <div className="note-head">
        <span className="badge kind">{note.kind}</span>
        <span className="muted small">
          {nameOf(note.authorUid)} · {when(note.createdAt)}
        </span>
      </div>
      {editing ? (
        <form className="form" onSubmit={save}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} aria-label="메모 수정" />
          <div className="button-row">
            <button className="primary" disabled={!body.trim()}>저장</button>
            <button type="button" onClick={() => { setBody(note.body); setEditing(false) }}>취소</button>
          </div>
        </form>
      ) : (
        <p className="note-body">{note.body}</p>
      )}
      <div className="note-foot">
        {note.editCount > 0 ? (
          <button type="button" className="link" onClick={toggleHistory}>
            수정됨 · {nameOf(note.editedBy)} · {when(note.editedAt)} ({note.editCount}회)
          </button>
        ) : (
          <span />
        )}
        <span>
          {canEdit && !editing && (
            <button type="button" className="link" onClick={() => setEditing(true)}>수정</button>
          )}
          {canDelete && !editing && (
            <button type="button" className="link danger" onClick={remove}>삭제</button>
          )}
        </span>
      </div>
      {revisions && (
        <ol className="revisions">
          {revisions.map((r) => (
            <li key={r.id}>
              <span className="muted small">
                {nameOf(r.editedBy)} · {when(r.editedAt)}
              </span>
              <p>{r.body}</p>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}
