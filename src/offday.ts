import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { db } from './firebase.ts'
import type { Profile } from './hooks.ts'
import { hasPhoneNative, PhoneNative } from './phone.ts'
import { addMonths, monthKey, OFF, rosterRef } from './schedule/roster.ts'

// 🌙 휴무일 자동 응답 (갤럭시 앱 1.3.0, 폰 쪽은 android/.../phone/OffDay.kt)
// 📋 근무표에서 내가 "휴"인 날, 업무 고객 번호로 전화가 오면 → 무음 + 내가 정한 문구로 자동 문자 (전화 올 때마다).
// 개인 번호는 건드리지 않는다. 문구는 직원마다 users/{uid}.settings.offDayReply { enabled, message } (기본 문구 있음).
// 웹앱이 휴무 날짜(이번 달·다음 달)와 내 모든 팀의 고객 번호를 폰에 넣어 두면, 앱이 꺼져 있어도 폰이 혼자 처리한다.
export type OffDayReply = { enabled?: boolean; message?: string }

export const defaultOffDayMessage = (name: string) =>
  `안녕하세요, 양산동원로얄CC 지원팀 ${name || ''}입니다. 오늘은 휴무라 전화를 받지 못했습니다. 내일 연락드리겠습니다. 감사합니다.`.replace('  ', ' ')

export async function saveOffDayReply(uid: string, reply: OffDayReply) {
  const patch: Record<string, unknown> = {}
  if (reply.enabled !== undefined) patch['settings.offDayReply.enabled'] = reply.enabled
  if (reply.message !== undefined) patch['settings.offDayReply.message'] = reply.message.slice(0, 300)
  await updateDoc(doc(db, 'users', uid), patch)
}

// 내 휴무 날짜 (내 모든 팀, 이번 달 + 다음 달)
export function useMyOffDates(uid: string, teamIds: string[], enabled = true) {
  const [byDoc, setByDoc] = useState<Record<string, string[]>>({})
  const key = teamIds.join(',')
  const month = monthKey(new Date())
  useEffect(() => {
    if (!enabled || !key) return
    const subs = key.split(',').flatMap((teamId) =>
      [month, addMonths(month, 1)].map((m) =>
        onSnapshot(
          rosterRef(teamId, m),
          (snap) => {
            const codes = (snap.get(`codes`) as Record<string, Record<string, string>> | undefined)?.[uid] ?? {}
            const dates = Object.entries(codes)
              .filter(([, c]) => c === OFF)
              .map(([d]) => `${m}-${d.padStart(2, '0')}`)
            setByDoc((prev) => ({ ...prev, [`${teamId}/${m}`]: dates }))
          },
          () => {},
        ),
      ),
    )
    return () => subs.forEach((u) => u())
  }, [uid, key, month, enabled])
  return useMemo(() => [...new Set(Object.values(byDoc).flat())].sort(), [byDoc])
}

// 켜 두면 휴무 날짜·고객 번호·문구를 폰에 맞춰 둔다 (App에서 늘 돈다).
export function useOffDaySync(uid: string, teamIds: string[], profile: Profile | null) {
  const reply = (profile?.settings as { offDayReply?: OffDayReply } | undefined)?.offDayReply
  const on = hasPhoneNative && reply?.enabled === true
  const dates = useMyOffDates(uid, teamIds, on)
  const [numbers, setNumbers] = useState<string[] | null>(null)
  const key = teamIds.join(',')
  const message = reply?.message?.trim() || defaultOffDayMessage(profile?.name ?? '')

  // 내 모든 팀의 고객 번호 (갤럭시 연락처 표시와 같은 모양의 조회라 함께 켜 두면 한 번만 읽는다)
  useEffect(() => {
    if (!on || !key) return
    const ids = key.split(',')
    const byChunk = new Map<number, string[]>()
    const subs: (() => void)[] = []
    for (let i = 0; i < ids.length; i += 30) {
      subs.push(
        onSnapshot(query(collection(db, 'customers'), where('teamId', 'in', ids.slice(i, i + 30))), (snap) => {
          byChunk.set(i, snap.docs.flatMap((d) => (d.get('phones') as string[] | undefined) ?? []))
          setNumbers([...new Set([...byChunk.values()].flat())])
        }),
      )
    }
    return () => subs.forEach((u) => u())
  }, [on, key])

  useEffect(() => {
    if (!hasPhoneNative) return
    if (!on) {
      void PhoneNative.offDayConfig({ enabled: false, dates: [], numbers: [], message: '' }).catch(() => {})
      return
    }
    if (numbers === null) return
    const t = setTimeout(() => void PhoneNative.offDayConfig({ enabled: true, dates, numbers, message }).catch(() => {}), 800)
    return () => clearTimeout(t)
  }, [on, dates, numbers, message])
}
