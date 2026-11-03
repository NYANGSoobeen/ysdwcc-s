// 🎉 채팅 효과 (2026-11-03, 프론트 앱 js/chatfx.js 를 그대로 옮김 — 사용자가 준 chatfx.js·chatfx.css·README)
// "/축하", "/생일"처럼 /명령어로 시작하는 말을 보내면, 그 방을 보고 있는 모두의 채팅 배경에 7초 애니메이션.
// - 메시지는 글 그대로 저장 (예: "/축하 승진 축하해요!") → 따로 저장하는 값 없음 · 프론트 앱과 같은 글이라 🏌️ 프론트 방에서도 양쪽 다 효과
// - 말풍선은 "🎉 승진 축하해요!"처럼 보이고, 누르면 효과를 다시 봄
// - 효과는 "방금(20초 안에) 올라온" 말에만 저절로 나옴 (예전 대화를 열 때 한꺼번에 터지지 않게)
// - 입력칸에 / 를 치면 입력칸 위에 효과 고르는 줄 (ChatFxPick)
// cmd: 같은 효과를 내는 말들 (맨 앞 말이 고르는 줄에 나옴) · functions/src/push.ts 의 FX(알림 문구)·프론트 앱과 같이 고치기
export const CHAT_FX = [
  { key: 'party', cmd: ['축하', '경축', '폭죽', 'ㅊㅋ', '축하해'], icon: '🎉', say: '축하해요!' },
  { key: 'clap', cmd: ['박수', '짝짝'], icon: '👏', say: '짝짝짝!' },
  { key: 'birthday', cmd: ['생일', '생축', '생일축하'], icon: '🎂', say: '생일 축하해요!' },
  { key: 'love', cmd: ['하트', '사랑', 'love'], icon: '💖', say: '사랑해요!' },
  { key: 'thanks', cmd: ['감사', '고마워', '땡큐'], icon: '🌸', say: '감사합니다!' },
  { key: 'fighting', cmd: ['화이팅', '파이팅', '힘내'], icon: '💪', say: '화이팅!' },
  { key: 'comfort', cmd: ['위로', '격려', '토닥'], icon: '🤗', say: '토닥토닥, 괜찮아요' },
  { key: 'good', cmd: ['수고', '고생', '수고했어'], icon: '✨', say: '수고했어요!' },
  { key: 'cry', cmd: ['ㅠㅠ', 'ㅜㅜ', '눈물', '슬퍼'], icon: '😭', say: 'ㅠㅠ' },
  { key: 'angry', cmd: ['화', '불꽃', '극대노', '분노'], icon: '😡', say: '화가 나요!!' },
  { key: 'snow', cmd: ['눈', '첫눈', '겨울'], icon: '❄️', say: '눈이 와요!' },
] as const
export type ChatFx = (typeof CHAT_FX)[number] & { rest: string }
const CHAT_FX_RECENT = 20000

// "/축하 승진 축하해요" → {key, icon, say, rest:'승진 축하해요'} · 명령어 뒤엔 띄어쓰기나 끝이어야 함
export function chatFxOf(text: string | null | undefined): ChatFx | null {
  const t = String(text || '').trim()
  if (t[0] !== '/') return null
  const m = t.slice(1).match(/^(\S+)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  const word = m[1].toLowerCase()
  const fx = CHAT_FX.find((f) => (f.cmd as readonly string[]).includes(word))
  if (!fx) return null
  return { ...fx, rest: (m[2] || '').trim() }
}

// 답장 미리보기·검색 등 글로 보일 때: "🎉 승진 축하해요!"
export function chatFxText(text: string) {
  const fx = chatFxOf(text)
  return fx ? `${fx.icon} ${fx.rest || fx.say}` : text
}

// 효과를 그릴 곳: 지금 보고 있는 채팅방의 대화 영역 (방 화면이 등록/해제)
let host: HTMLElement | null = null
export function setChatFxHost(el: HTMLElement | null) {
  if (host && host !== el) stopChatFx()
  host = el
}

// 새로 올라온 효과 말 찾기 (메시지 목록이 바뀔 때마다): 처음 보는 말 중 20초 안의 것만, 한 번에 하나(가장 최근)
const seen = new Set<string>()
export function chatFxCheck(list: { id: string; text: string; at: number | null; deleted?: boolean }[]) {
  let play: ChatFx | null = null
  for (const m of list) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    // 방금 보낸 내 말은 서버 시각이 아직 없다(null) → 지금 올라온 것으로 본다
    const at = m.at ?? Date.now()
    if (m.deleted || !m.text || Date.now() - at > CHAT_FX_RECENT) continue
    const fx = chatFxOf(m.text)
    if (fx) play = fx
  }
  if (play) chatFxPlay(play.key)
}

// ---------- 애니메이션 (대화 영역 위에 투명한 그림판, 눌러도 아래 채팅이 그대로 눌림) ----------
// 7초: 처음 5초 동안 조각이 계속 새로 나오고(화면 전체를 채움), 마지막 1.2초에 스르르 사라짐
// + 가운데에 큰 아이콘이 '팡' 하고 나타났다가 효과마다 다르게 움직이고(두근·부르르·흔들) 사라짐
const FX_DUR = 7000
const FX_SPAWN = 5000
const FX_FADE = 1200
const FX_MAX = 420
let fxRun: { c: HTMLCanvasElement; stop: () => void } | null = null

export function stopChatFx() {
  fxRun?.stop()
}

type P = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'

export function chatFxPlay(key: string) {
  const fx = CHAT_FX.find((f) => f.key === key)
  const box = host
  if (!fx || !box || !box.isConnected) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (fxRun) fxRun.stop()
  const br = box.getBoundingClientRect()
  if (br.width < 10 || br.height < 10) return
  const c = document.createElement('canvas')
  c.className = 'chat-fx-canvas'
  Object.assign(c.style, { left: `${br.left}px`, top: `${br.top}px`, width: `${br.width}px`, height: `${br.height}px` })
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const W = br.width
  const H = br.height
  c.width = Math.round(W * dpr)
  c.height = Math.round(H * dpr)
  document.body.appendChild(c)
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  const R = (a: number, b: number) => a + Math.random() * (b - a)
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
  const ps: P[] = []
  const COLORS = ['#e2776e', '#f6c343', '#5ab0e8', '#7ccf8a', '#b58be8', '#ff8fb1', '#ffa94d']
  const dens = reduce ? 0.3 : Math.min(1.4, Math.max(0.7, (W * H) / (390 * 600))) // 큰 화면은 조금 더 많이
  const add = (p: P) => {
    if (ps.length < FX_MAX) ps.push(p)
  }
  const emo = (e: string, o: P) => add({ t: 'e', e, s: R(20, 32), rot: R(-0.3, 0.3), vr: R(-0.03, 0.03), sw: R(0, 6), swA: 0.6, g: 0, ...o })
  const conf = (o: P) => add({ t: 'c', w: R(6, 11), h: R(3, 6), rot: R(0, 6), vr: R(-0.3, 0.3), col: pick(COLORS), g: 0.18, drag: 0.99, ...o })
  const burst = (x: number, y: number, col: string | null, k: number) => {
    for (let i = 0; i < k; i++) {
      const a = (Math.PI * 2 * i) / k
      const v = R(2.2, 5.2)
      add({ t: 'f', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.05, col: col || pick(COLORS), a: 1, r: R(1.6, 2.8) })
    }
  }
  // 효과마다: init = 처음 한 번, spawn(t, f) = 매 프레임 (처음 5초 동안), tint = 바탕 색, big = 가운데 아이콘 움직임
  type Spec = { big: string; tint?: string; init?: () => void; spawn?: (t: number, f: number) => void }
  const specs: Record<string, Spec> = {
    party: {
      big: 'pop',
      init() {
        for (let s = 0; s < 2; s++)
          for (let i = 0; i < 70 * dens; i++) {
            const L = s === 0
            conf({ x: L ? -10 : W + 10, y: H * R(0.6, 1), vx: (L ? 1 : -1) * R(4, 11), vy: R(-15, -7) })
          }
      },
      spawn(_t, f) {
        if (f % 2 === 0) conf({ x: R(0, W), y: -10, vx: R(-1, 1), vy: R(1, 3), g: 0.05 })
        if (f % 38 === 0) burst(R(W * 0.15, W * 0.85), R(H * 0.1, H * 0.5), null, 48)
        if (f % 70 === 35)
          for (let s = 0; s < 2; s++)
            for (let i = 0; i < 30 * dens; i++) {
              const L = s === 0
              conf({ x: L ? -10 : W + 10, y: H * R(0.6, 1), vx: (L ? 1 : -1) * R(4, 10), vy: R(-13, -6) })
            }
        if (f % 24 === 0) emo('🎉', { x: R(20, W - 20), y: -30, vx: R(-0.5, 0.5), vy: R(2, 3.5), g: 0.02 })
      },
    },
    clap: {
      big: 'clap',
      spawn(_t, f) {
        if (f % 14 === 0)
          for (let i = 0; i < 3 * dens + 1; i++)
            emo(pick(['👏', '👏', '👏', '🙌']), { x: W / 2 + R(-W * 0.3, W * 0.3), y: H + 20, vx: R(-2.5, 2.5), vy: -R(10, 15), g: 0.17, s: R(24, 38) })
        if (f % 3 === 0) add({ t: 's', x: R(0, W), y: R(0, H), r: R(2, 5), ph: R(0, 6), sp: R(0.12, 0.22), col: pick(['#f6c343', '#fff3b0', '#ffb4a2']), life: R(60, 110) })
      },
    },
    birthday: {
      big: 'pop',
      spawn(_t, f) {
        if (f % 7 === 0) add({ t: 'b', x: R(15, W - 15), y: H + 30, vx: R(-0.4, 0.4), vy: -R(2.6, 4.2), r: R(15, 24), col: pick(COLORS), sw: R(0, 6) })
        if (f % 3 === 0) conf({ x: R(0, W), y: -10, vx: R(-0.8, 0.8), vy: R(1.2, 2.6), g: 0.02 })
        if (f % 30 === 0) emo(pick(['🎂', '🎁', '🥳', '🎈']), { x: R(20, W - 20), y: H + 30, vy: -R(2.4, 3.6), s: R(26, 36) })
      },
    },
    love: {
      big: 'beat',
      spawn(_t, f) {
        if (f % 4 === 0) emo(pick(['💖', '💕', '❤️', '💗', '💓']), { x: R(10, W - 10), y: H + 25, vx: R(-0.4, 0.4), vy: -R(2.4, 4.2), s: R(18, 34), swA: 1.2 })
      },
    },
    thanks: {
      big: 'sway',
      init() {
        for (let i = 0; i < 24 * dens; i++)
          emo(pick(['🌸', '🌸', '🌷', '💐']), { x: R(0, W), y: R(-H * 0.2, H * 0.7), vx: R(-0.8, 0.8), vy: R(1.2, 2.4), s: R(16, 26), swA: 1.4, vr: R(-0.05, 0.05) })
      },
      spawn(_t, f) {
        if (f % 4 === 0) emo(pick(['🌸', '🌸', '🌷', '💐']), { x: R(0, W), y: -25, vx: R(-0.8, 0.8), vy: R(1.4, 2.6), s: R(16, 26), swA: 1.4, vr: R(-0.05, 0.05) })
      },
    },
    fighting: {
      big: 'pump',
      spawn(_t, f) {
        if (f % 5 === 0) emo(pick(['💪', '🔥', '⭐', '💪']), { x: R(15, W - 15), y: H + 25, vx: R(-1, 1), vy: -R(6, 10), g: 0.06, s: R(24, 40) })
        if (f % 10 === 0) burst(R(W * 0.2, W * 0.8), R(H * 0.15, H * 0.5), pick(['#ffa94d', '#f6c343', '#e2776e']), 30)
      },
    },
    comfort: {
      big: 'sway',
      tint: '255,214,140',
      spawn(_t, f) {
        if (f % 6 === 0) emo(pick(['🤗', '💛', '🍀', '🫂', '☀️', '💛']), { x: R(15, W - 15), y: H + 25, vx: R(-0.3, 0.3), vy: -R(1.4, 2.4), s: R(20, 32), swA: 1 })
        if (f % 3 === 0) add({ t: 's', x: R(0, W), y: R(0, H), r: R(2, 4), ph: R(0, 6), sp: R(0.05, 0.1), col: '#ffe08a', life: R(90, 150) })
      },
    },
    good: {
      big: 'pop',
      spawn(_t, f) {
        for (let i = 0; i < 2; i++) add({ t: 's', x: R(0, W), y: R(0, H), r: R(2, 6), ph: R(0, 6), sp: R(0.1, 0.2), col: pick(['#f6c343', '#fff3b0', '#ffd6e0', '#bde0ff']), life: R(60, 120) })
        if (f % 12 === 0) emo(pick(['✨', '☕', '👏', '🌟']), { x: R(20, W - 20), y: H + 25, vy: -R(2.6, 4), s: R(22, 32) })
      },
    },
    cry: {
      big: 'wobble',
      tint: '110,150,215',
      init() {
        for (let i = 0; i < 80 * dens; i++) add({ t: 'd', x: R(0, W), y: R(-H, H), vy: R(5, 9), l: R(10, 20), a: R(0.4, 0.85) })
      },
      spawn(_t, f) {
        for (let i = 0; i < 2 * dens + 1; i++) add({ t: 'd', x: R(0, W), y: -20, vy: R(5, 9), l: R(10, 20), a: R(0.4, 0.85) })
        if (f % 10 === 0) emo(pick(['😭', '😢', '💧', '💧']), { x: R(15, W - 15), y: -30, vy: R(2, 3.5), s: R(22, 32) })
      },
    },
    angry: {
      big: 'shake',
      tint: '230,50,30',
      spawn(_t, f) {
        for (let i = 0; i < 3 * dens + 1; i++) add({ t: 'fl', x: R(-10, W + 10), y: H + R(0, 30), vx: R(-0.5, 0.5), vy: -R(3, 7), r: R(12, 26), life: 1 })
        if (f % 9 === 0) emo(pick(['😡', '💢', '🔥', '🤬', '💢']), { x: R(20, W - 20), y: H + 25, vx: R(-1.5, 1.5), vy: -R(6, 10), g: 0.08, s: R(26, 44) })
        if (f % 20 === 0) add({ t: 'pop', e: '💢', x: R(30, W - 30), y: R(30, H * 0.7), s: R(30, 50), age: 0 })
      },
    },
    snow: {
      big: 'sway',
      tint: '200,220,245',
      init() {
        for (let i = 0; i < 110 * dens; i++) add({ t: 'n', x: R(0, W), y: R(-H * 0.3, H), r: R(1.5, 4.5), vy: R(0.8, 2), sw: R(0, 6), a: R(0.6, 1) })
      },
      spawn(_t, f) {
        if (f % 2 === 0) add({ t: 'n', x: R(0, W), y: -8, r: R(1.5, 4.5), vy: R(0.8, 2), sw: R(0, 6), a: R(0.6, 1) })
        if (f % 25 === 0) emo('❄️', { x: R(0, W), y: -25, vy: R(1, 1.8), s: R(18, 28), swA: 1 })
      },
    },
  }
  const S = specs[key]
  S.init?.()
  const BIG = Math.min(W, H) * 0.3
  const icon = fx.icon
  let raf = 0
  let frame = 0
  const stop = () => {
    cancelAnimationFrame(raf)
    c.remove()
    box.classList.remove('fx-shake')
    if (fxRun && fxRun.c === c) fxRun = null
  }
  fxRun = { c, stop }
  // 😡 /화: 채팅 화면이 부르르 (3번)
  if (key === 'angry' && !reduce) {
    const shake = () => {
      if (!fxRun || fxRun.c !== c) return
      box.classList.remove('fx-shake')
      void box.offsetWidth
      box.classList.add('fx-shake')
      setTimeout(() => box.classList.remove('fx-shake'), 850)
    }
    shake()
    setTimeout(shake, 1800)
    setTimeout(shake, 3600)
  }
  const T0 = performance.now()
  const dur = reduce ? 2500 : FX_DUR
  const step = (now: number) => {
    const t = now - T0
    const fade = t > dur - FX_FADE ? Math.max(0, (dur - t) / FX_FADE) : 1
    frame++
    if (!reduce && t < FX_SPAWN && S.spawn) S.spawn(t, frame)
    g.clearRect(0, 0, W, H)
    // 바탕 색 (아래에서 번지는 빛)
    if (S.tint) {
      const k = Math.min(1, t / 500) * fade * (key === 'angry' ? 0.75 + 0.25 * Math.sin(t / 180) : 1)
      const gr = g.createRadialGradient(W / 2, H, 0, W / 2, H, Math.max(W, H) * 1.1)
      gr.addColorStop(0, `rgba(${S.tint},${0.32 * k})`)
      gr.addColorStop(1, `rgba(${S.tint},0)`)
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]
      let dead = false
      if (p.t === 'c') {
        p.vy += p.g
        p.vx *= p.drag
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        dead = p.y > H + 20
        g.save()
        g.globalAlpha = fade
        g.translate(p.x, p.y)
        g.rotate(p.rot)
        g.fillStyle = p.col
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1)
        g.restore()
      } else if (p.t === 'e') {
        p.sw += 0.05
        p.vy += p.g
        p.x += (p.vx || 0) + Math.sin(p.sw) * p.swA
        p.y += p.vy
        p.rot += p.vr
        dead = p.y < -60 || p.y > H + 60
        g.save()
        g.globalAlpha = fade
        g.translate(p.x, p.y)
        g.rotate(p.rot)
        g.font = `${p.s}px ${EMOJI_FONT}`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(p.e, 0, 0)
        g.restore()
      } else if (p.t === 'b') {
        p.sw += 0.03
        p.x += p.vx + Math.sin(p.sw) * 0.6
        p.y += p.vy
        dead = p.y < -p.r * 4
        g.save()
        g.globalAlpha = 0.92 * fade
        g.fillStyle = p.col
        g.beginPath()
        g.ellipse(p.x, p.y, p.r * 0.82, p.r, 0, 0, Math.PI * 2)
        g.fill()
        g.beginPath()
        g.moveTo(p.x - 3, p.y + p.r + 4)
        g.lineTo(p.x + 3, p.y + p.r + 4)
        g.lineTo(p.x, p.y + p.r - 1)
        g.fill()
        g.globalAlpha = 0.4 * fade
        g.fillStyle = '#fff'
        g.beginPath()
        g.ellipse(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.17, p.r * 0.28, -0.4, 0, Math.PI * 2)
        g.fill()
        g.globalAlpha = 0.55 * fade
        g.strokeStyle = '#9a8a88'
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(p.x, p.y + p.r + 4)
        g.quadraticCurveTo(p.x + 7 * Math.sin(p.sw * 2), p.y + p.r + 24, p.x, p.y + p.r + 46)
        g.stroke()
        g.restore()
      } else if (p.t === 's') {
        p.ph += p.sp
        p.life--
        dead = p.life <= 0
        const k = ((Math.sin(p.ph) + 1) / 2) * Math.min(1, p.life / 20)
        g.save()
        g.globalAlpha = k * fade
        g.fillStyle = p.col
        g.translate(p.x, p.y)
        g.beginPath()
        for (let j = 0; j < 8; j++) {
          const rr = j % 2 ? p.r * 0.35 : p.r * (1 + k)
          const a = (Math.PI / 4) * j
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        g.closePath()
        g.fill()
        g.restore()
      } else if (p.t === 'f') {
        p.vy += p.g
        p.vx *= 0.985
        p.vy *= 0.985
        p.x += p.vx
        p.y += p.vy
        p.a *= 0.982
        dead = p.a < 0.04
        g.save()
        g.globalAlpha = p.a * fade
        g.fillStyle = p.col
        g.shadowColor = p.col
        g.shadowBlur = 6
        g.beginPath()
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        g.fill()
        g.restore()
      } else if (p.t === 'n') {
        p.sw += 0.02
        p.y += p.vy
        p.x += Math.sin(p.sw) * 0.6
        dead = p.y > H + 10
        g.save()
        g.globalAlpha = p.a * fade
        g.fillStyle = '#fff'
        g.shadowColor = 'rgba(120,160,200,.7)'
        g.shadowBlur = 3
        g.beginPath()
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        g.fill()
        g.restore()
      } else if (p.t === 'd') {
        p.y += p.vy
        dead = p.y > H + 20
        g.save()
        g.globalAlpha = p.a * fade
        g.strokeStyle = 'rgba(100,150,225,.9)'
        g.lineWidth = 2
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(p.x, p.y)
        g.lineTo(p.x - 1, p.y + p.l)
        g.stroke()
        g.restore()
      } else if (p.t === 'fl') {
        p.x += p.vx + R(-0.8, 0.8)
        p.y += p.vy
        p.r *= 0.972
        p.life -= 0.014
        dead = p.life <= 0 || p.r < 1.5
        g.save()
        g.globalAlpha = Math.max(0, p.life) * fade * 0.9
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r)
        gr.addColorStop(0, 'rgba(255,245,170,1)')
        gr.addColorStop(0.4, 'rgba(255,140,30,.9)')
        gr.addColorStop(1, 'rgba(220,40,20,0)')
        g.fillStyle = gr
        g.beginPath()
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        g.fill()
        g.restore()
      } else if (p.t === 'pop') {
        p.age++
        dead = p.age > 40
        const k = p.age < 8 ? (p.age / 8) * 1.3 : p.age < 14 ? 1.3 - ((p.age - 8) / 6) * 0.3 : 1
        g.save()
        g.globalAlpha = (p.age > 28 ? (40 - p.age) / 12 : 1) * fade
        g.translate(p.x, p.y)
        g.scale(k, k)
        g.font = `${p.s}px ${EMOJI_FONT}`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(p.e, 0, 0)
        g.restore()
      }
      if (dead) ps.splice(i, 1)
    }
    // 가운데 큰 아이콘: 0.35초 '팡' → 효과마다 움직임 → 3초부터 사라짐
    if (t < 3800) {
      const inK = t < 350 ? (t / 350) * 1.25 : t < 550 ? 1.25 - ((t - 350) / 200) * 0.25 : 1
      const outK = t > 3000 ? Math.max(0, (3800 - t) / 800) : 1
      let sc = inK
      let rot = 0
      let dx = 0
      let dy = -(t > 3000 ? ((t - 3000) / 800) * 30 : 0)
      const m = S.big
      const s = t / 1000
      if (m === 'beat') sc *= 1 + 0.12 * Math.max(0, Math.sin(s * Math.PI * 2.4)) ** 3
      else if (m === 'shake') {
        dx = Math.sin(t / 28) * 6
        rot = Math.sin(t / 40) * 0.08
      } else if (m === 'wobble') rot = Math.sin(s * 5) * 0.15
      else if (m === 'sway') {
        rot = Math.sin(s * 2.2) * 0.12
        dy += Math.sin(s * 2.2) * 6
      } else if (m === 'pump') sc *= 1 + 0.1 * Math.abs(Math.sin(s * 4))
      else if (m === 'clap') sc *= 1 + 0.14 * Math.max(0, Math.sin(s * Math.PI * 3)) ** 4
      g.save()
      g.globalAlpha = outK * 0.95
      g.translate(W / 2 + dx, H * 0.42 + dy)
      g.rotate(rot)
      g.scale(sc, sc)
      g.shadowColor = 'rgba(0,0,0,.18)'
      g.shadowBlur = 18
      g.shadowOffsetY = 6
      g.font = `${BIG}px ${EMOJI_FONT}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(icon, 0, 0)
      g.restore()
    }
    if (t < dur) raf = requestAnimationFrame(step)
    else stop()
  }
  raf = requestAnimationFrame(step)
}

// 다른 앱으로 가면 효과 끄기
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopChatFx()
})
