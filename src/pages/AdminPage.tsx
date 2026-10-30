import { doc, updateDoc } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'
import { api, ROLE_LABELS, type Role } from '../api.ts'
import { errorMessage, toLoginId } from '../auth.ts'
import { db } from '../firebase.ts'
import { useTeamsSummary, type Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { toast } from '../ui/dialogs.tsx'
import { FrontLinkCard } from './FrontLinkCard.tsx'
import { EmoticonAdminCard } from './EmoticonAdminCard.tsx'
import { SearchKeyCard } from './SearchKeyCard.tsx'

export const ROLE_HELP: Record<Role, string> = {
  admin: '팀원 관리(추가, 권한, 비밀번호, 삭제), 팀 이름, 모든 기능',
  editor: '고객, 메모, 채팅, 스케줄 작성',
  viewer: '읽기만 가능 (스케줄 스티커는 가능)',
}

type Props = {
  team: Team
  uid: string
  superAdmin: boolean
  teamIds: string[]
  onSelectTeam: (teamId: string) => void
  onOpenUsage: () => void
  onOpenStaff: () => void
}

// 🛡️ 관리자 설정: 팀 이름과 (최고 관리자) 모든 팀·팀 만들기·#검색 키·프론트 알림·이모티콘·용량 관리.
// 팀원 목록·등록·권한·직급은 👥 직원 관리(StaffPage)로 나눴다.
export function AdminPage({ team, superAdmin, teamIds, onSelectTeam, onOpenUsage, onOpenStaff }: Props) {
  const uids = Object.keys(team.members)

  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>🛡️ 관리자 설정</h2>
        <span />
      </header>
      <div className="page-body two-col">
        <p className="notice small">
          🛡️ <strong>{team.name}</strong> 팀의 관리자만 보는 화면입니다.
          {superAdmin && ' 최고 관리자는 아래에서 모든 팀을 관리할 수 있습니다.'}
        </p>

        <div className="col">
        <TeamNameForm team={team} />

        <section className="admin-section">
          <h3>직원 관리</h3>
          <p className="muted small">팀원 등록·권한·직급·비밀번호 초기화·사용 중지는 "👥 직원 관리" 화면에서 해요.</p>
          <button type="button" className="primary" onClick={onOpenStaff}>
            👥 직원 관리 열기 · {uids.length}명
          </button>
        </section>
        </div>

        <div className="col">
        {superAdmin && (
          <section className="admin-section">
            <h3>최고 관리자</h3>
            <AllTeams teamIds={teamIds} current={team.id} onSelectTeam={onSelectTeam} />
            <CreateTeamForm onCreated={onSelectTeam} />
            <SearchKeyCard />
            <FrontLinkCard />
            <EmoticonAdminCard />
            <button type="button" onClick={onOpenUsage}>
              💾 용량 관리 (저장 공간·데이터·기간별 채팅 삭제)
            </button>
          </section>
        )}

        <RoleHelp />
        </div>
      </div>
    </div>
  )
}

// 위쪽 검색칸: 이름이나 아이디로 팀원을 찾는다.
export function filterMembers(uids: string[], profiles: Record<string, { name: string; email?: string }>, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return uids
  return uids.filter((id) => {
    const p = profiles[id]
    return Boolean(p && (p.name.toLowerCase().includes(q) || toLoginId(p.email).toLowerCase().includes(q)))
  })
}

export function sortMembers(team: Team, profiles: Record<string, { name: string }>) {
  const order = { admin: 0, editor: 1, viewer: 2 }
  return Object.keys(team.members).sort(
    (a, b) =>
      order[team.members[a]] - order[team.members[b]] ||
      (profiles[a]?.name ?? '').localeCompare(profiles[b]?.name ?? '', 'ko'),
  )
}

export function RoleHelp() {
  return (
    <dl className="card help">
      {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
        <div key={r}>
          <dt>{ROLE_LABELS[r]}</dt>
          <dd>{ROLE_HELP[r]}</dd>
        </div>
      ))}
    </dl>
  )
}

// 최고 관리자: 모든 팀을 한눈에 보고, 눌러서 그 팀 관리로 바로 간다.
function AllTeams({ teamIds, current, onSelectTeam }: { teamIds: string[]; current: string; onSelectTeam: (id: string) => void }) {
  const teams = useTeamsSummary(teamIds)
  return (
    <ul className="list">
      {teamIds.map((id) => (
        <li key={id} className="row">
          <div className="row-main">
            <strong>
              {teams[id]?.name ?? '…'}
              {id === current && <span className="badge">지금 보는 팀</span>}
            </strong>
            <span className="muted small">팀원 {teams[id]?.memberCount ?? '…'}명</span>
          </div>
          {id !== current && (
            <button type="button" className="link" onClick={() => onSelectTeam(id)}>
              이 팀 관리 →
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function TeamNameForm({ team }: { team: Team }) {
  const [name, setName] = useState(team.name)
  const [busy, setBusy] = useState(false)
  const changed = name.trim() !== team.name

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await updateDoc(doc(db, 'teams', team.id), { name: name.trim() })
      toast('팀 이름을 바꿨습니다.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card inline-form" onSubmit={submit}>
      <label>
        팀 이름
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
      </label>
      <button disabled={busy || !changed || !name.trim()}>{changed ? '저장' : '저장됨'}</button>
    </form>
  )
}

// 최고 관리자만: 새 팀을 만들면 최고 관리자가 그 팀의 관리자로 들어가고 바로 그 팀으로 바뀐다.
function CreateTeamForm({ onCreated }: { onCreated: (teamId: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { teamId } = await api.createTeam({ name: name.trim() })
      setName('')
      onCreated(teamId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <strong>새 팀 만들기</strong>
      <p className="muted small">
        최고 관리자는 팀에 속하지 않아도 위 목록이나 메뉴의 팀 바꾸기로 모든 팀의 고객, 채팅, 스케줄, 팀원을 보고 관리해요
        (팀원 목록에는 안 나와요). 새 팀을 만들면 그 팀으로 바뀌니, 👥 직원 관리 → "＋ 직원 등록"으로 팀원을 넣으세요.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 지원팀" maxLength={30} aria-label="새 팀 이름" required />
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !name.trim()}>
        {busy ? '만드는 중…' : '팀 만들기'}
      </button>
    </form>
  )
}
