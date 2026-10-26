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
