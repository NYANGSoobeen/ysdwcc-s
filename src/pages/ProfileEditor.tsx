import { doc, updateDoc } from 'firebase/firestore'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage } from '../auth.ts'
import { resizeToJpeg } from '../chat.ts'
import { db, storage } from '../firebase.ts'
import type { Profile } from '../hooks.ts'
import { AVATAR_PRESETS, AvatarFace } from '../ui/Avatar.tsx'
import { Modal, toast } from '../ui/dialogs.tsx'

// 👤 내 프로필 바꾸기 (8번): 이름·직급·사진.
// 사진은 480px JPEG로 줄여(30~60KB) avatars/{uid}/ 에 바로 올린다. 저장하지 않고 닫으면 이 창에서 올린 사진은 지운다.
// 저장하면 이 창에서 올렸지만 안 고른 사진과 예전 사진도 지운다 (저장공간 아끼기).
const SIZE = 480

async function shrink(file: File) {
  // 60KB를 넘으면 화질을 낮춰 한 번 더 줄인다.
  let out = await resizeToJpeg(file, SIZE, 0.82)
  if (out.blob.size > 60 * 1024) out = await resizeToJpeg(file, SIZE, 0.65)
  return out.blob
}

export function ProfileEditor({ uid, profile, onClose }: { uid: string; profile: Profile; onClose: () => void }) {
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const uploaded = useRef<string[]>([]) // 이 창에서 올린 사진
  const saved = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  // 저장하지 않고 닫히면(취소, 다른 화면으로) 이 창에서 올린 사진을 지운다.
  useEffect(
    () => () => {
      if (!saved.current) uploaded.current.forEach((p) => void deleteObject(ref(storage, p)).catch(() => {}))
    },
    [],
  )

  async function pickPhoto(file: File) {
    setBusy('사진 올리는 중…')
    try {
      const blob = await shrink(file)
      const path = `avatars/${uid}/${Date.now().toString(36)}.jpg`
      await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' })
      uploaded.current.push(path)
      setAvatar(path)
    } catch (err) {
      toast(`사진을 올리지 못했어요. ${errorMessage(err)}`, { error: true })
    } finally {
      setBusy(null)
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast('이름을 넣어 주세요.', { error: true })
    setBusy('저장하는 중…')
    try {
      await updateDoc(doc(db, 'users', uid), { name: name.trim().slice(0, 30), avatar })
      saved.current = true
      // 안 고른 새 사진과 예전 사진 지우기
      const old = profile.avatar ?? ''
      const drop = [...uploaded.current.filter((p) => p !== avatar), ...(old.startsWith('avatars/') && old !== avatar ? [old] : [])]
      await Promise.allSettled(drop.map((p) => deleteObject(ref(storage, p))))
      toast('프로필을 저장했어요.')
      onClose()
    } catch (err) {
      toast(errorMessage(err), { error: true })
      setBusy(null)
    }
  }

  return (
    <Modal onClose={() => !busy && onClose()} labelledBy="profile-editor-title" className="profile-editor" closeOnOutside={false}>
      <form className="form" onSubmit={save}>
        <h3 id="profile-editor-title">👤 내 프로필</h3>
        <div className="profile-editor-photo">
          <AvatarFace uid={uid} name={name || '나'} avatar={avatar} className="big" />
          <div className="profile-editor-buttons">
            <button type="button" onClick={() => input.current?.click()} disabled={!!busy}>
              📷 사진 고르기
            </button>
            {avatar && (
              <button type="button" className="ghost" onClick={() => setAvatar('')} disabled={!!busy}>
                사진 없애기 (첫 글자)
              </button>
            )}
          </div>
        </div>
        <p className="muted small">기본 그림</p>
        <div className="avatar-presets">
          {AVATAR_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={avatar === `preset:${p.id}` ? 'selected' : ''}
              onClick={() => setAvatar(`preset:${p.id}`)}
              aria-label={`기본 그림 ${p.emoji}`}
              aria-pressed={avatar === `preset:${p.id}`}
            >
              <AvatarFace uid={uid} name="" avatar={`preset:${p.id}`} />
            </button>
          ))}
        </div>
        <label>
          이름
          <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required />
        </label>
        <p className="muted small">직급: {profile.position || '없음'} · 직급은 관리자가 👥 직원 관리에서 정해요.</p>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void pickPhoto(f)
          }}
        />
        {busy && <p className="notice">{busy}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={!!busy}>
            취소
          </button>
          <button type="submit" className="primary" disabled={!!busy}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  )
}
