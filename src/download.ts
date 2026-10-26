import { registerPlugin } from '@capacitor/core'
import { APK_URL, isAndroidApp } from './native.ts'
import { ask, toast } from './ui/dialogs.tsx'

// 사진·파일 저장 버튼.
// - 갤럭시 앱: 폰 Download 폴더에 바로 저장 (사진은 갤러리 "Download" 앨범에 보임, FileSaver 플러그인)
// - 아이폰: 공유 창을 연다 → "이미지 저장"(사진 앱) 또는 "파일에 저장"
// - PC, 갤럭시 브라우저: 일반 다운로드 (다운로드 폴더)

type FileSaverPlugin = { save(options: { data: string; name: string; mime: string }): Promise<{ name: string }> }
const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver')

export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// 아이폰 공유 창은 누른 직후에만 열 수 있어서, 화면에 보이는 사진은 미리 받아 둔다.
const ready = new Map<string, Blob>()
const loading = new Map<string, Promise<Blob>>()

export function prepareFile(url: string) {
  let entry = loading.get(url)
  if (!entry) {
    entry = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      ready.set(url, blob)
      return blob
    })
    entry.catch(() => loading.delete(url))
    loading.set(url, entry)
  }
  return entry
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

function mimeOf(blob: Blob, name: string) {
  return blob.type || MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream'
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function share(blob: Blob, name: string) {
  const file = new File([blob], name, { type: mimeOf(blob, name) })
  if (!navigator.canShare?.({ files: [file] })) return false
  try {
    await navigator.share({ files: [file] })
  } catch (error) {
    const reason = (error as Error).name
    if (reason === 'AbortError') return true // 사용자가 공유 창을 닫음
    if (reason !== 'NotAllowedError') throw error
    // 받는 데 시간이 걸려 "누른 직후"가 지나면 한 번 더 눌러 달라고 한다.
    if (await ask({ message: `"${name}" 저장 준비가 됐어요.`, ok: '저장', cancel: '닫기' })) await navigator.share({ files: [file] })
  }
  return true
}

// source: 주소(Storage 다운로드 주소, blob: 주소) 또는 Blob
export async function saveFile(source: string | Blob, name: string) {
  let blob: Blob
  try {
    blob = typeof source === 'string' ? (ready.get(source) ?? (await prepareFile(source))) : source
  } catch {
    // 받지 못하면(예: Storage CORS 미설정) 새 창으로 열어 길게 눌러 저장하게 한다.
    if (typeof source === 'string') window.open(source, '_blank', 'noopener')
    return
  }

  try {
    if (isAndroidApp) {
      const saved = await FileSaver.save({ data: await toBase64(blob), name, mime: mimeOf(blob, name) })
      toast(`저장했어요: 내 파일 > Download > ${saved.name}`)
      return
    }
    if (isIOS && (await share(blob, name))) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    toast(`다운로드했어요: ${name}`)
  } catch (error) {
    if (isAndroidApp && String((error as { code?: string }).code) === 'UNIMPLEMENTED') {
      // 예전 갤럭시 앱(1.1.0 이하)에는 저장 기능이 없다.
      if (await ask({ message: '저장하려면 갤럭시 앱을 새 버전으로 업데이트해야 해요. 설치 파일을 받을까요?', ok: '받기' })) {
        window.open(APK_URL, '_blank')
      }
      return
    }
    toast(`저장하지 못했어요. ${(error as Error).message ?? ''}`, { error: true })
  }
}

// 파일 이름에 쓸 수 없는 글자를 바꾼다.
export function fileName(base: string, ext: string) {
  return `${base.replace(/[\\/:*?"<>|]/g, '_').trim() || 'download'}.${ext}`
}
