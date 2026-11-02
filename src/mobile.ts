import { isTouchUi } from './ui/dialogs.tsx'

// 휴대폰 화면 맞춤.
// - 키보드가 올라오면 앱 화면(.shell)을 키보드 위 영역(visualViewport)에 꼭 맞춘다.
//   아이폰 사파리는 키보드가 열리면 화면 전체를 위로 밀어 올리는데, 그만큼 따라 내려가
//   머리줄이 밀려 올라가지 않고 채팅 입력칸은 키보드 바로 위에 붙는다.
//   (갤럭시 크롬은 index.html의 interactive-widget=resizes-content로, 갤럭시 앱은 Capacitor가 화면을 줄여 준다.)
// - 입력칸을 누르고 있는 동안 <html class="keyboard-open">: 아래 탭을 숨겨 입력칸이 키보드 바로 위에 오게 한다.
export function setupMobileViewport() {
  const root = document.documentElement
  const vv = window.visualViewport
  if (vv) {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // 두 손가락으로 확대한 상태에서는 화면 크기를 바꾸지 않는다.
        if (Math.abs(vv.scale - 1) > 0.01) return
        root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`)
        root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      })
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
  }

  if (isIOSDevice()) stopPageBounce()

  const isTextField = (el: EventTarget | null) =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type))

  document.addEventListener('focusin', (e) => {
    if (isTouchUi() && isTextField(e.target)) root.classList.add('keyboard-open')
  })
  document.addEventListener('focusout', () => {
    // 다른 입력칸으로 옮겨 가는 중이면 그대로 둔다.
    setTimeout(() => {
      if (!isTextField(document.activeElement)) root.classList.remove('keyboard-open')
    }, 50)
  })
}

const isIOSDevice = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// 아이폰: 머리줄처럼 스크롤이 없는 곳(또는 목록 맨 위)에서 아래로 끌면 사파리가 화면 전체를 끌어내렸다가
// 튕기며 화면이 위로 밀려 올라갔다(2026-11-02). overscroll-behavior를 무시하는 아이폰이 있어,
// 손가락이 움직일 때 그 방향으로 더 움직일 스크롤 영역이 없으면 화면 전체 끌기를 막는다.
// 두 손가락(확대), 가로로 밀리는 영역, 슬라이더, 입력칸 안 글자 고르기는 그대로 둔다.
function stopPageBounce() {
  let startX = 0
  let startY = 0
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    },
    { passive: true },
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1 || !e.cancelable) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      const vertical = Math.abs(dy) >= Math.abs(dx)
      let el = e.target instanceof Element ? e.target : null
      if (el?.closest('input[type=range]')) return
      while (el && el !== document.body && el !== document.documentElement) {
        const st = getComputedStyle(el)
        if (vertical) {
          if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1) {
            // 맨 위에서 아래로·맨 아래에서 위로 끌면 바깥으로 번진다 → 바깥 스크롤 영역을 다시 찾고, 없으면 막는다
            const atTop = el.scrollTop <= 0
            const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
            if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return
          }
          if (el instanceof HTMLTextAreaElement) return
        } else if (/(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth + 1) {
          return
        } else if (!vertical && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          return
        }
        el = el.parentElement
      }
      e.preventDefault()
    },
    { passive: false },
  )
}

// PWA 설치: 크롬(안드로이드, PC)은 설치 창을 띄울 수 있는 이벤트를 준다. 내 정보 화면의 "앱 설치" 버튼이 쓴다.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installPrompt: InstallPrompt | null = null
const installListeners = new Set<() => void>()

export function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt = e as InstallPrompt
    installListeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    installListeners.forEach((l) => l())
  })
}

export function canInstall() {
  return installPrompt !== null
}

export function onInstallChange(listener: () => void) {
  installListeners.add(listener)
  return () => {
    installListeners.delete(listener)
  }
}

export async function promptInstall() {
  if (!installPrompt) return false
  await installPrompt.prompt()
  const { outcome } = await installPrompt.userChoice
  installPrompt = null
  installListeners.forEach((l) => l())
  return outcome === 'accepted'
}

// 홈 화면에서 연 앱(PWA)인지
export const isStandalone =
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
