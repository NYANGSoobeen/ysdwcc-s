import { deleteField, doc, onSnapshot, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { auth, db } from '../firebase.ts'

// 📋 근무표 (엑셀에서 읽어 만든 표). 팀마다 달마다 문서 하나:
// teams/{teamId}/roster/{YYYY-MM} = { month, codes: { uid: { '1': 'B0', '3': '휴' } }, fileName, updatedAt, updatedBy }
// - 엑셀(직원 세로 · 날짜 가로)에서 우리 팀원 이름과 맞는 줄만 가져온다. 맞지 않는 이름은 건너뛴다.
// - 엑셀에 없는 직원(새 직원)은 비워 두고, 다음에 엑셀을 다시 불러오거나 직접 고쳐 넣는다.
// - 휴무(휴)인 날은 갤럭시 앱이 고객 전화를 무음 + 자동 문자 (src/offday.ts).
export type Roster = {
  month: string
  codes: Record<string, Record<string, string>>
  fileName?: string
  updatedAt?: Timestamp | null
  updatedBy?: string
}

export const OFF = '휴'
export const WORK = 'B0'

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export const dateKey = (d: Date) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`
export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number)
  return monthKey(new Date(y, m - 1 + n, 1))
}
export function daysIn(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
export function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return `${y}년 ${m}월`
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
export function weekday(month: string, day: number) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, day).getDay()
}
export const weekdayLabel = (n: number) => WEEK[n]

export const rosterRef = (teamId: string, month: string) => doc(db, 'teams', teamId, 'roster', month)

export function useRoster(teamId: string, month: string) {
  const [roster, setRoster] = useState<Roster | null | undefined>(undefined)
  useEffect(() => {
    setRoster(undefined)
    return onSnapshot(
      rosterRef(teamId, month),
      (snap) => setRoster(snap.exists() ? (snap.data() as Roster) : null),
      () => setRoster(null),
    )
  }, [teamId, month])
  return roster
}

// 엑셀을 불러오면 그 달을 통째로 바꾼다 (엑셀에 없는 사람은 비워짐).
export async function saveRoster(teamId: string, month: string, codes: Roster['codes'], fileName: string) {
  await setDoc(rosterRef(teamId, month), { month, codes, fileName, updatedAt: serverTimestamp(), updatedBy: auth.currentUser!.uid })
}

// 한 칸 고치기 (code가 ''이면 지움)
export async function setCode(teamId: string, month: string, uid: string, day: number, code: string, exists: boolean) {
  const by = { updatedAt: serverTimestamp(), updatedBy: auth.currentUser!.uid }
  if (!exists) {
    await setDoc(rosterRef(teamId, month), { month, codes: code ? { [uid]: { [day]: code } } : {}, fileName: '', ...by })
    return
  }
  await updateDoc(rosterRef(teamId, month), { [`codes.${uid}.${day}`]: code ? code : deleteField(), ...by })
}

// ── 엑셀 읽기 ──
// 칸 글자를 근무 코드로: B0/bo/B O → B0, 휴/휴무/OFF → 휴, 나머지는 그대로(6자까지)
export function normalizeCode(raw: string) {
  const s = raw.replace(/\s+/g, '').trim()
  if (!s) return ''
  if (/^b[0o]$/i.test(s)) return WORK
  if (/^(휴|휴무|휴일|off|오프|x)$/i.test(s)) return OFF
  return s.slice(0, 6)
}

const normName = (s: string) => s.replace(/[\s()·.,-]/g, '').toLowerCase()

// 날짜 머리줄 칸: "1", "1일", "11/3", "2026. 11. 3.", "11-03"
function dayOf(cell: string): { day: number; month?: number; year?: number } | null {
  const s = cell.trim()
  let m = s.match(/^(\d{1,2})\s*일?$/)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 31 ? { day: Number(m[1]) } : null
  m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(\(.\))?$/)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  m = s.match(/^(\d{1,2})\s*[/.\-월]\s*(\d{1,2})\s*일?\s*(\(.\))?$/)
  if (m) return { month: Number(m[1]), day: Number(m[2]) }
  return null
}

export type RosterImport = {
  month: string
  monthFound: boolean // 파일에서 달을 찾았는지 (못 찾으면 화면에서 고른 달)
  days: number // 찾은 날짜 칸 수
  matched: { uid: string; name: string; codes: Record<string, string>; offs: number; works: number }[]
  unmatched: string[] // 우리 팀에 없는 이름 (건너뜀)
  ambiguous: string[] // 같은 이름 팀원이 둘 이상 (건너뜀)
  missing: { uid: string; name: string }[] // 엑셀에 없는 팀원 (비워 둠)
}

export function parseRosterTable(rows: string[][], members: { uid: string; name: string }[], fallbackMonth: string): RosterImport {
  // 1) 날짜 머리줄: 앞 15줄 중 날짜 칸이 가장 많은 줄
  let header = -1
  let dayCols = new Map<number, number>()
  let found: { month?: number; year?: number } = {}
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = new Map<number, number>()
    let info: { month?: number; year?: number } = {}
    rows[i].forEach((c, j) => {
      const d = dayOf(c)
      if (d) {
        cols.set(j, d.day)
        if (d.month) info = { month: d.month, year: d.year ?? info.year }
      }
    })
    if (cols.size >= 5 && cols.size > dayCols.size) {
      header = i
      dayCols = cols
      found = info
    }
  }
  if (header < 0) throw new Error('날짜 줄(1, 2, 3 … 31)을 찾지 못했어요. 직원 이름이 세로(왼쪽 열), 날짜가 가로(위쪽 줄)인 근무표인지 확인해 주세요.')

  // 2) 달: 날짜 칸에 달이 있으면 그것, 없으면 위쪽 글자("2026년 11월"), 그것도 없으면 화면에서 고른 달
  let month = ''
  if (found.month) month = `${found.year ?? Number(fallbackMonth.slice(0, 4))}-${String(found.month).padStart(2, '0')}`
  if (!month) {
    for (const r of rows.slice(0, header + 1)) {
      for (const c of r) {
        const m = c.match(/(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*월?/) ?? c.match(/(?:^|\D)(\d{1,2})\s*월/)
        if (m && m.length === 3) month = `${m[1]}-${m[2].padStart(2, '0')}`
        else if (m) month = `${fallbackMonth.slice(0, 4)}-${m[1].padStart(2, '0')}`
        if (month) break
      }
      if (month) break
    }
  }
  const monthFound = !!month && Number(month.slice(5)) >= 1 && Number(month.slice(5)) <= 12
  if (!monthFound) month = fallbackMonth

  // 3) 이름 열: 날짜가 아닌 열 중 우리 팀원 이름이 가장 많이 맞는 열
  const byName = new Map<string, { uid: string; name: string }[]>()
  for (const m of members) {
    const k = normName(m.name)
    if (k) byName.set(k, [...(byName.get(k) ?? []), m])
  }
  const findMember = (cell: string) => {
    const c = normName(cell)
    if (!c) return null
    if (byName.has(c)) return byName.get(c)!
    // "김지원 주임", "김지원(B조)"처럼 이름 뒤에 몇 글자 붙은 것
    for (const [k, list] of byName) if (c.startsWith(k) && c.length - k.length <= 4) return list
    return null
  }
  const body = rows.slice(header + 1)
  const width = Math.max(0, ...rows.map((r) => r.length))
  let nameCol = -1
  let best = 0
  for (let j = 0; j < width; j++) {
    if (dayCols.has(j)) continue
    const n = body.filter((r) => findMember(r[j] ?? '')).length
    if (n > best) {
      best = n
      nameCol = j
    }
  }
  // 맞는 이름이 하나도 없으면, 첫 날짜 칸 바로 왼쪽의 글자 열을 이름 열로 본다 (건너뛴 이름 목록을 보여 주려고)
  if (nameCol < 0) nameCol = Math.max(0, Math.min(...dayCols.keys()) - 1)

  const matched: RosterImport['matched'] = []
  const unmatched: string[] = []
  const ambiguous: string[] = []
  const seen = new Set<string>()
  for (const r of body) {
    const cell = (r[nameCol] ?? '').trim()
    if (!cell || /^(합계|계|비고|총|인원)/.test(cell) || /^\d+$/.test(cell)) continue
    const hit = findMember(cell)
    if (!hit) {
      if (!unmatched.includes(cell)) unmatched.push(cell)
      continue
    }
    if (hit.length > 1) {
      if (!ambiguous.includes(cell)) ambiguous.push(cell)
      continue
    }
    const m = hit[0]
    if (seen.has(m.uid)) continue // 같은 사람 두 줄이면 첫 줄만
    seen.add(m.uid)
    const codes: Record<string, string> = {}
    for (const [j, day] of dayCols) {
      const code = normalizeCode(r[j] ?? '')
      if (code) codes[day] = code
    }
    const values = Object.values(codes)
    matched.push({ uid: m.uid, name: m.name, codes, offs: values.filter((v) => v === OFF).length, works: values.filter((v) => v === WORK).length })
  }
  const missing = members.filter((m) => !seen.has(m.uid))
  return { month, monthFound, days: dayCols.size, matched, unmatched, ambiguous, missing }
}
