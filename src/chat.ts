import {
  collection,
  deleteDoc,
  deleteField,
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
import { api, type LinkPreview } from './api.ts'
import { auth, db, storage } from './firebase.ts'

export type Attachment = {
  path: string
  thumbPath: string
  width: number
  height: number
  size: number
  thumbSize: number
}

// 채팅에 붙이는 파일 (사진이 아닌 것). 서버 규칙(storage.rules)과 같은 목록, 10MB 이하.
export type ChatFile = { path: string; name: string; size: number; type: string }
export const FILE_EXTS = ['xls', 'xlsx', 'csv', 'pdf', 'hwp', 'hwpx', 'doc', 'docx', 'ppt', 'pptx', 'zip', 'txt']
export const FILE_MAX_BYTES = 10 * 1024 * 1024
export const MAX_PHOTOS = 30

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
export const isPhotoFile = (f: File) => f.type.startsWith('image/') && !/svg/.test(f.type)

// 보낼 수 없는 파일이면 이유를 돌려준다.
export function fileProblem(f: File) {
  if (isPhotoFile(f)) return null
  if (!FILE_EXTS.includes(extOf(f.name))) return `"${f.name}"은(는) 보낼 수 없는 파일이에요. (엑셀·PDF·한글·워드·파워포인트·압축·텍스트만)`
  if (f.size > FILE_MAX_BYTES) return `"${f.name}"은(는) 10MB를 넘어 보낼 수 없어요.`
  return null
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
// 답장: 원문의 일부를 같이 저장해 두어, 원문을 불러오지 않아도 미리보기를 보여 준다.
export type { LinkPreview }

export type ReplyTo = { id: string; authorUid: string; text: string }

export function replyPreview(message: { body: string; attachments: Attachment[]; files?: ChatFile[] }) {
  if (message.body) return message.body.replace(/\s+/g, ' ').slice(0, 80)
  if (message.attachments.length) return `사진 ${message.attachments.length}장`
  return message.files?.length ? `파일 ${message.files[0].name}` : ''
}

export async function sendMessage(
  teamId: string,
  channelId: string,
  body: string,
  photos: File[] = [],
  replyTo: ReplyTo | null = null,
  files: File[] = [],
  onProgress?: (done: number, total: number) => void,
  mentions: string[] = [],
) {
  const uid = auth.currentUser!.uid
  const messageRef = doc(messagesRef(teamId, channelId))
  const folder = `teams/${teamId}/chat/${messageRef.id}`
  const meta = (contentType: string) => ({ contentType, customMetadata: { uploaderUid: uid } })

  const uploaded: string[] = []
  const attachments: Attachment[] = new Array(photos.length)
  const chatFiles: ChatFile[] = []
  const total = photos.length + files.length
  let done = 0
  const tick = () => onProgress?.(++done, total)
  try {
    // 사진은 줄여서(긴 쪽 1600px, 썸네일 400px) 3장씩 동시에 올린다.
    let next = 0
    const worker = async () => {
      while (next < photos.length) {
        const i = next++
        const file = photos[i]
        const photo = await resizeToJpeg(file, PHOTO_MAX_SIDE)
        const thumb = await resizeToJpeg(file, THUMB_MAX_SIDE)
        const path = `${folder}/${i}.jpg`
        const thumbPath = `${folder}/${i}_thumb.jpg`
        await uploadBytes(ref(storage, path), photo.blob, meta('image/jpeg'))
        uploaded.push(path)
        await uploadBytes(ref(storage, thumbPath), thumb.blob, meta('image/jpeg'))
        uploaded.push(thumbPath)
        attachments[i] = { path, thumbPath, width: photo.width, height: photo.height, size: photo.blob.size, thumbSize: thumb.blob.size }
        tick()
      }
    }
    await Promise.all([worker(), worker(), worker()])

    for (const [i, file] of files.entries()) {
      const path = `${folder}/f_${i}.${extOf(file.name)}`
      const type = file.type || 'application/octet-stream'
      await uploadBytes(ref(storage, path), file, meta(type))
      uploaded.push(path)
      chatFiles.push({ path, name: file.name, size: file.size, type })
      tick()
    }

    await setDoc(messageRef, {
      authorUid: uid,
      body,
      mentions,
      customerTags: [],
      replyTo,
      attachments,
      files: chatFiles,
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

// 링크 미리보기: 보낸 뒤 서버가 읽어 온 제목·설명·사진을 메시지에 붙인다.
// 🔎 #검색 결과 하나를 카드로 보낸다 (글 없이 link만, 답장 중이면 답장으로).
export async function sendLinkMessage(teamId: string, channelId: string, link: LinkPreview, replyTo: ReplyTo | null = null) {
  const messageRef = doc(messagesRef(teamId, channelId))
  await setDoc(messageRef, {
    authorUid: auth.currentUser!.uid,
    body: '',
    mentions: [],
    customerTags: [],
    replyTo,
    attachments: [],
    files: [],
    link,
    hasPhotos: false,
    createdAt: serverTimestamp(),
    editedAt: null,
  })
  return messageRef.id
}

export async function attachLinkPreview(teamId: string, channelId: string, messageId: string, url: string) {
  const preview = await api.linkPreview({ url }).catch(() => null)
  if (preview) await updateDoc(doc(messagesRef(teamId, channelId), messageId), { link: preview }).catch(() => {})
}

export const firstUrl = (text: string) => text.match(/https?:\/\/[^\s<>"']+/)?.[0] ?? null

// @멘션: 글 속 "@이름"과 "@모두"를 찾아 부른 사람 목록(uid)을 만든다. @모두는 나를 뺀 팀원 전부.
export const MENTION_ALL = '모두'
export function findMentions(text: string, members: { uid: string; name: string }[], me: string) {
  const found = new Set<string>()
  if (text.includes(`@${MENTION_ALL}`)) members.forEach((m) => m.uid !== me && found.add(m.uid))
  for (const m of members) if (m.name && text.includes(`@${m.name}`)) found.add(m.uid)
  found.delete(me)
  return [...found]
}

// 내 메시지 수정
export async function editMessage(teamId: string, channelId: string, messageId: string, body: string) {
  await updateDoc(doc(messagesRef(teamId, channelId), messageId), { body, editedAt: serverTimestamp() })
}

// 내 메시지 삭제: 글과 사진은 바로 영구 삭제하고, 대화 흐름이 끊기지 않게 "삭제된 메시지입니다" 자리만 남긴다.
export async function deleteMessage(
  teamId: string,
  channelId: string,
  message: { id: string; attachments: Attachment[]; files: ChatFile[] },
) {
  await updateDoc(doc(messagesRef(teamId, channelId), message.id), {
    deleted: true,
    body: '',
    attachments: [],
    files: [],
    hasPhotos: false,
    replyTo: null,
    mentions: [],
    customerTags: [],
    link: null,
    editedAt: null,
  })
  // 사진 파일은 올린 사람이 지울 수 있다 (Storage 규칙).
  await Promise.allSettled([
    ...message.attachments.flatMap((a) => [deleteObject(ref(storage, a.path)), deleteObject(ref(storage, a.thumbPath))]),
    ...message.files.map((f) => deleteObject(ref(storage, f.path))),
  ])
}

// 스티커(공감): 메시지마다 한 사람에 하나. 같은 것을 다시 누르면 뗀다.
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅'] as const

export async function setReaction(teamId: string, channelId: string, messageId: string, uid: string, emoji: string | null) {
  await updateDoc(doc(messagesRef(teamId, channelId), messageId), {
    [`reactions.${uid}`]: emoji ?? deleteField(),
  })
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
