import { useEffect, useRef, useState } from 'react'
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase.ts'
import { errorMessage } from '../auth.ts'
import { resizeToJpeg, type Attachment } from '../chat.ts'
import { StorageImage } from '../components/StorageImage.tsx'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer.tsx'
import { GameButton } from '../games/GameButton.tsx'
import { useMemberProfiles } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { ask, toast } from '../ui/dialogs.tsx'

// 🍱 식단표 (2026-11-04 사용자 요청, 프론트 앱 js/menu.js와 같은 동작): 사진만 올려 두는 화면.
// 문서 하나 meta/menu = { assetIds: [사진 경로…], by, at(ms) } — 모든 팀 공용(구내식당은 하나), 데이터는 우리 Firebase에만.
// 사진은 Storage menu/{시각}_{n}.jpg (팀 폴더 밖이라 용량 관리의 "사용하지 않는 파일" 정리 대상이 아님).
// 올리기 순서: ① 새 사진 올리기 → ② 문서 바꾸기 → ③ 예전 사진 지우기 (중간에 실패해도 식단표가 비지 않게, 실패하면 방금 올린 것만 지움)
const MENU_DOC = doc(db, 'meta', 'menu')
const MAX_SIDE = 2000
const QUALITY = 0.82
const KEEP_ORIGINAL = 400 * 1024 // 400KB 이하 JPEG는 원본 그대로
const MAX_PHOTOS = 20

type Menu = { assetIds: string[]; by: string; at: number }

function useMenu() {
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined)
  useEffect(
    () =>
      onSnapshot(
        MENU_DOC,
        (s) => {
          const ids = (s.get('assetIds') as string[] | undefined) ?? []
          setMenu(ids.length ? { assetIds: ids, by: String(s.get('by') ?? ''), at: Number(s.get('at') ?? 0) } : null)
        },
        () => setMenu(null),
      ),
    [],
  )
  return menu
}

async function shrink(file: File) {
  if (file.type === 'image/jpeg' && file.size <= KEEP_ORIGINAL) return file as Blob
  return (await resizeToJpeg(file, MAX_SIDE, QUALITY)).blob
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function MealPage({ uid }: { uid: string }) {
  const menu = useMenu()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [viewer, setViewer] = useState<number | null>(null)
  const profiles = useMemberProfiles(menu?.by ? [menu.by] : [])
  const byName = menu?.by ? (profiles[menu.by]?.name ?? '') : ''

  async function upload(files: File[]) {
    const pics = files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS)
    if (!pics.length) return toast('사진만 올릴 수 있어요.', { error: true })
    if (menu && !(await ask({ title: '🍱 식단표 올리기', message: '새 식단표를 올리면 지금 식단표 사진은 삭제돼요. 올릴까요?', ok: '올리기' }))) return
    const stamp = Date.now()
    const uploaded: string[] = []
    try {
      for (let i = 0; i < pics.length; i++) {
        setBusy(`올리는 중… ${i + 1}/${pics.length}`)
        const path = `menu/${stamp}_${i}.jpg`
        await uploadBytes(ref(storage, path), await shrink(pics[i]), { contentType: 'image/jpeg', customMetadata: { uploaderUid: uid } })
        uploaded.push(path)
      }
      const old = menu?.assetIds ?? []
      await setDoc(MENU_DOC, { assetIds: uploaded, by: uid, at: Date.now() })
      for (const p of old) await deleteObject(ref(storage, p)).catch(() => {})
      toast('식단표를 올렸어요 🍱')
    } catch (err) {
      for (const p of uploaded) await deleteObject(ref(storage, p)).catch(() => {})
      toast(`올리지 못했어요. ${errorMessage(err)}`, { error: true })
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!menu) return
    if (!(await ask({ title: '🍱 식단표 삭제', message: '식단표 사진을 삭제할까요?', ok: '삭제', danger: true }))) return
    try {
      await deleteDoc(MENU_DOC)
      for (const p of menu.assetIds) await deleteObject(ref(storage, p)).catch(() => {})
      toast('식단표를 삭제했어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  const photos: ViewerPhoto[] = (menu?.assetIds ?? []).map((path) => ({
    attachment: { path, thumbPath: path, width: 0, height: 0, size: 0, thumbSize: 0 } as Attachment,
    author: byName,
    createdAt: menu ? new Date(menu.at) : null,
  }))

  return (
    <div className="page meal-page">
      <header className="page-header">
        <MenuButton />
        <h2>🍱 식단표</h2>
        <span />
        <GameButton />
      </header>
      <div className="meal-view">
        <div className="sheet-toolbar">
          <button type="button" onClick={() => input.current?.click()} disabled={!!busy}>
            {busy ?? '📷 사진 올리기'}
          </button>
          {menu && (
            <button type="button" className="close-btn" onClick={() => void remove()} disabled={!!busy}>
              🗑️ 삭제
            </button>
          )}
          {menu && (
            <span className="meal-by">
              {byName ? `${byName} · ` : ''}
              {when(menu.at)}
            </span>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) void upload(files)
            }}
          />
        </div>
        <p className="meal-hint">새 사진을 올리면 예전 식단표는 자동으로 삭제돼요. 여러 장을 한 번에 올릴 수 있어요. 사진을 누르면 크게 볼 수 있어요.</p>
        <div className="meal-body">
          {menu === undefined ? (
            <p className="muted">불러오는 중…</p>
          ) : !menu ? (
            <p className="meal-empty">등록된 식단표가 없어요. 📷 사진 올리기로 올려주세요 🍱</p>
          ) : (
            menu.assetIds.map((path, i) => (
              <StorageImage key={path} path={path} alt={`식단표 ${i + 1}`} className="meal-img" onClick={() => setViewer(i)} />
            ))
          )}
        </div>
      </div>
      {viewer !== null && photos.length > 0 && <PhotoViewer photos={photos} index={viewer} onClose={() => setViewer(null)} />}
    </div>
  )
}
