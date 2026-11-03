// 🎮 게임 (2026-11-03 사용자 요청 "프론트에 있는 게임을 가져와서 랭킹"): 프론트 앱 게임 5개를 코드 그대로 옮겼다.
// src/games/legacy/*.js = 프론트 저장소 js/minigame·golf·boar·cart·lostball·jinsang.js 를 그대로 복사한 것.
// 그 코드가 기대하는 전역 값(db·myAccount·myProfile·toast·uiConfirm·isAdmin·firebase)을 여기서 우리 앱 것으로 이어 주고,
// 처음 🎮 을 누를 때 한 번만 <script> 로 넣는다(옛 방식 코드라 전역에서 돌아야 함). 프론트에서 게임을 고치면 legacy 파일을 다시 복사.
//
// 순위: 우리 Firestore 의 golfScores·boarScores·cartScores·lostScores·stressScores/{내 uid} (프론트와 같은 모양, 지원팀 앱 전체 한 순위표).
// 🏌️ 프론트와 같이 겨루기: 프론트 채팅에 게스트로 들어가 있으면(프론트 로그인) 순위표를 읽을 때 프론트 순위도 합쳐 보여 주고,
//   내 기록은 프론트에도 {col}/g_{내 uid} 로 같이 올린다. 프론트 보안 규칙이 게스트에게 허락해야 동작한다(GAMES_LINK.md, 안 되면 조용히 우리 순위만).
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore'
import { db as ourDb } from '../firebase.ts'
import { ydrAuth, ydrDb } from '../front/ydr.ts'
import { ask, toast } from '../ui/dialogs.tsx'
import './games.css'

const SCORE_COLS = ['golfScores', 'boarScores', 'cartScores', 'lostScores', 'stressScores']
const frontOn = () => !!ydrAuth.currentUser

type Snap = { id: string; exists: boolean; data: () => Record<string, unknown> | undefined }
const wrapSnap = (s: DocumentSnapshot): Snap => ({ id: s.id, exists: s.exists(), data: () => s.data() })
const NO_DOC = (id: string): Snap => ({ id, exists: false, data: () => undefined })

type Ref = {
  _r: DocumentReference
  _col: string
  _id: string
  get: () => Promise<Snap>
  set: (d: Record<string, unknown>) => Promise<void>
  delete: () => Promise<void>
  onSnapshot: (cb: (s: Snap) => void, err?: () => void) => () => void
}

function makeDb(uid: string) {
  const ref = (fs: Firestore, col: string, id: string): Ref => {
    const r = doc(fs, col, id)
    return {
      _r: r,
      _col: col,
      _id: id,
      get: async () => (col === 'meta' ? NO_DOC(id) : wrapSnap(await getDoc(r))), // meta/weather(프론트 날씨)는 우리에게 없음 → 바람 없이
      set: (d) => setDoc(r, d),
      delete: () => deleteDoc(r),
      onSnapshot: (cb, err) => (col === 'meta' ? (cb(NO_DOC(id)), () => {}) : onSnapshot(r, (s) => cb(wrapSnap(s)), () => err?.())),
    }
  }
  // 내 기록을 프론트에도 (프론트 규칙이 허락할 때만, 실패는 조용히)
  const mirror = (col: string, data: Record<string, unknown>) => {
    if (!frontOn() || !SCORE_COLS.includes(col)) return
    void setDoc(doc(ydrDb, col, `g_${uid}`), data).catch(() => {})
  }
  return {
    doc: (path: string) => {
      const [col, id] = path.split('/')
      return ref(ourDb, col, id)
    },
    collection: (col: string) => ({
      doc: (id: string) => ref(ourDb, col, id),
      // 순위표 읽기: 우리 순위 + (프론트에 들어가 있으면) 프론트 순위. 프론트에 올린 내 기록(g_…)은 빼고(우리 쪽에 이미 있음)
      get: async () => {
        const ours = (await getDocs(collection(ourDb, col))).docs.map(wrapSnap)
        let front: Snap[] = []
        if (frontOn() && SCORE_COLS.includes(col)) {
          try {
            front = (await getDocs(collection(ydrDb, col))).docs
              .filter((d) => !d.id.startsWith('g_'))
              .map((d) => {
                const v = { ...d.data() }
                v.name = `${String(v.name ?? '프론트 직원')} 🏌️`
                return { id: `front:${d.id}`, exists: true, data: () => v }
              })
          } catch {
            // 프론트 규칙이 아직 게스트에게 순위를 안 보여 주면 우리 순위만
          }
        }
        const docs = [...ours, ...front]
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (f: (s: Snap) => void) => docs.forEach(f) }
      },
    }),
    runTransaction: async (fn: (t: unknown) => Promise<void>) => {
      const sets: [string, Record<string, unknown>][] = []
      await runTransaction(ourDb, async (tx) => {
        sets.length = 0
        await fn({
          get: async (r: Ref) => wrapSnap(await tx.get(r._r)),
          set: (r: Ref, d: Record<string, unknown>) => {
            sets.push([r._col, d])
            tx.set(r._r, d)
          },
          update: (r: Ref, d: Record<string, unknown>) => tx.update(r._r, d),
          delete: (r: Ref) => tx.delete(r._r),
        })
      })
      for (const [col, d] of sets) mirror(col, d)
    },
  }
}

let loaded = false
type Me = { uid: string; name: string; superAdmin: boolean }
const w = window as unknown as Record<string, unknown>

export async function openGames(me: Me) {
  // 게임 코드가 쓰는 전역 값 (로그인한 사람이 바뀌어도 맞게 매번)
  w.db = makeDb(me.uid)
  w.myAccount = { loginId: me.uid, name: me.name }
  w.myProfile = { name: me.name }
  w.isAdmin = () => me.superAdmin
  // 골프의 "예전 uid 기록 옮기기"가 내 기록을 지우지 않게 (우리는 처음부터 uid 가 문서 이름이라 옮길 것이 없음)
  w.firebase = { auth: () => ({ currentUser: { uid: `legacy-${me.uid}` } }) }
  w.toast = (text: string) => toast(String(text))
  w.uiConfirm = (message: string, okLabel?: string) => ask({ message, ok: okLabel || '확인' })
  if (!loaded) {
    const files = import.meta.glob('./legacy/*.js', { query: '?raw', import: 'default' })
    const order = ['minigame', 'golf', 'boar', 'cart', 'lostball', 'jinsang']
    const parts: string[] = []
    for (const name of order) parts.push(String(await files[`./legacy/${name}.js`]()))
    // 게임 창(modal-bg)에 .fgame 을 붙여 우리 앱 .modal 모양과 섞이지 않게 (games.css 가 .fgame 안에서만 적용)
    const code = parts.join('\n;\n').replace(/className='modal-bg/g, "className='modal-bg fgame")
    const s = document.createElement('script')
    s.textContent = code
    document.head.appendChild(s)
    loaded = true
  }
  ;(w.openGames as () => void)()
}
