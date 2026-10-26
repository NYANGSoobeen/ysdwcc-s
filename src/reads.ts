import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { MAIN_CHANNEL, messagesRef, type Channel } from './chat.ts'
import { db } from './firebase.ts'

// 읽음 표시: teams/{팀}/channels/{방}/reads/{uid} = { at: 마지막으로 읽은 시각 }
// - 말풍선 옆 노란 숫자: 보낸 사람을 뺀 팀원 중 읽은 시각이 그 말보다 이른 사람 수.
// - 안 읽은 수: 방마다 "내가 읽은 시각 이후의 남의 말"만 지켜본다 (최대 100개, 99+로 표시).
//   지금 보고 있는 방은 지켜보지 않는다 (읽기 횟수 절약).

// 읽음 표시를 처음 만든 날. 이보다 먼저 만든 방은 처음 열 때 "지금"부터 센다 (예전 대화가 모두 안 읽음으로 뜨지 않게).
const READS_START = new Date('2026-10-26T00:00:00+09:00').getTime()
export const UNREAD_LIMIT = 100

const readsRef = (teamId: string, channelId: string) => collection(db, 'teams', teamId, 'channels', channelId, 'reads')

export function markRead(teamId: string, channelId: string, uid: string) {
  return setDoc(doc(readsRef(teamId, channelId), uid), { at: serverTimestamp() })
}

// 방의 팀원별 읽은 시각 (밀리초)
export function useRoomReads(teamId: string, channelId: string) {
  const [reads, setReads] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    setReads(null)
    return onSnapshot(
      readsRef(teamId, channelId),
      (snap) => {
        const next: Record<string, number> = {}
        for (const d of snap.docs) {
          const at = d.get('at', { serverTimestamps: 'estimate' }) as Timestamp | undefined
          if (at) next[d.id] = at.toMillis()
        }
        setReads(next)
      },
      () => setReads({}),
    )
  }, [teamId, channelId])
  return reads
}

// 이 말을 아직 안 읽은 팀원 수 (보낸 사람 제외)
export function unreadBy(members: string[], reads: Record<string, number>, authorUid: string, createdAt: number) {
  let n = 0
  for (const m of members) if (m !== authorUid && (reads[m] ?? 0) < createdAt) n++
  return n
}

export const badgeText = (n: number) => (n > 99 ? '99+' : String(n))

// 방마다 내가 안 읽은 메시지 수
export function useUnreadCounts(teamId: string | undefined, channels: Channel[] | null, uid: string, viewing: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const key = channels?.map((c) => `${c.id}:${c.createdAt?.toMillis() ?? ''}`).join('|') ?? ''

  useEffect(() => {
    if (!teamId || !channels) return
    const stops = channels
      .filter((room) => room.id !== viewing)
      .map((room) => {
        let stopMessages = () => {}
        const myRead = doc(readsRef(teamId, room.id), uid)
        const stopRead = onSnapshot(
          myRead,
          (snap) => {
            stopMessages()
            stopMessages = () => {}
            const at = snap.get('at', { serverTimestamps: 'estimate' }) as Timestamp | undefined
            if (!at) {
              // 처음: 읽음 표시 이후에 만든 방은 만든 때부터, 그 전 방(기본 방 포함)은 지금부터 센다.
              const created = room.createdAt?.toMillis() ?? 0
              const start = room.id !== MAIN_CHANNEL && created > READS_START ? room.createdAt! : serverTimestamp()
              setDoc(myRead, { at: start }).catch(() => {})
              return
            }
            stopMessages = onSnapshot(
              query(messagesRef(teamId, room.id), where('createdAt', '>', at), orderBy('createdAt'), limit(UNREAD_LIMIT)),
              (msgs) => {
                const n = msgs.docs.filter((d) => d.get('authorUid') !== uid && d.get('deleted') !== true).length
                setCounts((prev) => (prev[room.id] === n ? prev : { ...prev, [room.id]: n }))
              },
              () => {},
            )
          },
          () => {},
        )
        return () => {
          stopRead()
          stopMessages()
          setCounts((prev) => {
            if (!(room.id in prev)) return prev
            const next = { ...prev }
            delete next[room.id]
            return next
          })
        }
      })
    return () => stops.forEach((stop) => stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, uid, key, viewing])

  return counts
}
