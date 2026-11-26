import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from './firebase.ts'

// 🤝 프론트 공지 (2026-11-26, 프론트 GUEST_LINK 10): 모든 팀 공용 게시판 하나를 프론트 앱과 같이 쓴다.
// 우리 Firestore 최상위 frontNotices — 프론트 앱은 frontAuth(우리 함수)로 받은 'f_…' 로그인으로 같은 컬렉션을 읽고 쓴다.
// 칸 모양은 프론트와 같게: createdAt·pinnedAt·editedAt = ms 숫자, 쓴 사람 이름은 authorName 글자 그대로(우리 글 "이름 · 지원팀").
export const FRONT_NOTICES = 'frontNotices'
const PAGE = 300

export type FrontNotice = {
  id: string
  title: string
  body: string
  authorId: string
  authorName: string
  createdAt: number
  from: string
  pinned: boolean
  pinnedAt: number | null
  prank: number | null
  rank: number | null
  editedName: string
  editedAt: number | null
  imageUrl: string
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function useFrontNotices() {
  const [list, setList] = useState<FrontNotice[] | null>(null)
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, FRONT_NOTICES), orderBy('createdAt', 'desc'), limit(PAGE)),
        (snap) =>
          setList(
            snap.docs.map((d) => {
              const x = d.data()
              return {
                id: d.id,
                title: String(x.title ?? ''),
                body: String(x.body ?? ''),
                authorId: String(x.authorId ?? ''),
                authorName: String(x.authorName ?? ''),
                createdAt: num(x.createdAt) ?? 0,
                from: String(x.from ?? ''),
                pinned: x.pinned === true,
                pinnedAt: num(x.pinnedAt),
                prank: num(x.prank),
                rank: num(x.rank),
                editedName: String(x.editedName ?? ''),
                editedAt: num(x.editedAt),
                imageUrl: typeof x.imageUrl === 'string' && /^https:\/\//.test(x.imageUrl) ? x.imageUrl : '',
              }
            }),
          ),
        () => setList([]),
      ),
    [],
  )
  return list
}

// 프론트 앱과 같은 순서 (프론트 js/notices.js ntCmp): 고정 먼저, 그다음 순서 값(클수록 위)
const pinVal = (n: FrontNotice) => (n.prank != null ? n.prank : -(n.pinnedAt ?? n.createdAt))
const restVal = (n: FrontNotice) => (n.rank != null ? n.rank : n.createdAt)
export function sortFrontNotices(list: FrontNotice[]) {
  return [...list].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (b.pinned ? pinVal(b) - pinVal(a) : restVal(b) - restVal(a)) || b.createdAt - a.createdAt,
  )
}

export const myFrontName = (name: string) => `${(name || '지원팀').slice(0, 20)} · 지원팀`

export function addFrontNotice(uid: string, name: string, title: string, body: string) {
  return addDoc(collection(db, FRONT_NOTICES), {
    title: title.trim().slice(0, 100),
    body: body.trim().slice(0, 5000),
    authorId: uid,
    authorName: myFrontName(name),
    createdAt: Date.now(),
    from: 'support',
  })
}

export function editFrontNotice(id: string, uid: string, name: string, title: string, body: string) {
  return updateDoc(doc(db, FRONT_NOTICES, id), {
    title: title.trim().slice(0, 100),
    body: body.trim().slice(0, 5000),
    editedBy: uid,
    editedName: myFrontName(name),
    editedAt: Date.now(),
  })
}

export function pinFrontNotice(id: string, uid: string, on: boolean) {
  return updateDoc(
    doc(db, FRONT_NOTICES, id),
    on ? { pinned: true, pinnedAt: Date.now(), pinnedBy: uid, pcol: null, prank: null } : { pinned: false, pinnedAt: null, pinnedBy: null, pcol: null, prank: null },
  )
}

export function deleteFrontNotice(id: string) {
  return deleteDoc(doc(db, FRONT_NOTICES, id))
}
