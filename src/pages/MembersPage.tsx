import { ROLE_LABELS } from '../api.ts'
import { toLoginId } from '../auth.ts'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { Avatar } from '../ui/Avatar.tsx'
import { SearchBar, useTabSearch } from '../ui/search.tsx'
import { filterMembers, RoleHelp, sortMembers } from './AdminPage.tsx'

// 모든 팀원이 보는 팀원 목록 (보기 전용). 관리는 ☰ 메뉴 → 관리자에서 한다.
export function MembersPage({ team, uid, onOpenAdmin }: { team: Team; uid: string; onOpenAdmin: () => void }) {
  const profiles = useMemberProfiles(Object.keys(team.members))
  const isAdmin = team.members[uid] === 'admin'
  const { query } = useTabSearch()
  const list = filterMembers(sortMembers(team, profiles), profiles, query)

  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>👥 팀원 {Object.keys(team.members).length}명</h2>
        <span />
      </header>
      <SearchBar placeholder="팀원 이름, 아이디 검색" />
      <div className="page-body">
        {isAdmin && (
          <button type="button" className="primary" onClick={onOpenAdmin}>
            👥 직원 관리 (관리자)
          </button>
        )}
        {list.length === 0 && <p className="center muted">검색 결과가 없습니다.</p>}
        <ul className="list">
          {list.map((memberUid) => (
            <li key={memberUid} className="row">
              <span className="member-row-avatar">
                <Avatar uid={memberUid} name={profiles[memberUid]?.name ?? '?'} card />
              </span>
              <div className="row-main">
                <strong>
                  {profiles[memberUid]?.name ?? '…'}
                  {memberUid === uid && <span className="badge">나</span>}
                </strong>
                <span className="muted small">
                  {profiles[memberUid]?.position ? `${profiles[memberUid]?.position} · ` : ''}
                  {toLoginId(profiles[memberUid]?.email)}
                </span>
              </div>
              <span className="badge">{ROLE_LABELS[team.members[memberUid]]}</span>
            </li>
          ))}
        </ul>
        <RoleHelp />
      </div>
    </div>
  )
}
