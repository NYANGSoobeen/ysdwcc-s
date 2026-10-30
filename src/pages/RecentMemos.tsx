import { collection, getDocs, limit, orderBy, query, where, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { Customer } from '../customers.ts'
import { auth, db } from '../firebase.ts'
import { deviceNotesFor } from '../privateNotes.ts'
import { shortWhen } from '../phone.ts'

// 📞 최근기록·연락처 줄을 펼치면 그 번호의 최근 메모 5개 (2026-10-30, 사용자 요청)
// - 고객: 👥 공용 상담 메모(customers/{id}/notes 최근 5개) + 🔒 내 개인 메모, 합쳐 최신 5개
// - 고객이 아닌 번호: 이 기기에만 둔 🔒 내 메모
// 펼칠 때만 한 번 읽고(줄마다 최대 5 + 내 메모 수), 1분 동안은 기억해 다시 펼쳐도 안 읽는다.
type Memo = { id: string; kind: string; body: string; at: number; mine: boolean }
const MAX = 5
const cache = new Map<string, { at: number; memos: Memo[] }>()

async function loadCustomerMemos(customerId: string): Promise<Memo[]> {
  const hit = cache.get(customerId)
  if (hit && Date.now() - hit.at < 60_000) return hit.memos
  const ms = (t: unknown) => (t as Timestamp | null)?.toMillis?.() ?? 0
  const [shared, mine] = await Promise.all([
    getDocs(query(collection(db, 'customers', customerId, 'notes'), orderBy('createdAt', 'desc'), limit(MAX))).catch(() => null),
    auth.currentUser
      ? getDocs(query(collection(db, 'users', auth.currentUser.uid, 'customerNotes'), where('customerId', '==', customerId))).catch(() => null)
      : null,
  ])
  const memos = [
    ...(shared?.docs ?? []).map((d) => ({ id: d.id, kind: (d.get('kind') as string) ?? '메모', body: (d.get('body') as string) ?? '', at: ms(d.get('createdAt')), mine: false })),
    ...(mine?.docs ?? []).map((d) => ({ id: d.id, kind: (d.get('kind') as string) ?? '메모', body: (d.get('body') as string) ?? '', at: ms(d.get('createdAt')), mine: true })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX)
  cache.set(customerId, { at: Date.now(), memos })
  return memos
}

export function RecentMemos({ number, customer }: { number: string; customer?: Customer }) {
  const [memos, setMemos] = useState<Memo[] | null>(() =>
    customer
      ? (cache.get(customer.id)?.memos ?? null)
      : deviceNotesFor(number)
          .slice(0, MAX)
          .map((n) => ({ id: n.id, kind: n.kind, body: n.body, at: n.at, mine: true })),
  )
  useEffect(() => {
    if (!customer) return
    let alive = true
    void loadCustomerMemos(customer.id).then((m) => alive && setMemos(m))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id])
  if (memos === null) return <p className="recent-memos muted small">메모 불러오는 중…</p>
  if (memos.length === 0) return <p className="recent-memos muted small">아직 남긴 메모가 없어요.</p>
  return (
    <ul className="recent-memos">
      {memos.map((m) => (
        <li key={m.id}>
          <div className="recent-memo-head">
            {m.mine && <span aria-label="개인 메모">🔒 </span>}
            <strong>{m.kind}</strong> · <span className="muted">{shortWhen(m.at)}</span>
          </div>
          <div className="recent-memo-body">{m.body}</div>
        </li>
      ))}
    </ul>
  )
}
