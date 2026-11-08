// 📌 채팅방 위 고정 (2026-11-08 사용자 요청, 프론트 앱 js/chatpin.js 를 그대로 옮김, 카톡 채팅방 공지처럼 방마다 하나).
// chatpin.js·chatpin.css 는 프론트가 준 파일 그대로(고치지 않음, 프론트가 고치면 다시 복사).
// 🎲 미니 게임(src/chatgame)과 같은 방식: 옛 방식 코드라 uiForm(창)과 한 덩어리로 묶어 함수 안에서 돌리고, 기대하는 값을 여기서 이어 준다.
// 데이터는 프론트와 똑같이 channels/{방}.pin = {mid, text(200자), authorId, by, at(ms), msgAt(ms)}.
//  - 우리 방: teams/{팀}/channels/{방} 문서 (기본 방은 문서가 없으면 merge 로 생김), 메시지 위치는 기본 방이면 teams/{팀}/messages.
//  - 🏌️ 프론트 방: 프론트 channels/{방} 문서를 지켜보며 띠만 보여 주고 누르면 그 말로 이동 (게스트는 방 문서를 못 고쳐서 고정·내리기 없음).
import { deleteField, doc, getDoc, onSnapshot, setDoc, updateDoc, type DocumentReference } from 'firebase/firestore'
import { useEffect, useLayoutEffect, useState } from 'react'
import pinSrc from './chatpin.js?raw'
import listSrc from '../chatgame/form-list.js?raw'
import formSrc from '../chatgame/uiForm.js?raw'
import './chatpin.css'
import { errorMessage } from '../auth.ts'
import { db as ourDb } from '../firebase.ts'
import { ydrDb } from '../front/ydr.ts'
import { openMenu, type MenuAction } from '../ui/ContextMenu.tsx'
import { ask, isTouchUi, toast } from '../ui/dialogs.tsx'

export type Pin = { mid: string; text?: string; authorId?: string | null; by?: string | null; at: number; msgAt?: number }
// chatPinSet·chatPinSummary 에 넘기는 메시지 (프론트 모양)
export type PinMsg = {
  id: string
  text: string
  authorId: string | null
  createdAt: number
  imgs?: string[]
  video?: unknown
  file?: { name?: string } | null
  stickerAssetId?: string | null
  link?: { title?: string } | null
}
type LegacyItem = { label: string; action: () => void }
type Api = {
  chatPinRender: () => void
  chatPinMenuItems: (m: PinMsg) => LegacyItem[]
  chatPinOnEdit: (m: { id: string }, text: string) => void
  chatPinOnDelete: (m: { id: string }) => void
  set: (o: Record<string, unknown>) => void
}
const NAMES = [
  'channels', 'currentChannel', 'currentView', 'db', 'firebase', 'myId', '$', 'toast', 'fail', 'uiConfirm', 'displayNameFor',
  'copyText', 'fmtTime', 'menuButton', 'msgImageIds', 'chatFindPin', 'formNoFile', 'touchUI',
]
function build(): Api {
  const form = formSrc.replace('/*FORM_LIST*/', listSrc)
  // uiForm.js 의 $ 는 창 안에서 찾는 것 → chatpin.js 의 $(띠·대화 영역)와 이름이 겹쳐 창 쪽을 formQ 로 바꿔 둔다
  const formCode = form.replace(/\$\(/g, 'formQ(')
  const code =
    `"use strict";\nvar ${NAMES.join(', ')};\n${formCode}\n;\n${pinSrc}\n;\n` +
    `return { chatPinRender: chatPinRender, chatPinMenuItems: chatPinMenuItems, chatPinOnEdit: chatPinOnEdit, chatPinOnDelete: chatPinOnDelete, ` +
    `set: function (o) { ${NAMES.map((n) => `if ('${n}' in o) ${n} = o['${n}'];`).join(' ')} } };`
  return new Function(code)() as Api
}

const toMenu = (items: LegacyItem[]): MenuAction[] =>
  items.map((g) => {
    const [icon, ...rest] = g.label.split(' ')
    return { icon, label: rest.join(' '), onSelect: () => g.action() }
  })
// menuButton('⋯', ()=>메뉴들): 누르면 우리 메뉴(PC 작은 메뉴, 휴대폰 아래에서 올라옴)
const menuButton = (hide: RegExp | null) => (text: string, items: () => LegacyItem[]) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  b.title = '더 보기'
  b.onclick = (e) => {
    e.stopPropagation()
    const r = b.getBoundingClientRect()
    openMenu(toMenu(items().filter((i) => !hide || !hide.test(i.label))), r.right, r.bottom + 4)
  }
  return b
}
const common = {
  currentView: 'chat',
  firebase: { firestore: { FieldValue: { delete: deleteField } } },
  toast: (msg: string) => toast(String(msg)),
  fail: (e: unknown, what?: string) => toast(`${what || '처리'} 실패 — ${errorMessage(e)}`, { error: true }),
  uiConfirm: (message: string) => ask({ message, ok: '확인' }),
  fmtTime: (ms: number) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  msgImageIds: (m: PinMsg) => m.imgs ?? [],
  formNoFile: true,
  touchUI: isTouchUi,
}
// 메시지 문서 → chatPinGo 가 보는 모양 (우리 메시지는 body·attachments)
const asPinData = (d: Record<string, unknown>) => ({
  ...d,
  text: String(d.text ?? d.body ?? ''),
  imgs: Array.isArray(d.attachments) ? d.attachments : Array.isArray(d.imageAssetIds) ? d.imageAssetIds : d.imageAssetId ? [d.imageAssetId] : [],
  file: d.file ?? (Array.isArray(d.files) && d.files.length ? d.files[0] : null),
})
const docShim = (r: DocumentReference) => ({
  set: (o: Record<string, unknown>, opt?: { merge?: boolean }) => setDoc(r, o, opt ?? {}),
  update: (o: Record<string, unknown>) => updateDoc(r, o),
  get: async () => {
    const s = await getDoc(r)
    return { exists: s.exists(), data: () => asPinData(s.data() ?? {}) }
  },
})

export type PinEnv = {
  roomId: string
  pin: Pin | null
  myId: string
  nameOf: (id: string) => string
  copyText: (t: string) => void
  bar: () => HTMLElement | null
  list: () => HTMLElement | null
  findPin: (id: string) => void // 그 말을 가운데로 몇 초 붙잡기 (휴대폰 키보드가 닫히며 맨 아래로 튕기지 않게)
}

// ── 우리 방 ───────────────────────────────────────────────
let ours: Api | null = null
export function ourPins(teamId: string, e: PinEnv): Api {
  if (!ours) {
    ours = build()
    ours.set({ ...common, menuButton: menuButton(null) })
  }
  const roomDoc = (ch: string) => (ch === 'main' ? doc(ourDb, 'teams', teamId, 'channels', 'main') : doc(ourDb, 'teams', teamId, 'channels', ch))
  setEnv(ours, e, {
    db: {
      doc: (path: string) => {
        const [, ch, , id] = path.split('/') // 'channels/{방}' 또는 'channels/{방}/messages/{id}'
        if (!id) return docShim(roomDoc(ch))
        return docShim(ch === 'main' ? doc(ourDb, 'teams', teamId, 'messages', id) : doc(ourDb, 'teams', teamId, 'channels', ch, 'messages', id))
      },
    },
  })
  return ours
}

// ── 🏌️ 프론트 방 (보기·이동만) ───────────────────────────────
let front: Api | null = null
export function frontPins(e: PinEnv): Api {
  if (!front) {
    front = build()
    front.set({ ...common, menuButton: menuButton(/고정 내리기/) })
  }
  setEnv(front, e, { db: { doc: (path: string) => docShim(doc(ydrDb, path)) } })
  return front
}

function setEnv(api: Api, e: PinEnv, extra: Record<string, unknown>) {
  api.set({
    ...extra,
    channels: [{ id: e.roomId, pin: e.pin }],
    currentChannel: e.roomId,
    myId: e.myId,
    displayNameFor: (id: string) => (id ? e.nameOf(id) : ''),
    copyText: e.copyText,
    chatFindPin: e.findPin,
    $: (id: string) => (id === 'chatPinBar' ? e.bar() : id === 'messages' ? e.list() : document.getElementById(id)),
  })
}

export const pinMenu = (api: Api, m: PinMsg) => toMenu(api.chatPinMenuItems(m))

// 띠: chatPinRender 가 그린다 (pin 이 바뀌면 다시)
export function PinBar({ api, pin, roomId, barRef }: { api: Api; pin: Pin | null; roomId: string; barRef: React.RefObject<HTMLDivElement | null> }) {
  const key = JSON.stringify([roomId, pin])
  useLayoutEffect(() => {
    api.chatPinRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api])
  return <div ref={barRef} id="chatPinBar" style={{ display: 'none' }} />
}

// 🏌️ 프론트 방 문서의 pin 을 지켜본다 (방 문서 하나, 프론트 사용량)
export function useFrontPin(roomId: string) {
  const [pin, setPin] = useState<Pin | null>(null)
  useEffect(() => {
    setPin(null)
    return onSnapshot(
      doc(ydrDb, 'channels', roomId),
      (s) => {
        const p = s.get('pin') as Pin | undefined
        setPin(p && p.mid ? p : null)
      },
      () => setPin(null),
    )
  }, [roomId])
  return pin
}

