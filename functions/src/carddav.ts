// 읽기 전용 CardDAV 서버: 아이폰(설정 → 연락처 → 계정)이나 갤럭시(DAVx⁵)에 팀 고객을
// 별도 연락처 계정으로 넣어, 전화가 오면 기본 전화 앱이 고객 이름을 보여 주게 한다.
//
// 경로 (함수 주소 기준)
//   /                       주소록 모음(addressbook-home). current-user-principal → /principal/
//   /principal/             나(principal). 아이폰은 처음 주소(/)와 주체 주소가 같으면 다음 단계로 안 넘어가고
//                           같은 질문만 되풀이했다(2026-11-05 점검 기록: PROPFIND / ×6 후 멈춤) → 따로 둔다.
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
const LAST_USED_INTERVAL_MS = 30 * 60 * 1000

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

type Session = { uid: string; username: string; ref: DocumentReference; disabled: boolean; lastUsed: number; createdAt: number }

async function authenticate(req: DavRequest): Promise<Session | null> {
  const auth = header(req, 'authorization') ?? ''
  if (!auth.startsWith('Basic ')) return null
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
  const sep = decoded.indexOf(':')
  if (sep < 1) return null
  return checkLogin(decoded.slice(0, sep), decoded.slice(sep + 1))
}

async function checkLogin(username: string, password: string): Promise<Session | null> {
  if (!/^[a-z0-9]{4,40}$/.test(username)) return null

  const ref = getFirestore().doc(`carddavTokens/${username}`)
  const snap = await ref.get()
  if (!snap.exists) return null
  const expected = Buffer.from(String(snap.get('secretHash')), 'hex')
  const actual = Buffer.from(hashSecret(password), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  const lastUsed = snap.get('lastUsedAt')?.toMillis?.() ?? 0
  const createdAt = snap.get('createdAt')?.toMillis?.() ?? 0
  return { uid: snap.get('uid'), username, ref, disabled: snap.get('disabled') === true, lastUsed, createdAt }
}

// 폰이 언제 어디까지 받아 갔는지 남긴다 (2026-11-02 "아이폰 CardDAV 연결했는데 연락처가 안 떠" → 앱 설정 화면에서 확인).
// 연락처를 실제로 받아 갈 때(목록·받기)는 늘, 그 밖(바뀌었는지 확인)은 30분에 한 번만 써서 쓰기 횟수를 아낀다.
async function recordUse(session: Session, req: DavRequest, step: string, count: number | null) {
  const now = Date.now()
  if (count === null && now - session.lastUsed < LAST_USED_INTERVAL_MS) return
  const agent = String(header(req, 'user-agent') ?? '').slice(0, 120)
  const db = getFirestore()
  await Promise.all([
    session.ref.update({ lastUsedAt: FieldValue.serverTimestamp() }),
    db.doc(`users/${session.uid}/private/contactsSync`).get().then((d) =>
      // 지금 쓰는 접속 정보일 때만 (예전 접속 정보로 붙은 폰이 덮어쓰지 않게)
      d.get('username') === session.username
        ? d.ref.set(
            {
              phoneSeenAt: FieldValue.serverTimestamp(),
              phoneStep: step,
              phoneAgent: agent,
              ...(count === null ? {} : { phoneCount: count, phoneCountAt: FieldValue.serverTimestamp() }),
            },
            { merge: true },
          )
        : null,
    ),
  ]).catch((e) => console.error('carddav recordUse', e))
}

// ── 주소록 내용 ──────────────────────────────────────────────

// 이 사람이 지금 속한 팀들. 제외됐거나 계정이 지워졌거나 사용 중지됐으면 빈 목록.
async function memberTeams(session: Session) {
  if (session.disabled) return []
  const db = getFirestore()
  const user = await db.doc(`users/${session.uid}`).get()
  if (user.get('active') === false) return []
  // 최고 관리자는 팀에 속하지 않아도 모든 팀을 보므로 모든 팀의 고객 (2026-11-02: 팀원이 아닌 최고 관리자 아이폰에 연락처가 비어 있었다)
  if (user.get('superAdmin') === true) {
    const all = await db.collection('teams').get()
    return all.docs.map((t) => ({ id: t.id, version: Number(t.get('contactsVersion') ?? 0) }))
  }
  const teamIds = (user.get('teamIds') ?? []) as string[]
  if (teamIds.length === 0) return []
  const teams = await db.getAll(...teamIds.map((id) => db.doc(`teams/${id}`)))
  return teams
    .filter((t) => t.exists && t.get(`members.${session.uid}`))
    .map((t) => ({ id: t.id, version: Number(t.get('contactsVersion') ?? 0) }))
}

// 주소록이 바뀌었는지 폰이 확인하는 값. 고객이 바뀌면 팀의 contactsVersion이 올라간다.
const CTAG_SALT = 'v2'
const syncTokenOf = (ctag: string) => `data:,${ctag.replace(/"/g, '')}`
function ctagOf(teams: { id: string; version: number }[]) {
  // CTAG_SALT: 서버가 보내는 내용이 바뀌었을 때 올리면 폰이 전부 다시 받는다 (v2: 아이폰 multiget 고침)
  const key = CTAG_SALT + JSON.stringify(teams.map((t) => [t.id, t.version]).sort())
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

type Route = { prefix: string; kind: 'root' | 'principal' | 'book' | 'card' | 'wellknown' | 'unknown'; cardId?: string }

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
  const principal = path.match(/^(.*)\/principal\/?$/)
  if (principal) return { prefix: principal[1], kind: 'principal' }
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

const principalHref = (prefix: string) => `${prefix}/principal/`

// 처음 주소(/): 주소록 모음. 나(principal)는 /principal/ 로 따로 알려 준다.
function rootProps(prefix: string) {
  return (
    '<d:resourcetype><d:collection/></d:resourcetype>' +
    `<d:displayname>양산동원 지원팀</d:displayname>` +
    `<d:current-user-principal><d:href>${xmlEscape(principalHref(prefix))}</d:href></d:current-user-principal>` +
    `<card:addressbook-home-set><d:href>${xmlEscape(`${prefix}/`)}</d:href></card:addressbook-home-set>` +
    READ_ONLY_PRIVILEGES
  )
}

// 나(principal): 주소록 모음은 / (아이폰은 여기서 addressbook-home-set을 받아 / 를 Depth 1로 다시 묻는다)
function principalProps(prefix: string, displayName: string) {
  const me = principalHref(prefix)
  return (
    '<d:resourcetype><d:principal/></d:resourcetype>' +
    `<d:displayname>${xmlEscape(displayName)}</d:displayname>` +
    `<d:current-user-principal><d:href>${xmlEscape(me)}</d:href></d:current-user-principal>` +
    `<d:principal-URL><d:href>${xmlEscape(me)}</d:href></d:principal-URL>` +
    `<card:addressbook-home-set><d:href>${xmlEscape(`${prefix}/`)}</d:href></card:addressbook-home-set>` +
    `<d:principal-collection-set><d:href>${xmlEscape(`${prefix}/`)}</d:href></d:principal-collection-set>` +
    READ_ONLY_PRIVILEGES
  )
}

function bookProps(prefix: string, ctag: string) {
  return (
    '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>' +
    `<d:displayname>${BOOK_NAME}</d:displayname>` +
    `<cs:getctag>${xmlEscape(ctag)}</cs:getctag>` +
    // 아이폰은 주소록이 바뀌었는지 sync-token으로 본다 (없으면 처음 받은 빈 목록을 그대로 둠)
    `<d:sync-token>${xmlEscape(syncTokenOf(ctag))}</d:sync-token>` +
    `<d:getetag>${xmlEscape(ctag)}</d:getetag>` +
    // 주소록도 나(principal)는 /principal/ 로 (예전 / 그대로면 아이폰이 주소록을 다시 처음부터 찾으며 맴돌 수 있음)
    `<d:current-user-principal><d:href>${xmlEscape(principalHref(prefix))}</d:href></d:current-user-principal>` +
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
  // 아이폰은 <href xmlns="DAV:">처럼 속성을 붙여 보낸다 → 예전 식은 하나도 못 찾아 빈 답(고객 0명)을 줬다 (2026-11-05)
  return [...body.matchAll(/<(?:[A-Za-z0-9_-]+:)?href(?:\s[^>]*)?>([^<]+)<\/(?:[A-Za-z0-9_-]+:)?href>/g)].map((m) =>
    decodeURIComponent(m[1].trim()),
  )
}

// ── 요청 처리 ────────────────────────────────────────────────

function reply(status: number, body = '', headers: Record<string, string> = {}): DavResponse {
  return { status, headers, body }
}

// 🔍 연결 점검 기록 (2026-11-02, 아이폰이 접속은 하는데 고객 목록을 안 받아 감): 접속 정보를 만든 뒤 1시간 동안
// 폰이 보낸 요청의 종류·물어본 항목 이름·답한 상태만 users/{uid}/private/contactsSync.davLog에 남긴다(최근 60개,
// 고객 내용·암호 없음). 앱 설정 화면에서 복사해 개발자에게 보낸다.
export const DAV_LOG_MS = 60 * 60 * 1000
const DAV_LOG_MAX = 60

function propNames(body: string) {
  const inner = body.match(/<(?:[A-Za-z0-9_-]+:)?prop>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?prop>/)?.[1] ?? ''
  return [...inner.matchAll(/<(?:[A-Za-z0-9_-]+:)?([A-Za-z0-9_-]+)\s*\/?>/g)].map((m) => m[1]).slice(0, 25).join(',')
}

async function appendDavLog(session: Session, req: DavRequest, res: DavResponse) {
  if (session.disabled || Date.now() - session.createdAt > DAV_LOG_MS) return
  const route = parsePath(req.path)
  const body = req.body ?? ''
  const entry = {
    t: Date.now(),
    m: req.method.toUpperCase(),
    k: route.kind,
    p: req.path.replace(/\/book\/[A-Za-z0-9_-]+\.vcf$/, '/book/(card).vcf').slice(0, 80),
    d: String(header(req, 'depth') ?? ''),
    r: body.replace(/<\?[^>]*\?>/g, '').match(/<(?:[A-Za-z0-9_-]+:)?([A-Za-z0-9_-]+)/)?.[1] ?? '',
    q: propNames(body),
    s: res.status,
    n: (res.body.match(/<d:response>/g) ?? []).length,
    ua: String(header(req, 'user-agent') ?? '').slice(0, 60),
  }
  const ref = getFirestore().doc(`users/${session.uid}/private/contactsSync`)
  await getFirestore()
    .runTransaction(async (tx) => {
      const d = await tx.get(ref)
      if (d.get('username') !== session.username) return
      const log = ((d.get('davLog') ?? []) as unknown[]).slice(-(DAV_LOG_MAX - 1))
      tx.set(ref, { davLog: [...log, entry] }, { merge: true })
    })
    .catch((e) => console.error('carddav log', e))
}

export async function handleCardDav(req: DavRequest): Promise<DavResponse> {
  const ctx: { session?: Session } = {}
  const res = await handleRequest(req, ctx)
  if (ctx.session) await appendDavLog(ctx.session, req, res)
  return res
}

// 📲 아이폰 "한 번에 설정하기" (2026-11-05): 앱이 접속 정보를 폼(POST)으로 보내면, 맞는지 확인한 뒤
// 구성 프로파일(.mobileconfig)을 돌려준다. 앱 안에서 파일을 만들어 열면(blob·data:) 사파리가
// "프로파일 다운로드" 안내를 안 띄우거나 허용 뒤 아무 일이 없었다 → 서버 응답으로 받아야 설치 화면이 뜬다.
// 암호는 저장하지 않고 이 응답에만 담긴다 (HTTPS, 캐시 금지).
async function profileResponse(req: DavRequest): Promise<DavResponse> {
  const form = new URLSearchParams(req.body)
  const username = form.get('u') ?? ''
  const password = form.get('p') ?? ''
  const session = await checkLogin(username, password)
  if (!session || session.disabled) {
    return reply(403, '접속 정보가 맞지 않아요. 지원팀 앱에서 접속 정보를 새로 만든 뒤 다시 눌러 주세요.', {
      'Content-Type': 'text/plain; charset=utf-8',
    })
  }
  const host = String(header(req, 'x-forwarded-host') ?? header(req, 'host') ?? '').split(',')[0].trim()
  const prefix = parsePath(req.path.replace(/\/profile\/?$/, '/')).prefix
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const uuid = () => randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toUpperCase()
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>CardDAVAccountDescription</key><string>지원팀 고객</string>
      <key>CardDAVHostName</key><string>${esc(host)}</string>
      <key>CardDAVPort</key><integer>443</integer>
      <key>CardDAVPrincipalURL</key><string>${esc(`${prefix}/principal/`)}</string>
      <key>CardDAVUseSSL</key><true/>
      <key>CardDAVUsername</key><string>${esc(username)}</string>
      <key>CardDAVPassword</key><string>${esc(password)}</string>
      <key>PayloadDisplayName</key><string>지원팀 고객 연락처</string>
      <key>PayloadIdentifier</key><string>kr.yangsan.support.carddav</string>
      <key>PayloadType</key><string>com.apple.carddav.account</string>
      <key>PayloadUUID</key><string>${uuid()}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key><string>걸려 온 전화에 고객 이름("[업무] 이름")을 보여 주는 지원팀 연락처 계정</string>
  <key>PayloadDisplayName</key><string>양산동원지원팀 고객 연락처</string>
  <key>PayloadIdentifier</key><string>kr.yangsan.support.profile</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid()}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`
  return reply(200, xml, {
    'Content-Type': 'application/x-apple-aspen-config; charset=utf-8',
    // attachment 로 보내면 사파리가 "파일" 앱 다운로드 폴더에 넣기만 하고 설치 화면으로 안 넘겼다(2026-11-05) → inline
    'Content-Disposition': 'inline; filename="yangsan-support.mobileconfig"',
    'Cache-Control': 'no-store',
  })
}

async function handleRequest(req: DavRequest, ctx: { session?: Session }): Promise<DavResponse> {
  const method = req.method.toUpperCase()
  if (method === 'POST' && /\/profile\/?$/.test(req.path.split('?')[0])) return profileResponse(req)
  const route = parsePath(req.path)
  const { prefix } = route
  const bookHref = `${prefix}/book/`
  const cardHref = (id: string) => `${prefix}/book/${id}.vcf`

  if (method === 'OPTIONS') {
    return reply(200, '', { DAV: '1, 3, addressbook', Allow: 'OPTIONS, GET, HEAD, PROPFIND, REPORT' })
  }
  if (route.kind === 'wellknown') return reply(301, '', { Location: `${prefix}/` })

  const session = await authenticate(req)
  if (session) ctx.session = session
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
  const report = method === 'REPORT' ? (req.body.match(/<(?:[A-Za-z0-9_-]+:)?(addressbook-multiget|addressbook-query|sync-collection)\b/)?.[1] ?? 'other') : ''
  // 무엇을 물었는지만 남긴다 (고객 내용·암호는 안 남김) → 폰이 어디서 멈추는지 Cloud Logging에서 확인
  console.log('carddav', JSON.stringify({ method, kind: route.kind, depth, report, teams: teams.length, ua: String(header(req, 'user-agent') ?? '').slice(0, 80) }))

  if (method === 'PROPFIND') {
    if (route.kind === 'root') {
      const items = [response(`${prefix}/`, rootProps(prefix))]
      if (depth !== '0') items.push(response(bookHref, bookProps(prefix, ctag)))
      await recordUse(session, req, 'find', null)
      return reply(207, multistatus(items), XML_HEADERS)
    }
    if (route.kind === 'principal') {
      await recordUse(session, req, 'find', null)
      return reply(207, multistatus([response(principalHref(prefix), principalProps(prefix, '양산동원 지원팀'))]), XML_HEADERS)
    }
    if (route.kind === 'book') {
      const items = [response(bookHref, bookProps(prefix, ctag))]
      if (depth !== '0') {
        const cards = await loadCards(teams)
        for (const card of cards) items.push(response(cardHref(card.id), cardProps(card, false)))
        await recordUse(session, req, 'list', cards.length)
      } else {
        await recordUse(session, req, 'check', null)
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
      await recordUse(session, req, 'get', cards.length)
      return reply(207, multistatus(items), XML_HEADERS)
    }
    if (/addressbook-query/.test(req.body)) {
      await recordUse(session, req, 'get', cards.length)
      return reply(207, multistatus(cards.map((c) => response(cardHref(c.id), cardProps(c, true)))), XML_HEADERS)
    }
    // sync-collection: 내세우지는 않지만(supported-report-set에 없음) 폰이 물으면 답한다. 예전 표(sync-token)가
    // 지금과 다르면 처음부터 다시 받게 하고(valid-sync-token 오류, 빠진 고객도 지워지게), 처음이면 전부 보낸다.
    if (/sync-collection/.test(req.body)) {
      const token = req.body.match(/<(?:[A-Za-z0-9_-]+:)?sync-token>([^<]*)</)?.[1]?.trim() ?? ''
      const current = syncTokenOf(ctag)
      if (token && token !== current) {
        return reply(
          403,
          '<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>',
          XML_HEADERS,
        )
      }
      const items = token ? [] : cards.map((c) => response(cardHref(c.id), cardProps(c, false)))
      await recordUse(session, req, 'list', cards.length)
      return reply(
        207,
        multistatus(items).replace('</d:multistatus>', `<d:sync-token>${xmlEscape(current)}</d:sync-token>\n</d:multistatus>`),
        XML_HEADERS,
      )
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
