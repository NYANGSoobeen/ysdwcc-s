// 수정 표시 스티커 설정. 회사 근무 코드가 바뀌면 이 배열만 고치면 된다.
//   t: 스티커 글자 (근무표에 붙는 그대로)
//   kind: 'work'(노란 스티커) | 'off'(휴무칸 색 스티커)
//   row: 스티커 버튼 줄 (1줄, 2줄)
//   half: 반차 스티커 (칸을 못 찾았을 때 기본 글자 크기를 72%로)
export type StickerDef = { t: string; kind: 'work' | 'off'; row: 1 | 2; half?: boolean }

// 지원팀 근무 코드: B0(근무), 휴(휴무). 예) 반차를 넣으려면 { t: 'B/반', kind: 'work', row: 1, half: true }
export const STICKERS: StickerDef[] = [
  { t: 'B0', kind: 'work', row: 1 },
  { t: '휴', kind: 'off', row: 1 },
]

export const STICKER_STYLE = {
  work: { fill: '#ffe14a', stroke: '#d4a800', text: '#1a1a1a' },
  off: { fill: '#fce4d6', stroke: '#f4b183', text: '#1a1a1a' },
} as const

// 저장 모양. 좌표는 그림 크기 대비 0~1 비율 (칸을 못 찾았으면 w, h 없음)
export type Mark = { p: number; x: number; y: number; w?: number; h?: number; t: string }

export function stickerDef(t: string): StickerDef {
  return STICKERS.find((s) => s.t === t) ?? { t, kind: 'work', row: 1, half: t.includes('/반') }
}

// 글자폭: 한글 1글자 = 1, 영문·숫자·기호 = 0.62
export function textWidth(text: string) {
  let w = 0
  for (const ch of text) w += /[ㄱ-힝]/.test(ch) ? 1 : 0.62
  return w
}

// 스티커 상자와 글자 크기 (그림 픽셀 기준). 화면에서도, 크게 보기 PNG에서도 같은 계산을 쓴다.
export function stickerBox(mark: Mark, W: number, H: number) {
  const tw = textWidth(mark.t)
  if (mark.w && mark.h) {
    const cw = mark.w * W
    const ch = mark.h * H
    const font = Math.min(ch * 0.56, (cw * 0.8) / tw)
    return { cx: mark.x * W, cy: mark.y * H, w: cw, h: ch, font }
  }
  // 칸을 못 찾은 스티커: 그림 너비의 1.05% (반차는 72%), 상자는 글자 크기에서 거꾸로 계산
  const font = W * 0.0105 * (stickerDef(mark.t).half ? 0.72 : 1)
  return { cx: mark.x * W, cy: mark.y * H, w: (font * tw) / 0.8, h: font / 0.56, font }
}

export function drawSticker(ctx: CanvasRenderingContext2D, mark: Mark, W: number, H: number) {
  const { cx, cy, w, h, font } = stickerBox(mark, W, H)
  const style = STICKER_STYLE[stickerDef(mark.t).kind]
  const r = h * 0.28
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r)
  ctx.fillStyle = style.fill
  ctx.fill()
  ctx.lineWidth = Math.max(1, h * 0.06)
  ctx.strokeStyle = style.stroke
  ctx.stroke()
  ctx.fillStyle = style.text
  ctx.font = `800 ${font}px Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(mark.t, cx, cy + font * 0.04)
  ctx.restore()
}

// 같은 칸(새 칸 안에 가운데가 들어오는 스티커)을 찾는다 → 바꿔 붙이기
export function sameCell(a: Mark, b: Mark) {
  if (a.p !== b.p) return false
  const box = b.w && b.h ? b : a.w && a.h ? a : null
  if (!box) return Math.abs(a.x - b.x) < 0.004 && Math.abs(a.y - b.y) < 0.004
  const other = box === b ? a : b
  return Math.abs(other.x - box.x) <= box.w! / 2 && Math.abs(other.y - box.y) <= box.h! / 2
}
