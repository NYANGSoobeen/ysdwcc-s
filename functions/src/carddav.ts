// 읽기 전용 CardDAV 서버: 아이폰(설정 → 연락처 → 계정)이나 갤럭시(DAVx⁵)에 팀 고객을
// 별도 연락처 계정으로 넣어, 전화가 오면 기본 전화 앱이 고객 이름을 보여 주게 한다.
//
// 경로 (함수 주소 기준)
//   /                       주체(principal)이자 주소록 모음(addressbook-home)
//   /book/                  주소록 하나 ("지원팀 고객")
//   /book/{customerId}.vcf  고객 한 명
//   /.well-known/carddav    → / 로 안내
//
// 접속 정보는 앱에서 발급한다 (carddavTokens/{username}, 비밀번호는 해시만 저장).
// 팀에서 제외되거나 동기화를 끄면 빈 주소록을 돌려줘서, 다음 동기화 때 폰에서 고객 연락처가 사라진다.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore'

export type DavRequest = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

export type DavResponse = { status: number; headers: Record<string, string>; body: string }

// 이름 앞에 붙여, 전화가 왔을 때 업무 전화인지 바로 알아보게 한다.
export const NAME_PREFIX = '[업무] '
const BOOK_NAME = '지원팀 고객'
const REALM = 'Workphone Contacts'
const LAST_USED_INTERVAL_MS = 12 * 3600 * 1000

const XML_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1, 3, addressbook' }

// ── 접속 정보 ────────────────────────────────────────────────

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function randomText(length: number) {
  const bytes = randomBytes(length)
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function newCredentials() {
  return { username: `wp${randomText(10)}`, password: randomText(20) }
}

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}

function header(req: DavRequest, name: string) {
  const v = req.headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

type Session = { uid: string; ref: DocumentReference; disabled: boolean }

async function authenticate(req: DavRequest): Promise<Session | null> {
  const auth = header(req, 'authorization') ?? ''
  if (!auth.startsWith('Basic ')) return null
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep < 1) return null
  const username = decoded.slice(0, sep)
  const password = decoded.slice(sep + 1)
  if (!/^[a-z0-9]{4,40}$/.test(username)) return null

  const ref = getFirestore().doc(`carddavTokens/${username}`)
  const snap = await ref.get()
  if (!snap.exists) return null
  const expected = Buffer.from(String(snap.get('secretHash')), 'hex')
  const actual = Buffer.from(hashSecret(password), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  // 마지막 사용 시각은 반나절에 한 번만 기록해 쓰기 횟수를 아낀다.
  const lastUsed = snap.get('lastUsedAt')?.toMillis?.() ?? 0
  if (Date.now() - lastUsed > LAST_USED_INTERVAL_MS) {
    await ref.update({ lastUsedAt: FieldValue.serverTimestamp() })
  }
  return { uid: snap.get('uid'), ref, disabled: snap.get('disabled') === true }
}

// ── 주소록 내용 ──────────────────────────────────────────────

// 이 사람이 지금 속한 팀들. 제외됐거나 계정이 지워졌으면 빈 목록.
async function memberTeams(session: Session) {
  if (session.disabled) return []
  const db = getFirestore()
  const user = await db.doc(`users/${session.uid}`).get()
  const teamIds = (user.get('teamIds') ?? []) as string[]
  if (teamIds.length === 0) return []
  const teams = await db.getAll(...teamIds.map((id) => db.doc(`teams/${id}`)))
  return teams
    .filter((t) => t.exists && t.get(`members.${session.uid}`))
    .map((t) => ({ id: t.id, version: Number(t.get('contactsVersion') ?? 0) }))
}

// 주소록이 바뀌었는지 폰이 확인하는 값. 고객이 바뀌면 팀의 contactsVersion이 올라간다.
function ctagOf(teams: { id: string; version: number }[]) {
  const key = JSON.stringify(teams.map((t) => [t.id, t.version]).sort())
  return `"${createHash('sha1').update(key).digest('hex')}"`
}

type Card = { id: string; vcard: string; etag: string }

async function loadCards(teams: { id: string }[]): Promise<Card[]> {
  const db = getFirestore()
  const cards: Card[] = []
  for (let i = 0; i < teams.length; i += 30) {
    const ids = teams.slice(i, i + 30).map((t) => t.id)
    const snap = await db.collection('customers').where('teamId', 'in', ids).get()
    for (const doc of snap.docs) {
      const vcard = toVCard(doc.id, doc.data())
      cards.push({ id: doc.id, vcard, etag: `"${createHash('sha1').update(vcard).digest('hex')}"` })
    }
  }
  return cards.sort((a, b) => a.id.localeCompare(b.id))
}

async function loadCard(teams: { id: string }[], id: string): Promise<Card | null> {
  const doc = await getFirestore().doc(`customers/${id}`).get()
  if (!doc.exists || !teams.some((t) => t.id === doc.get('teamId'))) return null
  const vcard = toVCard(doc.id, doc.data()!)
  return { id: doc.id, vcard, etag: `"${createHash('sha1').update(vcard).digest('hex')}"` }
}

function escapeValue(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

export function toVCard(id: string, data: FirebaseFirestore.DocumentData) {
  const name = `${NAME_PREFIX}${String(data.name ?? '').trim() || '이름 없음'}`
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${id}`,
    `FN:${escapeValue(name)}`,
    // 한국 이름은 성/이름을 나누지 않고 통째로 넣어야 폰에서 그대로 보인다.
    `N:${escapeValue(name)};;;;`,
  ]
  if (data.company) lines.push(`ORG:${escapeValue(String(data.company))}`)
  for (const phone of (data.phones ?? []) as string[]) lines.push(`TEL;TYPE=CELL:${phone}`)
  lines.push('CATEGORIES:업무')
  lines.push(`NOTE:${escapeValue('양산동원 지원팀 앱에서 동기화한 연락처입니다. 수정은 앱에서 하세요.')}`)
  lines.push('END:VCARD')
  return lines.join('\r\n') + '\r\n'
}

// ── 경로 ─────────────────────────────────────────────────────

type Route = { prefix: string; kind: 'root' | 'book' | 'card' | 'wellknown' | 'unknown'; cardId?: string }

// 함수가 어떤 주소 아래에서 호출되든(에뮬레이터, run.app, 다른 경로) 같은 구조로 동작하게 한다.
export function parsePath(rawPath: string): Route {
  const path = decodeURIComponent(rawPath.split('?')[0])
  const wellKnown = path.match(/^(.*)\/\.well-known\/carddav\/?$/)
  if (wellKnown) return { prefix: wellKnown[1], kind: 'wellknown' }
  const card = path.match(/^(.*)\/book\/([A-Za-z0-9_-]+)\.vcf$/)
  if (card) return { prefix: card[1], kind: 'card', cardId: card[2] }
  const book = path.match(/^(.*)\/book\/?$/)
  if (book) return { prefix: book[1], kind: 'book' }
  if (/\/book\//.test(path)) return { prefix: '', kind: 'unknown' }
  return { prefix: path.replace(/\/+$/, ''), kind: 'root' }
}

// ── XML ──────────────────────────────────────────────────────

function xmlEscape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function multistatus(responses: string[]) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">\n' +
    responses.join('\n') +
    '\n</d:multistatus>'
  )
}

function response(href: string, props: string) {
  return (
    `<d:response><d:href>${xmlEscape(href)}</d:href>` +
    `<d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>` +
    '</d:response>'
  )
}

function notFound(href: string) {
  return `<d:response><d:href>${xmlEscape(href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
}

const READ_ONLY_PRIVILEGES =
  '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>'

function rootProps(prefix: string) {
  const self = `${prefix}/`
  return (
    '<d:resourcetype><d:collection/><d:principal/></d:resourcetype>' +
    `<d:displayname>양산동원 지원팀</d:displayname>` +
    `<d:current-user-principal><d:href>${xmlEscape(self)}</d:href></d:current-user-principal>` +
    `<d:principal-URL><d:href>${xmlEscape(self)}</d:href></d:principal-URL>` +
    `<card:addressbook-home-set><d:href>${xmlEscape(self)}</d:href></card:addressbook-home-set>` +
    READ_ONLY_PRIVILEGES
  )
}

function bookProps(prefix: string, ctag: string) {
  return (
    '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>' +
    `<d:displayname>${BOOK_NAME}</d:displayname>` +
    `<cs:getctag>${xmlEscape(ctag)}</cs:getctag>` +
    `<d:getetag>${xmlEscape(ctag)}</d:getetag>` +
    `<d:current-user-principal><d:href>${xmlEscape(`${prefix}/`)}</d:href></d:current-user-principal>` +
    '<d:supported-report-set>' +
    '<d:supported-report><d:report><card:addressbook-multiget/></d:report></d:supported-report>' +
    '<d:supported-report><d:report><card:addressbook-query/></d:report></d:supported-report>' +
    '</d:supported-report-set>' +
    '<card:supported-address-data><card:address-data-type content-type="text/vcard" version="3.0"/></card:supported-address-data>' +
    READ_ONLY_PRIVILEGES
  )
}

function cardProps(card: Card, withData: boolean) {
  return (
    '<d:resourcetype/>' +
    `<d:getetag>${xmlEscape(card.etag)}</d:getetag>` +
    '<d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype>' +
    (withData ? `<card:address-data>${xmlEscape(card.vcard)}</card:address-data>` : '')
  )
}

// REPORT addressbook-multiget에서 요청한 주소들을 꺼낸다.
function requestedHrefs(body: string) {
  return [...body.matchAll(/<(?:[A-Za-z0-9_-]+:)?href>([^<]+)<\/(?:[A-Za-z0-9_-]+:)?href>/g)].map((m) =>
    decodeURIComponent(m[1].trim()),
  )
}

// ── 요청 처리 ────────────────────────────────────────────────

function reply(status: number, body = '', headers: Record<string, string> = {}): DavResponse {
  return { status, headers, body }
}

export async function handleCardDav(req: DavRequest): Promise<DavResponse> {
  const method = req.method.toUpperCase()
  const route = parsePath(req.path)
  const { prefix } = route
  const bookHref = `${prefix}/book/`
  const cardHref = (id: string) => `${prefix}/book/${id}.vcf`

  if (method === 'OPTIONS') {
    return reply(200, '', { DAV: '1, 3, addressbook', Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT' })
  }
  if (route.kind === 'wellknown') return reply(301, '', { Location: `${prefix}/` })

  const session = await authenticate(req)
  if (!session) {
    return reply(401, '로그인이 필요합니다.', {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
    })
  }

  if (!['GET', 'HEAD', 'PROPFIND', 'REPORT'].includes(method)) {
    return reply(403, '지원팀 연락처는 읽기 전용입니다. 수정은 앱에서 하세요.', {
      'Content-Type': 'text/plain; charset=utf-8',
    })
  }
  if (route.kind === 'unknown') return reply(404)

  const teams = await memberTeams(session)
  const ctag = ctagOf(teams)
  const depth = header(req, 'depth') ?? '0'

  if (method === 'PROPFIND') {
    if (route.kind === 'root') {
      const items = [response(`${prefix}/`, rootProps(prefix))]
      if (depth !== '0') items.push(response(bookHref, bookProps(prefix, ctag)))
      return reply(207, multistatus(items), XML_HEADERS)
    }
    if (route.kind === 'book') {
      const items = [response(bookHref, bookProps(prefix, ctag))]
      if (depth !== '0') {
        for (const card of await loadCards(teams)) items.push(response(cardHref(card.id), cardProps(card, false)))
      }
      return reply(207, multistatus(items), XML_HEADERS)
    }
    const card = await loadCard(teams, route.cardId!)
    if (!card) return reply(404)
    return reply(207, multistatus([response(cardHref(card.id), cardProps(card, false))]), XML_HEADERS)
  }

  if (method === 'REPORT') {
    if (route.kind !== 'book') return reply(404)
    const cards = await loadCards(teams)
    if (/addressbook-multiget/.test(req.body)) {
      const byHref = new Map(cards.map((c) => [cardHref(c.id), c]))
      const items = requestedHrefs(req.body).map((href) => {
        // 폰이 전체 주소(https://…)로 요청해도 경로만 비교한다.
        const path = href.replace(/^https?:\/\/[^/]+/, '')
        const card = byHref.get(path)
        return card ? response(href, cardProps(card, true)) : notFound(href)
      })
      return reply(207, multistatus(items), XML_HEADERS)
    }
    if (/addressbook-query/.test(req.body)) {
      return reply(207, multistatus(cards.map((c) => response(cardHref(c.id), cardProps(c, true)))), XML_HEADERS)
    }
    return reply(501, '지원하지 않는 요청입니다.')
  }

  // GET, HEAD
  if (route.kind === 'card') {
    const card = await loadCard(teams, route.cardId!)
    if (!card) return reply(404)
    return reply(200, method === 'HEAD' ? '' : card.vcard, {
      'Content-Type': 'text/vcard; charset=utf-8',
      ETag: card.etag,
    })
  }
  return reply(200, method === 'HEAD' ? '' : '양산동원 지원팀 연락처 서버입니다.', { 'Content-Type': 'text/plain; charset=utf-8' })
}
