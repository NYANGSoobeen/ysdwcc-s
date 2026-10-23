// 연락처 구독(CardDAV) 서버를 실제 CardDAV 클라이언트(tsdav)로 확인한다.
// 폰이 하는 것과 같은 순서로 주소록을 찾고(PROPFIND) 연락처를 받는다(REPORT).
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createDAVClient } from 'tsdav'

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' })
const fn = await import('../functions/lib/index.js')
const { handleCardDav } = await import('../functions/lib/carddav.js')
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const db = getFirestore()

// 함수가 /carddav 아래에 붙어 있어도 주소가 맞게 나오는지 함께 확인한다.
const PREFIX = '/carddav'
let server
let base

before(async () => {
  for (const c of ['customers', 'teams', 'users', 'carddavTokens']) await db.recursiveDelete(db.collection(c))
  await db.doc('teams/t1').set({ name: '영업1팀', members: { ed: 'editor', boss: 'admin' }, contactsVersion: 0 })
  await db.doc('teams/t2').set({ name: '다른 팀', members: { other: 'admin' }, contactsVersion: 0 })
  await db.doc('users/ed').set({ name: '편집', email: 'ed@workphone.local', teamIds: ['t1'] })
  await db.doc('customers/c1').set({ teamId: 't1', name: '김협력', company: 'OO상사', phones: ['+821012345678'] })
  await db.doc('customers/c2').set({ teamId: 't1', name: '이대리; 테스트', company: '', phones: ['+8221234567', '+821099998888'] })
  await db.doc('customers/x1').set({ teamId: 't2', name: '다른팀 고객', phones: ['+821011112222'] })

  server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const path = req.url.startsWith(PREFIX) ? req.url : `${PREFIX}${req.url}`
    const out = await handleCardDav({ method: req.method, path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
    res.writeHead(out.status, out.headers)
    res.end(out.body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const as = (uid, data = {}) => ({ data, auth: { uid, token: {} }, rawRequest: {} })
let creds

async function fetchCards(credentials = creds) {
  const client = await createDAVClient({
    serverUrl: `${base}${PREFIX}/`,
    credentials,
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  })
  const books = await client.fetchAddressBooks()
  assert.equal(books.length, 1)
  const cards = await client.fetchVCards({ addressBook: books[0] })
  return { book: books[0], cards: cards.map((c) => c.data).sort() }
}

test('팀에 없는 사람은 접속 정보를 만들 수 없다', async () => {
  await assert.rejects(fn.enableContactsSync.run(as('nobody')), (e) => e.code === 'permission-denied')
})

test('접속 정보로 주소록을 찾고, 내 팀 고객만 [업무] 이름으로 받는다', async () => {
  creds = await fn.enableContactsSync.run(as('ed'))
  assert.match(creds.username, /^wp[a-z0-9]{10}$/)
  const saved = (await db.doc(`carddavTokens/${creds.username}`).get()).data()
  assert.notEqual(saved.secretHash, creds.password, '비밀번호가 그대로 저장됨')
  assert.equal((await db.doc('users/ed/private/contactsSync').get()).get('enabled'), true)

  const { book, cards } = await fetchCards()
  assert.equal(book.displayName, '업무폰 고객')
  assert.equal(cards.length, 2)
  const kim = cards.find((c) => c.includes('UID:c1'))
  assert.match(kim, /FN:\[업무\] 김협력/)
  assert.match(kim, /ORG:OO상사/)
  assert.match(kim, /TEL;TYPE=CELL:\+821012345678/)
  const lee = cards.find((c) => c.includes('UID:c2'))
  assert.match(lee, /FN:\[업무\] 이대리\\; 테스트/, '세미콜론이 이스케이프되지 않음')
  assert.equal((lee.match(/^TEL/gm) ?? []).length, 2)
  assert.ok(!cards.some((c) => c.includes('다른팀 고객')), '다른 팀 고객이 보임')
})

const request = (method, path, { auth = creds, body, headers = {} } = {}) =>
  fetch(`${base}${path}`, {
    method,
    body,
    redirect: 'manual',
    headers: {
      ...(auth ? { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}` } : {}),
      ...headers,
    },
  })

test('비밀번호가 틀리면 401, 수정 요청은 403, well-known은 안내', async () => {
  assert.equal((await request('PROPFIND', `${PREFIX}/`, { auth: { ...creds, password: 'wrong' } })).status, 401)
  assert.equal((await request('PROPFIND', `${PREFIX}/`, { auth: null })).status, 401)
  assert.equal((await request('PUT', `${PREFIX}/book/c1.vcf`, { body: 'BEGIN:VCARD' })).status, 403)
  assert.equal((await request('DELETE', `${PREFIX}/book/c1.vcf`)).status, 403)
  const wk = await request('PROPFIND', `${PREFIX}/.well-known/carddav`, { auth: null })
  assert.equal(wk.status, 301)
  assert.equal(wk.headers.get('location'), `${PREFIX}/`)
  const get = await request('GET', `${PREFIX}/book/c1.vcf`)
  assert.equal(get.status, 200)
  assert.match(await get.text(), /김협력/)
  assert.equal((await request('GET', `${PREFIX}/book/x1.vcf`)).status, 404, '다른 팀 고객을 직접 받을 수 있음')
})

async function ctag() {
  const res = await request('PROPFIND', `${PREFIX}/book/`, { headers: { Depth: '0' } })
  return (await res.text()).match(/<cs:getctag>([^<]+)</)[1]
}

test('고객이 바뀌면 주소록 버전(ctag)이 바뀌어 폰이 다시 받는다', async () => {
  const beforeTag = await ctag()
  const snap = (data) => ({ data: () => data })
  await db.doc('customers/c3').set({ teamId: 't1', name: '박신규', phones: ['+821033334444'] })
  await fn.onCustomerWrittenForContacts.run({
    params: { customerId: 'c3' },
    data: { before: snap(undefined), after: snap({ teamId: 't1' }) },
  })
  assert.equal((await db.doc('teams/t1').get()).get('contactsVersion'), 1)
  assert.notEqual(await ctag(), beforeTag)
  const { cards } = await fetchCards()
  assert.equal(cards.length, 3)
})

test('팀에서 제외되면 빈 주소록이 되어 폰에서 고객 연락처가 사라진다', async () => {
  await db.doc('teams/t1').update({ 'members.ed': FieldValue.delete() })
  await db.doc('users/ed').update({ teamIds: [] })
  const { cards } = await fetchCards()
  assert.equal(cards.length, 0)
  // 다시 팀에 넣고 다음 테스트를 위해 되돌린다
  await db.doc('teams/t1').update({ 'members.ed': 'editor' })
  await db.doc('users/ed').update({ teamIds: ['t1'] })
  assert.equal((await fetchCards()).cards.length, 3)
})

test('계정이 삭제돼도(프로필 없음) 빈 주소록을 준다', async () => {
  await db.doc('users/ed').delete()
  assert.equal((await fetchCards()).cards.length, 0)
  await db.doc('users/ed').set({ name: '편집', email: 'ed@workphone.local', teamIds: ['t1'] })
})

test('끄거나 새로 만들면 예전 접속 정보는 빈 주소록이 된다', async () => {
  const old = creds
  creds = await fn.enableContactsSync.run(as('ed'))
  assert.equal((await fetchCards(old)).cards.length, 0, '예전 접속 정보로 아직 받아짐')
  assert.equal((await fetchCards(creds)).cards.length, 3)

  await fn.disableContactsSync.run(as('ed'))
  assert.equal((await fetchCards(creds)).cards.length, 0)
  assert.equal((await db.doc('users/ed/private/contactsSync').get()).get('enabled'), false)
})
