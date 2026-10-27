import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase.ts'

export type Role = 'admin' | 'editor' | 'viewer'

export const ROLE_LABELS: Record<Role, string> = {
  admin: '관리자',
  editor: '편집',
  viewer: '보기',
}

export type Usage = {
  storage: {
    bytes: number
    photos: number
    scheduleBytes: number
    freeBytes: number
    byMonth: { month: string; bytes: number; photos: number }[]
  }
  counts: { members: number; messages: number; photoMessages: number; customers: number }
}

export type LinkPreview = { url: string; title: string; desc: string; image: string; site: string }

export type RangeResult = { messages: number; photos: number; bytes: number }

function call<Req, Res>(name: string) {
  const fn = httpsCallable<Req, Res>(functions, name)
  return async (data: Req) => (await fn(data)).data
}

export const api = {
  setupStatus: call<void, { needsSetup: boolean }>('setupStatus'),
  createFirstAdmin: call<
    { teamName: string; name: string; email: string; password: string },
    { teamId: string }
  >('createFirstAdmin'),
  addMember: call<
    { teamId: string; name: string; email: string; password: string; role: Role },
    { uid: string; existed: boolean }
  >('addMember'),
  updateMemberRole: call<{ teamId: string; uid: string; role: Role }, { ok: true }>('updateMemberRole'),
  moveMember: call<
    { fromTeamId: string; toTeamId: string; uid: string; role?: Role; newOwnerUid?: string },
    { ok: true; movedCustomers: number }
  >('moveMember'),
  removeMember: call<{ teamId: string; uid: string }, { accountDeleted: boolean }>('removeMember'),
  resetMemberPassword: call<{ teamId: string; uid: string; password: string }, { ok: true }>(
    'resetMemberPassword',
  ),
  changeMyPassword: call<{ password: string }, { ok: true }>('changeMyPassword'),
  setMemberActive: call<{ teamId: string; uid: string; active: boolean; reason?: string }, { ok: true }>(
    'setMemberActive',
  ),
  linkPreview: call<{ url: string }, LinkPreview | null>('linkPreview'),
  frontLinkInfo: call<void, { configured: boolean; updatedAt: number | null }>('frontLinkInfo'),
  setFrontLinkSecret: call<{ secret?: string }, { secret: string }>('setFrontLinkSecret'),
  getUsage: call<{ teamId: string }, Usage>('getUsage'),
  getMyAccess: call<void, { superAdmin: boolean }>('getMyAccess'),
  createTeam: call<{ name: string }, { teamId: string }>('createTeam'),
  enableContactsSync: call<void, { username: string; password: string }>('enableContactsSync'),
  disableContactsSync: call<void, { ok: true }>('disableContactsSync'),
  deleteMessagesInRange: call<
    { teamId: string; from: number; to: number; dryRun: boolean },
    RangeResult
  >('deleteMessagesInRange'),
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
