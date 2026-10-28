import { useSyncExternalStore } from 'react'
import { StorageImage } from '../components/StorageImage.tsx'
import { tell } from './dialogs.tsx'

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
        {preset.emoji}
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
      {name.slice(0, 1)}
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

export function showProfileCard(uid: string, fallbackName: string) {
  const p = people[uid]
  const name = p?.name || fallbackName
  void tell({
    message: (
      <span className="profile-card">
        <AvatarFace uid={uid} name={name} avatar={p?.avatar} className="big" />
        <strong>{name}</strong>
        {p?.position && <span className="muted">{p.position}</span>}
      </span>
    ),
  })
}
