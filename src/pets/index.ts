// 🐾 우리 펫 (2026-11-14, 프론트 앱 js/pets.js 를 그대로 옮김 — 프론트가 준 pets.js·pets.css·README.md).
// pets.js·pets.css 는 고치지 않고 그대로(프론트가 고치면 다시 복사). 🎲 미니 게임처럼 new Function 안에서 돌리고(전역에 안 나감),
// pets.js 가 기대하는 연결 window.PET_HOST 만 여기서 만든다.
// - 데이터: 프론트 Firebase(ydr)의 pets/{g_…}·petFx/{g_…} 그대로 (게스트 규칙은 프론트에 있음, 우리 무료 사용량과 무관)
// - 펫은 🏌️ 프론트 방 채팅 화면에서만 돌아다님 (setPetRoom 으로 그 화면이 알려 줌)
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import petSrc from './pets.js?raw'
import './pets.css'
import { ydrAuth, ydrDb } from '../front/ydr.ts'
import { toast } from '../ui/dialogs.tsx'

type Api = { petsInit: () => void; openPets: () => void; petPanelRender: () => void; petSync: () => void }
export type PetRoom = {
  list: () => HTMLElement | null // 대화 영역 (펫이 다닐 칸)
  myName: () => string
  ownerName: (id: string) => string // 펫 주인 id(프론트 직원 = 로그인 아이디, 지원팀 = g_…) → 이름
} | null

let room: PetRoom = null
let api: Api | null = null

// 지금 보이는 🏌️ 프론트 방 (나가면 null → 펫 숨김)
export function setPetRoom(r: PetRoom) {
  room = r
}

const ROOM_SEL = '[data-pet-room]'
const host = {
  // pets.js 는 옛 방식(compat) 모양으로 부른다 → 작은 다리
  db: {
    collection: (name: string) => ({
      onSnapshot: (ok: (s: unknown) => void, bad: (e: unknown) => void) => onSnapshot(collection(ydrDb, name), ok, bad),
    }),
    // 저장이 끝난 뒤 창을 한 번 더 그린다: 데려오기는 저장 직후 "고르는 중" 표시를 지우는데, 화면 갱신(onSnapshot)이 그보다 먼저 와서
    // 창이 고르기 화면에 머물렀다 (2026-11-14 확인)
    doc: (path: string) => ({
      set: (d: Record<string, unknown>) => setDoc(doc(ydrDb, path), d).then(redraw),
      update: (d: Record<string, unknown>) => updateDoc(doc(ydrDb, path), d).then(redraw),
    }),
  },
  me: () => ydrAuth.currentUser?.uid ?? null,
  myName: () => room?.myName() ?? '',
  ownerName: (id: string) => room?.ownerName(id) ?? '',
  view: () => (room ? 'chat' : ''),
  // 프론트 방 화면이 아니거나, 휴대폰 키보드가 열려 있으면 숨김
  hidden: () => !room || !room.list()?.isConnected || document.documentElement.classList.contains('keyboard-open'),
  area: () => {
    const el = room?.list()
    if (!el) return { l: 0, r: innerWidth, top: 0, floor: innerHeight }
    const r = el.getBoundingClientRect()
    const vh = window.visualViewport ? window.visualViewport.height : innerHeight
    // 바닥은 이름표(펫 아래 약 16px)까지 대화 영역 안에 들어오게 올린다 — 안 그러면 휴대폰에서 이름표 칸이 입력칸 위쪽을 덮어 눌리지 않았다
    return { l: Math.max(0, r.left) + 10, r: Math.min(innerWidth, r.right) - 10, top: r.top, floor: Math.min(r.bottom, vh) - 18 }
  },
  // 고양이가 올라갈 말풍선 (프론트 방 대화 영역 안만)
  platSel: `${ROOM_SEL} .msgRow .bubble:not(.deleted)`,
  platKey: (el: Element) => {
    const mid = (el.closest('[data-mid]') as HTMLElement | null)?.dataset.mid
    return mid ? `m:${mid}` : null
  },
  fxSel: (t: string) => (t.startsWith('m:') ? `${ROOM_SEL} .msgRow[data-mid="${CSS.escape(t.slice(2))}"] .bubble` : null),
  toast: (msg: string) => toast(String(msg)),
  petToast: (msg: string) => toast(String(msg)), // pets.js 가 PET_HOST.petToast 로 부름
}

function redraw() {
  setTimeout(() => api?.petPanelRender(), 0)
}
// 이름표 다시 쓰기 (프론트 직원 목록이 늦게 오면 처음엔 이름을 모름)
export const refreshPets = () => api?.petSync()

function load(): Api {
  if (!api) {
    ;(window as unknown as { PET_HOST: typeof host }).PET_HOST = host
    api = new Function(`"use strict";\n${petSrc}\n;\nreturn { petsInit: petsInit, openPets: openPets, petPanelRender: petPanelRender, petSync: petSync };`)() as Api
  }
  return api
}

export const petsInit = () => load().petsInit()
export const openPets = () => load().openPets()
