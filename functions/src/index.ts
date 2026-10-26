import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https'
import { handleCardDav, hashSecret, newCredentials } from './carddav.js'
import { passwordProblem } from './password.js'

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

// 새로 만든 채팅방(teams/{teamId}/channels/{channelId})의 메시지도 같은 폴더 규칙으로 사진을 지운다.
export const onChannelMessageDeleted = onDocumentDeleted(
  'teams/{teamId}/channels/{channelId}/messages/{msgId}',
  async (event) => {
    const { teamId, msgId } = event.params
    await getStorage().bucket().deleteFiles({ prefix: `teams/${teamId}/chat/${msgId}/` })
  },
)

// 채팅방을 지우면 방의 메시지를 모두 지운다 (메시지마다 위 트리거가 사진을 지운다).
export const onChannelDeleted = onDocumentDeleted('teams/{teamId}/channels/{channelId}', async (event) => {
  const { teamId, channelId } = event.params
  if (channelId === 'main') return
  const db = getFirestore()
  await db.recursiveDelete(db.collection(`teams/${teamId}/channels/${channelId}/messages`))
})

// 팀의 모든 채팅방 메시지 컬렉션 (기본 방 + 만든 방들)
async function messageCollections(teamId: string) {
  const db = getFirestore()
  const channels = await db.collection(`teams/${teamId}/channels`).select().get()
  return [
    db.collection(`teams/${teamId}/messages`),
    ...channels.docs.filter((c) => c.id !== 'main').map((c) => c.ref.collection('messages')),
  ]
}

// 스케줄은 팀마다 하나(teams/{teamId}/schedule/current). 새로 올리거나 지우면
// 이전 스케줄의 원본, 쪽 그림을 지운다 (스티커는 문서 안에 있어 함께 사라진다).
export const onScheduleWritten = onDocumentWritten('teams/{teamId}/schedule/{docId}', async (event) => {
  const before = event.data?.before?.data()?.uploadId as string | undefined
  const after = event.data?.after?.data()?.uploadId as string | undefined
  if (!before || before === after || !/^[A-Za-z0-9_-]+$/.test(before)) return
  await getStorage().bucket().deleteFiles({ prefix: `teams/${event.params.teamId}/schedule/${before}/` })
})

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

// 본인이 정하는 비밀번호(첫 관리자, 비밀번호 바꾸기)는 규칙(password.ts)을 지켜야 한다.
// 관리자가 정하는 임시 비밀번호는 6자 이상이면 되고, 받은 사람이 처음 로그인할 때 바꾼다.
function strongPassword(value: unknown, loginId: string) {
  const problem = typeof value === 'string' ? passwordProblem(value, loginId) : '비밀번호를 입력하세요.'
  if (problem) throw new HttpsError('invalid-argument', problem)
  return value as string
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
  const userPassword = strongPassword(req.data?.password, userEmail)

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
  batch.set(db.doc(`users/${uid}`), { name, email: userEmail, teamIds: [team.id], superAdmin: true, active: true })
  batch.update(db.doc('meta/setup'), { firstTeamId: team.id, ownerUid: uid })
  await batch.commit()
  return { teamId: team.id }
})

// ── 최고 관리자와 여러 팀 ────────────────────────────────────
// 최고 관리자(처음 만든 관리자)는 새 팀을 만들 수 있고, 모든 팀에 관리자로 들어가 있어 모든 팀을 본다.
// superAdmin 표시는 Functions만 쓴다 (보안 규칙상 본인은 name/platform/settings만 수정 가능).

async function isSuperAdmin(uid: string) {
  const db = getFirestore()
  if ((await db.doc(`users/${uid}`).get()).get('superAdmin') === true) return true
  // 최고 관리자 표시가 생기기 전에 만든 프로젝트: 첫 팀의 관리자를 최고 관리자로 정한다.
  const setup = await db.doc('meta/setup').get()
  if (!setup.exists || setup.get('ownerUid')) return false
  const firstTeam = await db.doc(`teams/${setup.get('firstTeamId')}`).get()
  if (firstTeam.get(`members.${uid}`) !== 'admin') return false
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(db.doc('meta/setup'))
    if (fresh.get('ownerUid')) throw new HttpsError('failed-precondition', '이미 최고 관리자가 있습니다.')
    tx.update(db.doc('meta/setup'), { ownerUid: uid })
    tx.set(db.doc(`users/${uid}`), { superAdmin: true }, { merge: true })
  })
  return true
}

async function requireSuperAdmin(req: CallableRequest) {
  const uid = requireUid(req)
  if (!(await isSuperAdmin(uid))) throw new HttpsError('permission-denied', '최고 관리자만 할 수 있습니다.')
  return uid
}

// 앱이 최고 관리자 화면(팀 만들기)을 보여 줄지 정한다.
export const getMyAccess = onCall(async (req) => {
  const uid = requireUid(req)
  return { superAdmin: await isSuperAdmin(uid) }
})

export const createTeam = onCall(async (req) => {
  const uid = await requireSuperAdmin(req)
  const name = text(req.data?.name, '팀 이름', 30)
  const db = getFirestore()
  const team = db.collection('teams').doc()
  const batch = db.batch()
  batch.set(team, { name, members: { [uid]: 'admin' }, createdAt: FieldValue.serverTimestamp() })
  batch.set(db.doc(`users/${uid}`), { teamIds: FieldValue.arrayUnion(team.id) }, { merge: true })
  await batch.commit()
  return { teamId: team.id }
})

// 최고 관리자는 모든 팀의 관리자로 남아 있어야 한다.
async function protectSuperAdmin(uid: string) {
  if ((await getFirestore().doc(`users/${uid}`).get()).get('superAdmin') === true) {
    throw new HttpsError('failed-precondition', '최고 관리자는 모든 팀의 관리자로 남아 있어야 합니다.')
  }
}

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
      : // 새 계정은 관리자가 정한 임시 비밀번호라, 처음 로그인하면 바꾸게 한다.
        { name, email: userEmail, teamIds: [teamId], active: true, mustChangePassword: true },
    { merge: true },
  )
  await batch.commit()
  return { uid, existed }
})

export const updateMemberRole = onCall(async (req) => {
  const { teamId, members } = await requireAdmin(req, req.data?.teamId)
  const uid = requireMember(members, req.data?.uid)
  const newRole = role(req.data?.role)
  if (newRole !== 'admin') await protectSuperAdmin(uid)
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
  await protectSuperAdmin(uid)
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
  // 초기화한 비밀번호도 임시 비밀번호이므로 다음 로그인 때 바꾸게 한다.
  await getFirestore().doc(`users/${uid}`).set({ mustChangePassword: true }, { merge: true })
  return { ok: true }
})

// 본인 비밀번호 바꾸기 (첫 로그인 때 임시 비밀번호 바꾸기 포함).
// 앱이 지금 비밀번호로 다시 로그인(재인증)한 직후에만 부른다. 규칙 검사는 서버에서도 한다.
export const changeMyPassword = onCall(async (req) => {
  const uid = requireUid(req)
  const authTime = Number(req.auth?.token.auth_time ?? 0)
  if (Date.now() / 1000 - authTime > 5 * 60) {
    throw new HttpsError('unauthenticated', '지금 비밀번호를 다시 확인해 주세요.')
  }
  const user = await getAuth().getUser(uid)
  const next = strongPassword(req.data?.password, user.email ?? '')
  await getAuth().updateUser(uid, { password: next })
  await getFirestore()
    .doc(`users/${uid}`)
    .set({ mustChangePassword: FieldValue.delete(), passwordChangedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { ok: true }
})

// 계정 사용 중지/다시 사용. 중지하면 로그인할 수 없고, 열려 있던 앱은 바로 로그아웃되며
// 로그인 화면에 이유가 나온다. 보안 규칙도 users.active를 보고 팀 데이터를 막는다.
// 계정 단위라 여러 팀에 속한 사람은 모든 팀에서 막힌다.
export const setMemberActive = onCall(async (req) => {
  const { uid: adminUid, members } = await requireAdmin(req, req.data?.teamId)
  const uid = requireMember(members, req.data?.uid)
  const active = req.data?.active === true
  const db = getFirestore()
  if (active) {
    await getAuth().updateUser(uid, { disabled: false })
    await db.doc(`users/${uid}`).set(
      { active: true, disabledReason: FieldValue.delete(), disabledAt: FieldValue.delete(), disabledBy: FieldValue.delete() },
      { merge: true },
    )
    return { ok: true }
  }
  if (uid === adminUid) throw new HttpsError('failed-precondition', '내 계정은 사용 중지할 수 없습니다.')
  await protectSuperAdmin(uid)
  if (isLastAdmin(members, uid)) throw new HttpsError('failed-precondition', '관리자가 최소 1명은 있어야 합니다.')
  const reason = text(req.data?.reason, '중지 이유', 200)
  // 앱이 이 문서를 보고 바로 로그아웃하므로, 계정을 막기 전에 먼저 쓴다.
  await db.doc(`users/${uid}`).set(
    { active: false, disabledReason: reason, disabledAt: FieldValue.serverTimestamp(), disabledBy: adminUid },
    { merge: true },
  )
  await getAuth().updateUser(uid, { disabled: true })
  await getAuth().revokeRefreshTokens(uid)
  return { ok: true }
})

// ── 용량 관리 ────────────────────────────────────────────────

// 용량 관리(용량 보기, 기간별 채팅 삭제)는 최고 관리자만 한다.
async function requireSuperAdminOf(req: CallableRequest, teamId: unknown) {
  const result = await requireAdmin(req, teamId)
  if (!(await isSuperAdmin(result.uid))) throw new HttpsError('permission-denied', '최고 관리자만 할 수 있습니다.')
  return result
}

export const getUsage = onCall(async (req) => {
  const { teamId, members } = await requireSuperAdminOf(req, req.data?.teamId)
  const db = getFirestore()
  const collections = await messageCollections(teamId)
  const sum = async (counts: Promise<{ data: () => { count: number } }>[]) =>
    (await Promise.all(counts)).reduce((total, c) => total + c.data().count, 0)

  const [[files], messageCount, photoMessageCount, customerCount] = await Promise.all([
    getStorage().bucket().getFiles({ prefix: `teams/${teamId}/` }),
    sum(collections.map((c) => c.count().get())),
    sum(collections.map((c) => c.where('hasPhotos', '==', true).count().get())),
    db.collection('customers').where('teamId', '==', teamId).count().get(),
  ])

  let bytes = 0
  let photos = 0
  let scheduleBytes = 0
  const months = new Map<string, { bytes: number; photos: number }>()
  for (const file of files) {
    const size = Number(file.metadata.size ?? 0)
    bytes += size
    // 스케줄 파일(원본 PDF, 쪽 그림)은 채팅 사진과 따로 센다.
    if (file.name.startsWith(`teams/${teamId}/schedule/`)) {
      scheduleBytes += size
      continue
    }
    // 사진 원본만 센다 (썸네일 ·_thumb.jpg, 첨부 파일 f_… 은 용량에만 넣는다)
    const isPhoto = /\/\d+\.jpg$/.test(file.name)
    const month = String(file.metadata.timeCreated ?? '').slice(0, 7) || '알 수 없음'
    const entry = months.get(month) ?? { bytes: 0, photos: 0 }
    entry.bytes += size
    if (isPhoto) entry.photos += 1
    months.set(month, entry)
    if (isPhoto) photos += 1
  }

  return {
    storage: {
      bytes,
      photos,
      scheduleBytes,
      freeBytes: FREE_STORAGE_BYTES,
      byMonth: [...months.entries()]
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => b.month.localeCompare(a.month)),
    },
    counts: {
      members: Object.keys(members).length,
      messages: messageCount,
      photoMessages: photoMessageCount,
      customers: customerCount.data().count,
    },
  }
})

// 기간을 정해 채팅을 한꺼번에 영구 삭제한다. dryRun이면 지울 양만 알려 준다.
export const deleteMessagesInRange = onCall(async (req) => {
  const { teamId } = await requireSuperAdminOf(req, req.data?.teamId)
  const from = millis(req.data?.from, '시작 날짜')
  const to = millis(req.data?.to, '끝 날짜')
  if (from >= to) throw new HttpsError('invalid-argument', '시작 날짜가 끝 날짜보다 앞서야 합니다.')
  const dryRun = req.data?.dryRun === true

  const db = getFirestore()
  // 모든 채팅방에서 그 기간의 메시지를 찾는다.
  const snaps = await Promise.all(
    (await messageCollections(teamId)).map((c) =>
      c
        .where('createdAt', '>=', Timestamp.fromMillis(from))
        .where('createdAt', '<', Timestamp.fromMillis(to))
        .select('attachments', 'files')
        .get(),
    ),
  )
  const docs = snaps.flatMap((s) => s.docs)

  let photos = 0
  let bytes = 0
  const withPhotos: string[] = []
  for (const doc of docs) {
    const attachments = (doc.get('attachments') ?? []) as { size?: number; thumbSize?: number }[]
    const files = (doc.get('files') ?? []) as { size?: number }[]
    if (attachments.length > 0 || files.length > 0) withPhotos.push(doc.id)
    photos += attachments.length
    for (const a of attachments) bytes += (a.size ?? 0) + (a.thumbSize ?? 0)
    for (const f of files) bytes += f.size ?? 0
  }
  const result = { messages: docs.length, photos, bytes }
  if (dryRun) return result

  const bucket = getStorage().bucket()
  const writer = db.bulkWriter()
  for (const doc of docs) writer.delete(doc.ref)
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

// ── 휴대폰 연락처에 표시 (CardDAV) ───────────────────────────

// 폰의 연락처 앱이 접속하는 주소. 앱 로그인과 별개인 접속 정보(Basic 인증)를 쓴다.
export const carddav = onRequest({ invoker: 'public' }, async (req, res) => {
  const result = await handleCardDav({
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.rawBody?.toString('utf8') ?? '',
  })
  res.status(result.status).set(result.headers).send(result.body)
})

// 고객이 추가, 수정, 삭제되면 팀의 contactsVersion을 올려 폰이 주소록을 다시 받게 한다.
export const onCustomerWrittenForContacts = onDocumentWritten('customers/{customerId}', async (event) => {
  const before = event.data?.before?.data()?.teamId as string | undefined
  const after = event.data?.after?.data()?.teamId as string | undefined
  const db = getFirestore()
  await Promise.all(
    [...new Set([before, after].filter((t): t is string => !!t))].map((teamId) =>
      db.doc(`teams/${teamId}`).update({ contactsVersion: FieldValue.increment(1) }).catch(() => {}),
    ),
  )
})

// 접속 정보를 새로 만든다. 예전 접속 정보는 끄므로, 그 폰에서는 고객 연락처가 사라진다.
// 비밀번호는 이때 한 번만 보여 주고 서버에는 해시만 남긴다.
export const enableContactsSync = onCall(async (req) => {
  const uid = requireUid(req)
  const db = getFirestore()
  const teamIds = ((await db.doc(`users/${uid}`).get()).get('teamIds') ?? []) as string[]
  if (teamIds.length === 0) throw new HttpsError('permission-denied', '팀에 속한 사람만 쓸 수 있습니다.')

  await disableTokens(uid)
  const { username, password } = newCredentials()
  const batch = db.batch()
  batch.set(db.doc(`carddavTokens/${username}`), {
    uid,
    secretHash: hashSecret(password),
    disabled: false,
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  })
  batch.set(db.doc(`users/${uid}/private/contactsSync`), {
    enabled: true,
    username,
    createdAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  return { username, password }
})

// 끄기. 접속 정보를 지우지 않고 "꺼짐"으로 남겨, 폰이 다음에 동기화할 때 빈 주소록을 받아 고객 연락처를 지우게 한다.
export const disableContactsSync = onCall(async (req) => {
  const uid = requireUid(req)
  await disableTokens(uid)
  await getFirestore().doc(`users/${uid}/private/contactsSync`).set({ enabled: false, username: null }, { merge: true })
  return { ok: true }
})

async function disableTokens(uid: string) {
  const db = getFirestore()
  const tokens = await db.collection('carddavTokens').where('uid', '==', uid).where('disabled', '==', false).get()
  const batch = db.batch()
  for (const t of tokens.docs) batch.update(t.ref, { disabled: true, disabledAt: FieldValue.serverTimestamp() })
  if (!tokens.empty) await batch.commit()
}
