import type { CSSProperties } from 'react'
import type { SchedulePage as Page } from './data.ts'
import { STICKER_STYLE, stickerBox, stickerDef, type Mark } from './stickers.ts'

export function stickerColors(kind: 'work' | 'off'): CSSProperties {
  const s = STICKER_STYLE[kind]
  return { '--st-fill': s.fill, '--st-stroke': s.stroke, '--st-text': s.text } as CSSProperties
}

// 스티커만 따로 그린다: 스티커가 바뀌어도 그림은 다시 그리지 않아 스크롤과 확대 위치가 유지된다.
export function StickerLayer(props: {
  page: Page
  marks: Mark[]
  pending?: Mark[]
  onMarkTap?: (mark: Mark) => void
}) {
  const { page, marks, pending = [], onMarkTap } = props
  return (
    <>
      {marks.map((m, i) => {
        const box = stickerBox(m, page.w, page.h)
        const style: CSSProperties = {
          ...stickerColors(stickerDef(m.t).kind),
          left: `${((box.cx - box.w / 2) / page.w) * 100}%`,
          top: `${((box.cy - box.h / 2) / page.h) * 100}%`,
          width: `${(box.w / page.w) * 100}%`,
          height: `${(box.h / page.h) * 100}%`,
          borderRadius: `${box.h * 0.28 * (100 / page.w)}cqw`,
          fontSize: `${(box.font / page.w) * 100}cqw`,
        }
        return (
          <button
            key={`${m.p}-${m.x}-${m.y}-${m.t}-${i}`}
            type="button"
            className={pending.includes(m) ? 'sticker pending' : 'sticker'}
            style={style}
            onClick={(e) => {
              e.stopPropagation()
              onMarkTap?.(m)
            }}
            aria-label={`스티커 ${m.t}`}
          >
            {m.t}
          </button>
        )
      })}
    </>
  )
}

