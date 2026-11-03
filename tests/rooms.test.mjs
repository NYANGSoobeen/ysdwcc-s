// 👥 초대한 사람만 보는 채팅방: 새 직원이 들어오기 전에 예전 방을 굳히고, 나가기·초대하기는 방 사람만
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' })
const fn = await import('../functions/lib/index.js')
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const db = getFirestore()
const as = (uid, data) => ({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} })
const expectError = (p, code) => assert.rejects(p, (err) => err.code === code || err.httpErrorCode?.canonicalName === code)

before(async () => {
  await db.recursiveDelete(db.collection('meta'))
  await db.recursiveDelete(db.collection('teams'))
  await db.recursiveDelete(db.collection('users'))
  const { users } = await getAuth().listUsers()
  await Promise.all(users.map((u) => getAuth().deleteUser(u.uid)))
})

test('새 직원은 예전 방이 안 보이고, 방 사람이 초대해야 들어오며, 나가면 관리자도 못 본다', async () => {
  const { teamId } = await fn.createFirstAdmin.run(as(null, { teamName: '지원팀', name: '대표', email: 'boss@workphone.local', password: 'Yangsan2468' }))
  const boss = (await getAuth().getUserByEmail('boss@workphone.local')).uid
  const kim = (await fn.addMember.run(as(boss, { teamId, name: '김', email: 'kim@workphone.local', password: 'pass123', role: 'editor' }))).uid
  // 대표가 팀에서 빠진 최고 관리자인 경우도 있지만 여기서는 팀원
  await db.doc(`teams/${teamId}/channels/talk`).set({ name: '수다방', createdBy: kim, createdAt: 1 })
  await db.doc(`teams/${teamId}/channels/work`).set({ name: '업무방', createdBy: kim, createdAt: 1 })
  const lee = (await fn.addMember.run(as(boss, { teamId, name: '이', email: 'lee@workphone.local', password: 'pass123', role: 'editor' }))).uid
  const talk = (await db.doc(`teams/${teamId}/channels/talk`).get()).get('members')
  assert.ok(talk[boss] && talk[kim] && !talk[lee], '예전 방은 새 직원 들어오기 전 사람으로 굳힘')
  // 새 직원은 초대 못 함, 방 사람은 초대
  await expectError(fn.roomMembers.run(as(lee, { teamId, channelId: 'talk', action: 'invite', uids: [lee] })), 'permission-denied')
  await fn.roomMembers.run(as(kim, { teamId, channelId: 'talk', action: 'invite', uids: [lee] }))
  assert.ok((await db.doc(`teams/${teamId}/channels/talk`).get()).get(`members.${lee}`))
  // 대표(관리자)가 수다방에서 나감 → 다시 못 들어옴(스스로 초대 불가)
  await fn.roomMembers.run(as(boss, { teamId, channelId: 'talk', action: 'leave' }))
  assert.equal((await db.doc(`teams/${teamId}/channels/talk`).get()).get(`members.${boss}`), undefined)
  await expectError(fn.roomMembers.run(as(boss, { teamId, channelId: 'talk', action: 'invite', uids: [boss] })), 'permission-denied')
  // 팀원이 아닌 사람은 초대 못 함, 전체 채팅은 나갈 수 없음
  await expectError(fn.roomMembers.run(as(kim, { teamId, channelId: 'talk', action: 'invite', uids: ['nobody'] })), 'invalid-argument')
  await expectError(fn.roomMembers.run(as(kim, { teamId, channelId: 'main', action: 'leave' })), 'failed-precondition')
  // 업무방은 그대로 대표·김
  const work = (await db.doc(`teams/${teamId}/channels/work`).get()).get('members')
  assert.deepEqual(Object.keys(work).sort(), [boss, kim].sort())
})
