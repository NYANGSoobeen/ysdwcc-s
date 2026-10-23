// "지우면 바로 영구 삭제"가 하위 데이터와 사진까지 지우는지 확인한다.
// 삭제 트리거 함수를 Firestore, Storage 에뮬레이터에 연결한 채 직접 실행한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// 함수 코드와 같은 firebase-admin 인스턴스를 써야 초기화된 앱을 공유한다.
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-workphone',
  storageBucket: 'demo-workphone.appspot.com',
})
const { onCustomerDeleted, onMessageDeleted, onNoteDeleted } = await import('../functions/lib/index.js')
const db = getFirestore()
const bucket = getStorage().bucket()

test('메시지를 지우면 첨부 사진도 지워진다', async () => {
  await db.doc('teams/t1/messages/m1').set({ authorUid: 'ed', body: '사진' })
  await bucket.file('teams/t1/chat/m1/0.jpg').save(Buffer.from([0xff, 0xd8]))
  await bucket.file('teams/t1/chat/m1/0_thumb.jpg').save(Buffer.from([0xff, 0xd8]))
  await bucket.file('teams/t1/chat/m2/0.jpg').save(Buffer.from([0xff, 0xd8]))

  await db.doc('teams/t1/messages/m1').delete()
  await onMessageDeleted.run({ params: { teamId: 't1', msgId: 'm1' } })
  const [left] = await bucket.getFiles({ prefix: 'teams/t1/chat/m1/' })
  assert.equal(left.length, 0, '사진이 남아 있음')
  const [others] = await bucket.getFiles({ prefix: 'teams/t1/chat/m2/' })
  assert.equal(others.length, 1, '다른 메시지의 사진까지 지워짐')
})

test('고객을 지우면 메모와 수정 기록도 지워진다', async () => {
  await db.doc('customers/c1').set({ teamId: 't1', name: '김협력' })
  await db.doc('customers/c1/notes/n1').set({ body: '메모' })
  await db.doc('customers/c1/notes/n1/revisions/r1').set({ body: '이전 메모' })

  await db.doc('customers/c1').delete()
  await onCustomerDeleted.run({ params: { customerId: 'c1' } })
  assert.ok((await db.collection('customers/c1/notes').get()).empty, '메모가 남아 있음')
  assert.ok((await db.collection('customers/c1/notes/n1/revisions').get()).empty, '수정 기록이 남아 있음')
})

test('메모를 지우면 수정 기록도 지워진다', async () => {
  await db.doc('customers/c2/notes/n1').set({ body: '메모' })
  await db.doc('customers/c2/notes/n1/revisions/r1').set({ body: '이전' })
  await db.doc('customers/c2/notes/n1').delete()
  await onNoteDeleted.run({ params: { customerId: 'c2', noteId: 'n1' } })
  assert.ok((await db.collection('customers/c2/notes/n1/revisions').get()).empty, '수정 기록이 남아 있음')
})
