import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { api, ROLE_LABELS, type Role } from '../api.ts'
import { errorMessage } from '../auth.ts'
import { db } from '../firebase.ts'
import type { Team } from '../hooks.ts'
import { Modal, toast } from '../ui/dialogs.tsx'

// 부서(팀) 이동: 이 부서에서 빼고 다른 부서에 넣는다 (서버 함수 moveMember).
// 이 사람이 담당하던 고객은 이 부서에 남으므로, 남는 사람 중 한 명에게 넘긴다.
export function MoveMemberDialog(props: {
  team: Team
  memberUid: string
  name: string
  myUid: string
  otherTeams: { id: string; name: string }[]
  names: Record<string, string> // 이 부서 팀원 이름
  onClose: () => void
}) {
  const { team, memberUid, name, myUid, otherTeams, names, onClose } = props
  const titleId = useId()
  const [toTeamId, setToTeamId] = useState(otherTeams[0]?.id ?? '')
  const [role, setRole] = useState<Role>(team.members[memberUid] ?? 'editor')
  const stay = Object.keys(team.members).filter((u) => u !== memberUid)
  const [newOwner, setNewOwner] = useState(stay.includes(myUid) ? myUid : (stay[0] ?? ''))
  const [owned, setOwned] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getCountFromServer(query(collection(db, 'customers'), where('teamId', '==', team.id), where('ownerUid', '==', memberUid))).then(
      (snap) => setOwned(snap.data().count),
      () => setOwned(0),
    )
  }, [team.id, memberUid])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!toTeamId) return
    setBusy(true)
    try {
      const res = await api.moveMember({ fromTeamId: team.id, toTeamId, uid: memberUid, role, newOwnerUid: owned ? newOwner : undefined })
      const to = otherTeams.find((t) => t.id === toTeamId)?.name ?? '다른 부서'
      toast(`${name}님을 ${to}(으)로 옮겼어요.${res.movedCustomers ? ` 담당 고객 ${res.movedCustomers}명은 ${names[newOwner] ?? '팀원'}님이 맡아요.` : ''}`, { long: true })
      onClose()
    } catch (err) {
      toast(errorMessage(err), { error: true, long: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form className="form" onSubmit={submit}>
        <h3 id={titleId}>🔀 부서 이동 · {name}</h3>
        <p className="muted small">
          {team.name}에서 빠지고 옮길 부서의 팀원이 됩니다. 이 부서의 고객·채팅은 더 이상 볼 수 없고, 옮긴 부서의 것을 보게 돼요.
        </p>
        <label>
          옮길 부서
          <select value={toTeamId} onChange={(e) => setToTeamId(e.target.value)}>
            {otherTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || '…'}
              </option>
            ))}
          </select>
        </label>
        <label>
          옮긴 부서에서의 권한
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {owned === null && <p className="muted small">담당 고객 확인 중…</p>}
        {owned !== null && owned > 0 && (
          <label>
            담당 고객 {owned}명을 넘겨받을 사람 (고객은 {team.name}에 남아요)
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
              {stay.map((u) => (
                <option key={u} value={u}>
                  {names[u] || '…'}
                  {u === myUid ? ' (나)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || owned === null || !toTeamId}>
            {busy ? '옮기는 중…' : '옮기기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
