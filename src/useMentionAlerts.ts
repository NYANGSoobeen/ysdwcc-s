import { limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useRef } from 'react'
import { messagesRef, type Channel } from './chat.ts'
import { toast } from './ui/dialogs.tsx'

// "○○님이 나를 불렀어요" 알림 (앱이 열려 있을 때).
// 방마다 나를 부른(mentions에 내가 든) 가장 최근 메시지 1개만 지켜보다가 새로 오면 알린다.
// 지금 그 방을 보고 있으면 알리지 않는다. 알림을 누르면 그 방으로 간다.
// (앱이 꺼져 있을 때 오는 푸시 알림은 알림 기능을 만들 때 붙인다)
type Options = {
  teamId: string | undefined
  channels: Channel[] | null
  uid: string
  names: Record<string, string>
  viewing: string | null
  onOpen: (channelId: string) => void
}

export function useMentionAlerts({ teamId, channels, uid, names, viewing, onOpen }: Options) {
  const latest = useRef({ names, viewing, onOpen })
  latest.current = { names, viewing, onOpen }
  const key = channels?.map((c) => `${c.id}:${c.name}`).join('|') ?? ''

  useEffect(() => {
    if (!teamId || !channels) return
    const stops = channels.map((room) => {
      let first = true
      return onSnapshot(
        query(messagesRef(teamId, room.id), where('mentions', 'array-contains', uid), orderBy('createdAt', 'desc'), limit(1)),
        (snap) => {
          // 처음 받은 것은 예전에 불렀던 말이므로 알리지 않는다.
          if (first) {
            first = false
            return
          }
          for (const change of snap.docChanges()) {
            if (change.type !== 'added' || change.doc.metadata.hasPendingWrites) continue
            const m = change.doc.data()
            if (m.authorUid === uid || m.deleted) continue
            const { names, viewing, onOpen } = latest.current
            if (viewing === room.id && !document.hidden) continue
            const who = names[m.authorUid] ?? '팀원'
            const preview = String(m.body ?? '').replace(/\s+/g, ' ').slice(0, 40)
            toast(`🔔 ${who}님이 나를 불렀어요 · ${room.name}\n${preview}`, { onClick: () => onOpen(room.id), long: true })
            // PC 브라우저: 다른 창을 보고 있고 알림을 허용해 두었으면 바탕화면 알림도 띄운다.
            if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              const n = new Notification(`${who}님이 나를 불렀어요`, { body: `${room.name}: ${preview}`, tag: change.doc.id })
              n.onclick = () => {
                window.focus()
                onOpen(room.id)
              }
            }
          }
        },
        () => {},
      )
    })
    return () => stops.forEach((stop) => stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, uid, key])
}
