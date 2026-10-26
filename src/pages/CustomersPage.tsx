import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import {
  createCustomer,
  findCustomerByPhone,
  formatPhone,
  isValidPhone,
  normalizePhone,
  toCustomer,
  type Customer,
} from '../customers.ts'
import { db } from '../firebase.ts'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { CustomerDetail } from './CustomerDetail.tsx'
import { MenuButton } from '../menu.tsx'
import { ask } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'

const OPEN_KEY = 'open-customer'

export function CustomersPage({ team, uid, desktop }: { team: Team; uid: string; desktop: boolean }) {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const { query: search } = useTabSearch()
  const [adding, setAdding] = useState(false)
  // 열어 둔 고객은 F5(새로 고침) 뒤에도 다시 연다.
  const [openId, setOpenIdState] = useState<string | null>(() => {
    try {
      const [teamId, id] = (sessionStorage.getItem(OPEN_KEY) ?? '').split(':')
      return teamId === team.id && id ? id : null
    } catch {
      return null
    }
  })
  const setOpenId = (id: string | null) => {
    setOpenIdState(id)
    try {
      if (id) sessionStorage.setItem(OPEN_KEY, `${team.id}:${id}`)
      else sessionStorage.removeItem(OPEN_KEY)
    } catch {
      // 기억하지 못해도 동작에는 문제없다.
    }
  }
  const profiles = useMemberProfiles(Object.keys(team.members))
  const canWrite = team.members[uid] !== 'viewer'

  useEffect(
    () =>
      onSnapshot(query(collection(db, 'customers'), where('teamId', '==', team.id)), (snap) =>
        setCustomers(snap.docs.map((d) => toCustomer(d.id, d.data()))),
      ),
    [team.id],
  )

  // 검색은 처음에는 기기에서 거른다 (CLAUDE.md: 규모가 커지면 검색 서비스 검토).
  const { due, rest } = useMemo(() => {
    const words = search.trim().toLowerCase()
    const digits = words.replace(/\D/g, '')
    const matches = (c: Customer) =>
      !words ||
      c.name.toLowerCase().includes(words) ||
      c.company.toLowerCase().includes(words) ||
      (digits.length >= 3 && c.phones.some((p) => formatPhone(p).replace(/\D/g, '').includes(digits)))
    const list = (customers ?? []).filter(matches).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)
    const due = list
      .filter((c) => c.nextContactAt && c.nextContactAt.toMillis() <= endOfToday.getTime())
      .sort((a, b) => a.nextContactAt!.toMillis() - b.nextContactAt!.toMillis())
    return { due, rest: list }
  }, [customers, search])

  const detail = openId ? (
    <CustomerDetail
      key={openId}
      customerId={openId}
      team={team}
      uid={uid}
      profiles={profiles}
      embedded={desktop}
      onClose={() => setOpenId(null)}
      onOpenOther={setOpenId}
    />
  ) : null

  // PC: 왼쪽 목록 | 오른쪽 상세 (2단). 휴대폰: 목록 위에 상세를 전체 화면으로 띄운다.
  return (
    <div className={desktop ? 'split' : 'page'}>
    <div className={desktop ? 'page split-list' : 'contents'}>
      <header className="page-header">
        <MenuButton />
        <h2>고객 {customers ? customers.length : ''}</h2>
        {canWrite ? (
          <button type="button" className="ghost" onClick={() => setAdding(!adding)}>
            {adding ? '닫기' : '+ 추가'}
          </button>
        ) : (
          <span />
        )}
      </header>
      <SearchBar placeholder="이름, 회사, 전화번호 검색" />
      <div className="page-body">
        {adding && (
          <AddCustomerForm
            teamId={team.id}
            onDone={(id) => {
              setAdding(false)
              setOpenId(id)
            }}
          />
        )}
        {customers === null && <p className="center muted">불러오는 중…</p>}
        {due.length > 0 && (
          <section>
            <h3>오늘까지 연락할 고객</h3>
            <ul className="list">
              {due.map((c) => (
                <CustomerRow key={c.id} customer={c} showDue selected={desktop && openId === c.id} onOpen={() => setOpenId(c.id)} />
              ))}
            </ul>
          </section>
        )}
        {customers !== null && (
          <section>
            {due.length > 0 && <h3>전체</h3>}
            {rest.length === 0 ? (
              <p className="center muted">
                {search ? '검색 결과가 없습니다.' : canWrite ? '"+ 추가"로 첫 고객을 등록하세요.' : '등록된 고객이 없습니다.'}
              </p>
            ) : (
              <ul className="list">
                {rest.map((c) => (
                  <CustomerRow
                    key={c.id}
                    customer={c}
                    owner={profiles[c.ownerUid]?.name}
                    selected={desktop && openId === c.id}
                    onOpen={() => setOpenId(c.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
      {desktop ? (
        <div className="split-detail">
          {detail ?? (
            <div className="split-empty">
              <span aria-hidden="true">📇</span>
              <p>왼쪽 목록에서 고객을 고르면 여기에 상세 정보와 상담 이력이 보여요.</p>
            </div>
          )}
        </div>
      ) : (
        detail
      )}
    </div>
  )
}

function CustomerRow(props: { customer: Customer; owner?: string; showDue?: boolean; selected?: boolean; onOpen: () => void }) {
  const { customer: c, owner, showDue, selected, onOpen } = props
  const overdue = showDue && c.nextContactAt && c.nextContactAt.toDate() < startOfToday()
  return (
    <li>
      <button type="button" className={selected ? 'row row-button selected' : 'row row-button'} onClick={onOpen} aria-current={selected || undefined}>
        <div className="row-main">
          <strong>{c.name}</strong>
          <span className="muted small">
            {[c.company, c.phones[0] && formatPhone(c.phones[0])].filter(Boolean).join(' · ')}
          </span>
          {showDue && (
            <span className={overdue ? 'small error' : 'small'}>
              {c.nextContactAt!.toDate().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
              {overdue ? ' (지남)' : ''} {c.nextContactNote}
            </span>
          )}
        </div>
        {owner && <span className="badge">{owner}</span>}
      </button>
    </li>
  )
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function PhoneFields({ phones, onChange }: { phones: string[]; onChange: (phones: string[]) => void }) {
  return (
    <fieldset className="phones">
      <legend>전화번호</legend>
      {phones.map((p, i) => (
        <div key={i} className="phone-row">
          <input
            type="tel"
            inputMode="tel"
            value={p}
            onChange={(e) => onChange(phones.map((v, j) => (j === i ? e.target.value : v)))}
            placeholder="010-1234-5678"
            aria-label={`전화번호 ${i + 1}`}
          />
          {phones.length > 1 && (
            <button type="button" className="link danger" onClick={() => onChange(phones.filter((_, j) => j !== i))}>
              빼기
            </button>
          )}
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...phones, ''])}>
        + 번호 추가
      </button>
    </fieldset>
  )
}

// 입력한 번호를 정리하고, 형식이 틀리면 오류 문구를 돌려준다.
export function cleanPhones(raw: string[]): { phones: string[]; error?: string } {
  const phones = [...new Set(raw.map(normalizePhone).filter(Boolean))]
  if (phones.length === 0) return { phones, error: '전화번호를 하나 이상 입력하세요.' }
  const bad = phones.find((p) => !isValidPhone(p))
  if (bad) return { phones, error: `전화번호 형식이 올바르지 않습니다: ${formatPhone(bad)}` }
  return { phones }
}

function AddCustomerForm({ teamId, onDone }: { teamId: string; onDone: (id: string) => void }) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [phones, setPhones] = useState([''])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const cleaned = cleanPhones(phones)
    if (cleaned.error) return setError(cleaned.error)
    setBusy(true)
    setError('')
    try {
      const existing = await findCustomerByPhone(teamId, cleaned.phones)
      if (existing) {
        if (await ask({ message: `${formatPhone(existing.phone)} 번호는 이미 "${existing.name}" 고객으로 등록되어 있습니다.\n그 고객을 열까요?`, ok: '열기' })) {
          onDone(existing.id)
        }
        return
      }
      onDone(await createCustomer(teamId, { name: name.trim(), company: company.trim(), phones: cleaned.phones }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <strong>고객 추가</strong>
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
