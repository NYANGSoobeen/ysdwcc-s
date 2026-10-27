// 프로필 사진 대신 이름 첫 글자 동그라미 (사람마다 색이 다르다)
const AVATAR_COLORS = ['#16587b', '#3d7fa3', '#5b8a72', '#a0694b', '#7a5c99', '#b0516a', '#4f7d8c']
export function Avatar({ uid, name }: { uid: string; name: string }) {
  let hash = 0
  for (const ch of uid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  )
}

