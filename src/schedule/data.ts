import { collection, deleteDoc, doc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from '../firebase.ts'
import { toLuminance, type Pixels } from './cells.ts'
import type { Mark } from './stickers.ts'

// 팀마다 스케줄은 하나: teams/{teamId}/schedule/current
// 파일은 teams/{teamId}/schedule/{uploadId}/ 아래. 새로 올리거나 지우면 Functions가 이전 폴더를 지운다.
export type SchedulePage = { assetId: string; name: string; w: number; h: number; scale: number }

export type Schedule = {
  uploadId: string
  fileName: string
  assetId: string | null // 원본 파일 (PDF는 1MB 이하일 때만, 사진은 남기지 않음)
  size: number
  pdfDropped: boolean
  images: SchedulePage[]
  marks: Mark[]
  marksAt: unknown
  marksBy: string | null
  authorId: string
}

export const scheduleRef = (teamId: string) => doc(db, 'teams', teamId, 'schedule', 'current')

const MAX_PAGES = 10
const LONG_SIDE = 2400
const MAX_PIXELS = 14_000_000 // 휴대폰 캔버스 한도 (가로×세로)
const JPEG_QUALITY = 0.88
const KEEP_PDF_BYTES = 1024 * 1024

export const EXCEL_HINT =
  '엑셀에서 파일 → 내보내기 → PDF로 저장하거나, 화면을 캡처(Win+Shift+S)해서 사진으로 올려 주세요.'

export class ScheduleFileError extends Error {}

type RenderedPage = { blob: Blob; w: number; h: number; scale: number }

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그림 변환 실패'))), type, quality),
  )
}

// PNG와 JPEG(0.88)를 둘 다 만들어 작은 쪽을 쓴다 (표는 PNG, 사진 같은 근무표는 JPEG가 작다).
async function smallerBlob(canvas: HTMLCanvasElement) {
  const [png, jpeg] = await Promise.all([canvasBlob(canvas, 'image/png'), canvasBlob(canvas, 'image/jpeg', JPEG_QUALITY)])
  return png.size <= jpeg.size ? png : jpeg
}

function fitScale(w: number, h: number, allowUpscale: boolean) {
  const s = Math.min(LONG_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)))
  return allowUpscale ? s : Math.min(1, s)
}

async function renderPdf(file: File, onProgress: (text: string) => void): Promise<RenderedPage[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.js?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // 한글 PDF가 깨지지 않게 글꼴 정보를 같이 쓴다 (빌드 때 public/pdfjs/ 로 복사됨)
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  }).promise
  const count = Math.min(pdf.numPages, MAX_PAGES)
  const pages: RenderedPage[] = []
  for (let i = 1; i <= count; i++) {
    onProgress(`PDF ${i}/${count}쪽 바꾸는 중…`)
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = fitScale(base.width, base.height, true)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    pages.push({ blob: await smallerBlob(canvas), w: canvas.width, h: canvas.height, scale })
    page.cleanup()
  }
  await pdf.destroy()
  return pages
}

async function renderImage(file: File): Promise<RenderedPage[]> {
  const bitmap = await createImageBitmap(file)
  const scale = fitScale(bitmap.width, bitmap.height, false)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return [{ blob: await smallerBlob(canvas), w: canvas.width, h: canvas.height, scale }]
}

export function isPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

export function checkScheduleFile(file: File) {
  if (/\.(xlsx?|xlsm|csv|cell|hwp)$/i.test(file.name) || /spreadsheet|excel/.test(file.type)) {
    throw new ScheduleFileError(`엑셀 파일은 올릴 수 없어요. ${EXCEL_HINT}`)
  }
  if (!isPdf(file) && !file.type.startsWith('image/')) {
    throw new ScheduleFileError(`사진 또는 PDF만 올릴 수 있어요. ${EXCEL_HINT}`)
  }
}

export async function uploadSchedule(teamId: string, file: File, onProgress: (text: string) => void) {
  checkScheduleFile(file)
  const pdf = isPdf(file)
  onProgress(pdf ? 'PDF 여는 중…' : '사진 줄이는 중…')
  const pages = pdf ? await renderPdf(file, onProgress) : await renderImage(file)
  if (pages.length === 0) throw new ScheduleFileError('PDF에 쪽이 없어요.')

  const uid = auth.currentUser!.uid
  const uploadId = doc(collection(db, 'ids')).id
  const folder = `teams/${teamId}/schedule/${uploadId}`
  const meta = (contentType: string) => ({ contentType, customMetadata: { uploaderUid: uid } })
  const uploaded: string[] = []
  try {
    const images: SchedulePage[] = []
    for (const [i, page] of pages.entries()) {
      onProgress(`올리는 중… ${i + 1}/${pages.length}`)
      const ext = page.blob.type === 'image/png' ? 'png' : 'jpg'
      const path = `${folder}/p${i + 1}.${ext}`
      await uploadBytes(ref(storage, path), page.blob, meta(page.blob.type))
      uploaded.push(path)
      images.push({ assetId: path, name: `${i + 1}쪽`, w: page.w, h: page.h, scale: page.scale })
    }
    // 원본 PDF는 1MB 이하일 때만 같이 남긴다 (다운로드용). 사진은 줄인 그림이 곧 원본이다.
    let assetId: string | null = null
    const pdfDropped = pdf && file.size > KEEP_PDF_BYTES
    if (pdf && !pdfDropped) {
      assetId = `${folder}/original.pdf`
      await uploadBytes(ref(storage, assetId), file, meta('application/pdf'))
      uploaded.push(assetId)
    }
    onProgress('저장하는 중…')
    await setDoc(scheduleRef(teamId), {
      uploadId,
      fileName: file.name,
      assetId,
      size: file.size,
      pdfDropped,
      images,
      marks: [],
      marksAt: null,
      marksBy: null,
      authorId: uid,
      createdAt: serverTimestamp(),
    })
  } catch (error) {
    await Promise.allSettled(uploaded.map((p) => deleteObject(ref(storage, p))))
    throw error
  }
}

export async function renameSchedule(teamId: string, fileName: string) {
  await updateDoc(scheduleRef(teamId), { fileName })
}

// 영구 삭제. 원본, 쪽 그림은 Functions가 지우고, 스티커는 문서와 함께 사라진다.
export async function deleteSchedule(teamId: string) {
  await deleteDoc(scheduleRef(teamId))
}

// 스티커는 여러 직원이 동시에 붙일 수 있어, 서버의 최신 목록에 바꾼 것만 반영한다.
export async function changeMarks(teamId: string, change: (marks: Mark[]) => Mark[]) {
  const target = scheduleRef(teamId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(target)
    if (!snap.exists()) return
    tx.update(target, {
      marks: change((snap.get('marks') ?? []) as Mark[]),
      marksAt: serverTimestamp(),
      marksBy: auth.currentUser!.uid,
    })
  })
}

// ── 쪽 그림 불러오기 ─────────────────────────────────────────
// 칸 찾기와 스티커 합성을 하려면 픽셀을 읽어야 해서, blob으로 받아 objectURL로 보여 준다.
// (Storage에 CORS 설정이 없으면 blob을 못 받으므로 주소로 바로 보여 주고, 칸 찾기만 못 한다.)
export type LoadedImage = { url: string; blob: Blob | null }

const images = new Map<string, Promise<LoadedImage>>()
const pixels = new Map<string, Promise<Pixels | null>>()

export function loadPageImage(assetId: string) {
  let entry = images.get(assetId)
  if (!entry) {
    entry = (async () => {
      const url = await getDownloadURL(ref(storage, assetId))
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        return { url: URL.createObjectURL(blob), blob }
      } catch {
        return { url, blob: null }
      }
    })()
    entry.catch(() => images.delete(assetId))
    images.set(assetId, entry)
  }
  return entry
}

export function pagePixels(assetId: string) {
  let entry = pixels.get(assetId)
  if (!entry) {
    entry = (async () => {
      const { blob } = await loadPageImage(assetId)
      if (!blob) return null
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      return toLuminance(data, canvas.width, canvas.height)
    })().catch(() => null)
    pixels.set(assetId, entry)
  }
  return entry
}

export async function downloadUrl(assetId: string) {
  return getDownloadURL(ref(storage, assetId))
}
