import { useCallback, useEffect, useState } from 'react'
import { api, formatBytes, type RangeResult, type Usage } from '../api.ts'
import { errorMessage } from '../auth.ts'
import type { Team } from '../hooks.ts'

export function UsagePage({ team }: { team: Team }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setUsage(await api.getUsage({ teamId: team.id }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [team.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const ratio = usage ? usage.storage.bytes / usage.storage.freeBytes : 0

  return (
    <div className="page">
      <header className="page-header">
        <span />
        <h2>용량 관리</h2>
        <button type="button" className="ghost" onClick={refresh} disabled={loading}>
          새로고침
        </button>
      </header>
      <div className="page-body">
        {error && <p className="error">{error}</p>}
        {!usage && !error && <p className="center muted">계산하는 중…</p>}
        {usage && (
          <>
            <section className="card">
              <h3>사진 저장 공간</h3>
              <p className="big">
                {formatBytes(usage.storage.bytes)}
                <span className="muted"> / 무료 {formatBytes(usage.storage.freeBytes)}</span>
              </p>
              <div className={ratio > 0.8 ? 'meter warn' : 'meter'} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
                <div style={{ width: `${Math.min(100, Math.max(ratio * 100, 0.5))}%` }} />
              </div>
              <p className="muted small">
                사진 {usage.storage.photos.toLocaleString()}장 · 무료 공간의 {(ratio * 100).toFixed(1)}% 사용
                {ratio > 0.8 && ' · 무료 한도에 가까워졌습니다. 오래된 채팅을 정리하세요.'}
              </p>
            </section>

            <section className="card">
              <h3>저장된 데이터</h3>
              <dl className="stats">
                <div><dt>채팅 메시지</dt><dd>{usage.counts.messages.toLocaleString()}개</dd></div>
                <div><dt>사진이 있는 메시지</dt><dd>{usage.counts.photoMessages.toLocaleString()}개</dd></div>
                <div><dt>고객</dt><dd>{usage.counts.customers.toLocaleString()}명</dd></div>
                <div><dt>팀원</dt><dd>{usage.counts.members.toLocaleString()}명</dd></div>
              </dl>
            </section>

            {usage.storage.byMonth.length > 0 && (
              <section className="card">
                <h3>월별 사진 용량</h3>
                <ul className="months">
                  {usage.storage.byMonth.map((m) => (
                    <li key={m.month}>
                      <span>{m.month.replace('-', '년 ')}월</span>
                      <span className="muted">{m.photos}장</span>
                      <strong>{formatBytes(m.bytes)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <RangeDelete teamId={team.id} onDeleted={refresh} />

        <p className="muted small">
          무료 사용량(사진 5GB, 하루 읽기 5만 건 등)은 Firebase 프로젝트 전체 기준입니다.
        </p>
      </div>
    </div>
  )
}

function dateInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function monthsAgo(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return dateInput(d)
}

// 날짜 입력은 그 날 0시(기기 시간) 기준. 끝 날짜는 그 날 하루 전체를 포함한다.
function toRange(from: string, to: string) {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : 0
  const end = new Date(`${to}T00:00:00`)
  end.setDate(end.getDate() + 1)
  return { from: start, to: end.getTime() }
}

function RangeDelete({ teamId, onDeleted }: { teamId: string; onDeleted: () => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(monthsAgo(6))
  const [preview, setPreview] = useState<RangeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setPreview(null), [from, to])

  function quick(months: number) {
    setFrom('')
    setTo(monthsAgo(months))
  }

  async function check() {
    setBusy(true)
    setError('')
    try {
      setPreview(await api.deleteMessagesInRange({ teamId, ...toRange(from, to), dryRun: true }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!preview) return
    const label = `${from || '처음'} ~ ${to}`
    if (!confirm(`${label} 채팅 ${preview.messages}개와 사진 ${preview.photos}장을 영구 삭제할까요?\n되돌릴 수 없습니다.`)) return
    setBusy(true)
    setError('')
    try {
      const result = await api.deleteMessagesInRange({ teamId, ...toRange(from, to), dryRun: false })
      alert(`채팅 ${result.messages}개, 사진 ${result.photos}장을 삭제했습니다.`)
      setPreview(null)
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card form">
      <h3>기간별 채팅 삭제</h3>
      <p className="muted small">선택한 기간의 채팅과 사진을 팀 전체에서 영구 삭제합니다.</p>
      <div className="chips">
        <button type="button" className="chip" onClick={() => quick(3)}>3개월 이전</button>
        <button type="button" className="chip" onClick={() => quick(6)}>6개월 이전</button>
        <button type="button" className="chip" onClick={() => quick(12)}>1년 이전</button>
      </div>
      <div className="date-range">
        <label>
          시작 (비우면 처음부터)
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          끝 (이 날 포함)
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {preview ? (
        <>
          <p className="notice">
            채팅 {preview.messages.toLocaleString()}개, 사진 {preview.photos.toLocaleString()}장
            {preview.bytes > 0 && ` (약 ${formatBytes(preview.bytes)})`}이 삭제됩니다.
          </p>
          <button type="button" className="danger-button" onClick={remove} disabled={busy || preview.messages === 0}>
            {busy ? '삭제하는 중…' : '영구 삭제'}
          </button>
        </>
      ) : (
        <button type="button" onClick={check} disabled={busy || !to}>
          {busy ? '확인하는 중…' : '삭제할 양 확인'}
        </button>
      )}
    </section>
  )
}
