// 🪟 윈도우 10 이모지 (2026-11-17 사용자 요청 "윈도우10에서 안 보이는 이모티콘들 대체해서"):
// 2020년 이후 이모지(유니코드 이모지 13.0+: 🪜🫧🫂🥹🫠🪴🪨🫐🪶🪙…)는 윈도우 10 글꼴에 없어 빈 네모로 나온다.
// 이 기기에서 색 있게 그려지는지 그림판에 그려 보고(emojiOk, 프론트 chatfx.js fxEmojiOk 와 같은 방법),
// 안 되면 비슷한 옛 이모지로 바꿔 보여 준다(fixEmoji). 저장되는 글은 그대로라 다른 기기에선 원래 이모지로 보인다.
const cache: Record<string, boolean> = {}
let pad: CanvasRenderingContext2D | null = null
export function emojiOk(e: string) {
  if (e in cache) return cache[e]
  let ok = true
  try {
    // 그림판 하나를 다시 쓴다 (고르는 창에서 이모지 1,900개를 한 번에 볼 때 빠르게)
    if (!pad) {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      pad = c.getContext('2d', { willReadFrequently: true })!
    }
    const g = pad
    g.clearRect(0, 0, 24, 24)
    g.fillStyle = '#000'
    g.textBaseline = 'top'
    g.font = '20px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
    g.fillText(e, 0, 0)
    const d = g.getImageData(0, 0, 24, 24).data
    ok = false
    for (let i = 0; i < d.length; i += 4) {
      // 색이 있으면 이모지로 그려진 것 (빈 네모·흑백 글자는 색이 없음)
      if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i + 1] - d[i + 2]) > 20)) {
        ok = true
        break
      }
    }
  } catch {
    ok = true
  }
  return (cache[e] = ok)
}

// 새 이모지 → 윈도우 10에도 있는 비슷한 이모지 (자주 쓰는 것 위주, 긴 것(ZWJ)부터 바꿈)
export const EMOJI_FB: Record<string, string> = {
  // 얼굴
  '🫠': '😩', '🥹': '🥺', '🥲': '😢', '🫢': '🤭', '🫣': '🙈', '🫡': '🙋', '🫥': '😶', '🫤': '😕', '🥸': '🤓', '🫨': '😵',
  '😮‍💨': '😮', '😵‍💫': '😵', '😶‍🌫️': '😶', '🙂‍↔️': '🙂', '🙂‍↕️': '🙂',
  // 하트
  '❤️‍🔥': '❤️', '❤️‍🩹': '❤️', '🩷': '💗', '🩵': '💙', '🩶': '🤍',
  // 손
  '🫶': '🥰', '🫰': '🤞', '🫵': '👉', '🫱': '🤚', '🫲': '🤚', '🫳': '🤚', '🫴': '🤲', '🫷': '✋', '🫸': '✋', '🤌': '👌',
  // 사람
  '🫂': '🤗', '🥷': '🦸', '🫅': '👑', '🫄': '🤰', '🫃': '🤰', '🧌': '👹',
  // 동물·자연
  '🦬': '🐃', '🦣': '🐘', '🦫': '🦦', '🐻‍❄️': '🐻', '🦤': '🐦', '🪶': '🦚', '🦭': '🐋', '🪲': '🐞', '🪳': '🐜', '🪰': '🦟', '🪱': '🐛',
  '🐈‍⬛': '🐈', '🐦‍⬛': '🐦', '🫎': '🦌', '🫏': '🐴', '🪿': '🦢', '🐦‍🔥': '🔥', '🪼': '🐙', '🪸': '🐚', '🪷': '🌸', '🪻': '🌷',
  '🪴': '🌿', '🪹': '🌳', '🪺': '🥚', '🍄‍🟫': '🍄',
  // 음식
  '🫐': '🍇', '🫒': '🥒', '🫑': '🌶️', '🫓': '🥞', '🫔': '🌯', '🫕': '🍲', '🫖': '☕', '🧋': '🥤', '🫗': '🥛', '🫘': '🥜', '🫙': '🥫',
  '🫚': '🥔', '🫛': '🥒', '🍋‍🟩': '🍋',
  // 물건
  '🪜': '🔀', '🫧': '💧', '🪨': '⛰️', '🪵': '🌲', '🛖': '🏠', '🛻': '🚚', '🪃': '🏏', '🪄': '✨', '🪅': '🎉', '🪆': '🎎', '🪡': '🧵',
  '🪢': '🧶', '🩴': '👡', '🪖': '⛑️', '🪗': '🎹', '🪘': '🥁', '🪙': '💰', '🪝': '🎣', '🪚': '🔨', '🪛': '🔧', '🪤': '🧀', '🪣': '🗑️',
  '🪥': '🧴', '🪦': '⚰️', '🪧': '📋', '🪞': '🖼️', '🪟': '🖼️', '🪠': '🚽', '🩼': '🦯', '🩻': '🩺', '🫁': '🫀', '🛞': '⚙️', '🛟': '⛑️',
  '🪫': '🔋', '🪩': '🎉', '🪬': '🧿', '🪭': '🎐', '🪮': '💇', '🪇': '🎵', '🪈': '🎵', '🛝': '🎢', '🫳🏻': '🤚', '⛓️‍💥': '⛓️',
}
const KEYS = Object.keys(EMOJI_FB).sort((a, b) => b.length - a.length)
const NEW_RE = new RegExp(KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')

// 이 기기에서 안 그려지는 새 이모지만 옛 이모지로 (그려지는 기기에서는 글을 그대로 돌려줌)
// 🪜 사다리는 기기와 상관없이 늘 🔀 (2026-11-18 프론트 12.99와 맞춤: 사다리타기 글도 이제 "🔀 사다리타기"로 저장, 예전 글의 🪜도 🔀로 보이게)
export function fixEmoji(text: string) {
  if (!text) return text
  return text.replace(/🪜/gu, '🔀').replace(NEW_RE, (e) => (emojiOk(e) ? e : EMOJI_FB[e]))
}
// 이모지 하나: 그려지면 그대로, 아니면 바꿀 것(없으면 null = 숨김)
export function safeEmoji(e: string): string | null {
  if (emojiOk(e)) return e
  return EMOJI_FB[e] ?? null
}
