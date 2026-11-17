import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, uploadBytesResumable } from 'firebase/storage'
import { resizeToJpeg, videoInfo, videoType } from '../chat.ts'
import { ydrAuth, ydrDb, ydrStorage } from './ydr.ts'

// 🏌️ 프론트 채팅방에 🖼️ 사진 · 🎬 동영상 · 📎 파일 보내기 (2026-11-17, 프론트 GUEST_LINK.md 5-2 그대로).
// 프론트 Storage assets/{무작위 32자} 에 올리고 assetsMeta/{id} {sizeBytes, contentType, createdAt(ISO), by: 내 g_ uid} 를 남긴 뒤
// 프론트 직원과 같은 모양으로 메시지를 쓴다: 사진 {imageAssetId, imageAssetIds}, 동영상 {video:{assetId, poster?, name, size, mime, w?, h?, dur?}},
// 파일 {file:{assetId, name, size, mime}}. 크기: 보통 파일·사진 20MB 미만, 동영상 100MB 미만 (프론트 storage.rules).
// 게스트는 프론트 파일을 못 지우므로, 메시지를 지우면 칸만 비우고 파일은 프론트 저장공간 정리가 치운다.
export const FRONT_MAX_PHOTOS = 30
export const FRONT_FILE_MAX = 20 * 1024 * 1024
export const FRONT_VIDEO_MAX = 100 * 1024 * 1024
export type FrontVideo = { assetId: string; poster?: string; name: string; size: number; mime: string; w?: number; h?: number; dur?: number }

const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')

async function put(blob: Blob, onProgress?: (p: number) => void) {
  const id = newId()
  const contentType = blob.type || 'application/octet-stream'
  if (onProgress) {
    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(ref(ydrStorage, `assets/${id}`), blob, { contentType })
      task.on('state_changed', (s) => onProgress(Math.floor((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)), reject, () => resolve())
    })
  } else {
    await uploadBytes(ref(ydrStorage, `assets/${id}`), blob, { contentType })
  }
  await setDoc(doc(ydrDb, 'assetsMeta', id), { sizeBytes: blob.size, contentType, createdAt: new Date().toISOString(), by: ydrAuth.currentUser!.uid })
  return id
}

export async function uploadFrontPhotos(files: File[], onProgress?: (done: number, total: number) => void) {
  const ids: string[] = new Array(files.length)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < files.length) {
      const i = next++
      const photo = await resizeToJpeg(files[i], 1600)
      ids[i] = await put(photo.blob)
      onProgress?.(++done, files.length)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return ids
}

export async function uploadFrontVideo(file: File, onProgress?: (percent: number) => void): Promise<FrontVideo> {
  if (file.size >= FRONT_VIDEO_MAX) throw new Error(`"${file.name}"은(는) 100MB를 넘어 보낼 수 없어요. 갤러리에서 길이를 잘라 다시 보내 주세요.`)
  const mime = videoType(file)
  const info = await videoInfo(file)
  const out: FrontVideo = { assetId: '', name: file.name.slice(0, 120) || '동영상', size: file.size, mime }
  if (info?.w && info.h) Object.assign(out, { w: info.w, h: info.h })
  if (info && Number.isFinite(info.dur) && info.dur > 0) out.dur = Math.round(info.dur * 10) / 10
  if (info?.poster) out.poster = await put(info.poster)
  out.assetId = await put(file.type ? file : new Blob([file], { type: mime }), onProgress)
  return out
}

export async function uploadFrontFile(file: File, onProgress?: (percent: number) => void) {
  if (file.size >= FRONT_FILE_MAX) throw new Error(`"${file.name}"은(는) 20MB를 넘어 보낼 수 없어요.`)
  const assetId = await put(file, onProgress)
  return { assetId, name: file.name.slice(0, 120) || '파일', size: file.size, mime: file.type || 'application/octet-stream' }
}
