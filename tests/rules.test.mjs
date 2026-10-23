import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
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

test('팀은 만든 사람이 유일한 관리자로 시작한다', async () => {
  await assertSucceeds(setDoc(doc(fs('u9'), 'teams/t9'), { name: 'x', members: { u9: 'admin' } }))
  await assertFails(setDoc(doc(fs('u8'), 'teams/t8'), { name: 'x', members: { u8: 'admin', other: 'admin' } }))
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
