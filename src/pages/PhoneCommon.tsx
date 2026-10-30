import { errorMessage } from '../auth.ts'
import { createCustomer, findCustomerByPhone, formatPhone, normalizePhone, type Customer } from '../customers.ts'
import { APK_URL } from '../native.ts'
import { askPermission, phoneKey, PhoneNative, prettyNumber, type DeviceContact } from '../phone.ts'
import { askText, tell, toast } from '../ui/dialogs.tsx'
import { CenteredGlyph } from '../ui/inkCenter.tsx'

// 전화·문자 화면이 같이 쓰는 것들

// 이름·번호로 사람 찾기 (업무 고객 먼저, 그다음 폰 연락처)
export type Person = { name: string; number: string; customer?: Customer }
export function searchPeople(q: string, customers: Customer[], contacts: DeviceContact[], max = 30): Person[] {
  const words = q.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  if (!words && !digits) return []
  const out: Person[] = []
  const seen = new Set<string>()
  const add = (p: Person) => {
    const key = phoneKey(p.number)
    if (seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  const hit = (name: string, number: string) =>
    (words && !/^[\d\s+-]+$/.test(words) && name.toLowerCase().includes(words)) ||
    (digits.length >= 2 && (number.replace(/\D/g, '').includes(digits) || prettyNumber(number).replace(/\D/g, '').includes(digits)))
  for (const c of customers) for (const p of c.phones) if (hit(c.name, formatPhone(p))) add({ name: c.name, number: p, customer: c })
  for (const c of contacts) if (hit(c.name, c.number)) add({ name: c.name, number: c.number })
  return out.slice(0, max)
}

// 처음 보는 번호를 고객으로 추가 (같은 번호 고객이 있으면 그 고객으로 연결)
export async function addAsCustomer(teamId: string, number: string, suggestedName = '') {
  const e164 = normalizePhone(number)
  if (!e164) return null
  const existing = await findCustomerByPhone(teamId, [e164]).catch(() => null)
  if (existing) {
    toast(`이미 고객이에요: ${existing.name}`)
    return existing.id
  }
  const name = await askText({
    title: '고객으로 추가',
    message: `${formatPhone(e164)} 번호를 업무 고객으로 추가해요. 팀원과 함께 보고, 이 번호의 통화·문자는 "업무"로 나뉘어요.`,
    label: '이름',
    value: suggestedName,
    ok: '추가',
    required: '이름을 넣어 주세요.',
  })
  if (!name) return null
  try {
    const id = await createCustomer(teamId, { name: name.trim(), company: '', phones: [e164] })
    toast(`${name.trim()}님을 고객으로 추가했어요.`)
    return id
  } catch (err) {
    toast(errorMessage(err), { error: true })
    return null
  }
}

export async function copyNumber(number: string) {
  try {
    await navigator.clipboard.writeText(prettyNumber(number))
    toast('번호를 복사했어요.')
  } catch {
    toast('복사하지 못했어요.', { error: true })
  }
}

// 사람 동그라미: 업무 고객은 주색, 개인은 회색, 모르는 번호는 👤
export function PersonDot({ name, work }: { name?: string; work: boolean }) {
  return (
    <span className={work ? 'person-dot work' : 'person-dot'} aria-hidden="true">
      <CenteredGlyph text={name ? name.slice(0, 1) : '👤'} />
    </span>
  )
}

// 갤럭시 앱 권한 안내 (통화 기록, 문자, 연락처)
export function PermissionCard({ kind, what, granted }: { kind: 'calls' | 'sms' | 'contacts'; what: string; granted: boolean }) {
  if (granted) return null
  async function ask() {
    if (await askPermission(kind)) return
    await tell({
      title: '권한이 막혀 있어요',
      message:
        '설정에서 직접 허용해 주세요.\n\n1. 아래 "설정 열기" → 권한\n2. 권한이 회색으로 막혀 있으면: 오른쪽 위 ⋮ → "제한된 설정 허용" 후 다시 권한\n\n(안드로이드는 Play 스토어 밖에서 받은 앱의 통화 기록·문자 권한을 이렇게 한 번 더 확인해요.)',
      ok: '설정 열기',
    })
    void PhoneNative.openSettings()
  }
  return (
    <section className="card phone-perm">
      <p>
        <strong>{what}</strong>을(를) 보려면 권한이 필요해요.
      </p>
      <p className="muted small">이 폰 안에서만 읽고, 서버나 팀원에게는 올리지 않아요.</p>
      <button type="button" className="primary" onClick={() => void ask()}>
        권한 허용하기
      </button>
    </section>
  )
}

export function OldAppCard() {
  return (
    <section className="card phone-perm">
      <p>
        <strong>갤럭시 앱을 새 버전(1.3.0)으로 업데이트</strong>하면 이 폰의 통화 기록과 문자를 여기서 바로 보고, 문자도 보낼 수 있어요.
      </p>
      <a className="button primary" href={APK_URL}>
        새 버전 받기
      </a>
    </section>
  )
}
