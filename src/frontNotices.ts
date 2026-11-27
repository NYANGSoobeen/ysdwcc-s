import { arrayRemove, arrayUnion, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { useEffect, useState } from 'react'
import { db, storage } from './firebase.ts'
import { resizeToJpeg } from './chat.ts'

// 🤝 프론트 공지 (2026-11-26, 프론트 GUEST_LINK 10): 모든 팀 공용 게시판 하나를 프론트 앱과 같이 쓴다.
// 우리 Firestore 최상위 frontNotices — 프론트 앱은 frontAuth(우리 함수)로 받은 'f_…' 로그인으로 같은 컬렉션을 읽고 쓴다.
// 칸 모양은 프론트와 같게: createdAt·pinnedAt·editedAt = ms 숫자, 쓴 사람 이름은 authorName 글자 그대로(우리 글 "이름 · 지원팀").
export const FRONT_NOTICES = 'frontNotices'
const PAGE = 300

export type FrontComment = { id: string; text: string; authorId: string; authorName: string; at: number }

export type FrontNotice = {
  comments: FrontComment[]
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
                comments: (Array.isArray(x.comments) ? (x.comments as FrontComment[]) : [])
                  .filter((c) => c && typeof c.text === 'string')
                  .sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0)),
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

// 📷 사진 한 장 (프론트 앱은 imageUrl 하나만 보여 줌): 긴 쪽 1600px JPEG로 줄여 Storage frontNotices/{글 id}/{시각}.jpg
export type FrontPhoto = { imageUrl: string; imagePath: string } | null
async function uploadPhoto(id: string, file: File, uid: string): Promise<FrontPhoto> {
  const blob = (await resizeToJpeg(file, 1600, 0.85)).blob
  const path = `${FRONT_NOTICES}/${id}/${Date.now()}.jpg`
  const r = ref(storage, path)
  await uploadBytes(r, blob, { contentType: 'image/jpeg', customMetadata: { uploaderUid: uid } })
  return { imageUrl: await getDownloadURL(r), imagePath: path }
}

export async function addFrontNotice(uid: string, name: string, title: string, body: string, photo: File | null = null) {
  const d = doc(collection(db, FRONT_NOTICES))
  const pic = photo ? await uploadPhoto(d.id, photo, uid) : null
  return setDoc(d, {
    title: title.trim().slice(0, 100),
    body: body.trim().slice(0, 5000),
    authorId: uid,
    authorName: myFrontName(name),
    createdAt: Date.now(),
    from: 'support',
    ...(pic ?? {}),
  })
}

// photo: 새 파일이면 올려서 바꾸고, null이면 사진 빼기, undefined면 그대로
export async function editFrontNotice(id: string, uid: string, name: string, title: string, body: string, photo?: File | null) {
  const pic = photo instanceof File ? await uploadPhoto(id, photo, uid) : photo === null ? { imageUrl: null, imagePath: null } : {}
  return updateDoc(doc(db, FRONT_NOTICES, id), {
    title: title.trim().slice(0, 100),
    body: body.trim().slice(0, 5000),
    editedBy: uid,
    editedName: myFrontName(name),
    editedAt: Date.now(),
    ...pic,
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

// 💬 댓글 (프론트 GUEST_LINK 10-5): 글 문서의 comments 배열에 내 댓글 하나 더하기·지우기 (규칙이 그것만 허락)
export function addFrontComment(id: string, uid: string, name: string, text: string) {
  const c: FrontComment = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim().slice(0, 1000),
    authorId: uid,
    authorName: myFrontName(name),
    at: Date.now(),
  }
  return updateDoc(doc(db, FRONT_NOTICES, id), { comments: arrayUnion(c) })
}
export function deleteFrontComment(id: string, c: FrontComment) {
  return updateDoc(doc(db, FRONT_NOTICES, id), { comments: arrayRemove(c) })
}
