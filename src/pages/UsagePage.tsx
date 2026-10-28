import { useCallback, useEffect, useState } from 'react'
import { api, type DataCount, type Usage } from '../api.ts'
import { errorMessage } from '../auth.ts'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import { app } from '../firebase.ts'
import type { Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { ask, Modal, toast } from '../ui/dialogs.tsx'

// 💾 용량 관리 (최고 관리자): 프론트 앱 "용량 관리" 탭과 같은 화면 (색은 우리 앱).
// ① 📁 파일 저장공간 ② 🗂️ 데이터(Firestore) ③ 💬 채팅 기간 삭제 ④ ↻ 다시 계산
// 계산은 서버 함수(getUsage · cleanUnusedFiles · countData · deleteMessagesInRange, functions/src/usage.ts)가 한다.

const UNUSED = '사용하지 않는 파일'

function fmtBytes(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 1000) / 10) : 0)
const cnt = (n: number) => `${n.toLocaleString()}개`
const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR')

function consoleUrl(path: string) {
  return `https://console.firebase.google.com/project/${encodeURIComponent(app.options.projectId ?? '')}/${path}`
}

// 사용량 막대: 70% 넘으면 노랑, 90% 넘으면 빨강
function Meter(props: { used: number; max: number; label: string; sub: string; small?: boolean }) {
  const p = pct(props.used, props.max)
  return (
    <div className={props.small ? 'st-meter small' : 'st-meter'}>
      <div className="st-meter-top">
        <b>{props.label}</b>
        <span>
          {p}% · {props.sub}
        </span>
      </div>
      <div className="st-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={props.label}>
        <div className={p >= 90 ? 'danger' : p >= 70 ? 'warn' : ''} style={{ width: `${Math.max(p, 0.5)}%` }} />
      </div>
    </div>
  )
}

function ConsoleLink({ label, path }: { label: string; path: string }) {
  return (
    <a className="st-link-btn" href={consoleUrl(path)} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}

export function UsagePage({ team }: { team: Team }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setError('')
    setUsage(null)
    try {
      setUsage(await api.getUsage({ teamId: team.id }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [team.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="page">
      <header className="page-header">
        <MenuButton />
        <h2>💾 용량 관리</h2>
        <span />
      </header>
      <div className="page-body storage-view">
        {error && <p className="st-empty">사용량을 불러오지 못했어요. 잠시 후 다시 시도해 주세요. ({error})</p>}
        {!usage && !error && <p className="st-empty">사용량을 계산하는 중...</p>}
        {usage && (
          <>
            <FileCard teamId={team.id} usage={usage} busy={busy} setBusy={setBusy} onChanged={refresh} />
            <DataCard teamId={team.id} />
            <ChatCard teamId={team.id} usage={usage} busy={busy} setBusy={setBusy} onChanged={refresh} />
          </>
        )}
        <div>
          <button type="button" className="st-btn st-close" onClick={() => void refresh()} disabled={busy}>
            ↻ 다시 계산
          </button>
        </div>
      </div>
    </div>
  )
}

type CardProps = { teamId: string; usage: Usage; busy: boolean; setBusy: (b: boolean) => void; onChanged: () => void }

// ① 📁 파일 저장공간: 막대 + 종류별 표 + 사용하지 않는 파일 정리
function FileCard({ teamId, usage, busy, setBusy, onChanged }: CardProps) {
  const s = usage.storage
  const [showUnused, setShowUnused] = useState(false)
  const [viewer, setViewer] = useState<ViewerPhoto[] | null>(null)
  const others = s.projectBytes - s.bytes

  async function clean() {
    if (busy) return
    if (!(await ask({ message: `어디에도 쓰이지 않는 파일 ${s.unusedCount}개(${fmtBytes(s.unusedBytes)})를 삭제할까요?\n되돌릴 수 없어요.`, ok: '정리', danger: true })))
      return
    setBusy(true)
    try {
      // 서버가 지우기 직전에 다시 나눠 보고, 그새 쓰이게 된 파일은 건너뛴다.
      const r = await api.cleanUnusedFiles({ teamId, paths: [] })
      toast(`${r.deleted}개 파일을 정리했어요 (${fmtBytes(r.bytes)})`)
    } catch (err) {
      toast(`정리하지 못했어요. ${errorMessage(err)}`, { error: true })
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const isImage = (type: string) => type.startsWith('image/')
  const kindOf = (type: string) => (isImage(type) ? '사진' : type.startsWith('video/') ? '동영상' : /pdf/.test(type) ? 'PDF' : '파일')
  const iconOf = (type: string) => (type.startsWith('video/') ? '🎬' : /pdf/.test(type) ? '📄' : '📎')

  return (
    <section className="st-card">
      <h3>📁 파일 저장공간 (Firebase Storage)</h3>
      <Meter used={s.projectBytes} max={s.freeBytes} label={`${fmtBytes(s.projectBytes)} 사용 / 무료 ${fmtBytes(s.freeBytes)}`} sub={`남은 무료 공간 ${fmtBytes(Math.max(0, s.freeBytes - s.projectBytes))}`} />
      <p className="st-note">
        이 팀 파일 {s.files.toLocaleString()}개 ({fmtBytes(s.bytes)}){others > 0 && ` · 다른 팀 ${fmtBytes(others)}`} · 무료 사용량: 저장 5GB, 내려받기 월 100GB (US 지역 버킷 기준). 넘으면 그만큼만 요금이 나와요.
      </p>
      <table className="st-table">
        <thead>
          <tr>
            <th>종류</th>
            <th>개수</th>
            <th>용량</th>
          </tr>
        </thead>
        <tbody>
          {s.groups.map((g) => (
            <tr key={g.label} className={g.label === UNUSED ? 'st-orphan' : undefined}>
              <td>{g.label}</td>
              <td>{g.count.toLocaleString()}개</td>
              <td>{fmtBytes(g.bytes)}</td>
            </tr>
          ))}
          {s.groups.length === 0 && (
            <tr>
              <td colSpan={3}>아직 올린 파일이 없어요</td>
            </tr>
          )}
        </tbody>
      </table>
      {s.unusedCount > 0 && (
        <>
          <p className="st-note">
            "사용하지 않는 파일"은 지운 채팅 사진·바꾼 스케줄·저장에 실패한 첨부처럼 이제 앱 어디에도 쓰이지 않는 파일이에요. 정리해도 화면에서 사라지는 것은 없어요.
          </p>
          <button type="button" className="st-btn" onClick={() => void clean()} disabled={busy}>
            🧹 사용하지 않는 파일 {s.unusedCount}개 정리 ({fmtBytes(s.unusedBytes)})
          </button>
          <button type="button" className="st-btn st-ghost" onClick={() => setShowUnused(!showUnused)}>
            {showUnused ? '🔼 접기' : '🔍 어떤 파일인지 보기'}
          </button>
          {showUnused && (
            <div className="st-orphan-list">
              {s.unused.map((f) => (
                <div key={f.name} className="st-orphan-item">
                  {isImage(f.type) ? (
                    <StorageImage
                      path={f.name}
                      onClick={() =>
                        setViewer([{ attachment: { path: f.name, thumbPath: f.name, width: 0, height: 0, size: f.size, thumbSize: 0 }, author: '사용하지 않는 파일', createdAt: f.created ? new Date(f.created) : null }])
                      }
                    />
                  ) : (
                    <div className="st-orphan-icon">{iconOf(f.type)}</div>
                  )}
                  <div className="st-orphan-cap">
                    {kindOf(f.type)} · {fmtBytes(f.size)}
                    {f.created && !isNaN(Date.parse(f.created)) && ` · ${day(Date.parse(f.created))}`}
                  </div>
                </div>
              ))}
              {s.unusedCount > s.unused.length && <p className="st-note">최근 {s.unused.length}개만 보여요.</p>}
            </div>
          )}
        </>
      )}
      <ConsoleLink label="📈 Firebase 콘솔에서 Storage 사용량 보기" path="storage" />
      {viewer && <PhotoViewer photos={viewer} index={0} onClose={() => setViewer(null)} />}
    </section>
  )
}

// ② 🗂️ 데이터 (Firestore): 개수 세기는 읽기 횟수를 써서 버튼을 눌렀을 때만
function DataCard({ teamId }: { teamId: string }) {
  const [result, setResult] = useState<DataCount | null>(null)
  const [counting, setCounting] = useState(false)
  async function count() {
    setCounting(true)
    try {
      setResult(await api.countData({ teamId }))
    } catch (err) {
      toast(`세지 못했어요. ${errorMessage(err)}`, { error: true })
    } finally {
      setCounting(false)
    }
  }
  return (
    <section className="st-card">
      <h3>🗂️ 데이터 (Firestore)</h3>
      <p className="st-note">
        Firestore는 저장 용량과 함께 하루에 읽고 쓰는 횟수에도 무료 한도가 있어요. 화면을 열 때마다 고객·채팅을 읽은 횟수가 쌓여요. 한도는 매일 오후 4~5시(한국 시간)에 다시 채워져요.
      </p>
      <table className="st-table">
        <tbody>
          <tr><td>저장 용량</td><td>무료 1GB</td></tr>
          <tr><td>읽기</td><td>하루 50,000회</td></tr>
          <tr><td>쓰기 (글 올리기·수정)</td><td>하루 20,000회</td></tr>
          <tr><td>삭제</td><td>하루 20,000회</td></tr>
        </tbody>
      </table>
      {counting && <p className="st-empty">세는 중...</p>}
      {result && !counting && (
        <div className="st-result">
          <Meter used={result.bytes} max={result.freeBytes} label={`약 ${fmtBytes(result.bytes)} 사용 / 무료 1GB`} sub={`남은 무료 용량 약 ${fmtBytes(Math.max(0, result.freeBytes - result.bytes))}`} />
          <table className="st-table">
            <thead>
              <tr>
                <th>종류</th>
                <th>개수</th>
              </tr>
            </thead>
            <tbody>
              {result.counts.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>{cnt(c.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="st-note">
            용량은 어림값이에요 (모든 팀 합계). 이번 계산에 읽기 약 {result.reads.toLocaleString()}회를 썼어요 (하루 무료 50,000회).
          </p>
        </div>
      )}
      <button type="button" className="st-btn" onClick={() => void count()} disabled={counting}>
        📊 데이터 개수·용량 계산하기
      </button>
      <p className="st-note">계산할 때 종류마다 몇십 번씩 읽기 횟수를 써요. 필요할 때만 눌러 주세요. 오늘 실제로 쓴 횟수는 Firebase 콘솔에서 볼 수 있어요.</p>
      <ConsoleLink label="📈 Firebase 콘솔에서 오늘 사용량 보기" path="firestore/databases/-default-/usage" />
    </section>
  )
}

// ③ 💬 채팅 기간 삭제 (방마다 가장 오래된 메시지 하나만 읽음)
function ChatCard({ teamId, usage, busy, setBusy, onChanged }: CardProps) {
  const [open, setOpen] = useState(false)
  return (
    <section className="st-card">
      <h3>💬 채팅 기간 삭제</h3>
      <table className="st-table">
        <thead>
          <tr>
            <th>채팅방</th>
            <th>가장 오래된 메시지</th>
          </tr>
        </thead>
        <tbody>
          {usage.rooms.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.oldest ? day(r.oldest) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="st-note">오래된 채팅을 지우면 저장 용량이 줄고, 채팅방을 열 때 읽는 양도 줄어요. 사진·동영상·파일도 함께 지워져요.</p>
      <button type="button" className="st-btn" onClick={() => setOpen(true)} disabled={busy}>
        🗑️ 기간을 정해 채팅 삭제
      </button>
      {open && (
        <RangeDeleteDialog
          teamId={teamId}
          rooms={usage.rooms}
          onClose={() => setOpen(false)}
          setBusy={setBusy}
          onDeleted={() => {
            setOpen(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

function dateInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

// 날짜 입력은 그 날 0시(기기 시간) 기준. 끝 날짜는 그 날 하루 전체를 포함한다.
function toRange(from: string, to: string) {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : 0
  const end = new Date(`${to}T00:00:00`)
  end.setDate(end.getDate() + 1)
  return { from: start, to: end.getTime() }
}

function RangeDeleteDialog(props: {
  teamId: string
  rooms: Usage['rooms']
  onClose: () => void
  setBusy: (b: boolean) => void
  onDeleted: () => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(dateInput(new Date(Date.now() - 30 * 86400000)))
  const [picked, setPicked] = useState<string[]>(props.rooms.map((r) => r.id))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function find() {
    setError('')
    if (!to) return setError('종료일을 선택해 주세요')
    if (from && from > to) return setError('시작일이 종료일보다 늦어요')
    if (!picked.length) return setError('채팅방을 하나 이상 선택해 주세요')
    const range = { teamId: props.teamId, ...toRange(from, to), channels: picked }
    setWorking(true)
    try {
      const preview = await api.deleteMessagesInRange({ ...range, dryRun: true })
      if (!preview.messages) return toast('그 기간에 해당하는 메시지가 없어요')
      const period = `${from || '처음'} ~ ${to}`
      const extra = preview.photos ? `(사진 ${preview.photos}장 포함)` : ''
      if (!(await ask({ message: `${period} 채팅 ${preview.messages}개${extra}를 삭제할까요?\n되돌릴 수 없어요.`, ok: '삭제', danger: true }))) return
      props.setBusy(true)
      const result = await api.deleteMessagesInRange({ ...range, dryRun: false })
      toast(`채팅 ${result.messages}개를 삭제했어요`)
      props.onDeleted()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setWorking(false)
      props.setBusy(false)
    }
  }

  return (
    <Modal onClose={props.onClose} labelledBy="range-delete-title">
      <h3 id="range-delete-title">채팅 기간 삭제</h3>
      <p className="modal-message">시작일을 비워두면 처음부터 종료일까지 지워요. 사진·동영상·파일도 함께 지워져 저장공간이 확보돼요.</p>
      <div className="form">
        <label>
          시작일
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          종료일 (이 날까지 포함)
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
        </label>
        {props.rooms.map((r) => (
          <label key={r.id} className="check-row">
            <input
              type="checkbox"
              checked={picked.includes(r.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((id) => id !== r.id))}
            />
            💬 {r.name}
          </label>
        ))}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose} disabled={working}>
          취소
        </button>
        <button type="button" className="primary" onClick={() => void find()} disabled={working}>
          {working ? '찾는 중…' : '삭제할 메시지 찾기'}
        </button>
      </div>
    </Modal>
  )
}
