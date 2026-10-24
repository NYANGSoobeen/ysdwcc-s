import { doc, updateDoc } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'
import { api, ROLE_LABELS, type Role } from '../api.ts'
import { errorMessage, toEmail, toLoginId } from '../auth.ts'
import { db } from '../firebase.ts'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'

const ROLE_HELP: Record<Role, string> = {
  admin: '팀원 관리, 용량 관리, 모든 기능',
  editor: '고객, 메모, 채팅 작성',
  viewer: '읽기만 가능',
}

type Props = { team: Team; uid: string; superAdmin: boolean; onSelectTeam: (teamId: string) => void }

export function MembersPage({ team, uid, superAdmin, onSelectTeam }: Props) {
  const isAdmin = team.members[uid] === 'admin'
  const uids = Object.keys(team.members)
  const profiles = useMemberProfiles(uids)
  const [adding, setAdding] = useState(false)

  const sorted = [...uids].sort((a, b) => {
    const order = { admin: 0, editor: 1, viewer: 2 }
    return order[team.members[a]] - order[team.members[b]] ||
      (profiles[a]?.name ?? '').localeCompare(profiles[b]?.name ?? '', 'ko')
  })

  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>팀원 {uids.length}명</h2>
        {isAdmin ? (
          <button type="button" className="ghost" onClick={() => setAdding(!adding)}>
            {adding ? '닫기' : '+ 추가'}
          </button>
        ) : (
          <span />
        )}
      </header>
      <div className="page-body">
        {adding && <AddMemberForm teamId={team.id} onDone={() => setAdding(false)} />}
        {isAdmin && <TeamNameForm team={team} />}
        <ul className="list">
          {sorted.map((memberUid) => (
            <MemberRow
              key={memberUid}
              team={team}
              memberUid={memberUid}
              name={profiles[memberUid]?.name ?? '…'}
              loginId={toLoginId(profiles[memberUid]?.email)}
              isMe={memberUid === uid}
              canManage={isAdmin}
            />
          ))}
        </ul>
        {superAdmin && <CreateTeamForm onCreated={onSelectTeam} />}
        <dl className="card help">
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <div key={r}>
              <dt>{ROLE_LABELS[r]}</dt>
              <dd>{ROLE_HELP[r]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function MemberRow(props: {
  team: Team
  memberUid: string
  name: string
  loginId: string
  isMe: boolean
  canManage: boolean
}) {
  const { team, memberUid, name, loginId, isMe, canManage } = props
  const role = team.members[memberUid]
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await action()
      if (done) alert(done)
    } catch (err) {
      alert(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function changeRole(next: Role) {
    if (next === role) return
    void run(() => api.updateMemberRole({ teamId: team.id, uid: memberUid, role: next }))
  }

  function resetPassword() {
    const password = prompt(`${name}님의 새 비밀번호 (6자 이상)`)
    if (!password) return
    void run(
      () => api.resetMemberPassword({ teamId: team.id, uid: memberUid, password }),
      `비밀번호를 바꿨습니다. ${name}님에게 새 비밀번호를 알려 주세요.`,
    )
  }

  function remove() {
    if (!confirm(`${name}님을 팀에서 삭제할까요?\n\n바로 팀 데이터에 접근할 수 없게 되고, 그 사람 폰에 남은 데이터도 다음에 앱을 열 때 지워집니다. 다른 팀에 속하지 않았다면 계정도 삭제됩니다.`)) return
    void run(async () => {
      const { accountDeleted } = await api.removeMember({ teamId: team.id, uid: memberUid })
      alert(accountDeleted ? `${name}님을 삭제하고 계정도 지웠습니다.` : `${name}님을 이 팀에서 뺐습니다.`)
    })
  }

  return (
    <li className="row">
      <div className="row-main">
        <strong>
          {name}
          {isMe && <span className="badge">나</span>}
        </strong>
        <span className="muted small">{loginId}</span>
      </div>
      {canManage ? (
        <div className="row-actions">
          <select value={role} onChange={(e) => changeRole(e.target.value as Role)} disabled={busy} aria-label={`${name} 권한`}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {!isMe && (
            <>
              <button type="button" className="link" onClick={resetPassword} disabled={busy}>
                비밀번호
              </button>
              <button type="button" className="link danger" onClick={remove} disabled={busy}>
                삭제
              </button>
            </>
          )}
        </div>
      ) : (
        <span className="badge">{ROLE_LABELS[role]}</span>
      )}
    </li>
  )
}

function AddMemberForm({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', loginId: '', password: '', role: 'editor' as Role })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { existed } = await api.addMember({
        teamId,
        name: form.name,
        email: toEmail(form.loginId),
        password: form.password,
        role: form.role,
      })
      alert(
        existed
          ? `${form.name}님을 추가했습니다. 이미 있던 계정이라 비밀번호는 그대로입니다.`
          : `${form.name}님을 추가했습니다.\n아이디: ${form.loginId.trim()}\n비밀번호: ${form.password}\n로그인 후 "내 정보"에서 비밀번호를 바꾸도록 안내하세요.`,
      )
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <strong>팀원 추가</strong>
      <label>
        이름
        <input value={form.name} onChange={set('name')} required />
      </label>
      <label>
        아이디 (영문, 숫자 또는 이메일)
        <input value={form.loginId} onChange={set('loginId')} autoCapitalize="none" required />
      </label>
      <label>
        처음 비밀번호 (6자 이상)
        <input value={form.password} onChange={set('password')} minLength={6} required />
      </label>
      <label>
        권한
        <select value={form.role} onChange={set('role')}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]} — {ROLE_HELP[r]}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? '추가하는 중…' : '추가'}
      </button>
    </form>
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
    } catch (err) {
      alert(errorMessage(err))
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
        최고 관리자는 모든 팀에 관리자로 들어가 있어, 화면 맨 위에서 팀을 바꿔 가며 모든 팀의 고객, 채팅, 팀원을 볼 수
        있습니다. 새 팀의 팀원은 그 팀으로 바꾼 뒤 "+ 추가"로 넣으세요.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 지원팀" maxLength={30} aria-label="새 팀 이름" required />
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !name.trim()}>
        {busy ? '만드는 중…' : '팀 만들기'}
      </button>
    </form>
  )
}
