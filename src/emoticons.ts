import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { useEffect, useSyncExternalStore } from 'react'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from './firebase.ts'

// 😊 이모티콘 (카톡 이모티콘처럼, 모든 팀 공용). 최고 관리자만 테마·이모티콘을 추가·삭제한다.
// - stickerPacks/{id} {name, order}            테마 (예: 강아지, 고양이)
// - stickers/{id} {packId, assetId, name, order} 이모티콘 하나 (assetId = Storage 경로 stickers/{id}.{확장자})
// - 채팅 메시지 {stickerAssetId} 로 보낸다 (글 없이 그림만).
// 목록은 실시간 구독하지 않고 처음 열 때 한 번 읽어 둔다 (읽기 절약). 관리자 화면은 바꿀 때마다 다시 읽는다.

export type EmoticonPack = { id: string; name: string; order: number }
export type Emoticon = { id: string; packId: string; assetId: string; name: string; order: number }

const MAX_SIDE = 256
export const EMOTICON_MAX_BYTES = 1024 * 1024 // storage.rules와 같게 (GIF 원본)

type State = { packs: EmoticonPack[]; items: Emoticon[]; loaded: boolean }
let state: State = { packs: [], items: [], loaded: false }
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export async function loadEmoticons(force = false) {
  if (loading && !force) return loading
  loading = (async () => {
    const [packs, items] = await Promise.all([
      getDocs(query(collection(db, 'stickerPacks'), orderBy('order'))),
      getDocs(query(collection(db, 'stickers'), orderBy('order'))),
    ])
    state = {
      packs: packs.docs.map((d) => ({ id: d.id, name: String(d.get('name') ?? ''), order: Number(d.get('order') ?? 0) })),
      items: items.docs.map((d) => ({
        id: d.id,
        packId: String(d.get('packId') ?? ''),
        assetId: String(d.get('assetId') ?? ''),
        name: String(d.get('name') ?? ''),
        order: Number(d.get('order') ?? 0),
      })),
      loaded: true,
    }
    emit()
  })()
  loading.catch(() => (loading = null))
  return loading
}

// enabled일 때 한 번 읽는다 (😊 창을 처음 열 때, 관리자 화면).
export function useEmoticons(enabled = true) {
  useEffect(() => {
    if (enabled) loadEmoticons().catch(() => {})
  }, [enabled])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

// ── 최근 보낸 이모티콘 (이 기기에만 기억) ──
const RECENT_KEY = 'recent-emoticons'
const RECENT_MAX = 24
export function recentEmoticons(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function rememberEmoticon(assetId: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([assetId, ...recentEmoticons().filter((a) => a !== assetId)].slice(0, RECENT_MAX)))
  } catch {
    // 기억하지 못해도 보내기는 된다.
  }
}

// ── 최고 관리자: 테마·이모티콘 관리 ──
export async function addPack(name: string) {
  const order = Math.max(0, ...state.packs.map((p) => p.order)) + 1
  await setDoc(doc(collection(db, 'stickerPacks')), { name: name.trim().slice(0, 30), order, createdAt: serverTimestamp() })
  await loadEmoticons(true)
}

export async function renamePack(id: string, name: string) {
  await updateDoc(doc(db, 'stickerPacks', id), { name: name.trim().slice(0, 30) })
  await loadEmoticons(true)
}

// 테마 순서 바꾸기 (위/아래 이웃과 맞바꿈)
export async function movePack(id: string, dir: -1 | 1) {
  const list = [...state.packs]
  const i = list.findIndex((p) => p.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  // 순서는 1, 2, 3…으로 다시 매긴다.
  const batch = writeBatch(db)
  list.forEach((p, k) => batch.update(doc(db, 'stickerPacks', p.id), { order: k + 1 }))
  await batch.commit()
  await loadEmoticons(true)
}

// 테마를 지우면 그 테마의 이모티콘도 지운다 (그림 파일은 Functions onStickerDeleted가 지움).
export async function deletePack(id: string) {
  const items = await getDocs(query(collection(db, 'stickers'), where('packId', '==', id)))
  for (let i = 0; i < items.docs.length; i += 400) {
    const batch = writeBatch(db)
    items.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await deleteDoc(doc(db, 'stickerPacks', id))
  await loadEmoticons(true)
}

export async function deleteEmoticon(id: string) {
  await deleteDoc(doc(db, 'stickers', id))
  await loadEmoticons(true)
}

export class EmoticonFileError extends Error {}

// PNG·JPG·WebP는 긴 쪽 256px PNG로 줄이고(투명 바탕 유지), 움직이는 GIF는 원본 그대로(1MB까지) 올린다.
async function prepare(file: File): Promise<{ blob: Blob; type: string; ext: string }> {
  if (file.type === 'image/gif') {
    if (file.size > EMOTICON_MAX_BYTES) throw new EmoticonFileError(`"${file.name}"은(는) 1MB를 넘어 올릴 수 없어요. (움직이는 GIF는 원본 그대로 올려요)`)
    return { blob: file, type: 'image/gif', ext: 'gif' }
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new EmoticonFileError(`"${file.name}"은(는) 그림 파일(PNG·JPG·GIF·WebP)이 아니에요.`)
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그림 변환 실패'))), 'image/png'))
  if (blob.size > EMOTICON_MAX_BYTES) throw new EmoticonFileError(`"${file.name}"이(가) 너무 커요.`)
  return { blob, type: 'image/png', ext: 'png' }
}

export async function addEmoticons(packId: string, files: File[], onProgress?: (done: number, total: number) => void) {
  let order = Math.max(0, ...state.items.filter((i) => i.packId === packId).map((i) => i.order)) + 1
  let done = 0
  for (const file of files) {
    const { blob, type, ext } = await prepare(file)
    const docRef = doc(collection(db, 'stickers'))
    const assetId = `stickers/${docRef.id}.${ext}`
    await uploadBytes(ref(storage, assetId), blob, { contentType: type, customMetadata: { uploaderUid: auth.currentUser!.uid } })
    try {
      await setDoc(docRef, { packId, assetId, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), order: order++, createdAt: serverTimestamp() })
    } catch (err) {
      await deleteObject(ref(storage, assetId)).catch(() => {})
      throw err
    }
    onProgress?.(++done, files.length)
  }
  await loadEmoticons(true)
}
