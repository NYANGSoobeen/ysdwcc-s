import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'

// Firestore와 같은 리전. 무료 사용량을 넘지 않도록 동시 실행 수를 제한한다.
setGlobalOptions({ region: 'us-west1', maxInstances: 3 })
initializeApp()

type Role = 'admin' | 'editor' | 'viewer'
const ROLES: Role[] = ['admin', 'editor', 'viewer']

// Cloud Storage 무료 사용량 (us-west1 등 미국 리전, 프로젝트 전체 기준)
const FREE_STORAGE_BYTES = 5 * 1024 ** 3

// ── 삭제 트리거 ──────────────────────────────────────────────

// 채팅 메시지를 지우면 첨부 사진도 바로 지운다.
export const onMessageDeleted = onDocumentDeleted(
  'teams/{teamId}/messages/{msgId}',
  async (event) => {
    const { teamId, msgId } = event.params
    await getStorage().bucket().deleteFiles({ prefix: `teams/${teamId}/chat/${msgId}/` })
  },
)

// Firestore는 문서를 지워도 하위 컬렉션이 남으므로, 고객을 지우면 메모와 수정 기록을 함께 지운다.
export const onCustomerDeleted = onDocumentDeleted('customers/{customerId}', async (event) => {
  const db = getFirestore()
  await db.recursiveDelete(db.doc(`customers/${event.params.customerId}`))
})

// 메모를 지우면 수정 기록도 함께 지운다.
export const onNoteDeleted = onDocumentDeleted(
  'customers/{customerId}/notes/{noteId}',
  async (event) => {
    const { customerId, noteId } = event.params
    const db = getFirestore()
    await db.recursiveDelete(db.doc(`customers/${customerId}/notes/${noteId}`))
  },
)

// ── 계정과 팀원 관리 ─────────────────────────────────────────
// 계정은 관리자만 만든다 (콘솔에서 이메일/비밀번호 가입을 꺼 둔다).
// 팀원 추가, 권한 변경, 삭제는 Auth 계정과 함께 바뀌어야 하므로 모두 여기서 처리한다.

function requireUid(req: CallableRequest) {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.')
  return req.auth.uid
}

function text(value: unknown, label: string, max = 100) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${label}을(를) 입력하세요.`)
  }
  if (value.length > max) throw new HttpsError('invalid-argument', `${label}이(가) 너무 깁니다.`)
  return value.trim()
}

function email(value: unknown) {
  const v = text(value, '아이디', 200).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpsError('invalid-argument', '아이디 형식이 올바르지 않습니다.')
  return v
}

function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 6) {
    throw new HttpsError('invalid-argument', '비밀번호는 6자 이상이어야 합니다.')
  }
  return value
}

function role(value: unknown): Role {
  if (!ROLES.includes(value as Role)) throw new HttpsError('invalid-argument', '권한이 올바르지 않습니다.')
  return value as Role
}

function millis(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpsError('invalid-argument', `${label}이(가) 올바르지 않습니다.`)
  }
  return value
}

async function requireAdmin(req: CallableRequest, teamId: unknown) {
  const uid = requireUid(req)
  const id = text(teamId, '팀')
  const snap = await getFirestore().doc(`teams/${id}`).get()
  const members = (snap.get('members') ?? {}) as Record<string, Role>
  if (members[uid] !== 'admin') throw new HttpsError('permission-denied', '관리자만 할 수 있습니다.')
  return { uid, teamId: id, members }
}

function requireMember(members: Record<string, Role>, uid: unknown) {
  if (typeof uid !== 'string' || !members[uid]) throw new HttpsError('not-found', '팀원이 아닙니다.')
  return uid
}

function isLastAdmin(members: Record<string, Role>, uid: string) {
  return members[uid] === 'admin' && Object.values(members).filter((r) => r === 'admin').length === 1
}

function authError(error: unknown): never {
  const code = (error as { code?: string }).code
  if (code === 'auth/email-already-exists') throw new HttpsError('already-exists', '이미 사용 중인 아이디입니다.')
  if (code === 'auth/invalid-password') throw new HttpsError('invalid-argument', '비밀번호는 6자 이상이어야 합니다.')
  if (code === 'auth/invalid-email') throw new HttpsError('invalid-argument', '아이디 형식이 올바르지 않습니다.')
  throw error
}

// 로그인 화면에서 "첫 관리자 만들기"를 보여 줄지 정한다.
export const setupStatus = onCall(async () => {
  const setup = await getFirestore().doc('meta/setup').get()
  return { needsSetup: !setup.exists }
})

// 프로젝트에서 딱 한 번, 첫 팀과 관리자 계정을 만든다.
export const createFirstAdmin = onCall(async (req) => {
  const teamName = text(req.data?.teamName, '팀 이름')
  const name = text(req.data?.name, '이름')
  const userEmail = email(req.data?.email)
  const userPassword = password(req.data?.password)

  const db = getFirestore()
  try {
    // create()는 문서가 이미 있으면 실패하므로, 동시에 눌러도 한 번만 통과한다.
    await db.doc('meta/setup').create({ createdAt: FieldValue.serverTimestamp() })
  } catch {
    throw new HttpsError('failed-precondition', '이미 관리자가 있습니다. 관리자에게 계정을 요청하세요.')
  }

  let uid: string
  try {
    uid = (await getAuth().createUser({ email: userEmail, password: userPassword, displayName: name })).uid
  } catch (error) {
    await db.doc('meta/setup').delete()
    authError(error)
  }

  const team = db.collection('teams').doc()
  const batch = db.batch()
  batch.set(team, {
    name: teamName,
    members: { [uid]: 'admin' },
    createdAt: FieldValue.serverTimestamp(),
  })
  batch.set(db.doc(`users/${uid}`), { name, email: userEmail, teamIds: [team.id] })
  batch.update(db.doc('meta/setup'), { firstTeamId: team.id })
  await batch.commit()
  return { teamId: team.id }
})

// 팀원 추가. 다른 팀에 이미 계정이 있으면 비밀번호는 그대로 두고 이 팀에만 추가한다.
export const addMember = onCall(async (req) => {
  const { teamId, members } = await requireAdmin(req, req.data?.teamId)
  const name = text(req.data?.name, '이름')
  const userEmail = email(req.data?.email)
  const memberRole = role(req.data?.role)
  const auth = getAuth()
  const db = getFirestore()

  let uid: string
  let existed = true
  try {
    uid = (await auth.getUserByEmail(userEmail)).uid
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
    existed = false
    try {
      uid = (await auth.createUser({
        email: userEmail,
        password: password(req.data?.password),
        displayName: name,
      })).uid
    } catch (createError) {
      if (createError instanceof HttpsError) throw createError
      authError(createError)
    }
  }
  if (members[uid]) throw new HttpsError('already-exists', '이미 팀원입니다.')

  const batch = db.batch()
  batch.update(db.doc(`teams/${teamId}`), { [`members.${uid}`]: memberRole })
  batch.set(
    db.doc(`users/${uid}`),
    existed
      ? { email: userEmail, teamIds: FieldValue.arrayUnion(teamId) }
      : { name, email: userEmail, teamIds: [teamId] },
    { merge: true },
  )
  await batch.commit()
  return { uid, existed }
})

export const updateMemberRole = onCall(async (req) => {
  const { teamId, members } = await requireAdmin(req, req.data?.teamId)
  const uid = requireMember(members, req.data?.uid)
  const newRole = role(req.data?.role)
  if (newRole !== 'admin' && isLastAdmin(members, uid)) {
    throw new HttpsError('failed-precondition', '관리자가 최소 1명은 있어야 합니다.')
  }
  await getFirestore().doc(`teams/${teamId}`).update({ [`members.${uid}`]: newRole })
  return { ok: true }
})

// 팀에서 빼면 보안 규칙상 즉시 팀 데이터에 접근할 수 없다.
// 더 이상 속한 팀이 없으면 계정도 지워 다시 로그인할 수 없게 한다.
export const removeMember = onCall(async (req) => {
  const { teamId, members } = await requireAdmin(req, req.data?.teamId)
  const uid = requireMember(members, req.data?.uid)
  if (isLastAdmin(members, uid)) {
    throw new HttpsError('failed-precondition', '관리자가 최소 1명은 있어야 합니다.')
  }

  const db = getFirestore()
  const userRef = db.doc(`users/${uid}`)
  const batch = db.batch()
  batch.update(db.doc(`teams/${teamId}`), { [`members.${uid}`]: FieldValue.delete() })
  batch.set(userRef, { teamIds: FieldValue.arrayRemove(teamId) }, { merge: true })
  await batch.commit()

  const remaining = ((await userRef.get()).get('teamIds') ?? []) as string[]
  if (remaining.length > 0) return { accountDeleted: false }

  await userRef.delete()
  try {
    await getAuth().deleteUser(uid)
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
  }
  return { accountDeleted: true }
})

export const resetMemberPassword = onCall(async (req) => {
  const { members } = await requireAdmin(req, req.data?.teamId)
  const uid = requireMember(members, req.data?.uid)
  await getAuth().updateUser(uid, { password: password(req.data?.password) })
  // 다른 기기에 남은 로그인은 토큰이 갱신될 때 끊긴다.
  await getAuth().revokeRefreshTokens(uid)
  return { ok: true }
})

// ── 용량 관리 ────────────────────────────────────────────────

export const getUsage = onCall(async (req) => {
  const { teamId, members } = await requireAdmin(req, req.data?.teamId)
  const db = getFirestore()
  const messages = db.collection(`teams/${teamId}/messages`)

  const [[files], messageCount, photoMessageCount, customerCount] = await Promise.all([
    getStorage().bucket().getFiles({ prefix: `teams/${teamId}/` }),
    messages.count().get(),
    messages.where('hasPhotos', '==', true).count().get(),
    db.collection('customers').where('teamId', '==', teamId).count().get(),
  ])

  let bytes = 0
  let photos = 0
  const months = new Map<string, { bytes: number; photos: number }>()
  for (const file of files) {
    const size = Number(file.metadata.size ?? 0)
    const isPhoto = !file.name.endsWith('_thumb.jpg')
    const month = String(file.metadata.timeCreated ?? '').slice(0, 7) || '알 수 없음'
    const entry = months.get(month) ?? { bytes: 0, photos: 0 }
    entry.bytes += size
    if (isPhoto) entry.photos += 1
    months.set(month, entry)
    bytes += size
    if (isPhoto) photos += 1
  }

  return {
    storage: {
      bytes,
      photos,
      freeBytes: FREE_STORAGE_BYTES,
      byMonth: [...months.entries()]
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => b.month.localeCompare(a.month)),
    },
    counts: {
      members: Object.keys(members).length,
      messages: messageCount.data().count,
      photoMessages: photoMessageCount.data().count,
      customers: customerCount.data().count,
    },
  }
})

// 기간을 정해 채팅을 한꺼번에 영구 삭제한다. dryRun이면 지울 양만 알려 준다.
export const deleteMessagesInRange = onCall(async (req) => {
  const { teamId } = await requireAdmin(req, req.data?.teamId)
  const from = millis(req.data?.from, '시작 날짜')
  const to = millis(req.data?.to, '끝 날짜')
  if (from >= to) throw new HttpsError('invalid-argument', '시작 날짜가 끝 날짜보다 앞서야 합니다.')
  const dryRun = req.data?.dryRun === true

  const db = getFirestore()
  const snap = await db
    .collection(`teams/${teamId}/messages`)
    .where('createdAt', '>=', Timestamp.fromMillis(from))
    .where('createdAt', '<', Timestamp.fromMillis(to))
    .select('attachments')
    .get()

  let photos = 0
  let bytes = 0
  const withPhotos: string[] = []
  for (const doc of snap.docs) {
    const attachments = (doc.get('attachments') ?? []) as { size?: number; thumbSize?: number }[]
    if (attachments.length > 0) withPhotos.push(doc.id)
    photos += attachments.length
    for (const a of attachments) bytes += (a.size ?? 0) + (a.thumbSize ?? 0)
  }
  const result = { messages: snap.size, photos, bytes }
  if (dryRun) return result

  const bucket = getStorage().bucket()
  const writer = db.bulkWriter()
  for (const doc of snap.docs) writer.delete(doc.ref)
  await writer.close()
  // 메시지 삭제 트리거도 사진을 지우지만, 결과를 바로 보여 주기 위해 여기서도 지운다.
  for (let i = 0; i < withPhotos.length; i += 10) {
    await Promise.all(
      withPhotos.slice(i, i + 10).map((msgId) =>
        bucket.deleteFiles({ prefix: `teams/${teamId}/chat/${msgId}/` }),
      ),
    )
  }
  return result
})
