import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'

const PROJECT = 'demo-workphone'
let env

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  })
})
after(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'teams/t1'), {
      name: '영업1팀',
      members: { admin: 'admin', ed: 'editor', ed2: 'editor', viewer: 'viewer' },
    })
    await setDoc(doc(db, 'customers/c1'), {
      teamId: 't1', name: '김협력', ownerUid: 'ed', createdBy: 'ed', createdAt: 1,
    })
    await setDoc(doc(db, 'customers/c1/notes/n1'), { authorUid: 'ed', body: '메모', createdAt: 1 })
    await setDoc(doc(db, 'teams/t1/messages/m1'), { authorUid: 'ed', body: '안녕', createdAt: 1 })
  })
})

const fs = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore()
const st = (uid) => env.authenticatedContext(uid).storage()
const jpeg = new Uint8Array([0xff, 0xd8, 0xff])

test('팀 밖 사람과 비로그인은 고객, 채팅을 읽을 수 없다', async () => {
  await assertFails(getDoc(doc(fs('outsider'), 'customers/c1')))
  await assertFails(getDoc(doc(fs('outsider'), 'teams/t1/messages/m1')))
  await assertFails(getDoc(doc(fs(null), 'customers/c1')))
  await assertSucceeds(getDoc(doc(fs('viewer'), 'customers/c1/notes/n1')))
})

test('viewer는 쓰기 불가, editor는 가능', async () => {
  await assertFails(setDoc(doc(fs('viewer'), 'teams/t1/messages/m2'), { authorUid: 'viewer', body: 'x', createdAt: 2 }))
  await assertSucceeds(setDoc(doc(fs('ed2'), 'teams/t1/messages/m2'), { authorUid: 'ed2', body: 'x', createdAt: 2 }))
  await assertFails(setDoc(doc(fs('ed2'), 'teams/t1/messages/m3'), { authorUid: 'ed', body: '사칭', createdAt: 2 }))
})

test('채팅 메시지 수정, 삭제는 작성자만', async () => {
  await assertFails(updateDoc(doc(fs('ed2'), 'teams/t1/messages/m1'), { body: '남이 수정' }))
  await assertFails(deleteDoc(doc(fs('admin'), 'teams/t1/messages/m1')))
  await assertSucceeds(updateDoc(doc(fs('ed'), 'teams/t1/messages/m1'), { body: '수정' }))
  await assertSucceeds(deleteDoc(doc(fs('ed'), 'teams/t1/messages/m1')))
})

test('고객 삭제는 관리자 또는 담당자만', async () => {
  await assertFails(deleteDoc(doc(fs('ed2'), 'customers/c1')))
  await assertFails(deleteDoc(doc(fs('viewer'), 'customers/c1')))
  await assertSucceeds(deleteDoc(doc(fs('ed'), 'customers/c1')))
})

test('고객을 다른 팀으로 옮길 수 없다', async () => {
  await assertFails(updateDoc(doc(fs('admin'), 'customers/c1'), { teamId: 't2' }))
})

test('팀 생성과 팀원 변경은 앱에서 직접 못 하고 서버 함수로만 한다', async () => {
  await assertFails(setDoc(doc(fs('u9'), 'teams/t9'), { name: 'x', members: { u9: 'admin' } }))
  await assertFails(updateDoc(doc(fs('admin'), 'teams/t1'), { 'members.outsider': 'editor' }))
  await assertFails(updateDoc(doc(fs('ed'), 'teams/t1'), { 'members.ed': 'admin' }))
  await assertFails(updateDoc(doc(fs('ed'), 'teams/t1'), { name: '바꾼 이름' }))
  await assertSucceeds(updateDoc(doc(fs('admin'), 'teams/t1'), { name: '바꾼 이름' }))
})

test('프로필은 본인이 이름만 바꿀 수 있고 소속 팀은 못 바꾼다', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'users/ed'), { name: '편집', email: 'ed@x.com', teamIds: ['t1'] }))
  await assertSucceeds(updateDoc(doc(fs('ed'), 'users/ed'), { name: '새 이름' }))
  await assertFails(updateDoc(doc(fs('ed'), 'users/ed'), { teamIds: ['t1', 't2'] }))
  await assertFails(updateDoc(doc(fs('ed2'), 'users/ed'), { name: '남의 이름' }))
  await assertFails(setDoc(doc(fs('new'), 'users/new'), { name: 'x', teamIds: ['t1'] }))
})

test('팀에서 빠지면 바로 팀 데이터에 접근할 수 없다', async () => {
  await assertSucceeds(getDoc(doc(fs('ed2'), 'teams/t1/messages/m1')))
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), 'teams/t1'), { 'members.ed2': deleteField() }))
  await assertFails(getDoc(doc(fs('ed2'), 'teams/t1/messages/m1')))
  await assertFails(getDoc(doc(fs('ed2'), 'customers/c1')))
  await assertFails(getDoc(doc(fs('ed2'), 'teams/t1')))
})

test('채팅 사진: editor만 올리고, 팀원만 보고, 크기와 형식 제한', async () => {
  const meta = (uid, contentType = 'image/jpeg') => ({ contentType, customMetadata: { uploaderUid: uid } })
  await assertSucceeds(uploadBytes(ref(st('ed'), 'teams/t1/chat/m1/0.jpg'), jpeg, meta('ed')))
  await assertFails(uploadBytes(ref(st('viewer'), 'teams/t1/chat/m1/1.jpg'), jpeg, meta('viewer')))
  await assertFails(uploadBytes(ref(st('outsider'), 'teams/t1/chat/m1/1.jpg'), jpeg, meta('outsider')))
  await assertFails(uploadBytes(ref(st('ed'), 'teams/t1/chat/m1/1.pdf'), jpeg, meta('ed', 'application/pdf')))
  await assertFails(uploadBytes(ref(st('ed'), 'teams/t1/chat/m1/big.jpg'), new Uint8Array(2 * 1024 * 1024 + 1), meta('ed')))
  await assertFails(deleteObject(ref(st('ed2'), 'teams/t1/chat/m1/0.jpg')))
  await assertSucceeds(deleteObject(ref(st('ed'), 'teams/t1/chat/m1/0.jpg')))
})

test('본인이 최고 관리자 표시를 스스로 붙일 수 없다', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'users/ed'), { name: '편집', email: 'ed@x.com', teamIds: ['t1'] }))
  await assertFails(updateDoc(doc(fs('ed'), 'users/ed'), { superAdmin: true }))
})

test('갤럭시 앱의 여러 팀 고객 조회: 내 팀들만 한 번에 읽을 수 있다', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teams/t2'), { name: '2팀', members: { ed: 'viewer', other: 'admin' } })
    await setDoc(doc(ctx.firestore(), 'teams/t3'), { name: '3팀', members: { other: 'admin' } })
    await setDoc(doc(ctx.firestore(), 'customers/c2'), { teamId: 't2', name: '2팀 고객', createdBy: 'other' })
  })
  const db = fs('ed')
  const both = await assertSucceeds(getDocs(query(collection(db, 'customers'), where('teamId', 'in', ['t1', 't2']))))
  assert.equal(both.size, 2)
  await assertFails(getDocs(query(collection(db, 'customers'), where('teamId', 'in', ['t1', 't3']))))
})

test('스케줄: 팀원만 보고, 올리기/삭제는 편집 이상, 스티커는 보기 권한도 가능', async () => {
  const sched = (db) => doc(db, 'teams/t1/schedule/current')
  const data = { uploadId: 'u1', fileName: '10월.pdf', images: [], marks: [], authorId: 'ed' }
  await assertFails(setDoc(sched(fs('viewer')), { ...data, authorId: 'viewer' }))
  await assertFails(setDoc(sched(fs('ed')), { ...data, authorId: 'someone' }))
  await assertSucceeds(setDoc(sched(fs('ed')), data))
  await assertFails(getDoc(sched(fs('outsider'))))
  await assertSucceeds(getDoc(sched(fs('viewer'))))

  const mark = [{ p: 0, x: 0.5, y: 0.5, w: 0.1, h: 0.05, t: 'A0' }]
  await assertSucceeds(updateDoc(sched(fs('viewer')), { marks: mark, marksAt: 1, marksBy: 'viewer' }))
  await assertFails(updateDoc(sched(fs('viewer')), { marks: [], marksAt: 2, marksBy: 'ed' }), '남의 이름으로 스티커')
  await assertFails(updateDoc(sched(fs('viewer')), { fileName: '바꾼 이름' }))
  await assertFails(updateDoc(sched(fs('outsider')), { marks: [], marksAt: 3, marksBy: 'outsider' }))
  await assertSucceeds(updateDoc(sched(fs('ed2')), { fileName: '11월.pdf' }))
  await assertFails(deleteDoc(sched(fs('viewer'))))
  await assertSucceeds(deleteDoc(sched(fs('ed'))))
})

test('사용 중지된 계정은 팀 데이터를 못 읽고 못 쓰지만, 자기 프로필(중지 이유)은 읽는다', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/ed'), { name: '편집', teamIds: ['t1'], active: false, disabledReason: '휴직' })
    await setDoc(doc(ctx.firestore(), 'users/ed2'), { name: '편집2', teamIds: ['t1'], active: true })
  })
  await assertFails(getDoc(doc(fs('ed'), 'customers/c1')))
  await assertFails(getDoc(doc(fs('ed'), 'teams/t1/messages/m1')))
  await assertFails(setDoc(doc(fs('ed'), 'teams/t1/messages/m9'), { authorUid: 'ed', body: 'x', createdAt: 2 }))
  await assertFails(updateDoc(doc(fs('ed'), 'users/ed'), { name: '바꿈' }))
  await assertSucceeds(getDoc(doc(fs('ed'), 'users/ed')))
  // active: true이거나 표시가 없는(예전) 계정은 그대로 쓴다
  await assertSucceeds(getDoc(doc(fs('ed2'), 'customers/c1')))
  await assertSucceeds(getDoc(doc(fs('viewer'), 'customers/c1')))
})

test('본인은 사용 중지, 임시 비밀번호 표시를 스스로 바꿀 수 없다', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/ed'), { name: '편집', teamIds: ['t1'], active: false, mustChangePassword: true })
  })
  await assertFails(updateDoc(doc(fs('ed'), 'users/ed'), { active: true }))
  await assertFails(updateDoc(doc(fs('ed'), 'users/ed'), { mustChangePassword: false }))
})
