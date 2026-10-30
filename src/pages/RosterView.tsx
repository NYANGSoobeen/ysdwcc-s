import { useMemo, useRef, useState, type ReactNode } from 'react'
import { errorMessage } from '../auth.ts'
import { useMemberProfiles, type Team } from '../hooks.ts'
import { readTableFile } from '../importCustomers.ts'
import { MenuButton } from '../menu.tsx'
import {
  addMonths,
  daysIn,
  monthKey,
  monthLabel,
  OFF,
  parseRosterTable,
  saveRoster,
  setCode,
  useRoster,
  weekday,
  weekdayLabel,
  WORK,
  type Roster,
  type RosterImport,
} from '../schedule/roster.ts'
import { Avatar } from '../ui/Avatar.tsx'
import { ask, Modal, toast } from '../ui/dialogs.tsx'
import { useIsDesktop } from '../useMedia.ts'

// 📋 근무표: 엑셀에서 우리 팀원 줄만 가져와 깔끔한 표로. 날짜마다 B0 · 휴 목록으로 보고, 직접 고칠 수도 있다.
// 데이터는 src/schedule/roster.ts. 휴무(휴)인 날은 갤럭시 앱이 고객 전화 무음 + 자동 문자 (src/offday.ts).
type Member = { uid: string; name: string; position: string }
type Tab = 'B0' | '휴' | 'etc' | 'none'

const MONTH_KEY = 'roster-month'

export function RosterView({ team, uid, tabs }: { team: Team; uid: string; tabs: ReactNode }) {
  const canEdit = team.members[uid] !== 'viewer'
  const desktop = useIsDesktop()
  const today = new Date()
  const [month, setMonthState] = useState(() => {
    try {
      return sessionStorage.getItem(MONTH_KEY) || monthKey(today)
    } catch {
      return monthKey(today)
    }
  })
  const setMonth = (m: string) => {
    setMonthState(m)
    try {
      sessionStorage.setItem(MONTH_KEY, m)
    } catch {
      // 기억 못 해도 괜찮다
    }
  }
  const roster = useRoster(team.id, month)
  const profiles = useMemberProfiles(Object.keys(team.members))
  const members: Member[] = useMemo(
    () =>
      Object.keys(team.members)
        .map((m) => ({ uid: m, name: profiles[m]?.name ?? '', position: profiles[m]?.position ?? '' }))
        .filter((m) => m.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [team.members, profiles],
  )
  const isThisMonth = month === monthKey(today)
  const [day, setDay] = useState(isThisMonth ? today.getDate() : 1)
  const [tab, setTab] = useState<Tab>('B0')
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showTable, setShowTable] = useState(desktop)
  const n = daysIn(month)
  const d = Math.min(day, n)
  const codeOf = (u: string, dd: number) => roster?.codes?.[u]?.[dd] ?? ''

  function go(delta: number) {
    const next = addMonths(month, delta)
    setMonth(next)
    setDay(next === monthKey(today) ? today.getDate() : 1)
  }

  async function change(u: string, dd: number, code: string) {
    try {
      await setCode(team.id, month, u, dd, code, !!roster)
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const lists = {
    B0: members.filter((m) => codeOf(m.uid, d) === WORK),
    휴: members.filter((m) => codeOf(m.uid, d) === OFF),
    etc: members.filter((m) => codeOf(m.uid, d) && codeOf(m.uid, d) !== WORK && codeOf(m.uid, d) !== OFF),
    none: members.filter((m) => !codeOf(m.uid, d)),
  }
  const myOffs = Object.entries(roster?.codes?.[uid] ?? {})
    .filter(([, c]) => c === OFF)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b)

  return (
    <div className="page roster-page">
      <header className="page-header">
        <MenuButton />
        <h2>📅 스케줄</h2>
        {canEdit ? (
          <span className="header-actions">
            <button type="button" className="ghost" onClick={() => setImporting(true)} aria-label="엑셀로 근무표 불러오기">
              📥<span className="hide-narrow"> 엑셀</span>
            </button>
            <button type="button" className={editing ? 'ghost active-toggle' : 'ghost'} onClick={() => setEditing(!editing)} aria-pressed={editing}>
              {editing ? '✓ 다 고침' : '✏️ 고치기'}
            </button>
          </span>
        ) : (
          <span />
        )}
      </header>
      {tabs}
      <div className="page-body roster-body">
        <div className="roster-month">
          <button type="button" className="ghost" onClick={() => go(-1)} aria-label="지난달">
            ‹
          </button>
          <strong>{monthLabel(month)}</strong>
          <button type="button" className="ghost" onClick={() => go(1)} aria-label="다음 달">
            ›
          </button>
          {!isThisMonth && (
            <button type="button" className="ghost small" onClick={() => {
                setMonth(monthKey(today))
                setDay(today.getDate())
              }}>
              이번 달
            </button>
          )}
        </div>

        {roster === undefined && <p className="center muted">불러오는 중…</p>}
        {roster === null && (
          <section className="card roster-empty-card">
            <p>
              <strong>{monthLabel(month)} 근무표가 아직 없어요.</strong>
            </p>
            <p className="muted small">
              근무표 엑셀(직원 이름이 세로, 날짜가 가로)을 불러오면 우리 팀원 이름과 맞는 줄만 가져와 날짜별 B0 · 휴 목록으로 정리해요.
              {canEdit ? ' "✏️ 고치기"로 직접 넣어도 돼요.' : ''}
            </p>
            {canEdit && (
              <button type="button" className="primary" onClick={() => setImporting(true)}>
                📥 엑셀로 불러오기
              </button>
            )}
          </section>
        )}

        {roster !== undefined && (
          <>
            {myOffs.length > 0 && (
              <p className="roster-mine">
                🌙 내 휴무: {myOffs.map((x) => `${x}일(${weekdayLabel(weekday(month, x))})`).join(', ')}
              </p>
            )}
            <div className="roster-days" role="tablist" aria-label="날짜">
              {Array.from({ length: n }, (_, i) => i + 1).map((x) => {
                const wd = weekday(month, x)
                const offs = members.filter((m) => codeOf(m.uid, x) === OFF).length
                const mine = codeOf(uid, x)
                return (
                  <button
                    key={x}
                    type="button"
                    role="tab"
                    aria-selected={x === d}
                    className={['roster-day', x === d && 'selected', isThisMonth && x === today.getDate() && 'today', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ')}
                    onClick={() => setDay(x)}
                    ref={(el) => {
                      if (el && x === d) el.scrollIntoView({ block: 'nearest', inline: 'center' })
                    }}
                  >
                    <small>{weekdayLabel(wd)}</small>
                    <strong>{x}</strong>
                    <span className={mine === OFF ? 'roster-dot off' : mine === WORK ? 'roster-dot work' : 'roster-dot'}>{offs > 0 ? `휴${offs}` : ''}</span>
                  </button>
                )
              })}
            </div>

            <section className="card roster-day-card">
              <h3>
                {Number(month.slice(5))}월 {d}일 ({weekdayLabel(weekday(month, d))})
                {isThisMonth && d === today.getDate() && <span className="badge kind"> 오늘</span>}
              </h3>
              <div className="roster-tabs" role="tablist">
                <TabButton id="B0" cur={tab} set={setTab} label={`B0 ${lists.B0.length}`} />
                <TabButton id="휴" cur={tab} set={setTab} label={`휴 ${lists.휴.length}`} />
                {lists.etc.length > 0 && <TabButton id="etc" cur={tab} set={setTab} label={`기타 ${lists.etc.length}`} />}
                <TabButton id="none" cur={tab} set={setTab} label={`비어 있음 ${lists.none.length}`} />
              </div>
              <ul className="roster-list">
                {lists[tab].length === 0 && <li className="muted small">{tab === 'none' ? '모두 들어가 있어요.' : '없어요.'}</li>}
                {lists[tab].map((m) => (
                  <li key={m.uid}>
                    <Avatar uid={m.uid} name={m.name} />
                    <span className="roster-name">
                      {m.name}
                      {m.uid === uid && <span className="muted"> (나)</span>}
                      {m.position && <small className="muted"> {m.position}</small>}
                      {tab === 'etc' && <span className="roster-code">{codeOf(m.uid, d)}</span>}
                    </span>
                    {editing && (
                      <span className="roster-actions">
                        {tab !== 'B0' && (
                          <button type="button" className="chip" onClick={() => void change(m.uid, d, WORK)}>
                            → B0
                          </button>
                        )}
                        {tab !== '휴' && (
                          <button type="button" className="chip" onClick={() => void change(m.uid, d, OFF)}>
                            → 휴
                          </button>
                        )}
                        {tab !== 'none' && (
                          <button type="button" className="chip" onClick={() => void change(m.uid, d, '')} aria-label={`${m.name} 비우기`}>
                            ✕
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {!editing && canEdit && <p className="muted small">바꾸려면 위의 ✏️ 고치기를 누르세요.</p>}
            </section>

            <button type="button" className="ghost roster-table-toggle" onClick={() => setShowTable(!showTable)} aria-expanded={showTable}>
              {showTable ? '▾' : '▸'} 한 달 표 {editing && showTable ? '(칸을 누르면 B0 → 휴 → 비움)' : ''}
            </button>
            {showTable && (
              <MonthTable
                month={month}
                members={members}
                me={uid}
                codeOf={codeOf}
                selected={d}
                today={isThisMonth ? today.getDate() : 0}
                onDay={setDay}
                onCell={editing ? (u, dd) => void change(u, dd, cycle(codeOf(u, dd))) : undefined}
              />
            )}
            {roster?.fileName && <p className="muted small">불러온 엑셀: {roster.fileName}</p>}
          </>
        )}
      </div>
      {importing && (
        <RosterImportDialog
          teamId={team.id}
          month={month}
          members={members}
          existing={(m) => m === month && !!roster}
          onClose={() => setImporting(false)}
          onSaved={(m) => {
            setImporting(false)
            setMonth(m)
            setDay(m === monthKey(today) ? today.getDate() : 1)
          }}
        />
      )}
    </div>
  )
}

const cycle = (c: string) => (c === WORK ? OFF : c === OFF ? '' : WORK)

function TabButton({ id, cur, set, label }: { id: Tab; cur: Tab; set: (t: Tab) => void; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={cur === id} className={cur === id ? `roster-tab selected t-${id}` : `roster-tab t-${id}`} onClick={() => set(id)}>
      {label}
    </button>
  )
}

function MonthTable(props: {
  month: string
  members: Member[]
  me: string
  codeOf: (u: string, d: number) => string
  selected: number
  today: number
  onDay: (d: number) => void
  onCell?: (u: string, d: number) => void
}) {
  const n = daysIn(props.month)
  const days = Array.from({ length: n }, (_, i) => i + 1)
  return (
    <div className="roster-table-wrap">
      <table className="roster-table">
        <thead>
          <tr>
            <th className="sticky">이름</th>
            {days.map((x) => {
              const wd = weekday(props.month, x)
              return (
                <th
                  key={x}
                  className={[x === props.selected && 'selected', x === props.today && 'today', wd === 0 && 'sun', wd === 6 && 'sat'].filter(Boolean).join(' ')}
                  onClick={() => props.onDay(x)}
                >
                  {x}
                  <small>{weekdayLabel(wd)}</small>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {props.members.map((m) => (
            <tr key={m.uid} className={m.uid === props.me ? 'me' : undefined}>
              <th className="sticky">{m.name}</th>
              {days.map((x) => {
                const c = props.codeOf(m.uid, x)
                return (
                  <td
                    key={x}
                    className={[c === WORK && 'work', c === OFF && 'off', c && c !== WORK && c !== OFF && 'etc', x === props.selected && 'selected', props.onCell && 'editable'].filter(Boolean).join(' ')}
                    onClick={() => (props.onCell ? props.onCell(m.uid, x) : props.onDay(x))}
                  >
                    {c}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 엑셀 불러오기 ──
function RosterImportDialog(props: {
  teamId: string
  month: string
  members: Member[]
  existing: (month: string) => boolean
  onClose: () => void
  onSaved: (month: string) => void
}) {
  const [result, setResult] = useState<(RosterImport & { fileName: string }) | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [month, setMonth] = useState(props.month)
  const input = useRef<HTMLInputElement>(null)

  async function open(file: File) {
    setBusy('엑셀을 읽는 중…')
    try {
      const { rows } = await readTableFile(file)
      const r = parseRosterTable(rows, props.members, props.month)
      setResult({ ...r, fileName: file.name })
      setMonth(r.month)
    } catch (err) {
      toast((err as Error).message || '파일을 읽지 못했어요.', { error: true, long: true })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!result) return
    if (result.matched.length === 0) return toast('우리 팀원과 이름이 맞는 줄이 없어요.', { error: true })
    if (props.existing(month) && !(await ask({ message: `${monthLabel(month)} 근무표를 이 엑셀로 바꿔요. 직접 고친 것도 엑셀 내용으로 바뀌어요. 계속할까요?`, ok: '바꾸기' }))) return
    setBusy('저장하는 중…')
    try {
      const codes: Roster['codes'] = {}
      for (const m of result.matched) codes[m.uid] = m.codes
      await saveRoster(props.teamId, month, codes, result.fileName)
      toast(`${monthLabel(month)} 근무표를 저장했어요.`)
      props.onSaved(month)
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setBusy(null)
    }
  }

  return (
    <Modal onClose={() => !busy && props.onClose()} labelledBy="roster-import-title" className="roster-import" closeOnOutside={false}>
      <h3 id="roster-import-title">📥 근무표 엑셀 불러오기</h3>
      {!result ? (
        <>
          <p className="muted small">
            직원 이름이 세로(왼쪽 열), 날짜(1~31)가 가로(위쪽 줄)인 엑셀(.xlsx)이나 CSV를 고르세요. <strong>우리 팀원과 이름이 같은 줄만</strong> 가져오고, 칸의
            B0 · 휴(휴무·OFF도 휴로)를 날짜별로 정리해요. 엑셀에 없는 팀원은 비워 둬요.
          </p>
          <button type="button" className="primary" onClick={() => input.current?.click()} disabled={!!busy}>
            📄 엑셀 파일 고르기
          </button>
        </>
      ) : (
        <>
          <label className="roster-import-month">
            몇 월 근무표인가요?
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            {!result.monthFound && <small className="muted">파일에서 달을 찾지 못해 지금 보던 달로 했어요. 맞는지 확인해 주세요.</small>}
          </label>
          <p>
            <strong>{result.matched.length}명</strong>의 근무를 가져와요 <span className="muted small">(날짜 {result.days}칸)</span>
          </p>
          <ul className="roster-import-list">
            {result.matched.map((m) => (
              <li key={m.uid}>
                ✅ {m.name} <span className="muted small">B0 {m.works}일 · 휴 {m.offs}일</span>
              </li>
            ))}
            {result.missing.map((m) => (
              <li key={m.uid} className="muted">
                ⬜ {m.name} <span className="small">엑셀에 없어 비워 둬요 (나중에 다시 불러오거나 직접 넣기)</span>
              </li>
            ))}
          </ul>
          {result.ambiguous.length > 0 && <p className="muted small">⚠️ 같은 이름 팀원이 여럿이라 건너뜀: {result.ambiguous.join(', ')} → 직접 넣어 주세요.</p>}
          {result.unmatched.length > 0 && (
            <details>
              <summary className="muted small">우리 팀에 없는 이름 {result.unmatched.length}개는 건너뛰어요</summary>
              <p className="muted small">{result.unmatched.slice(0, 60).join(', ')}</p>
            </details>
          )}
        </>
      )}
      {busy && <p className="notice">{busy}</p>}
      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void open(f)
        }}
      />
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose} disabled={!!busy}>
          닫기
        </button>
        {result && (
          <>
            <button type="button" className="ghost" onClick={() => input.current?.click()} disabled={!!busy}>
              다른 파일
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={!!busy || result.matched.length === 0}>
              저장
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}

