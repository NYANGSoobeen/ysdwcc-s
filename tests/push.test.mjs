// 푸시 알림: 누구에게 어떤 알림이 가는지, 못 보내는 토큰 정리, 프론트 알림(ydrGuestPush) 비밀값 검사.
// 실제 FCM 대신 보내는 부분(setSender)을 바꿔 끼워 보낸 내용만 확인한다.
import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' })
const fn = await import('../functions/lib/index.js')
const push = await import('../functions/lib/push.js')
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore } = require('firebase-admin/firestore')
const db = getFirestore()

let sent = []
let failCodes = {}
push.setSender(async (messages) => {
  sent.push(...messages)
  return messages.map((m) => (failCodes[m.token] ? { ok: false, code: failCodes[m.token] } : { ok: true }))
})

before(async () => {
  for (const c of ['teams', 'users', 'pushTokens', 'meta']) await db.recursiveDelete(db.collection(c))
  await db.doc('teams/t1').set({ name: '지원팀', members: { a: 'admin', b: 'editor', c: 'viewer', d: 'editor' } })
  await db.doc('teams/t1/channels/r1').set({ name: '오전 근무' })
  await db.doc('users/a').set({ name: '박관리', teamIds: ['t1'] })
  await db.doc('users/b').set({ name: '김지원', teamIds: ['t1'] })
  await db.doc('users/c').set({ name: '이보기', teamIds: ['t1'] })
  await db.doc('users/d').set({ name: '최중지', teamIds: ['t1'], active: false })
  const tok = (id, uid, mode, platform = 'web') => db.doc(`pushTokens/${id}`).set({ uid, token: `tok-${id}`, mode, platform })
  await tok('a1', 'a', 'all')
  await tok('b1', 'b', 'all')
  await tok('b2', 'b', 'all', 'android')
  await tok('c1', 'c', 'mentions')
  await tok('d1', 'd', 'all')
})
beforeEach(() => {
  sent = []
  failCodes = {}
})

test('팀 채팅: 보낸 사람·사용 중지된 사람 빼고, "나를 부른 말만" 기기는 멘션일 때만', async () => {
  await push.notifyChatMessage('t1', 'r1', { authorUid: 'a', body: '오늘   회의 10시', mentions: [] })
  assert.deepEqual(sent.map((m) => m.token).sort(), ['tok-b1', 'tok-b2'])
  const web = sent.find((m) => m.token === 'tok-b1')
  assert.deepEqual(web.data, { title: '오전 근무', body: '박관리: 오늘 회의 10시', url: '/?room=t1%3Ar1', tag: 'room-t1-r1', kind: 'chat' })
  assert.ok(web.webpush && !web.notification, '웹은 데이터만 보낸다 (서비스 워커가 그림)')
  const android = sent.find((m) => m.token === 'tok-b2')
  assert.equal(android.notification.title, '오전 근무')

  sent = []
  await push.notifyChatMessage('t1', 'main', { authorUid: 'b', body: '@이보기 확인 부탁', mentions: ['c'] })
  assert.deepEqual(sent.map((m) => m.token).sort(), ['tok-a1', 'tok-c1'])
  assert.equal(sent.find((m) => m.token === 'tok-c1').data.title, '🔔 김지원님이 나를 불렀어요 · 전체 채팅')
  assert.equal(sent.find((m) => m.token === 'tok-a1').data.title, '전체 채팅')
})

test('사진·파일만 보낸 말, 삭제된 말', async () => {
  await push.notifyChatMessage('t1', 'r1', { authorUid: 'b', body: '', attachments: [{}, {}, {}] })
  assert.equal(sent.find((m) => m.token === 'tok-a1').data.body, '김지원: 📷 사진 3장')
  sent = []
  await push.notifyChatMessage('t1', 'r1', { authorUid: 'b', body: '', files: [{ name: '견적서.xlsx' }, { name: 'b.pdf' }] })
  assert.equal(sent.find((m) => m.token === 'tok-a1').data.body, '김지원: 📎 견적서.xlsx 외 1개')
  sent = []
  await push.notifyChatMessage('t1', 'r1', { authorUid: 'b', body: '', deleted: true })
  assert.equal(sent.length, 0)
})

test('보낼 수 없는 토큰(앱 삭제·알림 해제)은 지운다', async () => {
  failCodes['tok-b1'] = 'messaging/registration-token-not-registered'
  failCodes['tok-b2'] = 'messaging/internal-error'
  await push.notifyChatMessage('t1', 'r1', { authorUid: 'a', body: '안녕' })
  assert.equal((await db.doc('pushTokens/b1').get()).exists, false)
  assert.equal((await db.doc('pushTokens/b2').get()).exists, true, '잠깐 실패한 토큰은 남긴다')
  await db.doc('pushTokens/b1').set({ uid: 'b', token: 'tok-b1', mode: 'all', platform: 'web' })
})

test('9번: 종류별 켜기/끄기, 20분 넘게 소식 없는 PC는 빼기, 새 공지 알림', async () => {
  const { Timestamp } = require('firebase-admin/firestore')
  const kinds = (chat, mention, notice, front) => ({ chat, mention, notice, front })
  const set = (id, uid, k, extra = {}) => db.doc(`pushTokens/${id}`).set({ uid, token: `tok-${id}`, platform: 'web', mode: 'all', kinds: k, ...extra })
  await set('k1', 'c', kinds(false, true, true, false)) // 이보기: 나를 부른 말 + 공지
  await set('k2', 'b', kinds(true, true, false, true), { pc: true, seenAt: Timestamp.fromMillis(Date.now() - 25 * 60_000) }) // 오래된 PC
  await set('k3', 'b', kinds(true, true, false, true), { pc: true, seenAt: Timestamp.now() }) // 열려 있는 PC
  try {
    await push.notifyChatMessage('t1', 'r1', { authorUid: 'a', body: '안녕' })
    let got = sent.map((m) => m.token)
    assert.ok(got.includes('tok-k3') && !got.includes('tok-k2'), '20분 넘은 PC는 안 보낸다')
    assert.ok(!got.includes('tok-k1'), '채팅을 끈 기기는 일반 채팅을 안 받는다')

    sent = []
    await push.notifyChatMessage('t1', 'r1', { authorUid: 'a', body: '@이보기 확인', mentions: ['c'] })
    assert.ok(sent.map((m) => m.token).includes('tok-k1'), '나를 부른 말은 받는다')

    sent = []
    await db.doc('teams/t1').update({ name: '지원팀' })
    await push.notifyNotice('t1', { authorUid: 'a', title: '내일 근무 변경' })
    got = sent.map((m) => m.token)
    assert.ok(got.includes('tok-k1') && !got.includes('tok-k3'), '공지를 켠 기기만')
    assert.ok(!got.includes('tok-a1'), '쓴 사람은 빼고')
    const n = sent.find((m) => m.token === 'tok-k1').data
    assert.equal(n.kind, 'notice')
    assert.equal(n.url, '/?notice=t1')
    assert.equal(n.title, '📢 새 공지 · 지원팀')
    assert.equal(n.body, '내일 근무 변경 (박관리)')
  } finally {
    for (const id of ['k1', 'k2', 'k3']) await db.doc(`pushTokens/${id}`).delete()
  }
})

function call(handler, { method = 'POST', headers = {}, body = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code
        return this
      },
      send(text) {
        resolve({ status: this.statusCode, body: text })
      },
      json(obj) {
        resolve({ status: this.statusCode, body: obj })
      },
    }
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    handler({ method, body, get: (h) => lower[h.toLowerCase()], header: (h) => lower[h.toLowerCase()], headers: lower }, res)
  })
}

test('프론트 알림(ydrGuestPush): 비밀값이 맞을 때만, 나를 부른 말만 기기는 빼고', async () => {
  const req = { uids: ['b', 'c', 'd', 'nobody'], title: '프론트 전체', body: '김프론트: 손님 도착', ch: 'c1', msg: 'm1' }
  // 비밀값을 정하기 전에는 모두 거절
  assert.equal((await call(fn.ydrGuestPush, { headers: { 'x-ydr-secret': 'x'.repeat(30) }, body: req })).status, 403)
  // 최고 관리자만 비밀값을 만든다
  await db.doc('users/a').update({ superAdmin: true })
  await db.doc('meta/setup').set({ ownerUid: 'a' })
  await assert.rejects(fn.setFrontLinkSecret.run({ data: {}, auth: { uid: 'b', token: {} }, rawRequest: {} }))
  const { secret } = await fn.setFrontLinkSecret.run({ data: {}, auth: { uid: 'a', token: {} }, rawRequest: {} })
  assert.ok(secret.length >= 20)
  assert.deepEqual((await fn.frontLinkInfo.run({ data: {}, auth: { uid: 'a', token: {} }, rawRequest: {} })).configured, true)

  assert.equal((await call(fn.ydrGuestPush, { headers: { 'x-ydr-secret': 'wrong'.repeat(6) }, body: req })).status, 403)
  assert.equal((await call(fn.ydrGuestPush, { method: 'GET', headers: { 'x-ydr-secret': secret } })).status, 405)
  const ok = await call(fn.ydrGuestPush, { headers: { 'x-ydr-secret': secret }, body: req })
  assert.equal(ok.status, 200)
  assert.deepEqual(sent.map((m) => m.token).sort(), ['tok-b1', 'tok-b2'])
  assert.deepEqual(sent.find((m) => m.token === 'tok-b1').data, {
    title: '🏌️ 프론트 전체',
    body: '김프론트: 손님 도착',
    url: '/?front=c1',
    tag: 'front-c1',
    kind: 'front',
  })
})
