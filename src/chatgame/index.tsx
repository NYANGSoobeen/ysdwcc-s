// 🎲 채팅 미니 게임 (2026-11-08 사용자 요청, 프론트 앱 js/chatgame.js 를 그대로 옮김): 📊 투표 · 🪜 사다리타기 · 🎲 주사위 · 🎡 돌림판 · 🎟️ 제비뽑기.
// chatgame.js·chatgame.css·form-list.js 는 프론트가 준 파일 그대로(고치지 않음, 프론트가 고치면 다시 복사).
// chatgame.js 는 전역 값(db·firebase·currentChannel·myId·uiForm·toast …)을 기대하는 옛 방식 코드라,
// uiForm.js(+ form-list.js 를 끼운 것)와 한 덩어리로 묶어 함수 안에서 돌리고(전역에 안 나감) 그 값들을 여기서 이어 준다.
// 우리 방용·🏌️ 프론트 방용 두 벌을 만들어 각자 따로 이어 준다 (내 id·저장 위치가 다름).
//
// 데이터 모양은 프론트와 똑같이: 메시지 하나 = 게임 하나 { game:{type,…}, votes:{사람id:[번호…]} } + 글 요약.
//  - 우리 방: 글 요약은 body, 보낸 사람은 authorUid(우리 메시지 모양), 투표 사진은 채팅 사진처럼 attachments.
//  - 프론트 방: 프론트 메시지 그대로 {text, game, authorId, createdAt(ms), replyTo?} (게스트는 사진 없는 투표만).
import { addDoc, collection, deleteField, doc, FieldPath, updateDoc } from 'firebase/firestore'
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import gameSrc from './chatgame.js?raw'
import listSrc from './form-list.js?raw'
import formSrc from './uiForm.js?raw'
import './chatgame.css'
import { errorMessage } from '../auth.ts'
import { sendMessage, type ReplyTo } from '../chat.ts'
import { db as ourDb } from '../firebase.ts'
import { ydrDb } from '../front/ydr.ts'
import { ask, toast } from '../ui/dialogs.tsx'
import type { MenuAction } from '../ui/ContextMenu.tsx'
import { isTouchUi } from '../ui/dialogs.tsx'

export type Game = { type: string; [k: string]: unknown }
export type Votes = Record<string, number[]>
// gameCard 에 넘기는 메시지 (프론트 모양)
export type GameMsg = { id: string; game: Game; votes: Votes | null; authorId: string | null; createdAt: number; text: string }

type Api = {
  gameCard: (m: GameMsg) => HTMLElement
  gameMenuItems: () => { label: string; action: () => void }[]
  set: (o: Partial<Env>) => void
}
type Env = {
  db: unknown
  firebase: unknown
  currentChannel: string
  myId: string
  assets: unknown
  viewDocs: { authorId: string | null; createdAt: number }[]
  chatRowCache: { rows: Map<string, unknown> }
  CHAT_IMG: unknown
  uiConfirm: (msg: string) => Promise<boolean>
  toast: (msg: string) => void
  fail: (e: unknown, what?: string) => void
  displayNameFor: (id: string) => string
  compressImage: (f: Blob) => Promise<Blob>
  dropAsset: (id: string) => void
  chatLinkify: (el: HTMLElement, text: string) => void
  renderMessages: () => void
  takeReply: () => Record<string, unknown>
  formNoFile: boolean
  touchUI: () => boolean
}
const NAMES: (keyof Env)[] = [
  'db', 'firebase', 'currentChannel', 'myId', 'assets', 'viewDocs', 'chatRowCache', 'CHAT_IMG', 'uiConfirm', 'toast', 'fail',
  'displayNameFor', 'compressImage', 'dropAsset', 'chatLinkify', 'renderMessages', 'takeReply', 'formNoFile', 'touchUI',
]

function build(): Api {
  const form = formSrc.replace('/*FORM_LIST*/', listSrc)
  const code =
    `"use strict";\nvar ${NAMES.join(', ')};\n${form}\n;\n${gameSrc}\n;\n` +
    `return { gameCard: gameCard, gameMenuItems: gameMenuItems, set: function (o) { ${NAMES.map((n) => `if ('${n}' in o) ${n} = o.${n};`).join(' ')} } };`
  return new Function(code)() as Api
}

// 투표 마감 시각이 되면 카드를 다시 그린다 (chatgame.js 의 renderMessages)
let tick = 0
const tickers = new Set<() => void>()
const bump = () => {
  tick++
  tickers.forEach((f) => f())
}
const subscribeTick = (f: () => void) => {
  tickers.add(f)
  return () => tickers.delete(f)
}

const firebaseShim = { firestore: { FieldPath, FieldValue: { delete: deleteField } } }
const common = (): Partial<Env> => ({
  firebase: firebaseShim,
  chatRowCache: { rows: new Map() },
  CHAT_IMG: null,
  uiConfirm: (message: string) => ask({ message, ok: '확인' }),
  toast: (msg: string) => toast(String(msg)),
  fail: (e: unknown, what?: string) => toast(`${what || '처리'} 실패 — ${errorMessage(e)}`, { error: true }),
  compressImage: async (f: Blob) => f,
  chatLinkify: (el: HTMLElement, text: string) => {
    el.textContent = text
  },
  renderMessages: bump,
  touchUI: isTouchUi,
})

type Upd = (a: unknown, b?: unknown) => Promise<void>
const updater = (r: ReturnType<typeof doc>): Upd => (a, b) =>
  (b === undefined ? updateDoc(r, a as Record<string, unknown>) : updateDoc(r, a as FieldPath, b)) as Promise<void>

// ── 우리 방 ───────────────────────────────────────────────
let ours: Api | null = null
const staged = new Map<string, Blob>() // 투표 사진: 메시지를 만들 때 채팅 사진처럼 올린다
let stagedN = 0

export type OurRoomEnv = {
  teamId: string
  channelId: string
  uid: string
  nameOf: (uid: string) => string
  recent: { authorId: string; createdAt: number }[]
  takeReply: () => ReplyTo | null
}
export function ourGames(e: OurRoomEnv): Api {
  if (!ours) {
    ours = build()
    ours.set(common())
    ours.set({
      assets: {
        upload: async (b: Blob) => {
          const id = `p${++stagedN}`
          staged.set(id, b)
          return { id }
        },
      },
      dropAsset: (id: string) => void staged.delete(id),
    })
  }
  const { teamId, uid } = e
  ours.set({
    currentChannel: e.channelId,
    myId: uid,
    viewDocs: e.recent,
    displayNameFor: (id: string) => e.nameOf(id),
    takeReply: () => {
      const r = e.takeReply()
      return r ? { replyTo: r } : {}
    },
    // chatgame.js 는 'channels/{방}/messages' 로 쓴다 → 우리 위치(기본 방 teams/{팀}/messages)로 바꿔 우리 메시지 모양으로 저장
    db: {
      collection: (path: string) => ({
        add: async (o: { text: string; game: Game; imageAssetId?: string; replyTo?: ReplyTo }) => {
          const ch = path.split('/')[1]
          const photo = o.imageAssetId ? staged.get(o.imageAssetId) : undefined
          if (o.imageAssetId) staged.delete(o.imageAssetId)
          await sendMessage(teamId, ch, o.text, photo ? [photo as File] : [], o.replyTo ?? null, [], undefined, [], { game: o.game })
        },
      }),
      doc: (path: string) => {
        const [, ch, , id] = path.split('/')
        const r = ch === 'main' ? doc(ourDb, 'teams', teamId, 'messages', id) : doc(ourDb, 'teams', teamId, 'channels', ch, 'messages', id)
        return { update: updater(r) }
      },
    },
  })
  return ours
}

// ── 🏌️ 프론트 방 ───────────────────────────────────────────
let front: Api | null = null
export type FrontRoomEnv = {
  channelId: string
  myId: string // g_{우리 uid}
  nameOf: (id: string) => string
  recent: { authorId: string | null; createdAt: number }[]
  takeReply: () => Record<string, unknown> | null
}
export function frontGames(e: FrontRoomEnv): Api {
  if (!front) {
    front = build()
    front.set(common())
    front.set({ assets: null, formNoFile: true, dropAsset: () => {} })
  }
  front.set({
    currentChannel: e.channelId,
    myId: e.myId,
    viewDocs: e.recent,
    displayNameFor: (id: string) => e.nameOf(id),
    takeReply: () => {
      const r = e.takeReply()
      return r ? { replyTo: r } : {}
    },
    // 프론트 Firestore 그대로 (프론트 규칙: 게스트는 text·game·authorId·createdAt·replyTo 만, 투표는 votes.{자기 id}만)
    db: {
      collection: (path: string) => ({ add: (o: Record<string, unknown>) => addDoc(collection(ydrDb, path), o) }),
      doc: (path: string) => ({ update: updater(doc(ydrDb, path)) }),
    },
  })
  return front
}

// ＋ 메뉴에 넣을 항목 ('📊 투표' → 아이콘 📊 · 투표)
export function gameMenu(api: Api): MenuAction[] {
  return api.gameMenuItems().map((g) => {
    const [icon, ...rest] = g.label.split(' ')
    return { icon, label: rest.join(' '), onSelect: () => g.action() }
  })
}

// 말풍선 안 카드: chatgame.js 의 gameCard 가 만든 것을 그대로 붙인다. 게임·투표가 바뀌면 다시 그림.
export function GameCardView({ api, msg }: { api: Api; msg: GameMsg }) {
  const box = useRef<HTMLDivElement>(null)
  const t = useSyncExternalStore(subscribeTick, () => tick)
  const key = JSON.stringify([msg.id, msg.game, msg.votes, msg.createdAt, t])
  useLayoutEffect(() => {
    box.current?.replaceChildren(api.gameCard(msg))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api])
  return <div ref={box} className="game-box" />
}
