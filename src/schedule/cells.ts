// 누른 곳의 "칸" 찾기: 그림 밝기에서 상하좌우 표 테두리선을 찾는다.
export type Pixels = { W: number; H: number; lum: Uint8Array }
export type Cell = { l: number; r: number; t: number; b: number }

// 밝기 = 0.299R + 0.587G + 0.114B. 그림마다 한 번만 계산해 둔다.
export function toLuminance(data: Uint8ClampedArray, W: number, H: number): Pixels {
  const lum = new Uint8Array(W * H)
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
    lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }
  return { W, H, lum }
}

// fx, fy: 누른 위치 (0~1). 못 찾으면 null.
export function findCell(px: Pixels, fx: number, fy: number): Cell | null {
  const { W, H, lum } = px
  let cx = Math.round(fx * W)
  let cy = Math.round(fy * H)
  const maxD = Math.round(Math.max(W, H) * 0.08)
  const span = Math.round(Math.max(W, H) * 0.05)
  const L = (x: number, y: number) => lum[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]
  // 테두리 점: 양옆보다 어둡거나(얇은 선), 아주 어둡거나, 양쪽 색이 다름(칸 색이 바뀌는 곳)
  const vpt = (x: number, y: number) => {
    const c = L(x, y), a = L(x - 2, y), b = L(x + 2, y)
    return (a + b) / 2 - c >= 6 || c < 140 || Math.abs(L(x + 1, y) - L(x - 1, y)) >= 10
  }
  const hpt = (x: number, y: number) => {
    const c = L(x, y), a = L(x, y - 2), b = L(x, y + 2)
    return (a + b) / 2 - c >= 6 || c < 140 || Math.abs(L(x, y + 1) - L(x, y - 1)) >= 10
  }
  // 선 = 여러 칸에 걸쳐 길게 이어짐 (span 구간의 절반 이상이 테두리 점) → 글자 획은 선으로 안 잡힘
  const vline = (x: number) => {
    let n = 0, t = 0
    for (let y = Math.max(0, cy - span); y < Math.min(H, cy + span); y++) { t++; n += vpt(x, y) ? 1 : 0 }
    return t > 0 && n / t >= 0.5
  }
  const hline = (y: number) => {
    let n = 0, t = 0
    for (let x = Math.max(0, cx - span); x < Math.min(W, cx + span); x++) { t++; n += hpt(x, y) ? 1 : 0 }
    return t > 0 && n / t >= 0.5
  }
  for (let k = 0; k < 4 && vline(cx); k++) cx += 2 // 선 위를 눌렀으면 살짝 안쪽으로
  for (let k = 0; k < 4 && hline(cy); k++) cy += 2
  const scan = (from: number, step: number, lim: number, test: (v: number) => boolean) => {
    for (let v = from, k = 0; k < maxD && v >= 0 && v < lim; v += step, k++) if (test(v)) return v
    return null
  }
  let l = scan(cx, -1, W, vline), r = scan(cx + 1, 1, W, vline)
  let t = scan(cy, -1, H, hline), b = scan(cy + 1, 1, H, hline)
  if (l == null || r == null || t == null || b == null) return null
  while (l + 1 < cx && vline(l + 1)) l++ // 선 두께만큼 안쪽으로
  while (r - 1 > cx && vline(r - 1)) r--
  while (t + 1 < cy && hline(t + 1)) t++
  while (b - 1 > cy && hline(b - 1)) b--
  if (r - l < 6 || b - t < 6) return null
  return { l: (l + 1) / W, r: r / W, t: (t + 1) / H, b: b / H }
}
