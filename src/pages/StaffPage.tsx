import { useState, type FormEvent } from 'react'
import { api, ROLE_LABELS, type Role } from '../api.ts'
import { errorMessage, toEmail, toLoginId } from '../auth.ts'
import { useMemberProfiles, useTeamNames, type Profile, type Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { makeTempPassword } from '../tempPassword.ts'
import { AvatarFace } from '../ui/Avatar.tsx'
import { MoreButton, useItemMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, askText, Modal, tell, toast } from '../ui/dialogs.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { filterMembers, ROLE_HELP, RoleHelp, sortMembers } from './AdminPage.tsx'
import { MoveMemberDialog } from './MoveMemberDialog.tsx'

// 👥 직원 관리 (관리자, 프론트 앱 "직원 관리"와 같은 모양, 색은 우리 앱).
// 줄마다: 사진 · 이름 · 직급 · 권한 / 아이디 · 최근 로그인 · 앱 버전(✅ 최신, ⚠️ 예전 버전) · 오른쪽 "관리 ▾".
// 직급은 관리자만 정한다(setMemberProfile, 정해진 목록 POSITIONS).
export const POSITIONS = ['사원', '주임', '계장', '대리', '과장', '차장', '부장', '팀장']

// 같은 빌드면 최신 (앱이 users.appVersion에 __APP_VERSION__을 적는다)
function versionIsCurrent(v: string) {
  return v === __APP_VERSION__
}

type Props = { team: Team; uid: string; teamIds: string[] }

export function StaffPage({ team, uid, teamIds }: Props) {
  const uids = Object.keys(team.members)
  const profiles = useMemberProfiles(uids)
  const teamNames = useTeamNames(teamIds)
  const otherTeams = teamIds.filter((id) => id !== team.id).map((id) => ({ id, name: teamNames[id] ?? '' }))
  const memberNames = Object.fromEntries(uids.map((u) => [u, profiles[u]?.name ?? '']))
  const [adding, setAdding] = useState(false)
  const { query } = useTabSearch()
  const sorted = filterMembers(sortMembers(team, profiles), profiles, query)

  return (
    <div className="page">
      <header className="page-header notices-header">
        <MenuButton />
        <h2>👥 직원 관리</h2>
        <SearchBar placeholder="검색" label="직원 이름, 아이디 검색" inline />
      </header>
      <div className="page-body staff-body">
        <div className="staff-top">
          <p className="muted small">여기서 등록한 직원만 로그인할 수 있어요. 등록할 때 정한 임시 비밀번호는 첫 로그인 때 본인이 바꿔요.</p>
          <button type="button" className="primary staff-add" onClick={() => setAdding(true)}>
            ＋ 직원 등록
          </button>
        </div>
        {sorted.length === 0 && <p className="center muted">검색 결과가 없어요.</p>}
        <ul className="staff-list">
          {sorted.map((memberUid) => (
            <StaffRow
              key={memberUid}
              team={team}
              memberUid={memberUid}
              name={profiles[memberUid]?.name ?? '…'}
              loginId={toLoginId(profiles[memberUid]?.email)}
              profile={profiles[memberUid]}
              isMe={memberUid === uid}
              myUid={uid}
              otherTeams={otherTeams}
              names={memberNames}
            />
          ))}
        </ul>
        <p className="muted small">
          팀에서 삭제하면 그 사람은 바로 팀 데이터에 접근할 수 없고, 폰에 남은 데이터도 다음에 앱을 열 때 지워져요. 잠시 막기만 하려면 "사용 중지"를 쓰세요
          (데이터와 팀 소속은 그대로, "다시 사용"으로 풀 수 있어요).
        </p>
        <RoleHelp />
      </div>
      {adding && (
        <Modal onClose={() => setAdding(false)} labelledBy="staff-add-title" className="staff-add-modal" closeOnOutside={false}>
          <h3 id="staff-add-title" className="sr-only">
            직원 등록
          </h3>
          <AddMemberForm teamId={team.id} onDone={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  )
}

// 이름·직급 수정 (관리자). 직급은 목록에서 고른다.
function EditProfileDialog({ team, memberUid, name, position, onClose }: { team: Team; memberUid: string; name: string; position: string; onClose: () => void }) {
  const [form, setForm] = useState({ name, position })
  const [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.setMemberProfile({ teamId: team.id, uid: memberUid, name: form.name.trim(), position: form.position })
      toast(`${form.name.trim()}님 정보를 바꿨어요.`)
      onClose()
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setBusy(false)
    }
  }
  const options = POSITIONS.includes(position) || !position ? POSITIONS : [position, ...POSITIONS]
  return (
    <Modal onClose={() => !busy && onClose()} labelledBy="staff-edit-title" closeOnOutside={false}>
      <form className="form" onSubmit={save}>
        <h3 id="staff-edit-title">✏️ 이름·직급 수정</h3>
        <label>
          이름
          <input value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <div className="field">
          <span>직급</span>
          <div className="chips position-chips" role="radiogroup" aria-label="직급">
            {['', ...options].map((p) => (
              <button
                type="button"
                key={p || 'none'}
                role="radio"
                aria-checked={form.position === p}
                className={form.position === p ? 'chip selected' : 'chip'}
                onClick={() => setForm({ ...form, position: p })}
              >
                {p || '없음'}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy || !form.name.trim()}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}

function StaffRow(props: {
  team: Team
  memberUid: string
  name: string
  loginId: string
  profile?: Profile
  isMe: boolean
  myUid: string
  otherTeams: { id: string; name: string }[] // 옮길 수 있는 다른 부서 (내가 속한 팀)
  names: Record<string, string>
}) {
  const { team, memberUid, name, loginId, profile, isMe } = props
  const canManage = true
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState(false)
  const inactive = profile?.active === false
  const role = team.members[memberUid]
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await action()
      if (done) toast(done)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  function changeRole(next: Role) {
    if (next === role) return
    void run(() => api.updateMemberRole({ teamId: team.id, uid: memberUid, role: next }), `${name}님 권한: ${ROLE_LABELS[next]}`)
  }

  async function resetPassword() {
    const password = await askText({
      title: '비밀번호 초기화',
      message: `${name}님의 임시 비밀번호예요 (헷갈리는 0·o·1·l·i는 뺐어요). 바꿔 써도 돼요 (6자 이상).\n다음에 로그인하면 새 비밀번호를 정하게 됩니다.`,
      label: '임시 비밀번호',
      value: makeTempPassword(),
      ok: '초기화',
      required: '임시 비밀번호를 입력하세요.',
    })
    if (!password) return
    if (password.length < 6) return toast('임시 비밀번호는 6자 이상이어야 합니다.', { error: true })
    setBusy(true)
    try {
      await api.resetMemberPassword({ teamId: team.id, uid: memberUid, password })
      await tell({
        title: '임시 비밀번호로 바꿨습니다',
        message: `${name}님에게 알려 주세요.\n아이디: ${loginId}\n임시 비밀번호: ${password}\n로그인하면 새 비밀번호를 정하게 됩니다.`,
        ok: '복사하고 닫기',
      })
      void copyText(`아이디: ${loginId}\n임시 비밀번호: ${password}`)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive() {
    if (inactive) {
      if (!(await ask({ message: `${name}님의 계정을 다시 사용하게 할까요?`, ok: '다시 사용' }))) return
      void run(() => api.setMemberActive({ teamId: team.id, uid: memberUid, active: true }), `${name}님이 다시 로그인할 수 있습니다.`)
      return
    }
    const reason = await askText({
      title: '계정 사용 중지',
      message: `${name}님의 계정을 사용 중지합니다.\n열려 있는 앱은 바로 로그아웃되고, 로그인 화면에 이유가 표시됩니다.`,
      label: '중지 이유',
      placeholder: '예: 휴직, 퇴사 예정',
      ok: '사용 중지',
      required: '중지 이유를 입력하세요.',
    })
    if (!reason?.trim()) return
    void run(
      () => api.setMemberActive({ teamId: team.id, uid: memberUid, active: false, reason: reason.trim() }),
      `${name}님의 계정을 사용 중지했습니다.`,
    )
  }

  async function remove() {
    const ok = await ask({
      title: '팀원 삭제',
      message: `${name}님을 팀에서 삭제할까요?\n\n바로 팀 데이터에 접근할 수 없게 되고, 그 사람 폰에 남은 데이터도 다음에 앱을 열 때 지워집니다. 다른 팀에 속하지 않았다면 계정도 삭제됩니다.`,
      ok: '삭제',
      danger: true,
    })
    if (!ok) return
    void run(async () => {
      const { accountDeleted } = await api.removeMember({ teamId: team.id, uid: memberUid })
      toast(accountDeleted ? `${name}님을 삭제하고 계정도 지웠습니다.` : `${name}님을 이 팀에서 뺐습니다.`)
    })
  }

  // 👑 최고 관리자는 팀에 속하지 않아도 모든 팀을 관리한다 → 팀원 목록·알림·읽음 숫자에서 빠진다
  async function leaveTeam() {
    const ok = await ask({
      title: '이 팀에서 빠지기',
      message: `${team.name} 팀원 목록에서 빠질까요?\n\n최고 관리자는 팀에 속하지 않아도 모든 팀을 그대로 보고 관리해요. 대신 이 팀 채팅 알림은 오지 않고, 팀원 목록·근무표·@부르기에 나오지 않아요.`,
      ok: '빠지기',
    })
    if (!ok) return
    void run(() => api.removeMember({ teamId: team.id, uid: memberUid }), `${team.name} 팀원 목록에서 빠졌어요. 계속 관리할 수 있어요.`)
  }

  // 관리 메뉴: ⋯ 버튼, PC 오른쪽 클릭, 휴대폰 길게 누르기
  const actions = (): MenuAction[] =>
    canManage && !isMe
      ? [
          { icon: '✏️', label: '이름·직급 수정', onSelect: () => setEditing(true) },
          ...(Object.keys(ROLE_LABELS) as Role[])
            .filter((r) => r !== role)
            .map((r) => ({ icon: r === 'admin' ? '⭐' : '🔑', label: r === 'admin' ? '관리자로 지정' : `권한: ${ROLE_LABELS[r]}(으)로`, onSelect: () => changeRole(r) })),
          ...(props.otherTeams.length ? [{ icon: '🔀', label: '부서 이동', onSelect: () => setMoving(true) }] : []),
          { icon: '🔒', label: '비밀번호 초기화', onSelect: () => void resetPassword() },
          inactive
            ? { icon: '✅', label: '다시 사용', onSelect: () => void toggleActive() }
            : { icon: '⛔', label: '사용 중지', onSelect: () => void toggleActive() },
          { icon: '🗑️', label: '팀에서 삭제', danger: true, onSelect: () => void remove() },
        ]
      : [
          { icon: '✏️', label: '내 이름·직급 수정', onSelect: () => setEditing(true) },
          ...(profile?.superAdmin ? [{ icon: '🚪', label: '이 팀에서 빠지기 (최고 관리자)', onSelect: () => void leaveTeam() }] : []),
        ]
  const menu = useItemMenu(actions, name)

  const position = profile?.position ?? ''
  const seen = profile?.lastSeenAt?.toDate()
  const version = profile?.appVersion ?? ''
  const sub = [
    `아이디: ${loginId}`,
    seen ? `최근 로그인 ${seen.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '최근 로그인 기록 없음',
  ]
  return (
    <>
      <li className={inactive ? 'staff-row inactive has-menu' : 'staff-row has-menu'} {...menu}>
        <AvatarFace uid={memberUid} name={name} avatar={profile?.avatar} className="staff-avatar" />
        <div className="staff-main">
          <div className="staff-name">
            <strong>
              {name}
              {position && <span className="staff-position"> · {position}</span>}
            </strong>
            <span className={`role-chip ${role}`}>{ROLE_LABELS[role]}</span>
            {isMe && <span className="role-chip me">나</span>}
            {inactive && <span className="role-chip off">사용 중지</span>}
            {profile?.mustChangePassword && !inactive && <span className="role-chip temp">임시 비밀번호</span>}
          </div>
          <div className="staff-sub">
            {sub.join(' · ')}
            {version && (
              <>
                {' · '}앱 v{version.split(' · ')[0]}{' '}
                {versionIsCurrent(version) ? (
                  <span className="ver-ok" title="최신 버전">
                    ✅
                  </span>
                ) : (
                  <span className="ver-old">⚠️ 예전 버전</span>
                )}
              </>
            )}
          </div>
          {inactive && profile?.disabledReason && <div className="small error">이유: {profile.disabledReason}</div>}
        </div>
        <MoreButton actions={actions} title={name} label={`${name} 관리 메뉴`} className="staff-manage">
          관리 <span aria-hidden="true">▾</span>
        </MoreButton>
        {busy && <span className="muted small">…</span>}
      </li>
      {editing && <EditProfileDialog team={team} memberUid={memberUid} name={name} position={position} onClose={() => setEditing(false)} />}
      {moving && (
        <MoveMemberDialog
          team={team}
          memberUid={memberUid}
          name={name}
          myUid={props.myUid}
          otherTeams={props.otherTeams}
          names={props.names}
          onClose={() => setMoving(false)}
        />
      )}
    </>
  )
}

function AddMemberForm({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', position: '', loginId: '', password: makeTempPassword(), role: 'editor' as Role })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { uid, existed } = await api.addMember({
        teamId,
        name: form.name,
        email: toEmail(form.loginId),
        password: form.password,
        role: form.role,
      })
      if (form.position) await api.setMemberProfile({ teamId, uid, position: form.position }).catch(() => undefined)
      if (existed) toast(`${form.name}님을 추가했습니다. 이미 있던 계정이라 비밀번호는 그대로입니다.`)
      else {
        await tell({
          title: `${form.name}님을 추가했습니다`,
          message: `아래 내용을 ${form.name}님에게 알려 주세요.\n아이디: ${form.loginId.trim()}\n임시 비밀번호: ${form.password}\n처음 로그인하면 새 비밀번호를 정하게 됩니다.`,
          ok: '복사하고 닫기',
        })
        // 확인을 누른 순간이라 복사가 허용된다
        void copyText(`아이디: ${form.loginId.trim()}\n임시 비밀번호: ${form.password}`)
      }
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <strong>＋ 직원 등록</strong>
      <label>
        이름
        <input value={form.name} onChange={set('name')} required />
      </label>
      <label>
        직급
        <select value={form.position} onChange={set('position')}>
          <option value="">(정하지 않음)</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label>
        아이디 (영문, 숫자 또는 이메일)
        <input value={form.loginId} onChange={set('loginId')} autoCapitalize="none" required />
      </label>
      <label>
        임시 비밀번호 (저절로 만들어짐, 처음 로그인 때 바꿈)
        <span className="temp-pw-row">
          <input value={form.password} onChange={set('password')} minLength={6} autoCapitalize="none" spellCheck={false} required />
          <button type="button" onClick={() => setForm({ ...form, password: makeTempPassword() })} aria-label="임시 비밀번호 새로 만들기">
            🎲 새로
          </button>
        </span>
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
        {busy ? '등록하는 중…' : '등록'}
      </button>
    </form>
  )
}


// 알려 줄 내용을 클립보드에 (안 되면 조용히 넘어감, 창에 그대로 보이므로)
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('아이디와 임시 비밀번호를 복사했어요.')
  } catch {
    // 복사가 막힌 브라우저
  }
}
