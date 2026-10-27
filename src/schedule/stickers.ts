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
  ctx.font = `800 ${font}px ${STICKER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  // 글자 모양(잉크)의 위아래 가운데가 상자 가운데에 오게
  const ink = ctx.measureText(mark.t)
  ctx.fillText(mark.t, cx, cy + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2)
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

// 스티커 글꼴 (화면과 크게 보기 PNG가 같은 글꼴을 쓴다)
export const STICKER_FONT = `'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif`

// 화면 스티커 글자를 위아래 가운데로: 한글 글꼴은 글자 위·아래 여백이 달라 그냥 가운데 맞춤하면 아래로 쏠려 보인다.
// 그 글자의 실제 모양(잉크)을 재서, line-height 1 상자 안에서 얼마나 옮기면 정가운데인지(글자 크기 대비 비율) 돌려준다.
const offsets = new Map<string, number>()
export function inkOffsetEm(text: string) {
  const hit = offsets.get(text)
  if (hit !== undefined) return hit
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 0
  const size = 100
  ctx.font = `800 ${size}px ${STICKER_FONT}`
  const m = ctx.measureText(text)
  if (!m.fontBoundingBoxAscent) return 0
  // line-height: 1 상자에서 기준선 위치(위에서부터) = (1em - (글꼴 위+아래)) / 2 + 글꼴 위
  const baseline = (size - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent
  const inkCenter = baseline - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
  const dy = (size / 2 - inkCenter) / size
  // 글꼴을 다 받은 뒤의 값만 기억한다 (받기 전 대체 글꼴 값은 다음에 다시 잰다)
  if (document.fonts?.check(`800 ${size}px 'Noto Sans KR'`)) offsets.set(text, dy)
  return dy
}
