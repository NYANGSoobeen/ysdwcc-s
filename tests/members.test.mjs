// 계정, 팀원 관리, 용량, 기간 삭제 함수를 Auth, Firestore, Storage 에뮬레이터에 연결해 직접 실행한다.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-workphone',
  storageBucket: 'demo-workphone.appspot.com',
})
const fn = await import('../functions/lib/index.js')
// 함수 코드와 같은 firebase-admin 인스턴스를 써야 초기화된 앱을 공유한다.
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { getAuth } = require('firebase-admin/auth')
const db = getFirestore()
const bucket = getStorage().bucket()

const as = (uid, data) => ({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} })
const expectError = async (promise, code) => {
  await assert.rejects(promise, (err) => err.code === code || err.httpErrorCode?.canonicalName === code)
}

let adminUid
let teamId

before(async () => {
  await db.recursiveDelete(db.collection('meta'))
  await db.recursiveDelete(db.collection('teams'))
  await db.recursiveDelete(db.collection('users'))
  const { users } = await getAuth().listUsers()
  await Promise.all(users.map((u) => getAuth().deleteUser(u.uid)))
})

test('첫 관리자는 한 번만 만들 수 있다', async () => {
  assert.deepEqual(await fn.setupStatus.run(as(null, {})), { needsSetup: true })
  const res = await fn.createFirstAdmin.run(
    as(null, { teamName: '영업1팀', name: '관리자', email: 'boss@workphone.local', password: 'secret1' }),
  )
  teamId = res.teamId
  adminUid = (await getAuth().getUserByEmail('boss@workphone.local')).uid
  const team = (await db.doc(`teams/${teamId}`).get()).data()
  assert.equal(team.members[adminUid], 'admin')
  assert.deepEqual(await fn.setupStatus.run(as(null, {})), { needsSetup: false })
  await expectError(
    fn.createFirstAdmin.run(as(null, { teamName: 'x', name: 'x', email: 'x@workphone.local', password: 'secret1' })),
    'failed-precondition',
  )
})

test('관리자만 팀원을 추가하고, 추가된 사람은 로그인 계정과 프로필이 생긴다', async () => {
  const res = await fn.addMember.run(
    as(adminUid, { teamId, name: '김영업', email: 'kim@workphone.local', password: 'pass123', role: 'editor' }),
  )
  assert.equal(res.existed, false)
  const user = await getAuth().getUser(res.uid)
  assert.equal(user.email, 'kim@workphone.local')
  assert.deepEqual((await db.doc(`users/${res.uid}`).get()).data().teamIds, [teamId])
  assert.equal((await db.doc(`teams/${teamId}`).get()).get(`members.${res.uid}`), 'editor')

  await expectError(
    fn.addMember.run(as(res.uid, { teamId, name: 'x', email: 'x@workphone.local', password: 'pass123', role: 'editor' })),
    'permission-denied',
  )
  await expectError(
    fn.addMember.run(as(adminUid, { teamId, name: '김영업', email: 'kim@workphone.local', password: 'pass123', role: 'editor' })),
    'already-exists',
  )
  await expectError(
    fn.addMember.run(as(adminUid, { teamId, name: 'x', email: 'short@workphone.local', password: '123', role: 'editor' })),
    'invalid-argument',
  )
})

test('마지막 관리자는 강등하거나 삭제할 수 없다', async () => {
  await expectError(fn.updateMemberRole.run(as(adminUid, { teamId, uid: adminUid, role: 'editor' })), 'failed-precondition')
  await expectError(fn.removeMember.run(as(adminUid, { teamId, uid: adminUid })), 'failed-precondition')
})

test('권한 변경과 비밀번호 초기화', async () => {
  const kim = (await getAuth().getUserByEmail('kim@workphone.local')).uid
  await fn.updateMemberRole.run(as(adminUid, { teamId, uid: kim, role: 'viewer' }))
  assert.equal((await db.doc(`teams/${teamId}`).get()).get(`members.${kim}`), 'viewer')
  await fn.resetMemberPassword.run(as(adminUid, { teamId, uid: kim, password: 'newpass1' }))
  await expectError(fn.resetMemberPassword.run(as(kim, { teamId, uid: adminUid, password: 'hacked1' })), 'permission-denied')
})

test('팀에서 삭제하면 팀원 목록에서 빠지고, 다른 팀이 없으면 계정도 지워진다', async () => {
  const kim = (await getAuth().getUserByEmail('kim@workphone.local')).uid
  const res = await fn.removeMember.run(as(adminUid, { teamId, uid: kim }))
  assert.equal(res.accountDeleted, true)
  assert.equal((await db.doc(`teams/${teamId}`).get()).get(`members.${kim}`), undefined)
  assert.equal((await db.doc(`users/${kim}`).get()).exists, false)
  await assert.rejects(getAuth().getUser(kim), (e) => e.code === 'auth/user-not-found')
})

test('다른 팀에도 속한 사람은 이 팀에서만 빠지고 계정은 남는다', async () => {
  const { uid } = await fn.addMember.run(
    as(adminUid, { teamId, name: '이협력', email: 'lee@workphone.local', password: 'pass123', role: 'editor' }),
  )
  await db.doc('teams/other').set({ name: '다른 팀', members: { [adminUid]: 'admin', [uid]: 'editor' } })
  await db.doc(`users/${uid}`).update({ teamIds: [teamId, 'other'] })
  const res = await fn.removeMember.run(as(adminUid, { teamId, uid }))
  assert.equal(res.accountDeleted, false)
  assert.deepEqual((await db.doc(`users/${uid}`).get()).get('teamIds'), ['other'])
  await getAuth().getUser(uid)
})

test('용량: 사진 크기와 월별 합계, 메시지 수', async () => {
  const put = (path, bytes) => bucket.file(path).save(Buffer.alloc(bytes))
  await put(`teams/${teamId}/chat/old1/0.jpg`, 3000)
  await put(`teams/${teamId}/chat/old1/0_thumb.jpg`, 500)
  await put(`teams/${teamId}/chat/new1/0.jpg`, 2000)
  await put(`teams/${teamId}/chat/new1/0_thumb.jpg`, 400)
  await put('teams/other/chat/x/0.jpg', 9999)

  const day = 24 * 3600 * 1000
  const now = Date.now()
  const msg = (id, ageDays, attachments = []) =>
    db.doc(`teams/${teamId}/messages/${id}`).set({
      authorUid: adminUid,
      body: id,
      attachments,
      hasPhotos: attachments.length > 0,
      createdAt: Timestamp.fromMillis(now - ageDays * day),
    })
  await msg('old1', 400, [{ path: `teams/${teamId}/chat/old1/0.jpg`, size: 3000, thumbSize: 500 }])
  await msg('old2', 300)
  await msg('new1', 10, [{ path: `teams/${teamId}/chat/new1/0.jpg`, size: 2000, thumbSize: 400 }])
  await msg('new2', 1)

  const usage = await fn.getUsage.run(as(adminUid, { teamId }))
  assert.equal(usage.storage.bytes, 5900)
  assert.equal(usage.storage.photos, 2)
  assert.equal(usage.counts.messages, 4)
  assert.equal(usage.counts.photoMessages, 2)
  assert.equal(usage.storage.byMonth.reduce((s, m) => s + m.bytes, 0), 5900)
  await expectError(fn.getUsage.run(as('nobody', { teamId })), 'permission-denied')
})

test('기간별 삭제: 미리 보기는 지우지 않고, 삭제는 그 기간의 메시지와 사진만 지운다', async () => {
  const day = 24 * 3600 * 1000
  const range = { teamId, from: 0, to: Date.now() - 180 * day }

  const preview = await fn.deleteMessagesInRange.run(as(adminUid, { ...range, dryRun: true }))
  assert.deepEqual(preview, { messages: 2, photos: 1, bytes: 3500 })
  assert.equal((await db.collection(`teams/${teamId}/messages`).get()).size, 4)

  const result = await fn.deleteMessagesInRange.run(as(adminUid, { ...range, dryRun: false }))
  assert.deepEqual(result, preview)
  const left = (await db.collection(`teams/${teamId}/messages`).get()).docs.map((d) => d.id).sort()
  assert.deepEqual(left, ['new1', 'new2'])
  const [oldFiles] = await bucket.getFiles({ prefix: `teams/${teamId}/chat/old1/` })
  const [newFiles] = await bucket.getFiles({ prefix: `teams/${teamId}/chat/new1/` })
  assert.equal(oldFiles.length, 0)
  assert.equal(newFiles.length, 2)

  await expectError(fn.deleteMessagesInRange.run(as(adminUid, { teamId, from: 10, to: 5, dryRun: true })), 'invalid-argument')
})
