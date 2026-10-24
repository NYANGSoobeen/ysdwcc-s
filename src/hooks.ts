import { onAuthStateChanged, type User } from 'firebase/auth'
import { collection, doc, documentId, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { Role } from './api.ts'
import { auth, db } from './firebase.ts'

export type Profile = { name: string; email: string; teamIds: string[]; superAdmin?: boolean }
export type Team = { id: string; name: string; members: Record<string, Role> }

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
        (snap) =>
          setState(
            snap.exists()
              ? { profile: { name: '', email: '', teamIds: [], ...snap.data() }, missing: false }
              : // 오프라인 캐시에 아직 없을 때는 서버 응답을 기다린다.
                { profile: null, missing: !snap.metadata.fromCache },
          ),
        () => setState({ profile: null, missing: true }),
      ),
    [uid],
  )
  return state
}

// 팀에서 제외되면 보안 규칙이 읽기를 막으므로 denied가 된다.
export function useTeam(teamId: string | undefined) {
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
  }, [teamId])
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
        onSnapshot(query(collection(db, 'users'), where(documentId(), 'in', chunk)), (snap) =>
          setProfiles((prev) => {
            const next = { ...prev }
            for (const d of snap.docs) next[d.id] = d.data() as Profile
            return next
          }),
        ),
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
