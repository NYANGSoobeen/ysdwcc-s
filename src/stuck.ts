import { deleteField, serverTimestamp, setDoc, updateDoc, type DocumentReference, type Timestamp } from 'firebase/firestore'
import { auth } from './firebase.ts'

// 🏷️ 붙이는 스티커: 채팅 말풍선(메시지 stk) · 채팅방 배경(channels/{id}.bgStk) · 공지 글 위에
// 이모지나 우리 이모티콘을 붙였다 뗀다. 붙인 곳 안에서 위치를 0~1 비율로 저장한다.
// 문서.field = { 스티커id: { e: 이모지 | a: 이모티콘 경로, x, y, by, at } }  (규칙 stkOk: 한 번에 하나, 자기 것만 떼기)
// 사용자 요청서는 배열 [{id, …}]이었지만, "남의 스티커는 못 떼게" 보안 규칙으로 막으려고 id를 열쇠로 한 맵에 둔다.

export type StickerChoice = { e: string } | { a: string }
export type StuckSticker = { id: string; e?: string; a?: string; x: number; y: number; by: string; at: Timestamp | null }
export type StuckMap = Record<string, Omit<StuckSticker, 'id'>>

export const MAX_STUCK = 60 // 규칙과 같게

export function stuckList(map: unknown): StuckSticker[] {
  if (!map || typeof map !== 'object') return []
  return Object.entries(map as StuckMap)
    .filter(([, v]) => v && typeof v.x === 'number' && typeof v.y === 'number' && (v.e || v.a))
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.at?.toMillis() ?? Infinity) - (b.at?.toMillis() ?? Infinity))
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000

// merge: 문서가 아직 없을 수 있는 곳(기본 방의 channels/main)은 merge로 만든다.
export async function stick(ref: DocumentReference, field: string, choice: StickerChoice, x: number, y: number, merge = false) {
  const id = newId()
  const value = { ...('e' in choice ? { e: choice.e } : { a: choice.a }), x: clamp(x), y: clamp(y), by: auth.currentUser!.uid, at: serverTimestamp() }
  if (merge) await setDoc(ref, { [field]: { [id]: value }, stkLast: id }, { merge: true })
  else await updateDoc(ref, { [`${field}.${id}`]: value, stkLast: id })
  rememberSticker(choice)
}

export async function unstick(ref: DocumentReference, field: string, id: string) {
  await updateDoc(ref, { [`${field}.${id}`]: deleteField(), stkLast: id })
}

// ── 최근 쓴 스티커 (이 기기에만) ──
const RECENT_KEY = 'recent-stickers'
export function recentStickers(): StickerChoice[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((c) => c && (typeof c.e === 'string' || typeof c.a === 'string')) : []
  } catch {
    return []
  }
}
function rememberSticker(choice: StickerChoice) {
  const key = (c: StickerChoice) => ('e' in c ? `e:${c.e}` : `a:${c.a}`)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([choice, ...recentStickers().filter((c) => key(c) !== key(choice))].slice(0, 32)))
  } catch {
    // 기억하지 못해도 붙이기는 된다.
  }
}
