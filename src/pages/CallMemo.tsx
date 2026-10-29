import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { addNote, findCustomerByPhone, formatPhone, NOTE_KINDS, normalizePhone } from '../customers.ts'
import { db } from '../firebase.ts'
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
} from '../phone.ts'
import { Modal, toast } from '../ui/dialogs.tsx'

// 📞 통화 후 메모 창 (화면 3·6). 어느 화면에 있든 통화가 끝나고 앱으로 돌아오면 뜬다.
// - 갤럭시 앱: 통화 기록에서 방금 끝난 통화(연결된 것)가 지금 팀 고객 번호면 → "수신/발신 통화" 메모 창
// - 아이폰·브라우저: 앱에서 건 전화(tel:)에서 돌아오면 → "발신 통화" 메모 창
// 서버에는 메모(종류와 내용)만 올리고, 통화 시간은 이 창에 보여 주기만 한다 (통화 시간은 기기 로컬만).
export type CallMemoTarget = {
  customerId: string
  name: string
  company?: string
  number?: string
  kind: string // '발신 통화' | '수신 통화'
  at?: number
  duration?: number
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

export function CallMemoWatcher({ team, uid }: { team: Team; uid: string }) {
  const [target, setTarget] = useState<CallMemoTarget | null>(null)
  const canWrite = team.members[uid] !== 'viewer'
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
  return <CallMemoSheet key={`${target.customerId}-${target.at ?? 0}`} target={target} onClose={() => setTarget(null)} />
}

function CallMemoSheet({ target, onClose }: { target: CallMemoTarget; onClose: () => void }) {
  const [kind, setKind] = useState(target.kind)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    try {
      await addNote(target.customerId, kind, body.trim())
      toast(`${target.name} 상담 이력에 저장했어요.`)
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
        <h3 id="call-memo-title">📞 통화 메모</h3>
        <div className="call-memo-who">
          <strong>{target.name}</strong>
          {target.company && <span className="muted"> · {target.company}</span>}
          {info && <div className="muted small">{info}</div>}
        </div>
        <div className="chips" role="radiogroup" aria-label="기록 종류">
          {NOTE_KINDS.map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'chip selected' : 'chip'} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="방금 통화한 내용을 적어 두세요" rows={4} autoFocus aria-label="통화 메모" />
        <p className="muted small">상담 이력에 저장돼 팀원과 함께 봐요. 통화 시간은 저장하지 않아요.</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            나중에
          </button>
          <button type="submit" className="primary" disabled={busy || !body.trim()}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}
