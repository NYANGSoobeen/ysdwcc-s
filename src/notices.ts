import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { resizeToJpeg, type Attachment } from './chat.ts'
import { auth, db, storage } from './firebase.ts'

// 📢 공지 게시판 (7번): 팀마다 teams/{teamId}/notices/{id}
// {title, body, photos[{path, thumbPath, width, height, size, thumbSize}], authorUid, createdAt, editedAt, editedBy, stk, stkLast}
// 사진은 채팅처럼 줄여서(긴 쪽 1600px + 썸네일 400px) Storage teams/{teamId}/notices/{id}/ 에 둔다.
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
}

export const NOTICE_PAGE = 50
export const MAX_NOTICE_PHOTOS = 10

export const noticesRef = (teamId: string) => collection(db, 'teams', teamId, 'notices')

export function useNotices(teamId: string) {
  const [notices, setNotices] = useState<Notice[] | null>(null)
  useEffect(() => {
    setNotices(null)
    return onSnapshot(
      query(noticesRef(teamId), orderBy('createdAt', 'desc'), limit(NOTICE_PAGE)),
      (snap) =>
        setNotices(
          snap.docs.map((d) => {
            const v = d.data({ serverTimestamps: 'estimate' })
            return {
              id: d.id,
              title: String(v.title ?? ''),
              body: String(v.body ?? ''),
              photos: (v.photos as Attachment[]) ?? [],
              authorUid: String(v.authorUid ?? ''),
              createdAt: (v.createdAt as Timestamp) ?? null,
              editedAt: (v.editedAt as Timestamp) ?? null,
              editedBy: (v.editedBy as string) ?? null,
              stk: v.stk ?? null,
            }
          }),
        ),
      () => setNotices([]),
    )
  }, [teamId])
  return notices
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
      const thumb = await resizeToJpeg(file, 400)
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
    else await setDoc(noticeRef, { ...fields, authorUid: uid, createdAt: serverTimestamp(), editedAt: null, editedBy: null })
  } catch (error) {
    await Promise.allSettled(uploaded.map((p) => deleteObject(ref(storage, p))))
    throw error
  }
  return noticeRef.id
}

export async function deleteNotice(teamId: string, id: string) {
  await deleteDoc(doc(noticesRef(teamId), id))
}
