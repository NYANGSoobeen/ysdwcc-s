import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, type QueryDocumentSnapshot, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { resizeToJpeg, type Attachment } from './chat.ts'
import { auth, db, storage } from './firebase.ts'

// 📢 공지 게시판 (7번): 팀마다 teams/{teamId}/notices/{id}
// {title(없어도 됨), body, photos[{path, thumbPath, width, height, size, thumbSize}], authorUid, createdAt, editedAt, editedBy, stk, stkLast, pinned, order}
// 사진은 줄여서(긴 쪽 1600px + 카드용 800px, 반씩 나눠 줄여 깨지지 않게) Storage teams/{teamId}/notices/{id}/ 에 둔다.
// 공지를 고치거나 지우면 Functions(onNoticeWritten)가 안 쓰는 사진을 지운다.
// 보는 화면에서만 최근 50개를 실시간으로 받는다.

export type Notice = {
  id: string
  title: string
  body: string
  photos: Attachment[]
  authorUid: string
  createdAt: Timestamp | null
  editedAt: Timestamp | null
  editedBy: string | null
  stk: unknown
  pinned: boolean // 📌 상단 고정
  order: number // 순서 (작을수록 위, ⠿ 끌어서 바꿈). 없으면 -만든 시각 → 새 글이 위
}

export const NOTICE_PAGE = 50
export const MAX_NOTICE_PHOTOS = 10

export const noticesRef = (teamId: string) => collection(db, 'teams', teamId, 'notices')

function toNotice(d: QueryDocumentSnapshot): Notice {
  const v = d.data({ serverTimestamps: 'estimate' })
  const createdAt = (v.createdAt as Timestamp) ?? null
  return {
    id: d.id,
    title: String(v.title ?? ''),
    body: String(v.body ?? ''),
    photos: (v.photos as Attachment[]) ?? [],
    authorUid: String(v.authorUid ?? ''),
    createdAt,
    editedAt: (v.editedAt as Timestamp) ?? null,
    editedBy: (v.editedBy as string) ?? null,
    stk: v.stk ?? null,
    pinned: v.pinned === true,
    order: typeof v.order === 'number' ? v.order : -(createdAt?.toMillis() ?? Date.now()),
  }
}

// 최근 50개 + 상단 고정 공지(오래돼도)를 실시간으로. 고정이 먼저, 그다음 순서(order) 작은 것부터.
export function useNotices(teamId: string) {
  const [recent, setRecent] = useState<Notice[] | null>(null)
  const [pinned, setPinned] = useState<Notice[]>([])
  useEffect(() => {
    setRecent(null)
    setPinned([])
    const a = onSnapshot(
      query(noticesRef(teamId), orderBy('createdAt', 'desc'), limit(NOTICE_PAGE)),
      (snap) => setRecent(snap.docs.map(toNotice)),
      () => setRecent([]),
    )
    const b = onSnapshot(
      query(noticesRef(teamId), where('pinned', '==', true)),
      (snap) => setPinned(snap.docs.map(toNotice)),
      () => setPinned([]),
    )
    return () => {
      a()
      b()
    }
  }, [teamId])
  if (recent === null) return null
  const byId = new Map<string, Notice>()
  for (const n of [...recent, ...pinned]) byId.set(n.id, n)
  for (const n of recent) if (n.pinned && !pinned.some((p) => p.id === n.id)) byId.set(n.id, n)
  return [...byId.values()].sort((x, y) => Number(y.pinned) - Number(x.pinned) || x.order - y.order)
}

export async function setNoticePinned(teamId: string, id: string, pinned: boolean) {
  await updateDoc(doc(noticesRef(teamId), id), { pinned })
}
export async function setNoticeOrder(teamId: string, id: string, order: number) {
  await updateDoc(doc(noticesRef(teamId), id), { order })
}

// 새 공지 또는 고치기: 남긴 사진(keep) + 새 사진(files)을 올리고 저장한다. 저장에 실패하면 새로 올린 사진을 지운다.
export async function saveNotice(
  teamId: string,
  existing: Notice | null,
  data: { title: string; body: string; keep: Attachment[]; files: File[] },
  onProgress?: (done: number, total: number) => void,
) {
  const uid = auth.currentUser!.uid
  const noticeRef = existing ? doc(noticesRef(teamId), existing.id) : doc(noticesRef(teamId))
  const folder = `teams/${teamId}/notices/${noticeRef.id}`
  const meta = { contentType: 'image/jpeg', customMetadata: { uploaderUid: uid } }
  const stamp = Date.now().toString(36)
  const uploaded: string[] = []
  const photos: Attachment[] = [...data.keep]
  try {
    for (const [i, file] of data.files.entries()) {
      const photo = await resizeToJpeg(file, 1600)
      const thumb = await resizeToJpeg(file, 800) // 카드 맨 위 220px 칸에 또렷하게(휴대폰 3배 화면)
      const path = `${folder}/${stamp}_${i}.jpg`
      const thumbPath = `${folder}/${stamp}_${i}_thumb.jpg`
      await uploadBytes(ref(storage, path), photo.blob, meta)
      uploaded.push(path)
      await uploadBytes(ref(storage, thumbPath), thumb.blob, meta)
      uploaded.push(thumbPath)
      photos.push({ path, thumbPath, width: photo.width, height: photo.height, size: photo.blob.size, thumbSize: thumb.blob.size })
      onProgress?.(i + 1, data.files.length)
    }
    const fields = { title: data.title.trim().slice(0, 100), body: data.body.trim().slice(0, 5000), photos }
    if (existing) await updateDoc(noticeRef, { ...fields, editedAt: serverTimestamp(), editedBy: uid })
    else await setDoc(noticeRef, { ...fields, authorUid: uid, createdAt: serverTimestamp(), editedAt: null, editedBy: null, pinned: false, order: -Date.now() })
  } catch (error) {
    await Promise.allSettled(uploaded.map((p) => deleteObject(ref(storage, p))))
    throw error
  }
  return noticeRef.id
}

export async function deleteNotice(teamId: string, id: string) {
  await deleteDoc(doc(noticesRef(teamId), id))
}
