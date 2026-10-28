import { FieldPath, getFirestore, type DocumentReference } from 'firebase-admin/firestore'

// 💾 용량 관리: Storage 파일이 어디에 쓰이는지 나누고, 어디에도 안 쓰이는 파일("사용하지 않는 파일")을 찾는다.
// 파일을 저장하는 곳이 늘면 여기(classifyTeamFiles)에 꼭 넣는다. 빠지면 쓰는 파일이 "사용하지 않는 파일"로 잡혀 지워질 수 있다.
//   - teams/{teamId}/chat/{msgId}/  : 채팅 사진(숫자.jpg, 숫자_thumb.jpg) · 파일(f_…) · 동영상(v_…, v_0_poster.jpg)
//   - teams/{teamId}/schedule/{uploadId}/ : 지금 스케줄(schedule/current.uploadId)의 쪽 그림·원본 PDF
// 그 밖의 경로는 "기타"로 두고 정리 대상에서 뺀다 (모르는 파일은 지우지 않는다).

export const UNUSED = '사용하지 않는 파일'

export type StoredFile = { name: string; size: number; type: string; created: string }

type MessageRefs = { attachments?: { path?: string; thumbPath?: string }[]; files?: { path?: string }[]; video?: { path?: string; posterPath?: string | null } | null }

function labelsOf(m: MessageRefs) {
  const out = new Map<string, string>()
  for (const a of m.attachments ?? []) {
    if (a.path) out.set(a.path, '채팅 사진')
    if (a.thumbPath) out.set(a.thumbPath, '채팅 사진')
  }
  for (const f of m.files ?? []) if (f.path) out.set(f.path, '채팅 파일')
  if (m.video?.path) out.set(m.video.path, '채팅 동영상')
  if (m.video?.posterPath) out.set(m.video.posterPath, '채팅 동영상')
  return out
}

export async function messageCollectionsOf(teamId: string) {
  const db = getFirestore()
  const channels = await db.collection(`teams/${teamId}/channels`).select('name').get()
  return {
    channels: channels.docs,
    collections: [
      { id: 'main', ref: db.collection(`teams/${teamId}/messages`) },
      ...channels.docs.filter((c) => c.id !== 'main').map((c) => ({ id: c.id, ref: c.ref.collection('messages') })),
    ],
  }
}

// 파일마다 쓰이는 곳(종류)을 붙인다. 읽기를 아끼려고 사진·동영상이 있는 메시지만 골라 읽고,
// 그래도 모르는 폴더(파일만 있는 메시지, 지운 메시지)만 메시지 문서를 직접 확인한다.
export async function classifyTeamFiles(teamId: string, files: StoredFile[]) {
  const db = getFirestore()
  const labels = new Map<string, string>()
  let reads = 0
  const chatPrefix = `teams/${teamId}/chat/`
  const schedulePrefix = `teams/${teamId}/schedule/`

  const { collections } = await messageCollectionsOf(teamId)
  const [current, ...snaps] = await Promise.all([
    db.doc(`teams/${teamId}/schedule/current`).get(),
    ...collections.flatMap((c) => [
      c.ref.where('hasPhotos', '==', true).select('attachments', 'files', 'video').get(),
      c.ref.where('video.path', '>', '').select('attachments', 'files', 'video').get(),
    ]),
  ])
  reads += 1
  const known = new Set<string>()
  for (const snap of snaps) {
    reads += Math.max(1, snap.size)
    for (const d of snap.docs) {
      known.add(d.id)
      for (const [path, label] of labelsOf(d.data() as MessageRefs)) labels.set(path, label)
    }
  }

  // 아직 모르는 채팅 폴더: 메시지 문서를 방마다 찾아본다 (문서가 없거나 그 파일을 안 가리키면 사용하지 않는 파일).
  const folders = new Set<string>()
  for (const f of files) {
    if (!f.name.startsWith(chatPrefix)) continue
    const msgId = f.name.slice(chatPrefix.length).split('/')[0]
    if (msgId && !known.has(msgId) && !labels.has(f.name)) folders.add(msgId)
  }
  const ids = [...folders]
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100)
    const refs: DocumentReference[] = part.flatMap((id) => collections.map((c) => c.ref.doc(id)))
    const docs = await db.getAll(...refs, { fieldMask: [new FieldPath('attachments'), new FieldPath('files'), new FieldPath('video')] })
    reads += refs.length
    for (const d of docs) if (d.exists) for (const [path, label] of labelsOf(d.data() as MessageRefs)) labels.set(path, label)
  }

  const uploadId = current.exists ? (current.get('uploadId') as string | undefined) : undefined
  // 방금(1시간 안) 올린 파일은 메시지 저장 전일 수 있어 정리하지 않는다.
  const recentMs = Number(process.env.USAGE_RECENT_MS ?? 3600_000) // 테스트에서 0으로 바꾼다
  const recent = (f: StoredFile) => Date.now() - Date.parse(f.created) < recentMs
  const labelOf = (f: StoredFile) => {
    if (f.name.startsWith(chatPrefix)) return labels.get(f.name) ?? (recent(f) ? '방금 올린 파일' : UNUSED)
    if (f.name.startsWith(schedulePrefix)) {
      const folder = f.name.slice(schedulePrefix.length).split('/')[0]
      if (!uploadId || folder !== uploadId) return recent(f) ? '방금 올린 파일' : UNUSED
      return /\.pdf$/i.test(f.name) ? '스케줄 파일' : '스케줄 사진'
    }
    return '기타'
  }
  return { labelOf, reads }
}
