import { DEVICE_NOTES_KEY, deviceNoteNumbers, noteKey } from '../privateNotes.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Customer } from '../customers.ts'
import { formatPhone } from '../customers.ts'
import type { Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import {
  appCalls,
  callTypeLabel,
  dayLabel,
  approxDurationText,
  APP_CALLS_EVENT,
  durationText,
  hasPhoneNative,
  isPcDevice,
  oldAndroidApp,
  PhoneNative,
  prettyNumber,
  startCall,
  timeText,
  useDeviceContacts,
  usePhoneChanged,
  usePhonePerms,
  useTeamCustomers,
  type CallEntry,
} from '../phone.ts'
import { useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { Modal, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { openCallMemo } from './CallMemo.tsx'
import { pushSharedMemo, readClipboard } from '../sharedMemo.ts'
import { addAsCustomer, copyNumber, OldAppCard, PermissionCard, PersonDot, searchPeople, type Person } from './PhoneCommon.tsx'

// 📞 전화 (삼성 전화 앱처럼 아래 탭: 키패드 · 최근기록 · 연락처)
// 최근기록은 업무(지금 팀 고객 번호)/개인으로 나눠 보고, 고객 통화는 바로 상담 메모를 남긴다.
type Sub = 'keypad' | 'recent' | 'contacts'
const SUB_KEY = 'phone-sub'
type Filter = 'all' | 'work' | 'personal' | 'missed'

type Props = { team: Team; uid: string; onOpenCustomer: (id: string) => void; onOpenSms: (number: string, name?: string) => void }

export function PhonePage({ team, onOpenCustomer, onOpenSms }: Props) {
  const [sub, setSubState] = useState<Sub>(() => {
    try {
      return (sessionStorage.getItem(SUB_KEY) as Sub) || 'recent'
    } catch {
      return 'recent'
    }
  })
  const setSub = (s: Sub) => {
    setSubState(s)
    try {
      sessionStorage.setItem(SUB_KEY, s)
    } catch {
      // 기억 못 해도 괜찮다
    }
  }
  const perms = usePhonePerms()
  const { customers, find } = useTeamCustomers(team.id)
  const { contacts, nameOf } = useDeviceContacts(perms.contacts)
  const canWrite = team.myRole !== 'viewer'
  const [picking, setPicking] = useState(false)
  // 누른 줄은 펼쳐서 버튼(전화·문자·메모·고객)을 보여 준다 (삼성 전화 앱처럼, 잘못 눌러 전화가 걸리지 않게)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const ctx: RowCtx = {
    teamId: team.id,
    canWrite,
    find,
    nameOf,
    onOpenCustomer,
    onOpenSms,
    pickMemo: () => setPicking(true),
    openRow,
    toggleRow: (k) => setOpenRow((cur) => (cur === k ? null : k)),
  }

  return (
    <div className="page phone-page">
      <header className="page-header">
        <MenuButton />
        <h2>📞 전화</h2>
        <span />
      </header>
      <nav className="phone-tabs" aria-label="전화 화면">
        {(
          [
            ['keypad', '⌨️', '키패드'],
            ['recent', '🕘', '최근기록'],
            ['contacts', '👥', '연락처'],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} type="button" className={sub === id ? 'selected' : ''} aria-current={sub === id ? 'page' : undefined} onClick={() => setSub(id)}>
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      <div className="page-body phone-body">
        {oldAndroidApp && <OldAppCard />}
        {sub === 'keypad' && <Keypad customers={customers ?? []} contacts={contacts} ctx={ctx} />}
        {sub === 'recent' && <Recent ctx={ctx} callsGranted={perms.calls} loaded={perms.loaded} />}
        {sub === 'contacts' && <Contacts customers={customers} contacts={contacts} contactsGranted={perms.contacts} ctx={ctx} />}
      </div>
      {picking && <MemoCustomerPicker customers={customers ?? []} onClose={() => setPicking(false)} />}
    </div>
  )
}

type RowCtx = {
  teamId: string
  canWrite: boolean
  find: (n: string) => Customer | undefined
  nameOf: (n: string) => string | undefined
  onOpenCustomer: (id: string) => void
  onOpenSms: (number: string, name?: string) => void
  pickMemo: () => void
  openRow: string | null
  toggleRow: (key: string) => void
}

function personActions(ctx: RowCtx, number: string, customer: Customer | undefined, extra: MenuAction[] = []): MenuAction[] {
  return [
    { icon: '📞', label: '전화 걸기', onSelect: () => void startCall(number, customer?.id, customer?.name ?? ctx.nameOf(number)).catch((e) => toast(String(e.message ?? e), { error: true })) },
    { icon: '✉️', label: '문자 보내기', onSelect: () => ctx.onOpenSms(number, customer?.name ?? ctx.nameOf(number)) },
    ...extra,
    customer
      ? { icon: '📇', label: '고객 정보 보기', onSelect: () => ctx.onOpenCustomer(customer.id) }
      : ctx.canWrite
        ? {
            icon: '＋',
            label: '고객으로 추가',
            onSelect: () => void addAsCustomer(ctx.teamId, number, ctx.nameOf(number) ?? '').then((id) => id && ctx.onOpenCustomer(id)),
          }
        : null,
    { icon: '📋', label: '번호 복사', onSelect: () => void copyNumber(number) },
  ].filter(Boolean) as MenuAction[]
}

// ── 키패드 ──
const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
]

function Keypad({ customers, contacts, ctx }: { customers: Customer[]; contacts: { name: string; number: string }[]; ctx: RowCtx }) {
  const [number, setNumber] = useState('')
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined)
  const held = useRef(false)
  const matches = useMemo(() => (number.length >= 2 ? searchPeople(number, customers, contacts, 3) : []), [number, customers, contacts])
  const exact = ctx.find(number)
  const contactName = exact ? undefined : ctx.nameOf(number)

  // PC 키보드로도 누를 수 있게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (/^[\d*#+]$/.test(e.key)) setNumber((n) => n + e.key)
      else if (e.key === 'Backspace') setNumber((n) => n.slice(0, -1))
      else if (e.key === 'Enter' && number) void call(number)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function call(n: string, customer?: Customer) {
    try {
      await startCall(n.replace(/[^\d*#+]/g, ''), customer?.id ?? ctx.find(n)?.id, (customer ?? ctx.find(n))?.name ?? ctx.nameOf(n))
    } catch (err) {
      toast((err as Error).message, { error: true })
    }
  }

  return (
    <div className="keypad">
      <div className="keypad-display">
        <div className="keypad-number" aria-live="polite">
          {prettyNumber(number) || <span className="muted">번호를 누르세요</span>}
        </div>
        {exact && (
          <button type="button" className="keypad-who work" onClick={() => ctx.onOpenCustomer(exact.id)}>
            [업무] {exact.name}
            {exact.company && ` · ${exact.company}`}
          </button>
        )}
        {contactName && <div className="keypad-who">{contactName}</div>}
        {!exact && !contactName && matches.length > 0 && (
          <ul className="keypad-matches">
            {matches.map((m: Person) => (
              <li key={m.number}>
                <button type="button" onClick={() => setNumber(m.number.startsWith('+82') ? `0${m.number.slice(3)}` : m.number.replace(/\D/g, ''))}>
                  <PersonDot name={m.name} work={!!m.customer} />
                  <span>
                    {m.customer && <span className="work-tag">업무</span>}
                    {m.name}
                    <small className="muted"> {prettyNumber(m.number)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="keypad-grid">
        {KEYS.map(([k, sub]) => (
          <button
            key={k}
            type="button"
            className="keypad-key"
            onPointerDown={() => {
              held.current = false
              if (k === '0')
                hold.current = setTimeout(() => {
                  held.current = true
                  setNumber((n) => n + '+')
                }, 600)
            }}
            onPointerUp={() => clearTimeout(hold.current)}
            onPointerLeave={() => clearTimeout(hold.current)}
            onClick={() => {
              if (held.current) return
              setNumber((n) => n + k)
            }}
            aria-label={k}
          >
            <span className="digit">{k}</span>
            <small>{sub}</small>
          </button>
        ))}
      </div>
      <div className="keypad-actions">
        <button type="button" className="ghost keypad-side" disabled={!number} onClick={() => ctx.onOpenSms(number)} aria-label="문자 보내기">
          ✉️
        </button>
        <button type="button" className="keypad-call" disabled={!number} onClick={() => void call(number)} aria-label="전화 걸기">
          📞
        </button>
        <button
          type="button"
          className="ghost keypad-side"
          disabled={!number}
          onClick={() => setNumber((n) => n.slice(0, -1))}
          onContextMenu={(e) => {
            e.preventDefault()
            setNumber('')
          }}
          aria-label="지우기"
        >
          ⌫
        </button>
      </div>
    </div>
  )
}

// ── 최근기록 ──
type Group = { key: string; first: CallEntry; count: number }

function Recent({ ctx, callsGranted, loaded }: { ctx: RowCtx; callsGranted: boolean; loaded: boolean }) {
  const [calls, setCalls] = useState<CallEntry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const { query } = useTabSearch()
  const native = hasPhoneNative && callsGranted

  const load = () => {
    if (native)
      void PhoneNative.callLog({ limit: 400 })
        .then(({ calls }) => setCalls(calls))
        .catch((e) => toast(String(e.message ?? e), { error: true }))
    else setCalls(appCalls())
  }
  useEffect(load, [native])
  usePhoneChanged('calls', load)
  // 🔒 이 기기에 내 메모가 있는 번호 (고객이 아닌 번호)
  const [noted, setNoted] = useState(deviceNoteNumbers)
  useEffect(() => {
    const reload = () => setNoted(deviceNoteNumbers())
    window.addEventListener(DEVICE_NOTES_KEY, reload)
    return () => window.removeEventListener(DEVICE_NOTES_KEY, reload)
  }, [])
  // 아이폰·PC: 돌아와서 통화 시간 어림값을 적으면 다시 읽는다
  useEffect(() => {
    if (native) return
    const reload = () => setCalls(appCalls())
    window.addEventListener(APP_CALLS_EVENT, reload)
    return () => window.removeEventListener(APP_CALLS_EVENT, reload)
  }, [native])

  const groups = useMemo(() => {
    const words = query.trim().toLowerCase()
    const digits = query.replace(/\D/g, '')
    const list = (calls ?? []).filter((c) => {
      const customer = ctx.find(c.number)
      const kind = callTypeLabel(c.type).kind
      if (filter === 'work' && !customer) return false
      if (filter === 'personal' && customer) return false
      if (filter === 'missed' && kind !== 'missed') return false
      if (!words) return true
      const name = customer?.name ?? ctx.nameOf(c.number) ?? c.name
      return name.toLowerCase().includes(words) || (digits.length >= 2 && c.number.replace(/\D/g, '').includes(digits))
    })
    // 같은 날 같은 번호에서 이어진 같은 종류 통화는 하나로 묶는다 (삼성 전화 앱처럼 "(3)")
    const out: Group[] = []
    for (const c of list) {
      const prev = out[out.length - 1]
      if (prev && prev.first.number === c.number && prev.first.type === c.type && dayLabel(prev.first.date) === dayLabel(c.date)) prev.count++
      else out.push({ key: c.id, first: c, count: 1 })
    }
    return out
  }, [calls, filter, query, ctx])

  return (
    <>
      {hasPhoneNative && loaded && <PermissionCard kind="calls" what="이 폰의 통화 기록" granted={callsGranted} />}
      <SearchBar placeholder="이름, 번호 검색" />
      <div className="chips phone-filters" role="radiogroup" aria-label="보기">
        {(
          [
            ['all', '전체'],
            ['work', '업무'],
            ['personal', '개인'],
            ['missed', '부재중'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={filter === id} className={filter === id ? 'chip selected' : 'chip'} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {ctx.canWrite && (
        <button type="button" className="summary-paste" onClick={() => void pasteSummary()}>
          📋 복사한 통화 요약으로 메모하기 <small className="muted">(에이닷 등)</small>
        </button>
      )}
      {!native && (
        <div className="card phone-hint">
          <p className="muted small">
            {hasPhoneNative
              ? '권한을 허용하기 전에는 이 앱에서 건 전화만 보여요.'
              : isPcDevice()
                ? '컴퓨터에는 전화 회선이 없어요. 📞를 누르면 휴대폰으로 걸 수 있게 번호를 크게 보여 드려요.'
                : '아이폰·브라우저는 폰의 통화 기록을 읽을 수 없어서, 이 앱에서 건 전화만 보여요. 받은 전화는 아래 버튼으로 메모해 주세요.'}
          </p>
          {ctx.canWrite && (
            <button type="button" onClick={ctx.pickMemo}>
              📝 방금 받은 전화 메모하기
            </button>
          )}
        </div>
      )}
      {calls === null && <p className="center muted">불러오는 중…</p>}
      {calls && groups.length === 0 && <p className="center muted">{query ? `"${query}"에 맞는 통화가 없어요.` : '통화 기록이 없어요.'}</p>}
      <ul className="call-list">
        {groups.map((g, i) => (
          <CallRow
            key={g.key}
            group={g}
            ctx={ctx}
            hasNote={noted.has(noteKey(g.first.number))}
            day={i === 0 || dayLabel(groups[i - 1].first.date) !== dayLabel(g.first.date) ? dayLabel(g.first.date) : null}
          />
        ))}
      </ul>
    </>
  )
}

function CallRow({ group, ctx, day, hasNote }: { group: Group; ctx: RowCtx; day: string | null; hasNote: boolean }) {
  const c = group.first
  const customer = ctx.find(c.number)
  const name = customer?.name ?? ctx.nameOf(c.number) ?? (c.name || '')
  const t = callTypeLabel(c.type)
  const kind = c.type === 2 ? '발신 통화' : '수신 통화'
  // 고객: 📝 통화 메모 (창에서 👥 공용 / 🔒 개인 고름), 고객이 아닌 번호: 🔒 내 메모 (이 기기에만)
  const memo: MenuAction[] = customer
    ? [
        {
          icon: '📝',
          label: '통화 메모 남기기',
          onSelect: () =>
            openCallMemo({ customerId: customer.id, name: customer.name, company: customer.company, number: c.number, kind, at: c.date, duration: c.duration, approx: c.approx }),
        },
      ]
    : [{ icon: '🔒', label: hasNote ? '내 메모 보기·남기기' : '내 메모', onSelect: () => openCallMemo({ customerId: '', personal: true, name, number: c.number, kind, at: c.date, duration: c.duration, approx: c.approx }) }]
  const actions = () => personActions(ctx, c.number, customer, memo)
  const menu = useItemMenu(actions, name || prettyNumber(c.number))
  const open = ctx.openRow === group.key
  return (
    <>
      {day && <li className="list-day">{day}</li>}
      <li className={open ? 'open' : undefined}>
        <div
          className={`call-row has-menu ${t.kind}`}
          {...menu}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={() => ctx.toggleRow(group.key)}
          onKeyDown={(e) => e.key === 'Enter' && ctx.toggleRow(group.key)}
        >
          <PersonDot name={name} work={!!customer} />
          <div className="call-main">
            <div className="call-name">
              {customer && <span className="work-tag">업무</span>}
              {name || prettyNumber(c.number)}
              {hasNote && !customer && (
                <span className="note-lock" title="내 메모 있음" aria-label="내 메모 있음">
                  {' '}🔒
                </span>
              )}
              {group.count > 1 && <span className="muted"> ({group.count})</span>}
            </div>
            <div className="call-sub">
              <span className={`call-icon ${t.kind}`} aria-label={t.label}>
                {t.icon}
              </span>{' '}
              {name ? prettyNumber(c.number) : t.label}
              {customer?.company && ` · ${customer.company}`}
              {c.duration > 0 && ` · ${c.approx ? approxDurationText(c.duration) : durationText(c.duration)}`}
            </div>
          </div>
          <span className="call-time muted">{timeText(c.date)}</span>
        </div>
        {open && <RowActions actions={actions()} />}
      </li>
    </>
  )
}

// 펼친 줄의 버튼 (📞 전화 · ✉️ 문자 · 📝 메모 · 📇 고객 …)
function RowActions({ actions }: { actions: MenuAction[] }) {
  return (
    <div className="row-actions">
      {actions.map((a) => (
        <button key={a.label} type="button" className={a.icon === '📞' ? 'call' : undefined} onClick={a.onSelect}>
          <span aria-hidden="true">{a.icon}</span>
          <small>{a.label.replace(' 걸기', '').replace(' 보내기', '').replace(' 남기기', '').replace(' 정보 보기', '').replace('고객으로 추가', '고객 추가').replace('번호 복사', '복사')}</small>
        </button>
      ))}
    </div>
  )
}

// ── 연락처 (업무 고객 + 폰의 개인 연락처) ──
function Contacts(props: {
  customers: Customer[] | null
  contacts: { name: string; number: string }[]
  contactsGranted: boolean
  ctx: RowCtx
}) {
  const { query } = useTabSearch()
  const words = query.trim().toLowerCase()
  const digits = query.replace(/\D/g, '')
  const match = (name: string, numbers: string[]) =>
    !words || name.toLowerCase().includes(words) || (digits.length >= 2 && numbers.some((n) => n.replace(/\D/g, '').includes(digits) || prettyNumber(n).replace(/\D/g, '').includes(digits)))
  const work = (props.customers ?? []).filter((c) => match(`${c.name} ${c.company}`, c.phones.map(formatPhone))).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const personal = props.contacts.filter((c) => match(c.name, [c.number]))
  return (
    <>
      <SearchBar placeholder="이름, 회사, 번호 검색" />
      <h3 className="phone-section">
        업무 고객 <span className="muted">{work.length}</span>
      </h3>
      {props.customers === null && <p className="center muted">불러오는 중…</p>}
      {props.customers && work.length === 0 && <p className="muted small">{query ? '맞는 고객이 없어요.' : '아직 고객이 없어요. 고객 화면에서 추가해 주세요.'}</p>}
      <ul className="call-list">
        {work.map((c) => (
          <ContactRow key={c.id} name={c.name} sub={[c.company, c.phones[0] && formatPhone(c.phones[0])].filter(Boolean).join(' · ')} number={c.phones[0] ?? ''} customer={c} ctx={props.ctx} />
        ))}
      </ul>
      {hasPhoneNative && (
        <>
          <h3 className="phone-section">
            개인 연락처 {props.contactsGranted && <span className="muted">{personal.length}</span>}
          </h3>
          <PermissionCard kind="contacts" what="폰의 개인 연락처" granted={props.contactsGranted} />
          <ul className="call-list">
            {personal.slice(0, 500).map((c) => (
              <ContactRow key={c.name + c.number} name={c.name} sub={prettyNumber(c.number)} number={c.number} ctx={props.ctx} />
            ))}
          </ul>
          {personal.length > 500 && <p className="muted small center">검색으로 더 찾아 주세요 ({personal.length}명)</p>}
        </>
      )}
    </>
  )
}

function ContactRow({ name, sub, number, customer, ctx }: { name: string; sub: string; number: string; customer?: Customer; ctx: RowCtx }) {
  const actions = () => personActions(ctx, number, customer)
  const menu = useItemMenu(actions, name)
  const key = `c-${customer?.id ?? number}`
  const open = ctx.openRow === key
  return (
    <li className={open ? 'open' : undefined}>
      <div className="call-row has-menu" {...menu} role="button" tabIndex={0} aria-expanded={open} onClick={() => ctx.toggleRow(key)}>
        <PersonDot name={name} work={!!customer} />
        <div className="call-main">
          <div className="call-name">{name}</div>
          <div className="call-sub">{sub}</div>
        </div>
        {number && (
          <>
            <button
              type="button"
              className="ghost round-action"
              aria-label={`${name} 문자`}
              onClick={(e) => {
                e.stopPropagation()
                ctx.onOpenSms(number, name)
              }}
            >
              ✉️
            </button>
            <button
              type="button"
              className="ghost round-action call"
              aria-label={`${name}에게 전화`}
              onClick={(e) => {
                e.stopPropagation()
                void startCall(number, customer?.id, name)
              }}
            >
              📞
            </button>
          </>
        )}
      </div>
      {open && <RowActions actions={actions()} />}
    </li>
  )
}

// 통신사 앱 요약을 복사해 왔을 때: 클립보드 글로 요약 메모 창 (요약 속 번호로 고객 찾기, src/sharedMemo.ts)
async function pasteSummary() {
  const text = await readClipboard()
  if (!text) return toast('복사한 글이 없어요. 통신사 앱(에이닷 등)에서 통화 요약을 먼저 복사해 주세요.', { error: true, long: true })
  pushSharedMemo(text)
}

// "방금 받은 전화 메모하기": 고객을 골라 메모 창 열기
function MemoCustomerPicker({ customers, onClose }: { customers: Customer[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = searchPeople(q || ' ', customers, [], 40).filter((p) => p.customer)
  const shown = q ? list : [...customers].sort((a, b) => a.name.localeCompare(b.name, 'ko')).slice(0, 40).map((c) => ({ name: c.name, number: c.phones[0] ?? '', customer: c }))
  return (
    <Modal onClose={onClose} labelledBy="memo-pick-title" className="memo-pick">
      <h3 id="memo-pick-title">📝 방금 받은 전화</h3>
      <p className="muted small">누구 전화였나요? 고객을 고르면 메모 창이 열려요.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 번호" autoFocus aria-label="고객 찾기" />
      <ul className="call-list">
        {shown.map((p) => (
          <li key={p.customer!.id}>
            <button
              type="button"
              className="call-row"
              onClick={() => {
                onClose()
                openCallMemo({ customerId: p.customer!.id, name: p.customer!.name, company: p.customer!.company, number: p.number, kind: '수신 통화', at: Date.now() })
              }}
            >
              <PersonDot name={p.name} work />
              <div className="call-main">
                <div className="call-name">{p.name}</div>
                <div className="call-sub">{[p.customer!.company, p.number && formatPhone(p.number)].filter(Boolean).join(' · ')}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="muted small">맞는 고객이 없어요.</p>}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
