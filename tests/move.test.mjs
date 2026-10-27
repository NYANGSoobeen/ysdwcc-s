// 부서(팀) 이동: 권한, 마지막 관리자·최고 관리자 보호, 소속이 한 번에 바뀌는지, 담당 고객 넘기기
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' })
const fn = await import('../functions/lib/index.js')
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore } = require('firebase-admin/firestore')
const db = getFirestore()
const as = (uid, data) => ({ data, auth: { uid, token: {} }, rawRequest: {} })
const fails = (p, code) => assert.rejects(p, (e) => e.code === code || e.httpErrorCode?.canonicalName === code)

before(async () => {
  for (const c of ['teams', 'users', 'customers', 'meta']) await db.recursiveDelete(db.collection(c))
  await db.doc('meta/setup').set({ ownerUid: 'boss' })
  await db.doc('teams/sales').set({ name: '영업팀', members: { boss: 'admin', a1: 'admin', kim: 'editor', lee: 'viewer' } })
  await db.doc('teams/support').set({ name: '지원팀', members: { boss: 'admin', a2: 'admin' } })
  await db.doc('teams/solo').set({ name: '혼자팀', members: { a3: 'admin' } })
  await db.doc('users/a3').set({ name: '혼자관리', teamIds: ['solo'] })
  await db.doc('users/boss').set({ name: '최고', teamIds: ['sales', 'support'], superAdmin: true })
  await db.doc('users/a1').set({ name: '영업관리', teamIds: ['sales'] })
  await db.doc('users/a2').set({ name: '지원관리', teamIds: ['support'] })
  await db.doc('users/kim').set({ name: '김영업', teamIds: ['sales'] })
  await db.doc('users/lee').set({ name: '이보기', teamIds: ['sales'] })
  await db.doc('customers/c1').set({ teamId: 'sales', name: '고객1', ownerUid: 'kim', phones: [] })
  await db.doc('customers/c2').set({ teamId: 'sales', name: '고객2', ownerUid: 'kim', phones: [] })
  await db.doc('customers/c3').set({ teamId: 'sales', name: '고객3', ownerUid: 'lee', phones: [] })
})

test('한쪽 부서 관리자만으로는 못 옮기고, 최고 관리자·마지막 관리자·자기 자신은 안 됨', async () => {
  await fails(fn.moveMember.run(as('a1', { fromTeamId: 'sales', toTeamId: 'support', uid: 'lee' })), 'permission-denied')
  await fails(fn.moveMember.run(as('kim', { fromTeamId: 'sales', toTeamId: 'support', uid: 'lee' })), 'permission-denied')
  await fails(fn.moveMember.run(as('a2', { fromTeamId: 'support', toTeamId: 'sales', uid: 'boss' })), 'permission-denied')
  await fails(fn.moveMember.run(as('boss', { fromTeamId: 'solo', toTeamId: 'sales', uid: 'a3' })), 'failed-precondition')
  await fails(fn.moveMember.run(as('a1', { fromTeamId: 'sales', toTeamId: 'sales', uid: 'a1' })), 'invalid-argument')
  await fails(fn.moveMember.run(as('boss', { fromTeamId: 'sales', toTeamId: 'sales', uid: 'kim' })), 'invalid-argument')
})

test('담당 고객이 있으면 넘길 사람을 정해야 하고, 옮기면 소속·권한·고객 담당이 한 번에 바뀐다', async () => {
  await fails(fn.moveMember.run(as('boss', { fromTeamId: 'sales', toTeamId: 'support', uid: 'kim' })), 'not-found')
  await fails(fn.moveMember.run(as('boss', { fromTeamId: 'sales', toTeamId: 'support', uid: 'kim', newOwnerUid: 'a2' })), 'not-found')
  const res = await fn.moveMember.run(as('boss', { fromTeamId: 'sales', toTeamId: 'support', uid: 'kim', newOwnerUid: 'a1' }))
  assert.deepEqual(res, { ok: true, movedCustomers: 2 })
  assert.equal((await db.doc('teams/sales').get()).get('members.kim'), undefined)
  assert.equal((await db.doc('teams/support').get()).get('members.kim'), 'editor', '권한을 안 정하면 원래 권한 그대로')
  assert.deepEqual((await db.doc('users/kim').get()).get('teamIds'), ['support'])
  assert.equal((await db.doc('customers/c1').get()).get('ownerUid'), 'a1')
  assert.equal((await db.doc('customers/c2').get()).get('ownerUid'), 'a1')
  assert.equal((await db.doc('customers/c1').get()).get('teamId'), 'sales', '고객은 원래 부서에 남는다')
})

test('담당 고객이 없으면 그냥 옮기고, 새 권한을 정할 수 있다', async () => {
  await db.doc('customers/c3').update({ ownerUid: 'a1' })
  await fn.moveMember.run(as('boss', { fromTeamId: 'sales', toTeamId: 'support', uid: 'lee', role: 'admin' }))
  assert.equal((await db.doc('teams/support').get()).get('members.lee'), 'admin')
  assert.deepEqual((await db.doc('users/lee').get()).get('teamIds'), ['support'])
})
