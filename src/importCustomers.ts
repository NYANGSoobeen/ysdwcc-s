import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { isValidPhone, normalizePhone, type Customer } from './customers.ts'
import { auth, db } from './firebase.ts'

// 📥 고객 한꺼번에 가져오기 (처음 셋팅, 화면 11)
// - 엑셀(.xlsx)·CSV·텍스트: 머리줄(이름/회사/전화…)을 찾아 열을 맞추고, 화면에서 바꿀 수 있다.
// - 연락처 파일(.vcf): 아이폰 연락처 앱·구글 연락처에서 내보낸 것.
// - 갤럭시 앱: 폰 연락처에서 골라 오기 (PhonePlugin.contacts).
// 같은 번호의 고객이 팀에 이미 있거나 파일 안에서 겹치면 새로 만들지 않는다 (CLAUDE.md: 같은 번호면 기존 고객).

export type Candidate = {
  key: string
  name: string
  company: string
  phones: string[] // E.164
  rawPhones: string // 화면에 보여 줄 원래 글자
  status: 'new' | 'exists' | 'dup' | 'no-phone' | 'no-name'
  existing?: string // 이미 있는 고객 이름
}

export const IMPORT_MAX = 2000 // 한 번에 (무료 사용량: 하루 쓰기 2만 회)

// ── 표 (엑셀·CSV) ──
export type Table = { rows: string[][]; sheetNames?: string[] }
export type Mapping = { header: number; name: number; company: number; phones: number[] } // -1 = 없음, header -1 = 머리줄 없음

const NAME_RE = /^(이름|성명|성함|고객명|고객 ?이름|담당자|담당자명|성명\(?한글\)?|name|full ?name)$/i
const NAME_LOOSE = /(이름|성명|성함|담당자|name)/i
const COMPANY_RE = /(회사|업체|거래처|상호|소속|기관|법인|직장|company|organization|org)/i
const PHONE_RE = /(전화|휴대|핸드폰|폰|연락처|번호|mobile|phone|tel|cell)/i
const NOT_PHONE_RE = /(팩스|fax|사업자|주민|우편|계좌)/i

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleDateString('ko-KR')
  return String(v).trim()
}

// 한 칸에 번호가 여럿일 수 있다 ("010-1234-5678 / 02-123-4567")
export function phonesIn(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[,/;\n|]|\s{2,}/)) {
    let digits = part.replace(/[^\d+]/g, '')
    if (!digits) continue
    // 엑셀이 숫자로 바꿔 앞 0이 빠진 번호 (1012345678 → 01012345678)
    if (/^1[0-9]{8,9}$/.test(digits)) digits = `0${digits}`
    else if (/^[2-6][0-9]{7,9}$/.test(digits)) digits = `0${digits}`
    const e164 = normalizePhone(digits)
    if (isValidPhone(e164) && !out.includes(e164)) out.push(e164)
  }
  return out
}

const looksPhone = (s: string) => phonesIn(s).length > 0 && s.replace(/[\d\s()+\-./]/g, '').length <= 2

export function guessMapping(rows: string[][]): Mapping {
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length))
  // 머리줄: 앞 10줄 중 이름·전화 같은 말이 있는 줄
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i].map((c) => c.replace(/\s+/g, ' ').trim())
    const phones = r.map((c, j) => (PHONE_RE.test(c) && !NOT_PHONE_RE.test(c) ? j : -1)).filter((j) => j >= 0)
    let name = r.findIndex((c) => NAME_RE.test(c))
    if (name < 0) name = r.findIndex((c) => NAME_LOOSE.test(c) && !COMPANY_RE.test(c))
    const company = r.findIndex((c, j) => j !== name && COMPANY_RE.test(c))
    if (name >= 0 || phones.length > 0) {
      return { header: i, name, company, phones: phones.filter((j) => j !== name && j !== company) }
    }
  }
  // 머리줄이 없으면 내용으로: 번호가 대부분인 열 = 전화, 글자 열 = 이름, 다음 글자 열 = 회사
  const sample = rows.slice(0, 50)
  const phones: number[] = []
  const texts: number[] = []
  for (let j = 0; j < width; j++) {
    const vals = sample.map((r) => r[j] ?? '').filter(Boolean)
    if (vals.length === 0) continue
    if (vals.filter(looksPhone).length / vals.length >= 0.6) phones.push(j)
    else texts.push(j)
  }
  return { header: -1, name: texts[0] ?? -1, company: texts[1] ?? -1, phones }
}

export function columnLabels(rows: string[][], header: number) {
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length))
  return Array.from({ length: width }, (_, j) => {
    const letter = j < 26 ? String.fromCharCode(65 + j) : `${j + 1}번째`
    const title = header >= 0 ? rows[header]?.[j] : rows[0]?.[j]
    return `${letter}열${title ? `: ${title.slice(0, 20)}` : ''}`
  })
}

export function tableCandidates(rows: string[][], m: Mapping) {
  const out: Omit<Candidate, 'status' | 'key' | 'existing'>[] = []
  for (const r of rows.slice(m.header + 1)) {
    const name = m.name >= 0 ? (r[m.name] ?? '').trim() : ''
    const company = m.company >= 0 ? (r[m.company] ?? '').trim() : ''
    const raw = m.phones.map((j) => r[j] ?? '').filter(Boolean)
    if (!name && !company && raw.length === 0) continue // 빈 줄
    out.push({ name: name.slice(0, 50), company: company.slice(0, 80), phones: raw.flatMap(phonesIn).slice(0, 5), rawPhones: raw.join(', ') })
  }
  return out
}

// ── 파일 읽기 ──
export async function readTableFile(file: File): Promise<Table> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    // 줄이 가장 많은 시트를 먼저
    sheets.sort((a, b) => b.data.length - a.data.length)
    return { rows: sheets[0]?.data.map((r) => r.map(cellText)) ?? [], sheetNames: sheets.map((s) => s.sheet) }
  }
  if (lower.endsWith('.xls')) throw new Error('예전 엑셀(.xls) 파일이에요. 엑셀에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 저장한 뒤 올려 주세요.')
  return { rows: parseCsv(await readText(file)) }
}

// 한국어 엑셀이 저장한 CSV는 대부분 EUC-KR(CP949)이다. UTF-8로 읽어 보고 깨지면 EUC-KR로.
export async function readText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

// ── 연락처 파일 (.vcf) ──
export function parseVcf(text: string) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const out: Omit<Candidate, 'status' | 'key' | 'existing'>[] = []
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    let fn = ''
    let n = ''
    let org = ''
    const tels: string[] = []
    for (const line of card.split(/\r?\n/)) {
      const at = line.indexOf(':')
      if (at < 0) continue
      const key = line.slice(0, at).replace(/^item\d+\./i, '')
      const prop = key.split(';')[0].toUpperCase()
      let value = line.slice(at + 1)
      if (/ENCODING=QUOTED-PRINTABLE/i.test(key)) value = decodeQp(value)
      value = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim()
      if (prop === 'FN') fn = value
      else if (prop === 'N') n = value.split(';').slice(0, 2).filter(Boolean).join('')
      else if (prop === 'ORG') org = value.split(';').filter(Boolean).join(' ')
      else if (prop === 'TEL' && !/FAX/i.test(key)) tels.push(value)
    }
    const name = (fn || n).slice(0, 50)
    if (!name && !org && tels.length === 0) continue
    out.push({ name, company: org.slice(0, 80), phones: tels.flatMap(phonesIn).slice(0, 5), rawPhones: tels.join(', ') })
  }
  return out
}

function decodeQp(s: string) {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else if (s[i] !== '=') bytes.push(s.charCodeAt(i))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// ── 폰 연락처 (갤럭시 앱): 같은 사람(이름+회사)의 번호를 한 고객으로 묶는다 ──
export function contactCandidates(list: { name: string; number: string; company?: string }[]) {
  const byPerson = new Map<string, Omit<Candidate, 'status' | 'key' | 'existing'>>()
  for (const c of list) {
    const k = `${c.name}\u0000${c.company ?? ''}`
    const cur = byPerson.get(k) ?? { name: c.name.slice(0, 50), company: (c.company ?? '').slice(0, 80), phones: [], rawPhones: '' }
    for (const p of phonesIn(c.number)) if (!cur.phones.includes(p)) cur.phones.push(p)
    cur.rawPhones = cur.rawPhones ? `${cur.rawPhones}, ${c.number}` : c.number
    byPerson.set(k, cur)
  }
  return [...byPerson.values()]
}

// ── 상태 붙이기: 이미 있는 고객, 파일 안 중복, 번호·이름 없음 ──
export function withStatus(list: Omit<Candidate, 'status' | 'key' | 'existing'>[], existing: Customer[]): Candidate[] {
  const owner = new Map<string, string>()
  for (const c of existing) for (const p of c.phones) owner.set(p, c.name)
  const seen = new Set<string>()
  return list.map((c, i) => {
    const name = c.name || c.company
    let status: Candidate['status'] = 'new'
    let ex: string | undefined
    if (!name) status = 'no-name'
    else if (c.phones.length === 0) status = 'no-phone'
    else if (c.phones.some((p) => owner.has(p))) {
      status = 'exists'
      ex = owner.get(c.phones.find((p) => owner.has(p))!)
    } else if (c.phones.some((p) => seen.has(p))) status = 'dup'
    if (status === 'new') c.phones.forEach((p) => seen.add(p))
    return { ...c, name, key: `${i}`, status, existing: ex }
  })
}

// ── 저장: 400개씩 묶어 쓴다. 담당자는 가져온 사람. ──
export async function saveCandidates(teamId: string, list: Candidate[], onProgress: (done: number) => void) {
  const uid = auth.currentUser!.uid
  let done = 0
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db)
    for (const c of list.slice(i, i + 400)) {
      batch.set(doc(collection(db, 'customers')), {
        teamId,
        name: c.name,
        company: c.company,
        phones: c.phones,
        ownerUid: uid,
        nextContactAt: null,
        nextContactNote: '',
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
    done += Math.min(400, list.length - i)
    onProgress(done)
  }
  return done
}

// 엑셀 양식 (CSV, 엑셀에서 바로 열리게 UTF-8 BOM)
export function templateCsv() {
  return '﻿이름,회사,휴대폰,전화번호2\r\n김고객,한빛상사,010-1234-5678,02-123-4567\r\n'
}
