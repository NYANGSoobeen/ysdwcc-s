import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type Timestamp,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
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

// ── 단체 채팅방 ───────────────────────────────────────────────
// 기본 방(main): 처음부터 있던 방. 메시지는 teams/{teamId}/messages에 있고 지울 수 없다.
// 만든 방: teams/{teamId}/channels/{channelId}, 메시지는 그 아래 messages.
// 사진은 방과 상관없이 teams/{teamId}/chat/{msgId}/ 에 둔다.
export const MAIN_CHANNEL = 'main'
export const MAIN_CHANNEL_NAME = '전체 채팅'

export type Channel = { id: string; name: string; createdBy: string | null; createdAt: Timestamp | null }

export function messagesRef(teamId: string, channelId: string): CollectionReference {
  return channelId === MAIN_CHANNEL
    ? collection(db, 'teams', teamId, 'messages')
    : collection(db, 'teams', teamId, 'channels', channelId, 'messages')
}

// 팀의 채팅방 목록 (기본 방이 맨 앞, 나머지는 만든 순서)
export function useChannels(teamId: string | undefined) {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  useEffect(() => {
    setChannels(null)
    if (!teamId) return
    return onSnapshot(
      collection(db, 'teams', teamId, 'channels'),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          name: String(d.get('name') ?? ''),
          createdBy: (d.get('createdBy') as string) ?? null,
          createdAt: (d.get('createdAt') as Timestamp) ?? null,
        }))
        const main = list.find((c) => c.id === MAIN_CHANNEL)
        const others = list
          .filter((c) => c.id !== MAIN_CHANNEL)
          .sort((a, b) => (a.createdAt?.toMillis() ?? Infinity) - (b.createdAt?.toMillis() ?? Infinity))
        setChannels([
          { id: MAIN_CHANNEL, name: main?.name || MAIN_CHANNEL_NAME, createdBy: null, createdAt: null },
          ...others,
        ])
      },
      () => setChannels([{ id: MAIN_CHANNEL, name: MAIN_CHANNEL_NAME, createdBy: null, createdAt: null }]),
    )
  }, [teamId])
  return channels
}

export async function createChannel(teamId: string, name: string) {
  const ref = doc(collection(db, 'teams', teamId, 'channels'))
  await setDoc(ref, { name: name.trim(), createdBy: auth.currentUser!.uid, createdAt: serverTimestamp() })
  return ref.id
}

export async function renameChannel(teamId: string, channelId: string, name: string) {
  const ref = doc(db, 'teams', teamId, 'channels', channelId)
  // 기본 방은 이름을 처음 바꿀 때 문서가 생긴다.
  if (channelId === MAIN_CHANNEL) {
    await setDoc(ref, { name: name.trim(), createdBy: auth.currentUser!.uid, createdAt: serverTimestamp() }).catch(() =>
      updateDoc(ref, { name: name.trim() }),
    )
  } else {
    await updateDoc(ref, { name: name.trim() })
  }
}

// 방과 방의 모든 메시지·사진을 영구 삭제한다 (메시지와 사진은 Functions가 지운다).
export async function deleteChannel(teamId: string, channelId: string) {
  await deleteDoc(doc(db, 'teams', teamId, 'channels', channelId))
}

// ── 메시지 ───────────────────────────────────────────────────

// 사진을 압축해 올린 뒤 메시지를 저장한다. 메시지 저장에 실패하면 올린 사진을 지운다.
export async function sendMessage(teamId: string, channelId: string, body: string, photos: File[] = []) {
  const uid = auth.currentUser!.uid
  const messageRef = doc(messagesRef(teamId, channelId))
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
export async function deleteMessage(teamId: string, channelId: string, messageId: string) {
  await deleteDoc(doc(messagesRef(teamId, channelId), messageId))
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
