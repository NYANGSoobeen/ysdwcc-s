import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging, type Message } from 'firebase-admin/messaging'

// 푸시 알림 (FCM).
// - 기기마다 pushTokens/{sha256(token)} = { uid, token, platform: 'web'|'android', mode: 'all'|'mentions', updatedAt }
//   (앱 "내 정보"에서 알림을 켜면 생기고, 끄거나 로그아웃하면 지운다)
// - 웹은 데이터만 보내고 서비스 워커(public/push-sw.js)가 알림을 그린다 (앱을 보고 있으면 띄우지 않음).
// - 보낼 수 없는 토큰(앱 삭제, 알림 해제)은 지운다.

export type PushNote = {
  title: string
  body: string
  url: string // 알림을 누르면 열 주소 (/?room=팀:방, /?front=방)
  tag: string // 같은 방 알림은 하나로 묶는다
}

type Token = { id: string; uid: string; token: string; platform: string; mode: string }

const chunk = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

export async function tokensOf(uids: string[]): Promise<Token[]> {
  const db = getFirestore()
  const out: Token[] = []
  for (const part of chunk([...new Set(uids)], 30)) {
    const snap = await db.collection('pushTokens').where('uid', 'in', part).get()
    for (const d of snap.docs) {
      const v = d.data()
      if (typeof v.token === 'string') out.push({ id: d.id, uid: v.uid, token: v.token, platform: v.platform ?? 'web', mode: v.mode ?? 'all' })
    }
  }
  return out
}

export function buildMessage(t: Pick<Token, 'token' | 'platform'>, note: PushNote): Message {
  const data = { title: note.title, body: note.body, url: note.url, tag: note.tag }
  if (t.platform === 'android') {
    return {
      token: t.token,
      notification: { title: note.title, body: note.body },
      data,
      android: { priority: 'high', notification: { tag: note.tag } },
    }
  }
  return { token: t.token, data, webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) } } }
}

// 보내는 부분 (테스트에서 바꿔 끼운다)
export type Sender = (messages: Message[]) => Promise<{ ok: boolean; code?: string }[]>
let sender: Sender = async (messages) => {
  const res = await getMessaging().sendEach(messages)
  return res.responses.map((r) => ({ ok: r.success, code: r.error?.code }))
}
export function setSender(next: Sender) {
  sender = next
}

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']

// 받는 사람마다 알림 내용이 다를 수 있다 (나를 부른 말).
export async function sendNotes(targets: { token: Token; note: PushNote }[]) {
  if (targets.length === 0) return 0
  let sent = 0
  for (const part of chunk(targets, 500)) {
    const results = await sender(part.map((t) => buildMessage(t.token, t.note)))
    const dead = part.filter((_, i) => !results[i]?.ok && DEAD.includes(results[i]?.code ?? ''))
    sent += results.filter((r) => r.ok).length
    if (dead.length) {
      const db = getFirestore()
      await Promise.all(dead.map((t) => db.doc(`pushTokens/${t.token.id}`).delete().catch(() => {})))
    }
  }
  return sent
}

// 사용 중지되었거나 팀에서 빠진 사람에게는 보내지 않는다.
export async function activeUsers(uids: string[], teamId?: string) {
  if (uids.length === 0) return new Map<string, { name: string }>()
  const db = getFirestore()
  const docs = await db.getAll(...uids.map((u) => db.doc(`users/${u}`)))
  const out = new Map<string, { name: string }>()
  for (const d of docs) {
    if (!d.exists || d.get('active') === false) continue
    if (teamId && !(d.get('teamIds') ?? []).includes(teamId)) continue
    out.set(d.id, { name: String(d.get('name') ?? '') })
  }
  return out
}

const short = (text: string, n: number) => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export function previewOf(m: Record<string, unknown>) {
  const body = typeof m.body === 'string' ? m.body : ''
  if (body.trim()) return short(body, 100)
  const photos = Array.isArray(m.attachments) ? m.attachments.length : 0
  if (photos) return photos > 1 ? `📷 사진 ${photos}장` : '📷 사진'
  const files = Array.isArray(m.files) ? (m.files as { name?: string }[]) : []
  if (files.length) return `📎 ${files[0].name ?? '파일'}${files.length > 1 ? ` 외 ${files.length - 1}개` : ''}`
  return '새 메시지'
}

// 팀 채팅 새 메시지 → 보낸 사람을 뺀 팀원에게.
// mode 'mentions' 기기는 나를 부른 말(@이름, @모두)만 받는다.
export async function notifyChatMessage(teamId: string, channelId: string, m: Record<string, unknown>) {
  if (m.deleted === true || typeof m.authorUid !== 'string') return 0
  const db = getFirestore()
  const team = await db.doc(`teams/${teamId}`).get()
  const members = Object.keys((team.get('members') as Record<string, string>) ?? {})
  const author = m.authorUid
  const others = members.filter((u) => u !== author)
  if (others.length === 0) return 0
  const tokens = await tokensOf(others)
  if (tokens.length === 0) return 0
  const [room, people] = await Promise.all([
    db.doc(`teams/${teamId}/channels/${channelId}`).get(),
    activeUsers([author, ...new Set(tokens.map((t) => t.uid))], teamId),
  ])
  const roomName = String(room.get('name') ?? '') || (channelId === 'main' ? '전체 채팅' : '채팅방')
  const who = (await db.doc(`users/${author}`).get()).get('name') || '팀원'
  const mentions = new Set(Array.isArray(m.mentions) ? (m.mentions as string[]) : [])
  const text = previewOf(m)
  const url = `/?room=${encodeURIComponent(`${teamId}:${channelId}`)}`
  const tag = `room-${teamId}-${channelId}`
  const targets = tokens
    .filter((t) => people.has(t.uid))
    .filter((t) => t.mode !== 'mentions' || mentions.has(t.uid))
    .map((t) => ({
      token: t,
      note: mentions.has(t.uid)
        ? { title: `🔔 ${who}님이 나를 불렀어요 · ${roomName}`, body: text, url, tag }
        : { title: roomName, body: `${who}: ${text}`, url, tag },
    }))
  return sendNotes(targets)
}

// 🏌️ 프론트 채팅방 새 말 (프론트 서버가 ydrGuestPush로 알려 줌) → 그 방에 있는 우리 직원에게.
export async function notifyFront(uids: string[], title: string, body: string, ch: string) {
  const people = await activeUsers(uids)
  const tokens = (await tokensOf([...people.keys()])).filter((t) => t.mode !== 'mentions')
  const note = {
    title: short(`🏌️ ${title || '프론트 채팅'}`, 80),
    body: short(body || '새 메시지', 120),
    url: `/?front=${encodeURIComponent(ch)}`,
    tag: `front-${ch}`,
  }
  return sendNotes(tokens.map((token) => ({ token, note })))
}
