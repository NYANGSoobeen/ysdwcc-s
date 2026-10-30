import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { addNote, findCustomerByPhone, formatPhone, NOTE_KINDS, normalizePhone } from '../customers.ts'
import { db } from '../firebase.ts'
import { phonesIn } from '../importCustomers.ts'
import { guessKind, MEMO_MAX, onSharedMemo, readClipboard, takeSharedMemo } from '../sharedMemo.ts'
import type { Team } from '../hooks.ts'
import {
  CALL_MEMO_CHECKED,
  durationText,
  hasPhoneNative,
  PhoneNative,
  takePendingCall,
  timeText,
  usePhoneChanged,
  usePhonePerms,
  useTeamCustomers,
} from '../phone.ts'
import { Modal, toast } from '../ui/dialogs.tsx'

// 📞 통화 후 메모 창 (화면 3·6). 어느 화면에 있든 통화가 끝나고 앱으로 돌아오면 뜬다.
// - 갤럭시 앱: 통화 기록에서 방금 끝난 통화(연결된 것)가 지금 팀 고객 번호면 → "수신/발신 통화" 메모 창
// - 아이폰·브라우저: 앱에서 건 전화(tel:)에서 돌아오면 → "발신 통화" 메모 창
// 서버에는 메모(종류와 내용)만 올리고, 통화 시간은 이 창에 보여 주기만 한다 (통화 시간은 기기 로컬만).
export type CallMemoTarget = {
  customerId: string // ''이면 창에서 고객을 고른다 (통화 요약 공유처럼 누구인지 모를 때)
  name: string
  company?: string
  number?: string
  kind: string // '발신 통화' | '수신 통화'
  at?: number
  duration?: number
  body?: string // 미리 채울 내용 (통신사 앱 통화 요약)
  summary?: boolean
}

const listeners = new Set<(t: CallMemoTarget) => void>()
// 전화 화면의 "방금 받은 전화 메모하기"처럼 직접 띄울 때
export function openCallMemo(t: CallMemoTarget) {
  listeners.forEach((l) => l(t))
}

async function customerTarget(teamId: string, number: string, kind: string, extra: Partial<CallMemoTarget> = {}) {
  const e164 = normalizePhone(number)
  if (!e164) return null
  const found = await findCustomerByPhone(teamId, [e164]).catch(() => null)
  if (!found) return null
  const snap = await getDoc(doc(db, 'customers', found.id)).catch(() => null)
  return { customerId: found.id, name: found.name, company: (snap?.get('company') as string) ?? '', number: e164, kind, ...extra }
}

export function CallMemoWatcher({ team }: { team: Team; uid: string }) {
  const [target, setTarget] = useState<CallMemoTarget | null>(null)
  const canWrite = team.myRole !== 'viewer'
  const { calls } = usePhonePerms()

  useEffect(() => {
    const l = (t: CallMemoTarget) => setTarget(t)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])

  // 아이폰·브라우저: 앱에서 건 전화에서 돌아오면
  useEffect(() => {
    if (hasPhoneNative || !canWrite) return
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      const p = takePendingCall()
      if (!p) return
      if (p.customerId) {
        const snap = await getDoc(doc(db, 'customers', p.customerId)).catch(() => null)
        if (snap?.exists()) {
          setTarget({ customerId: p.customerId, name: snap.get('name'), company: snap.get('company'), number: p.number, kind: '발신 통화', at: p.at })
          return
        }
      }
      const t = await customerTarget(team.id, p.number, '발신 통화', { at: p.at })
      if (t) setTarget(t)
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [team.id, canWrite])

  // 📝 통신사 앱(에이닷 등) 통화 요약 공유 → 요약 글을 채운 메모 창. 요약 속 번호로 고객을 찾고, 없으면 창에서 고른다.
  useEffect(() => {
    const check = async () => {
      const text = takeSharedMemo()
      if (!text) return
      if (!canWrite) return toast('보기 권한은 상담 메모를 남길 수 없어요.', { error: true })
      const kind = guessKind(text)
      for (const n of phonesIn(text)) {
        const t = await customerTarget(team.id, n, kind, { body: text, summary: true, at: Date.now() })
        if (t) return setTarget(t)
      }
      setTarget({ customerId: '', name: '', kind, body: text, summary: true, at: Date.now() })
    }
    void check()
    return onSharedMemo(() => void check())
  }, [team.id, canWrite])

  // 갤럭시 앱: 통화 기록에 새로 생긴, 연결된 고객 통화
  const checkLog = async () => {
    if (!hasPhoneNative || !calls || !canWrite || document.visibilityState !== 'visible') return
    let since = 0
    try {
      since = Number(localStorage.getItem(CALL_MEMO_CHECKED) ?? 0)
      if (!since) {
        // 처음 켰을 때는 지난 통화를 묻지 않는다
        localStorage.setItem(CALL_MEMO_CHECKED, String(Date.now()))
        return
      }
    } catch {
      return
    }
    const { calls: list } = await PhoneNative.callLog({ since, limit: 10 }).catch(() => ({ calls: [] }))
    if (list.length === 0) return
    try {
      localStorage.setItem(CALL_MEMO_CHECKED, String(Math.max(...list.map((c) => c.date + c.duration * 1000), since)))
    } catch {
      // 기억 못 하면 같은 통화를 한 번 더 물을 수 있다
    }
    // 가장 최근의 연결된 통화(받은·건 전화) 하나만 묻는다
    const last = list.find((c) => (c.type === 1 || c.type === 2) && c.duration > 0)
    if (!last) return
    const t = await customerTarget(team.id, last.number, last.type === 1 ? '수신 통화' : '발신 통화', { at: last.date, duration: last.duration })
    if (t) setTarget(t)
  }
  usePhoneChanged('calls', () => void checkLog())
  useEffect(() => {
    void checkLog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, team.id])

  if (!target) return null
  return <CallMemoSheet key={`${target.customerId}-${target.at ?? 0}`} teamId={team.id} target={target} onClose={() => setTarget(null)} />
}

type Picked = { id: string; name: string; company: string }

function CallMemoSheet({ teamId, target, onClose }: { teamId: string; target: CallMemoTarget; onClose: () => void }) {
  const [kind, setKind] = useState(target.kind)
  const [body, setBody] = useState(target.body ?? '')
  const [busy, setBusy] = useState(false)
  const [who, setWho] = useState<Picked | null>(target.customerId ? { id: target.customerId, name: target.name, company: target.company ?? '' } : null)

  async function paste() {
    const text = await readClipboard()
    if (!text) return toast('복사한 글이 없어요. 통신사 앱에서 요약을 먼저 복사해 주세요.', { error: true, long: true })
    setBody((b) => (b.trim() ? `${b.trim()}\n${text}` : text).slice(0, MEMO_MAX))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!body.trim() || !who) return
    setBusy(true)
    try {
      await addNote(who.id, kind, body.trim().slice(0, MEMO_MAX))
      toast(`${who.name} 상담 이력에 저장했어요.`)
      onClose()
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setBusy(false)
    }
  }

  const info = [target.number && formatPhone(target.number), target.at && timeText(target.at), target.duration && durationText(target.duration)]
    .filter(Boolean)
    .join(' · ')
  return (
    <Modal onClose={() => !busy && onClose()} labelledBy="call-memo-title" className="call-memo" closeOnOutside={false}>
      <form className="form" onSubmit={save}>
        <h3 id="call-memo-title">{target.summary ? '📝 통화 요약 → 상담 메모' : '📞 통화 메모'}</h3>
        {who ? (
          <div className="call-memo-who">
            <strong>{who.name}</strong>
            {who.company && <span className="muted"> · {who.company}</span>}
            {target.summary && !target.customerId && (
              <button type="button" className="link" onClick={() => setWho(null)}>
                다른 고객
              </button>
            )}
            {info && <div className="muted small">{info}</div>}
          </div>
        ) : (
          <CustomerPick teamId={teamId} onPick={setWho} />
        )}
        <div className="chips" role="radiogroup" aria-label="기록 종류">
          {NOTE_KINDS.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'chip selected' : 'chip'} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MEMO_MAX))}
          placeholder="방금 통화한 내용을 적어 두세요"
          rows={target.summary ? 7 : 4}
          autoFocus={!target.summary}
          aria-label="통화 메모"
        />
        <div className="call-memo-tools">
          <button type="button" className="ghost" onClick={() => void paste()} disabled={busy}>
            📋 붙여넣기
          </button>
          <span className="muted small">통신사 앱(에이닷 등) 요약을 복사해 왔다면</span>
        </div>
        <p className="muted small">
          상담 이력에 저장돼 팀원과 함께 봐요. 통화 시간{target.summary ? '과 녹음 파일은' : '은'} 저장하지 않아요.
        </p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            나중에
          </button>
          <button type="submit" className="primary" disabled={busy || !body.trim() || !who}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 요약 속 번호로 고객을 못 찾았을 때: 이름·회사·번호로 골라요
function CustomerPick({ teamId, onPick }: { teamId: string; onPick: (p: Picked) => void }) {
  const { customers } = useTeamCustomers(teamId)
  const [q, setQ] = useState('')
  const words = q.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  const list = (customers ?? [])
    .filter(
      (c) =>
        !words ||
        c.name.toLowerCase().includes(words) ||
        c.company.toLowerCase().includes(words) ||
        (digits.length >= 3 && c.phones.some((p) => formatPhone(p).replace(/\D/g, '').includes(digits))),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .slice(0, 30)
  return (
    <div className="memo-customer-pick">
      <p className="small">어느 고객과의 통화인가요?</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 회사, 번호로 찾기" aria-label="고객 찾기" />
      <ul className="call-list">
        {customers === null && <li className="muted small">불러오는 중…</li>}
        {customers && list.length === 0 && <li className="muted small">맞는 고객이 없어요. 고객 화면에서 먼저 추가해 주세요.</li>}
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" className="call-row" onClick={() => onPick({ id: c.id, name: c.name, company: c.company })}>
              <span className="call-main">
                <span className="call-name">{c.name}</span>
                <span className="call-sub">{[c.company, c.phones[0] && formatPhone(c.phones[0])].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
