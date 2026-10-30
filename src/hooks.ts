import { onAuthStateChanged, type User } from 'firebase/auth'
import { collection, doc, documentId, onSnapshot, query, serverTimestamp, updateDoc, where, type Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { Role } from './api.ts'
import { api } from './api.ts'
import { auth, db } from './firebase.ts'
import { rememberPeople } from './ui/Avatar.tsx'

export type Profile = {
  name: string
  position?: string // 직급 (관리자가 직원 관리에서 정함: 사원~팀장)
  avatar?: string // '' | 'preset:아이디' | 'avatars/{uid}/파일.jpg' (src/ui/Avatar.tsx)
  email: string
  teamIds: string[]
  superAdmin?: boolean
  active?: boolean // false면 관리자가 사용 중지한 계정
  disabledReason?: string
  lastSeenAt?: Timestamp // 최근 로그인(앱을 연 때, useSeenStamp)
  appVersion?: string // 그때 앱 버전 (__APP_VERSION__)
  mustChangePassword?: boolean // 임시 비밀번호(새 계정, 초기화) → 처음 로그인하면 바꾼다
  settings?: { frontChat?: boolean; team?: string; offDayReply?: { enabled?: boolean; message?: string } } // team: 마지막으로 고른 팀(기기끼리 맞춤), frontChat: 프론트 채팅에 들어가 있음 (다른 기기·다시 로그인해도 코드 없이 연결)
}
// myRole: 이 팀에서 내 권한 (최고 관리자는 팀원이 아니어도 'admin'). people: 팀원 + 최고 관리자 (글쓴이 이름 표시용). App이 채운다.
export type Team = { id: string; name: string; members: Record<string, Role>; myRole?: Role; people?: string[] }

export function useAuthUser() {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({
    user: auth.currentUser,
    loading: true,
  })
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), [])
  return state
}

// 프로필 문서가 없으면(모든 팀에서 제외되어 계정이 지워짐) missing으로 알린다.
export function useProfile(uid: string) {
  const [state, setState] = useState<{ profile: Profile | null; missing: boolean }>({
    profile: null,
    missing: false,
  })
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) rememberPeople({ [snap.id]: snap.data() as Profile })
          setState(
            snap.exists()
              ? { profile: { name: '', email: '', teamIds: [], ...snap.data() }, missing: false }
              : // 오프라인 캐시에 아직 없을 때는 서버 응답을 기다린다.
                { profile: null, missing: !snap.metadata.fromCache },
          )
        },
        () => setState({ profile: null, missing: true }),
      ),
    [uid],
  )
  return state
}

// 팀에서 제외되면 보안 규칙이 읽기를 막으므로 denied가 된다.
export function useTeam(teamId: string | undefined, retry = 0) {
  const [state, setState] = useState<{ team: Team | null; denied: boolean }>({
    team: null,
    denied: false,
  })
  useEffect(() => {
    if (!teamId) return
    setState({ team: null, denied: false })
    return onSnapshot(
      doc(db, 'teams', teamId),
      (snap) =>
        setState(
          snap.exists()
            ? { team: { id: snap.id, ...(snap.data() as Omit<Team, 'id'>) }, denied: false }
            : { team: null, denied: !snap.metadata.fromCache },
        ),
      () => setState({ team: null, denied: true }),
    )
  }, [teamId, retry])
  return state
}

// 팀원들의 이름과 아이디. Firestore "in" 조회는 30개씩 나눠서 한다.
export function useMemberProfiles(uids: string[]) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const key = [...uids].sort().join(',')
  useEffect(() => {
    if (!key) return
    const ids = key.split(',')
    const unsubscribes: (() => void)[] = []
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30)
      unsubscribes.push(
        onSnapshot(query(collection(db, 'users'), where(documentId(), 'in', chunk)), (snap) => {
          rememberPeople(Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as Profile])))
          setProfiles((prev) => {
            const next = { ...prev }
            for (const d of snap.docs) next[d.id] = d.data() as Profile
            return next
          })
        }),
      )
    }
    return () => unsubscribes.forEach((u) => u())
  }, [key])
  return profiles
}

// 내가 속한 팀들의 이름 (팀 바꾸기 칸에 표시). 이름이 바뀌면 바로 반영된다.
export function useTeamNames(teamIds: string[]) {
  const [names, setNames] = useState<Record<string, string>>({})
  const key = teamIds.join(',')
  useEffect(() => {
    if (!key) return
    const unsubscribes = key.split(',').map((id) =>
      onSnapshot(
        doc(db, 'teams', id),
        (snap) => setNames((prev) => ({ ...prev, [id]: (snap.get('name') as string) ?? '' })),
        () => {},
      ),
    )
    return () => unsubscribes.forEach((u) => u())
  }, [key])
  return names
}

// 최고 관리자 화면의 "모든 팀" 목록: 팀 이름과 팀원 수
export function useTeamsSummary(teamIds: string[]) {
  const [teams, setTeams] = useState<Record<string, { name: string; memberCount: number }>>({})
  const key = teamIds.join(',')
  useEffect(() => {
    if (!key) return
    const unsubscribes = key.split(',').map((id) =>
      onSnapshot(
        doc(db, 'teams', id),
        (snap) =>
          setTeams((prev) => ({
            ...prev,
            [id]: { name: (snap.get('name') as string) ?? '', memberCount: Object.keys(snap.get('members') ?? {}).length },
          })),
        () => {},
      ),
    )
    return () => unsubscribes.forEach((u) => u())
  }, [key])
  return teams
}

// 직원 관리의 "최근 로그인 · 앱 버전": 앱을 열 때 적는다 (버전이 바뀌었거나 10분 넘게 지났을 때만, 쓰기 절약)
export function useSeenStamp(uid: string, profile: Profile | null) {
  const ready = Boolean(profile) && profile?.active !== false
  const last = profile?.lastSeenAt?.toMillis() ?? 0
  const version = profile?.appVersion ?? ''
  useEffect(() => {
    if (!ready) return
    if (version === __APP_VERSION__ && Date.now() - last < 10 * 60 * 1000) return
    void updateDoc(doc(db, 'users', uid), { lastSeenAt: serverTimestamp(), appVersion: __APP_VERSION__ }).catch(() => undefined)
    // 앱을 연 뒤 한 번만 (적은 값이 돌아와도 다시 적지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, ready])
}

// 👑 최고 관리자: 어느 팀에도 속하지 않아도 모든 팀을 본다. 보안 규칙은 로그인 토큰의 superAdmin 표시를 보므로,
// 표시가 없으면 서버(getMyAccess)에 넣어 달라고 하고 토큰을 새로 받는다. 표시가 준비되면 true.
export function useSuperClaim(user: User, wanted: boolean) {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (!wanted) return setOk(false)
    let alive = true
    void (async () => {
      try {
        let claims = (await user.getIdTokenResult()).claims
        if (claims.superAdmin !== true) {
          const r = await api.getMyAccess().catch(() => null)
          if (r?.refresh) claims = (await user.getIdTokenResult(true)).claims
        }
        if (alive) setOk(claims.superAdmin === true)
      } catch {
        if (alive) setOk(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user, wanted])
  return ok
}

// 최고 관리자가 보는 모든 팀 (이름 순). 표시가 준비된 뒤에만 읽는다.
export function useAllTeamIds(enabled: boolean) {
  const [ids, setIds] = useState<string[] | null>(null)
  useEffect(() => {
    if (!enabled) return setIds(null)
    return onSnapshot(
      collection(db, 'teams'),
      (snap) =>
        setIds(
          snap.docs
            .map((d) => ({ id: d.id, name: (d.get('name') as string) ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
            .map((t) => t.id),
        ),
      () => setIds(null),
    )
  }, [enabled])
  return ids
}

// 최고 관리자 uid들: 팀원이 아니어도 채팅·공지·메모에 쓴 글의 이름을 보이게 (보통 1명, 한 번 읽음)
export function useSuperAdminUids() {
  const [uids, setUids] = useState<string[]>([])
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'users'), where('superAdmin', '==', true)),
        (snap) => setUids(snap.docs.map((d) => d.id)),
        () => setUids([]),
      ),
    [],
  )
  return uids
}

export const teamPeople = (team: Team) => team.people ?? Object.keys(team.members)
