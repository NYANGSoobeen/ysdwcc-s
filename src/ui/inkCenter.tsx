import { useLayoutEffect, useRef } from 'react'

// 글자·그림 문자를 상자 정가운데에 (가로·세로). 글꼴마다 글자가 아래나 옆으로 쏠리므로
// 실제 그려지는 모양(잉크)을 재서 그만큼 옮긴다. 근무표 스티커(inkOffsetEm)와 같은 방식.
const cache = new Map<string, [number, number]>()
let ctx: CanvasRenderingContext2D | null | undefined

function inkShift(text: string, style: CSSStyleDeclaration): [number, number] {
  const font = `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`
  const key = `${font}|${text}`
  const hit = cache.get(key)
  if (hit) return hit
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return [0, 0]
  ctx.font = font
  const m = ctx.measureText(text)
  if (!m.fontBoundingBoxAscent) return [0, 0]
  // line-height: 1 상자 안 기준선 위치(위에서부터)
  const baseline = (100 - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent
  const dy = (50 - (baseline - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)) / 100
  const dx = (m.width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2) / 100
  const v: [number, number] = [dx, dy]
  // 글꼴을 다 받은 뒤의 값만 기억한다 (받기 전 대체 글꼴 값은 다음에 다시 잰다)
  if (document.fonts?.status === 'loaded') cache.set(key, v)
  return v
}

export function CenteredGlyph({ text }: { text: string }) {
  const el = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const place = () => {
      const node = el.current
      if (!node || !text) return
      const [dx, dy] = inkShift(text, getComputedStyle(node))
      node.style.transform = `translate(${dx.toFixed(3)}em, ${dy.toFixed(3)}em)`
    }
    place()
    let alive = true
    void document.fonts?.ready.then(() => alive && place())
    return () => {
      alive = false
    }
  }, [text])
  return (
    <span ref={el} className="glyph">
      {text}
    </span>
  )
}
