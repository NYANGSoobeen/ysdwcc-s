import { useSyncExternalStore } from 'react'
import { PhotoViewer } from '../components/PhotoViewer.tsx'
import { StorageImage } from '../components/StorageImage.tsx'
import type { Attachment } from '../chat.ts'
import { tell } from './dialogs.tsx'
import { CenteredGlyph } from './inkCenter.tsx'

// 프로필 사진 (8번). users/{uid}.avatar = '' (이름 첫 글자 동그라미) | 'preset:아이디' (기본 그림) | 'avatars/{uid}/파일.jpg' (사진)
// 팀원 프로필을 불러오는 곳(useProfile, useMemberProfiles)이 여기 저장소에 넣어 두면, 어디서든 uid만으로 그린다.

// 기본 프로필 그림: 파일 없이 그림 문자 + 바탕색
export const AVATAR_PRESETS: { id: string; emoji: string; bg: string }[] = [
  { id: 'dog', emoji: '🐶', bg: '#f6deb4' },
  { id: 'cat', emoji: '🐱', bg: '#f7d6c4' },
  { id: 'fox', emoji: '🦊', bg: '#fbd2a8' },
  { id: 'bear', emoji: '🐻', bg: '#e6cdb4' },
  { id: 'panda', emoji: '🐼', bg: '#dfe6ea' },
  { id: 'rabbit', emoji: '🐰', bg: '#f6dbe3' },
  { id: 'tiger', emoji: '🐯', bg: '#fbe0a6' },
  { id: 'koala', emoji: '🐨', bg: '#d9e2e8' },
  { id: 'penguin', emoji: '🐧', bg: '#cfe0ec' },
  { id: 'frog', emoji: '🐸', bg: '#d6ecc9' },
  { id: 'golf', emoji: '⛳', bg: '#cfe8d4' },
  { id: 'flower', emoji: '🌸', bg: '#f9dce6' },
  { id: 'sun', emoji: '🌻', bg: '#fbefb4' },
  { id: 'coffee', emoji: '☕', bg: '#e8d8c8' },
  { id: 'star', emoji: '⭐', bg: '#dbe6f3' },
  { id: 'smile', emoji: '😊', bg: '#fbe7b8' },
]

// 사진 없을 때 이름 첫 글자 동그라미 색 (사람마다 다르다)
const AVATAR_COLORS = ['#16587b', '#3d7fa3', '#5b8a72', '#a0694b', '#7a5c99', '#b0516a', '#4f7d8c']

type Person = { name: string; avatar?: string; position?: string }
let people: Record<string, Person> = {}
const listeners = new Set<() => void>()
export function rememberPeople(list: Record<string, { name?: string; avatar?: string; position?: string }>) {
  let changed = false
  const next = { ...people }
  for (const [uid, p] of Object.entries(list)) {
    const v = { name: p.name ?? '', avatar: p.avatar ?? '', position: p.position ?? '' }
    const old = next[uid]
    if (!old || old.name !== v.name || old.avatar !== v.avatar || old.position !== v.position) {
      next[uid] = v
      changed = true
    }
  }
  if (changed) {
    people = next
    listeners.forEach((l) => l())
  }
}
// 불러 둔 우리 직원 (🏌️ 프론트 채팅에서 같이 들어간 우리 직원 g_{uid} 이름 표시용)
export const rememberedPerson = (uid: string): Person | undefined => people[uid]

function usePerson(uid: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => people[uid],
  )
}

export function AvatarFace({ uid, name, avatar, className }: { uid: string; name: string; avatar?: string; className?: string }) {
  const preset = avatar?.startsWith('preset:') ? AVATAR_PRESETS.find((p) => p.id === avatar.slice(7)) : undefined
  if (preset)
    return (
      <span className={`avatar preset ${className ?? ''}`} style={{ background: preset.bg }} aria-hidden="true">
        <CenteredGlyph text={preset.emoji} />
      </span>
    )
  if (avatar?.startsWith('avatars/'))
    return (
      <span className={`avatar photo ${className ?? ''}`} aria-hidden="true">
        <StorageImage path={avatar} alt="" />
      </span>
    )
  let hash = 0
  for (const ch of uid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className={`avatar ${className ?? ''}`} style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">
      <CenteredGlyph text={name.slice(0, 1)} />
    </span>
  )
}

// card: 누르면 프로필 카드(사진 크게·이름·직급)
export function Avatar({ uid, name, card = false }: { uid: string; name: string; card?: boolean }) {
  const person = usePerson(uid)
  const face = <AvatarFace uid={uid} name={person?.name || name} avatar={person?.avatar} />
  if (!card) return face
  return (
    <button
      type="button"
      className="avatar-button"
      aria-label={`${person?.name || name} 프로필 보기`}
      onClick={(e) => {
        e.stopPropagation()
        showProfileCard(uid, person?.name || name)
      }}
    >
      {face}
    </button>
  )
}

// 프로필 카드. 사진이면 눌러서 크게 보기(두 손가락 확대, 2026-11-02 "프사 눌러도 확대해서 안 보여").
// extra: 우리 직원이 아닌 사람(🏌️ 프론트 직원)의 직급·사진 주소
export function showProfileCard(uid: string, fallbackName: string, extra?: { position?: string; imageUrl?: string }) {
  const p = people[uid]
  const name = p?.name || fallbackName
  const position = extra?.position ?? p?.position
  const avatar = p?.avatar ?? ''
  const photo = extra?.imageUrl
    ? { path: `ext/${uid}`, load: () => Promise.resolve(extra.imageUrl!) }
    : avatar.startsWith('avatars/')
      ? { path: avatar }
      : null
  const face = extra?.imageUrl ? (
    <span className="avatar photo big" aria-hidden="true">
      <img src={extra.imageUrl} alt="" />
    </span>
  ) : (
    <AvatarFace uid={uid} name={name} avatar={avatar} className="big" />
  )
  void tell({
    message: (
      <span className="profile-card">
        {photo ? (
          <button type="button" className="profile-photo-button" aria-label="사진 크게 보기" onClick={() => openProfilePhoto({ ...photo, name })}>
            {face}
            <span className="profile-photo-hint">🔍 눌러서 크게</span>
          </button>
        ) : (
          face
        )}
        <strong>{name}</strong>
        {position && <span className="muted">{position}</span>}
      </span>
    ),
  })
}

// 프로필 사진 크게 보기 (프로필 카드 창 위에 뜬다, main.tsx의 ProfilePhotoHost)
type Viewing = { path: string; name: string; load?: () => Promise<string> }
let viewing: Viewing | null = null
const viewListeners = new Set<() => void>()
export function openProfilePhoto(v: Viewing) {
  viewing = v
  viewListeners.forEach((l) => l())
}
export function ProfilePhotoHost() {
  const v = useSyncExternalStore(
    (l) => {
      viewListeners.add(l)
      return () => viewListeners.delete(l)
    },
    () => viewing,
  )
  if (!v) return null
  return (
    <div className="profile-photo-layer">
      <PhotoViewer
        photos={[
          {
            attachment: { path: v.path, thumbPath: v.path, width: 0, height: 0, size: 0, thumbSize: 0 } as Attachment,
            author: v.name,
            createdAt: null,
            load: v.load,
          },
        ]}
        index={0}
        onClose={() => openProfilePhoto(null as unknown as Viewing)}
      />
    </div>
  )
}
