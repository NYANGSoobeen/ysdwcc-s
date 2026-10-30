import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { addNote, formatPhone, type Customer } from '../customers.ts'
import type { Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import {
  dayLabel,
  hasPhoneNative,
  markSmsSeen,
  oldAndroidApp,
  PhoneNative,
  prettyNumber,
  shortWhen,
  smsLink,
  smsSeen,
  isPcDevice,
  startCall,
  timeText,
  useDeviceContacts,
  usePhoneChanged,
  usePhonePerms,
  useTeamCustomers,
  type SmsMessage,
  type SmsThread,
} from '../phone.ts'
import { useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, Modal, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { addAsCustomer, copyNumber, OldAppCard, PermissionCard, PersonDot, searchPeople } from './PhoneCommon.tsx'

// ✉️ 문자 (삼성 메시지 앱처럼: 대화 목록 → 대화 말풍선, 아래 입력칸)
// - 갤럭시 앱: 이 폰의 문자를 읽고 바로 보낸다 (폰 안에서만, 서버에 안 올림). 받은 문자 알림은 삼성 메시지 앱이 그대로 띄운다.
// - 아이폰·브라우저: 문자를 읽을 수 없어 보낼 사람·내용을 정하면 기본 문자 앱을 연다.
// - 업무 고객과 주고받은 문자는 길게 눌러 "상담 메모로 남기기"를 해야만 팀에 공유된다.
const OPEN_KEY = 'sms-open' // 다른 화면(전화·고객)에서 "문자 보내기" → 이 번호의 대화
const THREAD_KEY = 'sms-thread'
type Open = { threadId: string; address: string }
type Filter = 'all' | 'work' | 'personal'

export function openSmsTo(number: string) {
  try {
    sessionStorage.setItem(OPEN_KEY, number)
  } catch {
    // 기억하지 못하면 목록이 열린다
  }
}

type Props = { team: Team; uid: string; onOpenCustomer: (id: string) => void }

export function MessagesPage({ team, onOpenCustomer }: Props) {
  const perms = usePhonePerms()
  const { customers, find } = useTeamCustomers(team.id)
  const { contacts, nameOf } = useDeviceContacts(perms.contacts)
  const canWrite = team.myRole !== 'viewer'
  const native = hasPhoneNative && perms.sms
  const [open, setOpenState] = useState<Open | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(THREAD_KEY) ?? 'null') as Open | null
    } catch {
      return null
    }
  })
  const [composing, setComposing] = useState<string | null>(null) // 새 문자 (아이폰은 받는 번호)
  const setOpen = (o: Open | null) => {
    setOpenState(o)
    try {
      if (o) sessionStorage.setItem(THREAD_KEY, JSON.stringify(o))
      else sessionStorage.removeItem(THREAD_KEY)
    } catch {
      // 기억 못 해도 괜찮다
    }
  }

  // 전화·고객 화면에서 "문자 보내기"로 들어왔으면 그 번호의 대화를 연다
  useEffect(() => {
    if (!perms.loaded) return
    let number: string | null = null
    try {
      number = sessionStorage.getItem(OPEN_KEY)
      sessionStorage.removeItem(OPEN_KEY)
    } catch {
      return
    }
    if (!number) return
    if (native) void openNumber(number)
    else setComposing(number)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.loaded, native])

  async function openNumber(number: string) {
    try {
      const { threadId } = await PhoneNative.threadFor({ number })
      setOpen({ threadId, address: number })
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const who = (address: string) => {
    const customer = find(address)
    return { customer, name: customer?.name ?? nameOf(address) ?? '' }
  }

  if (native && open) {
    const { customer, name } = who(open.address)
    return (
      <SmsThreadView
        key={open.threadId}
        open={open}
        name={name}
        customer={customer}
        canWrite={canWrite}
        teamId={team.id}
        onBack={() => setOpen(null)}
        onOpenCustomer={onOpenCustomer}
      />
    )
  }

  return (
    <div className="page sms-page">
      <header className="page-header">
        <MenuButton />
        <h2>✉️ 문자</h2>
        <button type="button" className="ghost" onClick={() => setComposing('')} aria-label="새 문자">
          ✏️ 새 문자
        </button>
      </header>
      <div className="page-body">
        {oldAndroidApp && <OldAppCard />}
        {hasPhoneNative && perms.loaded && <PermissionCard kind="sms" what="이 폰의 문자" granted={perms.sms} />}
        {native ? (
          <ThreadList who={who} onOpen={setOpen} />
        ) : (
          <section className="card">
            <p className="muted small">
              {hasPhoneNative
                ? '권한을 허용하면 이 폰의 문자를 여기서 바로 보고 보낼 수 있어요.'
                : isPcDevice()
                  ? '컴퓨터에서는 문자를 읽거나 보낼 수 없어요. "새 문자"로 받는 사람과 내용을 정하면 휴대폰으로 보낼 수 있게 번호와 내용을 크게 보여 드려요.'
                  : '아이폰·브라우저는 폰의 문자를 읽을 수 없어요. "새 문자"로 받는 사람과 내용을 정하면 기본 문자 앱이 열려요. 고객 화면·전화 화면의 ✉️ 버튼도 같아요.'}
            </p>
            <button type="button" className="primary" onClick={() => setComposing('')}>
              ✏️ 새 문자 쓰기
            </button>
          </section>
        )}
      </div>
      {native && (
        <button type="button" className="fab" onClick={() => setComposing('')} aria-label="새 문자">
          ✏️
        </button>
      )}
      {composing !== null && (
        <NewMessage
          initial={composing}
          customers={customers ?? []}
          contacts={contacts}
          native={native}
          onClose={() => setComposing(null)}
          onPick={(number) => {
            setComposing(null)
            void openNumber(number)
          }}
        />
      )}
    </div>
  )
}

// ── 대화 목록 ──
function ThreadList({ who, onOpen }: { who: (a: string) => { customer?: Customer; name: string }; onOpen: (o: Open) => void }) {
  const [threads, setThreads] = useState<SmsThread[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const { query } = useTabSearch()
  const load = () =>
    void PhoneNative.threads({ limit: 300 })
      .then(({ threads }) => setThreads(threads))
      .catch((e) => toast(String(e.message ?? e), { error: true }))
  useEffect(load, [])
  usePhoneChanged('sms', load)
  const seen = smsSeen()

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    const digits = query.replace(/\D/g, '')
    return (threads ?? []).filter((t) => {
      const w = who(t.address)
      if (filter === 'work' && !w.customer) return false
      if (filter === 'personal' && w.customer) return false
      if (!words) return true
      return w.name.toLowerCase().includes(words) || t.text.toLowerCase().includes(words) || (digits.length >= 2 && t.address.replace(/\D/g, '').includes(digits))
    })
  }, [threads, filter, query, who])

  return (
    <>
      <SearchBar placeholder="이름, 번호, 내용 검색" />
      <div className="chips phone-filters" role="radiogroup" aria-label="보기">
        {(
          [
            ['all', '전체'],
            ['work', '업무'],
            ['personal', '개인'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={filter === id} className={filter === id ? 'chip selected' : 'chip'} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {threads === null && <p className="center muted">불러오는 중…</p>}
      {threads && shown.length === 0 && <p className="center muted">{query ? `"${query}"에 맞는 문자가 없어요.` : '문자가 없어요.'}</p>}
      <ul className="call-list sms-threads">
        {shown.map((t) => {
          const w = who(t.address)
          const unread = t.unread > 0 && t.date > (seen[t.threadId] ?? 0) ? t.unread : 0
          return (
            <li key={t.threadId}>
              <button type="button" className={unread ? 'call-row unread' : 'call-row'} onClick={() => onOpen({ threadId: t.threadId, address: t.address })}>
                <PersonDot name={w.name} work={!!w.customer} />
                <div className="call-main">
                  <div className="call-name">
                    {w.customer && <span className="work-tag">업무</span>}
                    {w.name || prettyNumber(t.address)}
                  </div>
                  <div className="call-sub sms-preview">
                    {t.mine && <span className="muted">나: </span>}
                    {t.text}
                  </div>
                </div>
                <div className="sms-side">
                  <span className="call-time muted">{shortWhen(t.date)}</span>
                  {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ── 한 대화 ──
type Local = SmsMessage & { local?: true; retry?: string }

function SmsThreadView(props: {
  open: Open
  name: string
  customer?: Customer
  canWrite: boolean
  teamId: string
  onBack: () => void
  onOpenCustomer: (id: string) => void
}) {
  const { open, name, customer } = props
  const [messages, setMessages] = useState<SmsMessage[] | null>(null)
  const [pending, setPending] = useState<Local[]>([])
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const load = () =>
    void PhoneNative.messages({ threadId: open.threadId, limit: 300 })
      .then(({ messages }) => {
        setMessages(messages)
        markSmsSeen(open.threadId)
      })
      .catch((e) => toast(String(e.message ?? e), { error: true }))
  useEffect(load, [open.threadId])
  usePhoneChanged('sms', load)

  // 새 문자가 오거나 보내면 맨 아래로 (위에서 읽는 중이면 그대로)
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  // 입력칸 줄 수 (5줄까지)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 5 * 22 + 18)}px`
  }, [text])

  async function send(body: string, retryId?: string) {
    const id = retryId ?? `p${Date.now()}`
    const local: Local = { id, text: body, date: Date.now(), mine: true, sending: true, local: true }
    setPending((p) => [...p.filter((m) => m.id !== id), local])
    atBottom.current = true
    try {
      await PhoneNative.sendSms({ number: open.address, text: body })
      setPending((p) => p.filter((m) => m.id !== id))
      load()
    } catch (err) {
      setPending((p) => p.map((m) => (m.id === id ? { ...m, sending: false, failed: true } : m)))
      toast(errorMessage(err), { error: true })
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    void send(body)
  }

  const headerActions = (): MenuAction[] =>
    [
      customer
        ? { icon: '📇', label: '고객 정보 보기', onSelect: () => props.onOpenCustomer(customer.id) }
        : props.canWrite
          ? { icon: '＋', label: '고객으로 추가', onSelect: () => void addAsCustomer(props.teamId, open.address, name).then((id) => id && props.onOpenCustomer(id)) }
          : null,
      { icon: '📋', label: '번호 복사', onSelect: () => void copyNumber(open.address) },
    ].filter(Boolean) as MenuAction[]

  const all: Local[] = [...(messages ?? []), ...pending]
  return (
    <div className="page sms-thread">
      <header className="page-header sms-thread-header">
        <button type="button" className="ghost" onClick={props.onBack} aria-label="문자 목록으로">
          ‹
        </button>
        <h2>
          {customer && <span className="work-tag">업무</span>}
          {name || prettyNumber(open.address)}
          {name && <small className="muted">{prettyNumber(open.address)}</small>}
        </h2>
        <div className="sms-head-actions">
          <button type="button" className="ghost" onClick={() => void startCall(open.address, customer?.id, name || undefined)} aria-label="전화 걸기">
            📞
          </button>
          <MoreMenu actions={headerActions} />
        </div>
      </header>
      <div
        className="sms-messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {messages === null && <p className="center muted">불러오는 중…</p>}
        {messages && all.length === 0 && <p className="center muted">아직 주고받은 문자가 없어요. 아래에 써서 보내 보세요.</p>}
        {all.map((m, i) => (
          <SmsBubble
            key={m.id}
            m={m}
            day={i === 0 || dayLabel(all[i - 1].date) !== dayLabel(m.date) ? dayLabel(m.date) : null}
            customer={props.canWrite ? customer : undefined}
            onRetry={m.failed && m.local ? () => void send(m.text, m.id) : undefined}
          />
        ))}
      </div>
      <form className="sms-composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="문자 메시지"
          rows={1}
          aria-label="문자 내용"
          onKeyDown={(e) => {
            // PC 키보드: Enter 보내기, Shift+Enter 줄바꿈 (휴대폰은 줄바꿈)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia('(hover: hover)').matches) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <span className="sms-count muted" aria-hidden="true">
          {text.length > 0 && `${text.length}자${new TextEncoder().encode(text).length > 90 ? ' · 장문' : ''}`}
        </span>
        <button type="submit" className="send-button" disabled={!text.trim()} onPointerDown={(e) => e.preventDefault()} aria-label="보내기">
          ↑
        </button>
      </form>
    </div>
  )
}

function MoreMenu({ actions }: { actions: () => MenuAction[] }) {
  const menu = useItemMenu(actions)
  return (
    <button type="button" className="ghost" aria-label="더 보기" onClick={(e) => menu.onContextMenu(e)}>
      ⋯
    </button>
  )
}

function SmsBubble({ m, day, customer, onRetry }: { m: Local; day: string | null; customer?: Customer; onRetry?: () => void }) {
  const menu = useItemMenu(() =>
    [
      {
        icon: '📋',
        label: '복사',
        onSelect: () => void navigator.clipboard.writeText(m.text).then(() => toast('복사했어요.'), () => toast('복사하지 못했어요.', { error: true })),
      },
      customer && m.text
        ? {
            icon: '📝',
            label: '상담 메모로 남기기',
            onSelect: async () => {
              const ok = await ask({
                title: '상담 메모로 남기기',
                message: `이 문자를 "${customer.name}" 상담 이력(문자/카톡)에 저장할까요? 팀원도 함께 봐요.\n\n${m.text.slice(0, 200)}`,
                ok: '저장',
              })
              if (!ok) return
              try {
                await addNote(customer.id, '문자/카톡', `${m.mine ? '보낸 문자' : '받은 문자'} (${dayLabel(m.date)} ${timeText(m.date)})\n${m.text}`)
                toast('상담 이력에 저장했어요.')
              } catch (err) {
                toast(errorMessage(err), { error: true })
              }
            },
          }
        : null,
    ].filter(Boolean) as MenuAction[],
  )
  return (
    <>
      {day && <div className="day">{day}</div>}
      <div className={m.mine ? 'sms-row mine' : 'sms-row'}>
        <div className="sms-bubble has-menu" {...menu}>
          {!!m.images && <div className="sms-mms">📷 사진 {m.images}장 (삼성 메시지 앱에서 보기)</div>}
          {m.text}
        </div>
        <span className="sms-meta muted">
          {m.sending ? '보내는 중…' : m.failed ? '' : timeText(m.date)}
          {m.failed && (
            <button type="button" className="link danger" onClick={onRetry} disabled={!onRetry}>
              ⚠️ 실패 · 다시 보내기
            </button>
          )}
        </span>
      </div>
    </>
  )
}

// ── 새 문자: 받는 사람 고르기 ──
function NewMessage(props: {
  initial: string
  customers: Customer[]
  contacts: { name: string; number: string }[]
  native: boolean
  onClose: () => void
  onPick: (number: string) => void
}) {
  const [q, setQ] = useState(props.initial)
  const [to, setTo] = useState(props.initial)
  const [toName, setToName] = useState<string | undefined>(undefined)
  const [body, setBody] = useState('')
  const people = searchPeople(q, props.customers, props.contacts, 20)
  const digits = q.replace(/[^\d+]/g, '')

  function choose(number: string, name?: string) {
    if (props.native) props.onPick(number)
    else {
      setTo(number)
      setToName(name)
      setQ(number)
    }
  }

  return (
    <Modal onClose={props.onClose} labelledBy="new-sms-title" className="new-sms">
      <h3 id="new-sms-title">✏️ 새 문자</h3>
      <label>
        받는 사람
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setTo('')
          }}
          placeholder="이름 또는 번호"
          autoFocus
          inputMode="text"
        />
      </label>
      {(!to || props.native) && (
        <ul className="call-list">
          {digits.length >= 8 && !people.some((p) => p.number.replace(/\D/g, '').endsWith(digits.replace(/\D/g, '').slice(1))) && (
            <li>
              <button type="button" className="call-row" onClick={() => choose(digits)}>
                <PersonDot work={false} />
                <div className="call-main">
                  <div className="call-name">{prettyNumber(digits)}</div>
                  <div className="call-sub">이 번호로 보내기</div>
                </div>
              </button>
            </li>
          )}
          {people.map((p) => (
            <li key={p.number}>
              <button type="button" className="call-row" onClick={() => choose(p.number, p.name)}>
                <PersonDot name={p.name} work={!!p.customer} />
                <div className="call-main">
                  <div className="call-name">
                    {p.customer && <span className="work-tag">업무</span>}
                    {p.name}
                  </div>
                  <div className="call-sub">{[p.customer?.company, prettyNumber(p.number)].filter(Boolean).join(' · ')}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!props.native && to && (
        <>
          <p className="muted small">받는 사람: {formatPhone(to).startsWith('+') ? prettyNumber(to) : formatPhone(to)}</p>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="내용 (문자 앱에서 고칠 수 있어요)" rows={4} aria-label="문자 내용" />
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose}>
          닫기
        </button>
        {!props.native && isPcDevice() && (
          <button
            type="button"
            className="primary"
            disabled={!to}
            onClick={() => {
              props.onClose()
              void import('../pcGuide.tsx').then((m) => m.showSmsGuide(to, toName, body.trim() || undefined))
            }}
          >
            휴대폰으로 보내기
          </button>
        )}
        {!props.native && !isPcDevice() && (
          <a className={to ? 'button primary' : 'button primary disabled'} href={to ? smsLink(to, body) : undefined} onClick={() => to && props.onClose()} aria-disabled={!to}>
            문자 앱 열기
          </a>
        )}
      </div>
    </Modal>
  )
}
