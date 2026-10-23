import { collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from './firebase.ts'

export type Attachment = {
  path: string
  thumbPath: string
  width: number
  height: number
  size: number
  thumbSize: number
}

const PHOTO_MAX_SIDE = 1600
const THUMB_MAX_SIDE = 400
const JPEG_QUALITY = 0.8

// 사진을 압축해 올린 뒤 메시지를 저장한다. 메시지 저장에 실패하면 올린 사진을 지운다.
export async function sendMessage(teamId: string, body: string, photos: File[] = []) {
  const uid = auth.currentUser!.uid
  const messageRef = doc(collection(db, 'teams', teamId, 'messages'))
  const folder = `teams/${teamId}/chat/${messageRef.id}`
  const metadata = { contentType: 'image/jpeg', customMetadata: { uploaderUid: uid } }

  const uploaded: string[] = []
  const attachments: Attachment[] = []
  try {
    for (const [i, file] of photos.entries()) {
      const photo = await resizeToJpeg(file, PHOTO_MAX_SIDE)
      const thumb = await resizeToJpeg(file, THUMB_MAX_SIDE)
      const path = `${folder}/${i}.jpg`
      const thumbPath = `${folder}/${i}_thumb.jpg`
      await uploadBytes(ref(storage, path), photo.blob, metadata)
      uploaded.push(path)
      await uploadBytes(ref(storage, thumbPath), thumb.blob, metadata)
      uploaded.push(thumbPath)
      attachments.push({
        path,
        thumbPath,
        width: photo.width,
        height: photo.height,
        size: photo.blob.size,
        thumbSize: thumb.blob.size,
      })
    }

    await setDoc(messageRef, {
      authorUid: uid,
      body,
      mentions: [],
      customerTags: [],
      replyTo: null,
      attachments,
      // 사진 모아보기에서 사진이 있는 메시지만 조회하기 위한 표시
      hasPhotos: attachments.length > 0,
      createdAt: serverTimestamp(),
      editedAt: null,
    })
  } catch (error) {
    await Promise.allSettled(uploaded.map((path) => deleteObject(ref(storage, path))))
    throw error
  }
  return messageRef.id
}

// 바로 영구 삭제한다. 첨부 사진은 서버(Functions)가 지운다.
export async function deleteMessage(teamId: string, messageId: string) {
  await deleteDoc(doc(db, 'teams', teamId, 'messages', messageId))
}

async function resizeToJpeg(file: File, maxSide: number) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진 변환 실패'))), 'image/jpeg', JPEG_QUALITY),
  )
  return { blob, width, height }
}

const urlCache = new Map<string, Promise<string>>()

// 같은 사진의 주소를 여러 번 요청하지 않도록 기억해 둔다.
export function photoUrl(path: string) {
  let url = urlCache.get(path)
  if (!url) {
    url = getDownloadURL(ref(storage, path))
    url.catch(() => urlCache.delete(path))
    urlCache.set(path, url)
  }
  return url
}
