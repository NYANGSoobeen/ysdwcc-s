import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase.ts'

export type Customer = {
  id: string
  teamId: string
  name: string
  company: string
  phones: string[]
  ownerUid: string
  nextContactAt: Timestamp | null
  nextContactNote: string
  createdBy: string
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

export type Note = {
  id: string
  kind: string
  body: string
  authorUid: string
  createdAt: Timestamp | null
  editedBy: string | null
  editedAt: Timestamp | null
  editCount: number
}

export type Revision = { id: string; body: string; editedBy: string; editedAt: Timestamp | null }

export const NOTE_KINDS = ['발신 통화', '수신 통화', '방문 미팅', '문자/카톡', '메모']

// 국내 번호를 E.164(+82…)로 바꾼다. 예: 010-1234-5678 → +821012345678
export function normalizePhone(input: string) {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.startsWith('82')) return `+${digits}`
  if (digits.startsWith('0')) return `+82${digits.slice(1)}`
  return `+82${digits}`
}

// 화면 표시용. +821012345678 → 010-1234-5678
export function formatPhone(e164: string) {
  if (!e164.startsWith('+82')) return e164
  const local = `0${e164.slice(3)}`
  if (/^02\d{7,8}$/.test(local)) return local.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3')
  if (/^0\d{9,10}$/.test(local)) return local.replace(/^(0\d{2})(\d{3,4})(\d{4})$/, '$1-$2-$3')
  return local
}

export function isValidPhone(e164: string) {
  return /^\+\d{9,15}$/.test(e164)
}

// 같은 번호의 고객이 팀에 이미 있으면 그 고객을 돌려준다 (새로 만들지 않고 연결하기 위함).
export async function findCustomerByPhone(teamId: string, phones: string[]) {
  for (const phone of phones) {
    const snap = await getDocs(
      query(
        collection(db, 'customers'),
        where('teamId', '==', teamId),
        where('phones', 'array-contains', phone),
        limit(1),
      ),
    )
    if (!snap.empty) return { id: snap.docs[0].id, name: snap.docs[0].get('name') as string, phone }
  }
  return null
}

export async function createCustomer(
  teamId: string,
  fields: { name: string; company: string; phones: string[] },
) {
  const uid = auth.currentUser!.uid
  const ref = await addDoc(collection(db, 'customers'), {
    teamId,
    name: fields.name,
    company: fields.company,
    phones: fields.phones,
    ownerUid: uid,
    nextContactAt: null,
    nextContactNote: '',
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateCustomer(
  customerId: string,
  fields: Partial<Pick<Customer, 'name' | 'company' | 'phones' | 'ownerUid' | 'nextContactAt' | 'nextContactNote'>>,
) {
  await updateDoc(doc(db, 'customers', customerId), { ...fields, updatedAt: serverTimestamp() })
}

// 바로 영구 삭제한다. 메모와 수정 기록은 서버(Functions)가 함께 지운다.
// 되돌릴 수 없으므로 화면에서 반드시 확인 창을 띄운 뒤 호출한다.
export async function deleteCustomer(customerId: string) {
  await deleteDoc(doc(db, 'customers', customerId))
}

export async function addNote(customerId: string, kind: string, body: string) {
  await addDoc(collection(db, 'customers', customerId, 'notes'), {
    kind,
    body,
    authorUid: auth.currentUser!.uid,
    createdAt: serverTimestamp(),
    editedBy: null,
    editedAt: null,
    editCount: 0,
  })
}

// 메모를 고치면 고치기 전 내용을 수정 기록에 남긴다.
export async function editNote(customerId: string, note: Note, body: string) {
  const uid = auth.currentUser!.uid
  const noteRef = doc(db, 'customers', customerId, 'notes', note.id)
  const batch = writeBatch(db)
  batch.set(doc(collection(noteRef, 'revisions')), {
    body: note.body,
    editedBy: note.editedBy ?? note.authorUid,
    editedAt: note.editedAt ?? note.createdAt,
  })
  batch.update(noteRef, {
    body,
    editedBy: uid,
    editedAt: serverTimestamp(),
    editCount: increment(1),
  })
  await batch.commit()
}

// 바로 영구 삭제한다. 수정 기록은 서버(Functions)가 함께 지운다.
export async function deleteNote(customerId: string, noteId: string) {
  await deleteDoc(doc(db, 'customers', customerId, 'notes', noteId))
}

export async function loadRevisions(customerId: string, noteId: string) {
  const snap = await getDocs(collection(db, 'customers', customerId, 'notes', noteId, 'revisions'))
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Revision, 'id'>) }))
    .sort((a, b) => (b.editedAt?.toMillis() ?? 0) - (a.editedAt?.toMillis() ?? 0))
}

export function toCustomer(id: string, data: Record<string, unknown>): Customer {
  return {
    id,
    teamId: '',
    name: '',
    company: '',
    phones: [],
    ownerUid: '',
    nextContactAt: null,
    nextContactNote: '',
    createdBy: '',
    createdAt: null,
    updatedAt: null,
    ...data,
  } as Customer
}

export function toNote(id: string, data: Record<string, unknown>): Note {
  return { id, kind: '메모', body: '', authorUid: '', createdAt: null, editedBy: null, editedAt: null, editCount: 0, ...data } as Note
}
