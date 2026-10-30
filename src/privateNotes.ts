import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { auth, db } from './firebase.ts'

// 🔒 개인 메모 (나만 보는 메모, 2026-10-30). 사용자가 정한 저장 위치:
// - 고객에 대한 개인 메모 → 서버 users/{uid}/customerNotes/{id} {customerId, kind, body, createdAt, editedAt}
//   보안 규칙상 본인만 읽고 쓴다(관리자도 못 봄). PC·휴대폰에서 같이 보인다. 고객을 지우면 Functions가 같이 지운다.
// - 고객이 아닌 번호(개인 통화)에 대한 메모 → 이 기기에만 (localStorage, 개인 통화는 서버에 안 올리는 규칙). 로그아웃하면 지운다.
// 👥 공용 메모는 지금처럼 customers/{id}/notes (팀이 함께 봄).

export type PrivateNote = { id: string; kind: string; body: string; at: number; editedAt: number | null }
export const PRIVATE_MAX = 4000

// ── 고객 개인 메모 (서버, 나만) ──
const myCol = () => collection(db, 'users', auth.currentUser!.uid, 'customerNotes')

export function useMyCustomerNotes(customerId: string) {
  const [notes, setNotes] = useState<PrivateNote[]>([])
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    return onSnapshot(
      query(collection(db, 'users', uid, 'customerNotes'), where('customerId', '==', customerId)),
      (snap) =>
        setNotes(
          snap.docs
            .map((d) => {
              const v = d.data({ serverTimestamps: 'estimate' })
              return {
                id: d.id,
                kind: (v.kind as string) ?? '메모',
                body: (v.body as string) ?? '',
                at: (v.createdAt as Timestamp | null)?.toMillis() ?? Date.now(),
                editedAt: (v.editedAt as Timestamp | null)?.toMillis() ?? null,
              }
            })
            .sort((a, b) => b.at - a.at),
        ),
      () => setNotes([]),
    )
  }, [customerId])
  return notes
}

export async function addMyCustomerNote(customerId: string, kind: string, body: string) {
  await addDoc(myCol(), { customerId, kind, body: body.slice(0, PRIVATE_MAX), createdAt: serverTimestamp(), editedAt: null })
}
export async function editMyCustomerNote(id: string, body: string) {
  await updateDoc(doc(myCol(), id), { body: body.slice(0, PRIVATE_MAX), editedAt: serverTimestamp() })
}
export async function deleteMyCustomerNote(id: string) {
  await deleteDoc(doc(myCol(), id))
}

// ── 개인 번호 메모 (이 기기에만) ──
export const DEVICE_NOTES_KEY = 'private-phone-notes'
const DEVICE_MAX = 500
type DeviceNote = PrivateNote & { number: string }
const digits = (n: string) => n.replace(/\D/g, '').replace(/^82/, '0')

function readDevice(): DeviceNote[] {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_NOTES_KEY) ?? '[]') as DeviceNote[]
  } catch {
    return []
  }
}
function writeDevice(list: DeviceNote[]) {
  try {
    localStorage.setItem(DEVICE_NOTES_KEY, JSON.stringify(list.slice(0, DEVICE_MAX)))
  } catch {
    // 저장 공간이 꽉 찼을 때: 메모를 못 남긴다
  }
  window.dispatchEvent(new Event(DEVICE_NOTES_KEY))
}
export function deviceNotesFor(number: string) {
  const key = digits(number)
  return readDevice()
    .filter((n) => digits(n.number) === key)
    .sort((a, b) => b.at - a.at)
}
// 메모가 있는 번호들 (최근기록에 🔒 표시)
export function deviceNoteNumbers() {
  return new Set(readDevice().map((n) => digits(n.number)))
}
export const noteKey = digits
export function addDeviceNote(number: string, kind: string, body: string) {
  writeDevice([{ id: String(Date.now()), number, kind, body: body.slice(0, PRIVATE_MAX), at: Date.now(), editedAt: null }, ...readDevice()])
}
export function editDeviceNote(id: string, body: string) {
  writeDevice(readDevice().map((n) => (n.id === id ? { ...n, body: body.slice(0, PRIVATE_MAX), editedAt: Date.now() } : n)))
}
export function deleteDeviceNote(id: string) {
  writeDevice(readDevice().filter((n) => n.id !== id))
}
export function useDeviceNotes(number: string) {
  const [list, setList] = useState(() => deviceNotesFor(number))
  useEffect(() => {
    const reload = () => setList(deviceNotesFor(number))
    reload()
    window.addEventListener(DEVICE_NOTES_KEY, reload)
    return () => window.removeEventListener(DEVICE_NOTES_KEY, reload)
  }, [number])
  return list
}
