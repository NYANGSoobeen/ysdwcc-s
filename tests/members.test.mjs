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
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore')
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
    as(null, { teamName: '영업1팀', name: '관리자', email: 'boss@workphone.local', password: 'Yangsan2468' }),
  )
  teamId = res.teamId
  adminUid = (await getAuth().getUserByEmail('boss@workphone.local')).uid
  const team = (await db.doc(`teams/${teamId}`).get()).data()
  assert.equal(team.members[adminUid], 'admin')
  assert.deepEqual(await fn.setupStatus.run(as(null, {})), { needsSetup: false })
  await expectError(
    fn.createFirstAdmin.run(as(null, { teamName: 'x', name: 'x', email: 'x@workphone.local', password: 'Yangsan2468' })),
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

const fresh = () => ({ auth_time: Math.floor(Date.now() / 1000) })
const asFresh = (uid, data) => ({ data, auth: { uid, token: fresh() }, rawRequest: {} })

test('첫 관리자 비밀번호도 규칙을 지켜야 한다 (1234, abcd 같은 연속 글자 금지)', async () => {
  for (const password of ['qwer5678x', 'pass1234', 'abcd9753', 'short1']) {
    await expectError(
      fn.createFirstAdmin.run(as(null, { teamName: 'x', name: 'x', email: 'y@workphone.local', password })),
      'invalid-argument',
    )
  }
})

test('새 계정과 초기화한 계정은 처음 로그인할 때 비밀번호를 바꿔야 하고, 바꾸면 표시가 지워진다', async () => {
  const kim = (await getAuth().getUserByEmail('kim@workphone.local')).uid
  assert.equal((await db.doc(`users/${kim}`).get()).get('mustChangePassword'), true)
  // 재인증하지 않은(오래된) 로그인으로는 바꿀 수 없다
  await expectError(fn.changeMyPassword.run(as(kim, { password: 'Busan7319k' })), 'unauthenticated')
  // 규칙 위반
  await expectError(fn.changeMyPassword.run(asFresh(kim, { password: 'abc12345' })), 'invalid-argument')
  await expectError(fn.changeMyPassword.run(asFresh(kim, { password: 'kim97531x' })), 'invalid-argument') // 아이디 포함
  await fn.changeMyPassword.run(asFresh(kim, { password: 'Busan7319k' }))
  assert.equal((await db.doc(`users/${kim}`).get()).get('mustChangePassword'), undefined)

  await fn.resetMemberPassword.run(as(adminUid, { teamId, uid: kim, password: 'temp999' }))
  assert.equal((await db.doc(`users/${kim}`).get()).get('mustChangePassword'), true)
})

test('사용 중지: 계정이 막히고 이유가 남으며, 다시 사용하면 풀린다', async () => {
  const kim = (await getAuth().getUserByEmail('kim@workphone.local')).uid
  await expectError(fn.setMemberActive.run(as(kim, { teamId, uid: adminUid, active: false, reason: 'x' })), 'permission-denied')
  await expectError(fn.setMemberActive.run(as(adminUid, { teamId, uid: adminUid, active: false, reason: 'x' })), 'failed-precondition')
  await expectError(fn.setMemberActive.run(as(adminUid, { teamId, uid: kim, active: false })), 'invalid-argument') // 이유 없음

  await fn.setMemberActive.run(as(adminUid, { teamId, uid: kim, active: false, reason: '휴직' }))
  const user = (await db.doc(`users/${kim}`).get()).data()
  assert.equal(user.active, false)
  assert.equal(user.disabledReason, '휴직')
  assert.equal((await getAuth().getUser(kim)).disabled, true)
  // 팀 소속은 그대로
  assert.equal((await db.doc(`teams/${teamId}`).get()).get(`members.${kim}`), 'viewer')

  await fn.setMemberActive.run(as(adminUid, { teamId, uid: kim, active: true }))
  const back = (await db.doc(`users/${kim}`).get()).data()
  assert.equal(back.active, true)
  assert.equal(back.disabledReason, undefined)
  assert.equal((await getAuth().getUser(kim)).disabled, false)
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

  // 만든 채팅방의 오래된 메시지도 함께 지운다.
  await db.doc(`teams/${teamId}/channels/room1`).set({ name: '오전 근무', createdBy: adminUid })
  await db.doc(`teams/${teamId}/channels/room1/messages/roomOld`).set({ authorUid: adminUid, body: '방 옛 글', attachments: [], createdAt: Timestamp.fromMillis(Date.now() - 400 * day) })
  await db.doc(`teams/${teamId}/channels/room1/messages/roomNew`).set({ authorUid: adminUid, body: '방 새 글', attachments: [], createdAt: Timestamp.now() })
  const preview = await fn.deleteMessagesInRange.run(as(adminUid, { ...range, dryRun: true }))
  assert.deepEqual(preview, { messages: 3, photos: 1, bytes: 3500 })
  assert.equal((await db.collection(`teams/${teamId}/messages`).get()).size, 4)

  const result = await fn.deleteMessagesInRange.run(as(adminUid, { ...range, dryRun: false }))
  assert.deepEqual(result, preview)
  const left = (await db.collection(`teams/${teamId}/messages`).get()).docs.map((d) => d.id).sort()
  assert.deepEqual(left, ['new1', 'new2'])
  const roomLeft = (await db.collection(`teams/${teamId}/channels/room1/messages`).get()).docs.map((d) => d.id)
  assert.deepEqual(roomLeft, ['roomNew'])
  const usage = await fn.getUsage.run(as(adminUid, { teamId }))
  assert.equal(usage.counts.messages, 3, '용량의 메시지 수에 만든 방이 빠짐')
  await db.recursiveDelete(db.doc(`teams/${teamId}/channels/room1`))
  const [oldFiles] = await bucket.getFiles({ prefix: `teams/${teamId}/chat/old1/` })
  const [newFiles] = await bucket.getFiles({ prefix: `teams/${teamId}/chat/new1/` })
  assert.equal(oldFiles.length, 0)
  assert.equal(newFiles.length, 2)

  await expectError(fn.deleteMessagesInRange.run(as(adminUid, { teamId, from: 10, to: 5, dryRun: true })), 'invalid-argument')
})

test('최고 관리자: 첫 관리자는 최고 관리자이고, 새 팀을 만들면 그 팀의 관리자가 된다', async () => {
  assert.equal((await db.doc(`users/${adminUid}`).get()).get('superAdmin'), true)
  assert.deepEqual(await fn.getMyAccess.run(as(adminUid, {})), { superAdmin: true })
  const { teamId: newTeam } = await fn.createTeam.run(as(adminUid, { name: '지원팀' }))
  assert.equal((await db.doc(`teams/${newTeam}`).get()).get(`members.${adminUid}`), 'admin')
  assert.ok((await db.doc(`users/${adminUid}`).get()).get('teamIds').includes(newTeam))

  // 다른 관리자는 팀을 만들 수 없고, 최고 관리자를 빼거나 강등할 수 없다
  const { uid: otherAdmin } = await fn.addMember.run(
    as(adminUid, { teamId: newTeam, name: '팀장', email: 'lead@workphone.local', password: 'pass123', role: 'admin' }),
  )
  await expectError(fn.createTeam.run(as(otherAdmin, { name: '몰래 만든 팀' })), 'permission-denied')
  assert.deepEqual(await fn.getMyAccess.run(as(otherAdmin, {})), { superAdmin: false })
  await expectError(fn.removeMember.run(as(otherAdmin, { teamId: newTeam, uid: adminUid })), 'failed-precondition')
  await expectError(fn.updateMemberRole.run(as(otherAdmin, { teamId: newTeam, uid: adminUid, role: 'viewer' })), 'failed-precondition')
})

test('최고 관리자 표시가 생기기 전에 만든 프로젝트: 첫 팀 관리자가 최고 관리자가 된다', async () => {
  await db.doc(`users/${adminUid}`).update({ superAdmin: FieldValue.delete() })
  await db.doc('meta/setup').update({ ownerUid: FieldValue.delete() })
  const { uid: second } = await fn.addMember.run(
    as(adminUid, { teamId, name: '부관리자', email: 'sub@workphone.local', password: 'pass123', role: 'admin' }),
  )
  assert.deepEqual(await fn.getMyAccess.run(as(adminUid, {})), { superAdmin: true })
  assert.equal((await db.doc('meta/setup').get()).get('ownerUid'), adminUid)
  // 한 명이 정해지면 같은 팀의 다른 관리자는 최고 관리자가 되지 않는다
  assert.deepEqual(await fn.getMyAccess.run(as(second, {})), { superAdmin: false })
})

test('용량 관리는 최고 관리자만 (다른 팀 관리자는 불가)', async () => {
  const { uid: lead } = await fn.addMember.run(
    as(adminUid, { teamId, name: '팀장2', email: 'lead2@workphone.local', password: 'pass123', role: 'admin' }),
  )
  await expectError(fn.getUsage.run(as(lead, { teamId })), 'permission-denied')
  await expectError(
    fn.deleteMessagesInRange.run(as(lead, { teamId, from: 0, to: Date.now(), dryRun: true })),
    'permission-denied',
  )
  await fn.getUsage.run(as(adminUid, { teamId }))
})

test('스케줄: 새로 올리거나 지우면 이전 파일을 지우고, 용량에서는 따로 센다', async () => {
  const put = (path, bytes) => bucket.file(path).save(Buffer.alloc(bytes))
  await put(`teams/${teamId}/schedule/old/p1.png`, 1000)
  await put(`teams/${teamId}/schedule/old/original.pdf`, 500)
  await put(`teams/${teamId}/schedule/new/p1.png`, 700)

  const usage = await fn.getUsage.run(as(adminUid, { teamId }))
  assert.equal(usage.storage.scheduleBytes, 2200)

  const snap = (data) => ({ data: () => data })
  const params = { teamId, docId: 'current' }
  // 교체: old → new
  await fn.onScheduleWritten.run({ params, data: { before: snap({ uploadId: 'old' }), after: snap({ uploadId: 'new' }) } })
  assert.equal((await bucket.getFiles({ prefix: `teams/${teamId}/schedule/old/` }))[0].length, 0)
  assert.equal((await bucket.getFiles({ prefix: `teams/${teamId}/schedule/new/` }))[0].length, 1)
  // 스티커만 바뀜: 그대로
  await fn.onScheduleWritten.run({ params, data: { before: snap({ uploadId: 'new' }), after: snap({ uploadId: 'new' }) } })
  assert.equal((await bucket.getFiles({ prefix: `teams/${teamId}/schedule/new/` }))[0].length, 1)
  // 삭제
  await fn.onScheduleWritten.run({ params, data: { before: snap({ uploadId: 'new' }), after: snap(undefined) } })
  assert.equal((await bucket.getFiles({ prefix: `teams/${teamId}/schedule/` }))[0].length, 0)
})
