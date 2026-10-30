import { isIOS } from '../download.ts'
import { useMemo, useRef, useState } from 'react'
import { errorMessage } from '../auth.ts'
import { formatPhone, type Customer } from '../customers.ts'
import { saveFile } from '../download.ts'
import {
  columnLabels,
  contactCandidates,
  guessMapping,
  IMPORT_MAX,
  parseVcf,
  readTableFile,
  readText,
  saveCandidates,
  tableCandidates,
  templateCsv,
  withStatus,
  type Candidate,
  type Mapping,
} from '../importCustomers.ts'
import { askPermission, hasPhoneNative, oldAndroidApp, PhoneNative } from '../phone.ts'
import { Modal, toast } from '../ui/dialogs.tsx'

// 📥 고객 한꺼번에 가져오기 창 (처음 셋팅, 화면 11): 엑셀·CSV / 연락처 파일(.vcf) / 갤럭시 폰 연락처
type Source = { kind: 'table'; fileName: string; rows: string[][]; mapping: Mapping } | { kind: 'list'; title: string; items: Omit<Candidate, 'status' | 'key' | 'existing'>[]; pick: boolean }

const STATUS_LABEL: Record<Candidate['status'], string> = {
  new: '새 고객',
  exists: '이미 있음',
  dup: '위와 같은 번호',
  'no-phone': '번호 없음',
  'no-name': '이름 없음',
}
const SHOW_MAX = 300

const isAndroidDevice = /Android/i.test(navigator.userAgent)

export function ImportCustomers({ teamId, customers, onClose }: { teamId: string; customers: Customer[]; onClose: () => void }) {
  const [source, setSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set()) // 폰 연락처: 고른 것만
  const [q, setQ] = useState('')
  const [done, setDone] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const list = useMemo(() => {
    if (!source) return []
    const raw = source.kind === 'table' ? tableCandidates(source.rows, source.mapping) : source.items
    return withStatus(raw, customers)
  }, [source, customers])
  const pickMode = source?.kind === 'list' && source.pick
  const isChosen = (c: Candidate) => c.status === 'new' && (pickMode ? picked.has(c.key) : !unchecked.has(c.key))
  const chosen = list.filter(isChosen)
  const counts = list.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {})
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return list.filter(
      (c) =>
        !words ||
        c.name.toLowerCase().includes(words) ||
        c.company.toLowerCase().includes(words) ||
        (digits.length >= 3 && c.phones.some((p) => formatPhone(p).replace(/\D/g, '').includes(digits))),
    )
  }, [list, q])

  function reset(next: Source) {
    setSource(next)
    setUnchecked(new Set())
    setPicked(new Set())
    setQ('')
  }

  async function openFile(file: File) {
    setBusy('파일을 읽는 중…')
    try {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.vcf')) {
        const items = parseVcf(await readText(file))
        if (items.length === 0) throw new Error('연락처를 찾지 못했어요. 연락처 앱에서 내보낸 .vcf 파일인지 확인해 주세요.')
        reset({ kind: 'list', title: file.name, items, pick: false })
      } else {
        const { rows } = await readTableFile(file)
        if (rows.length === 0) throw new Error('파일에 내용이 없어요.')
        reset({ kind: 'table', fileName: file.name, rows, mapping: guessMapping(rows) })
      }
    } catch (err) {
      toast((err as Error).message || '파일을 읽지 못했어요.', { error: true, long: true })
    } finally {
      setBusy(null)
    }
  }

  async function openPhoneContacts() {
    if (!(await askPermission('contacts'))) return toast('연락처 권한을 허용해 주세요.', { error: true })
    setBusy('폰 연락처를 읽는 중…')
    try {
      const { contacts } = await PhoneNative.contacts()
      reset({ kind: 'list', title: '이 폰 연락처', items: contactCandidates(contacts), pick: true })
    } catch (err) {
      toast(errorMessage(err), { error: true })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (chosen.length === 0) return
    if (chosen.length > IMPORT_MAX) return toast(`한 번에 ${IMPORT_MAX}명까지 가져올 수 있어요. 나눠서 올려 주세요.`, { error: true, long: true })
    setBusy(`저장하는 중… 0/${chosen.length}`)
    try {
      const n = await saveCandidates(teamId, chosen, (d) => setBusy(`저장하는 중… ${d}/${chosen.length}`))
      setDone(n)
    } catch (err) {
      toast(errorMessage(err), { error: true, long: true })
    } finally {
      setBusy(null)
    }
  }

  function toggle(c: Candidate) {
    if (c.status !== 'new') return
    const flip = (s: Set<string>) => {
      const n = new Set(s)
      if (n.has(c.key)) n.delete(c.key)
      else n.add(c.key)
      return n
    }
    if (pickMode) setPicked(flip)
    else setUnchecked(flip)
  }

  function setAllShown(on: boolean) {
    const keys = shown.filter((c) => c.status === 'new').map((c) => c.key)
    if (pickMode) setPicked((s) => new Set(on ? [...s, ...keys] : [...s].filter((k) => !keys.includes(k))))
    else setUnchecked((s) => new Set(on ? [...s].filter((k) => !keys.includes(k)) : [...s, ...keys]))
  }

  const input = (
    <input
      ref={fileInput}
      type="file"
      accept=".xlsx,.xls,.csv,.txt,.vcf,text/csv,text/vcard,text/x-vcard,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void openFile(f)
      }}
    />
  )

  // ── 끝 ──
  if (done !== null)
    return (
      <Modal onClose={onClose} labelledBy="import-title" className="import-customers">
        <h3 id="import-title">📥 고객 가져오기</h3>
        <p className="import-done">✅ {done}명을 고객으로 추가했어요.</p>
        <p className="muted small">담당자는 나로 들어가 있어요. 고객 화면에서 담당자 넘기기로 바꿀 수 있어요. 이 번호들의 통화·문자는 이제 "업무"로 나뉘어요.</p>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </Modal>
    )

  // ── 1. 어디서 가져올지 ──
  if (!source)
    return (
      <Modal onClose={() => !busy && onClose()} labelledBy="import-title" className="import-customers">
        <h3 id="import-title">📥 고객 한꺼번에 가져오기</h3>
        <p className="muted small">같은 번호의 고객이 이미 있으면 건너뛰어요. 가져오기 전에 목록을 보고 고를 수 있어요.</p>
        <div className="import-sources">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={!!busy}>
            <span aria-hidden="true">📄</span>
            <strong>엑셀 · CSV 파일</strong>
            <small>거래처 목록 엑셀(.xlsx)이나 CSV. 이름·회사·전화번호 열을 저절로 찾아요. PC에서 하면 편해요.</small>
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={!!busy}>
            <span aria-hidden="true">📇</span>
            <strong>연락처 파일 (.vcf)</strong>
            <small>
              {isIOS
                ? '연락처 앱 → 목록을 길게 누르기 → 내보내기.'
                : isAndroidDevice
                  ? '삼성 연락처 → ⋮ → 연락처 관리 → 연락처 가져오기/내보내기 → 내보내기. 또는 구글 연락처 → 내보내기 → vCard.'
                  : '아이폰: 연락처 앱 → 목록을 길게 누르기 → 내보내기. 구글 연락처 → 내보내기 → vCard.'}
            </small>
          </button>
          {hasPhoneNative ? (
            <button type="button" onClick={() => void openPhoneContacts()} disabled={!!busy}>
              <span aria-hidden="true">📱</span>
              <strong>이 폰 연락처에서 고르기</strong>
              <small>폰에 저장된 연락처 중 업무 고객만 체크해서 가져와요.</small>
            </button>
          ) : isIOS ? null : (
            <div className="import-source-note muted small">
              📱 폰 연락처에서 바로 고르기는 {oldAndroidApp ? '갤럭시 앱 새 버전(1.3.0)' : '갤럭시 앱'}에서 할 수 있어요.
            </div>
          )}
        </div>
        <button type="button" className="link" onClick={() => void saveFile(new Blob([templateCsv()], { type: 'text/csv' }), '고객_양식.csv')}>
          📎 엑셀 양식 받기 (이름 · 회사 · 휴대폰 · 전화번호2)
        </button>
        {busy && <p className="notice">{busy}</p>}
        {input}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={!!busy}>
            닫기
          </button>
        </div>
      </Modal>
    )

  // ── 2. 확인하고 고르기 ──
  const labels = source.kind === 'table' ? columnLabels(source.rows, source.mapping.header) : []
  const setMap = (patch: Partial<Mapping>) => source.kind === 'table' && setSource({ ...source, mapping: { ...source.mapping, ...patch } })
  const colSelect = (value: number, onChange: (v: number) => void, label: string) => (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={-1}>없음</option>
        {labels.map((l, j) => (
          <option key={j} value={j}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <Modal onClose={() => !busy && onClose()} labelledBy="import-title" className="import-customers wide" closeOnOutside={false}>
      <h3 id="import-title">📥 {source.kind === 'table' ? source.fileName : source.title}</h3>
      {source.kind === 'table' && (
        <details className="import-map" open={source.mapping.name < 0 || source.mapping.phones.length === 0}>
          <summary>열 맞추기 {source.mapping.header >= 0 ? `(머리줄: ${source.mapping.header + 1}번째 줄)` : '(머리줄 없음)'}</summary>
          <div className="import-map-grid">
            {colSelect(source.mapping.name, (v) => setMap({ name: v }), '이름')}
            {colSelect(source.mapping.company, (v) => setMap({ company: v }), '회사')}
            {colSelect(source.mapping.phones[0] ?? -1, (v) => setMap({ phones: [v, ...source.mapping.phones.slice(1)].filter((j) => j >= 0) }), '전화번호')}
            {colSelect(source.mapping.phones[1] ?? -1, (v) => setMap({ phones: [source.mapping.phones[0] ?? -1, v, ...source.mapping.phones.slice(2)].filter((j) => j >= 0) }), '전화번호 2')}
            <label>
              머리줄
              <select value={source.mapping.header} onChange={(e) => setMap({ header: Number(e.target.value) })}>
                <option value={-1}>없음 (첫 줄부터 고객)</option>
                {source.rows.slice(0, 10).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}번째 줄: {r.filter(Boolean).slice(0, 3).join(', ').slice(0, 30)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      )}
      <p className="import-summary">
        <strong>{chosen.length}명</strong> 가져오기
        <span className="muted small">
          {' '}
          · 새 고객 {counts.new ?? 0}
          {counts.exists ? ` · 이미 있음 ${counts.exists}` : ''}
          {counts.dup ? ` · 겹침 ${counts.dup}` : ''}
          {counts['no-phone'] ? ` · 번호 없음 ${counts['no-phone']}` : ''}
          {counts['no-name'] ? ` · 이름 없음 ${counts['no-name']}` : ''}
        </span>
      </p>
      <div className="import-tools">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 회사, 번호로 찾기" aria-label="찾기" />
        <button type="button" className="ghost" onClick={() => setAllShown(true)}>
          {q ? '찾은 것 ' : ''}모두 선택
        </button>
        <button type="button" className="ghost" onClick={() => setAllShown(false)}>
          모두 해제
        </button>
      </div>
      <ul className="import-list">
        {shown.slice(0, SHOW_MAX).map((c) => (
          <li key={c.key} className={c.status === 'new' ? '' : 'skip'}>
            <label>
              <input type="checkbox" checked={isChosen(c)} disabled={c.status !== 'new'} onChange={() => toggle(c)} />
              <span className="import-who">
                <strong>{c.name || '(이름 없음)'}</strong>
                {c.company && <span className="muted"> · {c.company}</span>}
                <small className="muted">{c.phones.length ? c.phones.map(formatPhone).join(', ') : c.rawPhones || '번호 없음'}</small>
              </span>
              {c.status !== 'new' && (
                <span className={`import-status ${c.status}`}>
                  {STATUS_LABEL[c.status]}
                  {c.existing && c.existing !== c.name ? ` (${c.existing})` : ''}
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {shown.length > SHOW_MAX && <p className="muted small center">{shown.length - SHOW_MAX}명 더 있어요. 찾기로 좁혀 보거나 그대로 가져오세요 (선택은 그대로 적용돼요).</p>}
      {busy && <p className="notice">{busy}</p>}
      {input}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => setSource(null)} disabled={!!busy}>
          ‹ 다시 고르기
        </button>
        <button type="button" className="primary" onClick={() => void save()} disabled={!!busy || chosen.length === 0}>
          {chosen.length}명 가져오기
        </button>
      </div>
    </Modal>
  )
}
