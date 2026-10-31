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
  useSmsThreads,
  usePhonePerms,
  useTeamCustomers,
  type SmsMessage,
} from '../phone.ts'
import { clearSmsAlert } from '../phoneAlerts.ts'
import { ClipboardChip, insertAt } from '../ui/ClipboardChip.tsx'
import { EmojiButton } from './ChatPage.tsx'
import { isAndroidBrowser } from '../native.ts'
import { useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, Modal, tell, toast } from '../ui/dialogs.tsx'
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
        {hasPhoneNative && perms.sms && !perms.im && <ChatPlusOffCard />}
        {hasPhoneNative && perms.sms && perms.chat === false && <ChatPlusCard />}
        {native ? (
          <ThreadList who={who} onOpen={setOpen} />
        ) : (
          <section className="card">
            <p className="muted small">
              {hasPhoneNative
                ? '권한을 허용하면 이 폰의 문자를 여기서 바로 보고 보낼 수 있어요.'
                : isPcDevice()
                  ? '컴퓨터에서는 문자를 읽거나 보낼 수 없어요. "새 문자"로 받는 사람과 내용을 정하면 휴대폰으로 보낼 수 있게 번호와 내용을 크게 보여 드려요.'
                  : isAndroidBrowser
                    ? '브라우저에서는 폰의 문자를 읽을 수 없어요(갤럭시 앱을 설치하면 여기서 바로 보고 보내요). "새 문자"로 받는 사람과 내용을 정하면 기본 문자 앱이 열려요.'
                    : '아이폰은 폰의 문자를 읽을 수 없어요. "새 문자"로 받는 사람과 내용을 정하면 기본 문자 앱이 열려요. 고객 화면·전화 화면의 ✉️ 버튼도 같아요.'}
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
  const [filter, setFilter] = useState<Filter>('all')
  const { query } = useTabSearch()
  // 앱을 열 때 미리 읽어 둔 대화 목록을 바로 보여 주고 뒤에서 새로 읽는다 (src/phone.ts)
  const threads = useSmsThreads(true, (e) => {
    const msg = String((e as Error).message ?? e)
    // 1.6.2 전 갤럭시 앱: 채팅+만 있는 대화(rcs:번호)가 있으면 목록을 못 읽는다 → 업데이트 안내 (2026-10-31 실제 폰)
    if (/For input string/.test(msg)) toast('갤럭시 앱이 예전 버전이라 문자 목록을 못 읽었어요.\n아래 "업데이트"로 새 버전을 깔아 주세요.', { error: true, long: true })
    else toast(msg, { error: true })
  })
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
type Local = SmsMessage & { local?: true; retry?: string; sent?: true }

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
    void PhoneNative.messages({ threadId: open.threadId, address: open.address, limit: 300 })
      .then(({ messages }) => {
        setMessages(messages)
        markSmsSeen(open.threadId)
        clearSmsAlert(open.address)
      })
      .catch((e) => toast(String(e.message ?? e), { error: true }))
  useEffect(load, [open.threadId])
  usePhoneChanged('sms', load)
  // 이 대화를 보는 동안은 이 번호의 우리 알림을 안 띄운다 (갤럭시 앱 1.5.0)
  useEffect(() => {
    void PhoneNative.alertsViewing({ number: open.address }).catch(() => {})
    return () => void PhoneNative.alertsViewing({ number: null }).catch(() => {})
  }, [open.address])

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
      // 문자함에 저장되는 게 조금 늦을 수 있어, 불러온 목록에 이 글이 보일 때까지 "보냄"으로 남겨 둔다 (아래 all)
      setPending((p) => p.map((m) => (m.id === id ? { ...m, sending: false, sent: true } : m)))
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

  // 보낸 글이 문자함에서 불러와지면 화면의 임시 글은 뺀다 (2분 안에 같은 글을 내가 보낸 것)
  const shown = pending.filter((p) => !(p.sent && messages?.some((m) => m.mine && m.text === p.text && m.date >= p.date - 120_000)))
  const all: Local[] = [...(messages ?? []), ...shown]
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
        {/* 💬 채팅+(RCS)로 받은 글이 있으면 맨 위에 한 번만 (말마다 붙이면 많아 보여서, 2026-10-30 사용자 요청) */}
        {all.some((m) => m.im) ? (
          <div className="sms-rcs-note">💬 채팅+ 대화 · 삼성 메시지에서 보낸 것·받은 것을 모두 읽어 왔어요</div>
        ) : all.some((m) => m.rcs) && (
          <button type="button" className="sms-rcs-note" onClick={() => void showChatPlusOff()}>
            💬 채팅+ 대화 · 삼성 메시지에서 보낸 답장은 여기 안 보여요 · <u>채팅+ 끄는 법</u>
          </button>
        )}
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
      <ClipboardChip inputRef={inputRef} onPaste={(t) => insertAt(inputRef.current, text, t, setText)} />
      <form className="sms-composer" onSubmit={submit}>
        <EmojiButton onPick={(emoji) => insertAt(inputRef.current, text, emoji, setText)} />
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

// 💬 채팅+ 끄기 안내 (2026-10-30 사용자가 정함): 채팅+(RCS)는 삼성 메시지 전용 저장소에 있어 다른 앱이 읽을 수 없다.
// 끄면 주고받는 문자가 모두 일반 문자·사진 문자로 오가서 이 앱이 보낸 것·받은 것을 전부 읽는다(끄기 전 채팅+ 내역은 그대로 못 읽음).
const CHATPLUS_OFF_HIDE = 'chatplus-off-hide'
function chatPlusOffSteps() {
  return (
    <ol className="small chatplus-steps">
      <li>
        <b>삼성 메시지</b> 앱을 열어요.
      </li>
      <li>오른쪽 위 <b>⋮</b> → <b>설정</b></li>
      <li>
        <b>채팅 설정</b>(폰에 따라 "채팅+ 설정", "채팅 기능") → <b>채팅+ 사용</b>을 꺼요.
      </li>
      <li className="muted">구글 메시지 앱을 쓰면: 프로필 사진 → 메시지 설정 → RCS 채팅 → 끄기</li>
    </ol>
  )
}
function showChatPlusOff() {
  return tell({
    title: '💬 채팅+ 끄는 법',
    message: (
      <>
        <p className="small">
          채팅+(파란 말풍선) 문자는 삼성 메시지 앱만 읽을 수 있어서, 이 앱에는 <b>받은 글만 일부</b> 보이고 내가 보낸 답장은 안 보여요. 채팅+를 끄면 모든 문자가
          일반 문자로 오가서 여기에 <b>보낸 것·받은 것이 다</b> 보여요.
        </p>
        {chatPlusOffSteps()}
        <p className="small muted">끄기 전에 주고받은 채팅+ 내역은 그대로 삼성 메시지에서만 보여요. 읽음 표시·입력 중 표시 같은 채팅+ 기능도 없어져요.</p>
      </>
    ),
  })
}
function ChatPlusOffCard() {
  const threads = useSmsThreads(true, () => {})
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(CHATPLUS_OFF_HIDE)
    } catch {
      return false
    }
  })
  // 채팅+로 받은 대화가 있을 때만 (채팅+를 이미 껐거나 안 쓰는 폰에는 안 보임)
  if (hidden || !threads?.some((t) => t.rcs)) return null
  return (
    <div className="card phone-hint">
      <p className="small">
        <strong>💬 채팅+를 끄면 모든 문자가 여기 보여요</strong>
        <br />
        <span className="muted">채팅+(파란 말풍선)로 주고받은 문자는 삼성 메시지 앱만 읽을 수 있어 내 답장이 여기 안 보여요.</span>
      </p>
      {chatPlusOffSteps()}
      <div className="button-row">
        <button
          type="button"
          className="ghost"
          onClick={() => {
            try {
              localStorage.setItem(CHATPLUS_OFF_HIDE, '1')
            } catch {
              // 다음에 또 보일 뿐
            }
            setHidden(true)
          }}
        >
          껐어요 · 안 볼게요
        </button>
      </div>
    </div>
  )
}

// 💬 채팅+(RCS)로 온 문자는 문자함에 없어서, "알림 접근"을 켜야 목록에 보인다 (갤럭시 앱 1.5.0, ChatListener.kt)
const CHATPLUS_HIDE = 'chatplus-card-hide'
function ChatPlusCard() {
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(CHATPLUS_HIDE)
    } catch {
      return false
    }
  })
  if (hidden) return null
  return (
    <div className="card phone-hint">
      <p className="small">
        <strong>💬 채팅+(파란 말풍선)로 온 문자가 안 보여요</strong>
        <br />
        <span className="muted">
          삼성 메시지의 채팅+ 문자는 다른 앱이 읽을 수 없어요. "알림 접근"을 켜면 받은 채팅+를 이 폰 안에서만 읽어 여기에 보여 드려요(서버에 안 올림). 회색으로
          막혀 있으면 앱 정보 ⋮ → "제한된 설정 허용" 먼저.
        </span>
      </p>
      <div className="button-row">
        <button type="button" className="primary" onClick={() => void PhoneNative.openChatAccess().catch(() => {})}>
          💬 알림 접근 켜기
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            try {
              localStorage.setItem(CHATPLUS_HIDE, '1')
            } catch {
              // 다음에 또 보일 뿐
            }
            setHidden(true)
          }}
        >
          안 볼게요
        </button>
      </div>
    </div>
  )
}
