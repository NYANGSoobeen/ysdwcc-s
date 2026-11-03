// 🎮 게임 버튼: 프론트 앱처럼 화면 머리줄 오른쪽 (2026-11-03 사용자가 정함). 누르면 게임 고르기 창.
// 게임 코드(src/games/index.ts, legacy/*.js)는 처음 누를 때 불러온다 (앱을 여는 속도에 영향 없게).
type Me = { uid: string; name: string; superAdmin: boolean }
let me: Me | null = null
export function setGameUser(m: Me | null) {
  me = m
}

export function GameButton() {
  return (
    <button
      type="button"
      className="header-icon-button game-button"
      title="게임 (원터치 골프 · 멧돼지 사냥 · 카트 배차왕 · 로스트볼 찾기 · 진상 날리기)"
      aria-label="게임"
      onClick={() => {
        if (!me) return
        const who = me
        void import('./index.ts').then((g) => g.openGames(who))
      }}
    >
      🎮
    </button>
  )
}
