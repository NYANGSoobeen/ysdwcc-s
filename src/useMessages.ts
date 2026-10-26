import {
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, ChatFile, LinkPreview, ReplyTo } from './chat.ts'

// 채팅방 메시지 불러오기.
// - 최근 100개는 실시간으로 받는다 (새 메시지, 수정, 삭제가 바로 보임).
// - 위로 올리면 이전 메시지를 100개씩 한 번만 읽어 앞에 붙인다 (읽기 횟수를 아껴 무료 사용량 안에서).
// - 새 메시지가 와서 최근 100개 밖으로 밀려난 메시지는 지우지 않고 그대로 둔다.
export const PAGE_SIZE = 100

export type Message = {
  id: string
  authorUid: string
  body: string
  attachments: Attachment[]
  files: ChatFile[]
  createdAt: Timestamp | null
  pending: boolean
  replyTo: ReplyTo | null
  editedAt: Timestamp | null
  deleted: boolean
  reactions: Record<string, string>
  mentions: string[]
  link: LinkPreview | null
}

function toMessage(d: QueryDocumentSnapshot<DocumentData>): Message {
  const data = d.data({ serverTimestamps: 'estimate' })
  return {
    id: d.id,
    authorUid: data.authorUid,
    body: data.body ?? '',
    attachments: data.attachments ?? [],
    files: data.files ?? [],
    createdAt: data.createdAt ?? null,
    pending: d.metadata.hasPendingWrites,
    replyTo: data.replyTo ?? null,
    editedAt: data.editedAt ?? null,
    deleted: data.deleted === true,
    reactions: data.reactions ?? {},
    mentions: data.mentions ?? [],
    link: data.link ?? null,
  }
}

const time = (m: Message) => m.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER

export function useMessages(ref: CollectionReference) {
  const [live, setLive] = useState<Message[]>([])
  const [older, setOlder] = useState<Message[]>([]) // 오래된 것부터
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  useEffect(() => {
    setLive([])
    setOlder([])
    setLoaded(false)
    let first = true
    return onSnapshot(
      query(ref, orderBy('createdAt', 'desc'), limit(PAGE_SIZE)),
      { includeMetadataChanges: true },
      (snap) => {
        const current = snap.docs.map(toMessage).reverse()
        const oldestLive = current.length ? time(current[0]) : Infinity
        const rolledOut: Message[] = []
        const deleted = new Set<string>()
        for (const change of snap.docChanges()) {
          if (change.type !== 'removed') continue
          const m = toMessage(change.doc)
          // 최근 100개 밖으로 밀려남 (가장 오래된 것보다 더 오래됨) → 그대로 보여 준다. 그 밖에는 삭제.
          if (snap.size >= PAGE_SIZE && time(m) <= oldestLive) rolledOut.push(m)
          else deleted.add(m.id)
        }
        setLive(current)
        if (rolledOut.length || deleted.size) {
          setOlder((prev) =>
            [...prev.filter((m) => !deleted.has(m.id) && !rolledOut.some((r) => r.id === m.id)), ...rolledOut].sort(
              (a, b) => time(a) - time(b),
            ),
          )
        }
        if (first && !snap.metadata.fromCache) {
          first = false
          setHasMore(snap.size >= PAGE_SIZE)
        }
        if (!snap.metadata.fromCache || snap.size > 0) setLoaded(true)
      },
    )
  }, [ref])

  const messages = useMemo(() => mergeById(older, live), [older, live])
  const latest = useRef({ messages, hasMore })
  latest.current = { messages, hasMore }

  // 가장 오래된 메시지보다 더 이전 것을 n개(기본 100개) 불러온다.
  // 이미 불러오는 중이면 그것이 끝난 뒤 이어서 불러온다 (검색, 답장 원문 찾기, 스크롤이 겹쳐도 빠짐없이).
  const inflight = useRef<Promise<number> | null>(null)
  const loadOlder = useCallback(
    async (n = PAGE_SIZE): Promise<number> => {
      while (inflight.current) await inflight.current.catch(() => 0)
      const oldest = latest.current.messages[0]
      if (!latest.current.hasMore || !oldest?.createdAt) return 0
      const run = (async () => {
        setLoadingOlder(true)
        const snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), startAfter(oldest.createdAt), limit(n)))
        const page = snap.docs.map(toMessage).reverse()
        setOlder((prev) => mergeById(page, prev))
        setHasMore(snap.size >= n)
        // 다음 호출이 렌더링 전에 와도 이어서 불러오게 바로 반영해 둔다.
        latest.current = { messages: mergeById(page, latest.current.messages), hasMore: snap.size >= n }
        return page.length
      })()
      inflight.current = run
      try {
        return await run
      } finally {
        inflight.current = null
        setLoadingOlder(false)
      }
    },
    [ref],
  )

  // 화면이 다시 그려지기 전에도 지금까지 불러온 메시지를 확인할 수 있게 (답장 원문 찾기)
  const peek = useCallback(() => latest.current.messages, [])

  return { messages, hasMore, loaded, loadingOlder, loadOlder, peek }
}

function mergeById(older: Message[], newer: Message[]) {
  const ids = new Set(newer.map((m) => m.id))
  return [...older.filter((m) => !ids.has(m.id)), ...newer]
}
