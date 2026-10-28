import { registerSW } from 'virtual:pwa-register'

// 새 버전은 저절로 적용한다.
// - 새로고침(F5)하거나 앱을 다시 열 때 새 버전을 찾으면 바로 바꾼다 (한 번 더 새로고침됨).
// - 쓰는 중에 찾으면, 쓰던 글·고른 사진·열린 창·올리는 중인 것이 없을 때 바꾼다.
//   그런 게 있으면 하단 알림을 띄우고, 다 끝나면 바꾼다 (알림을 눌러도 바로 바뀜).

// 아이폰 홈 화면 앱은 브라우저가 업데이트를 자주 확인하지 않으므로 직접 확인한다.
const CHECK_INTERVAL_MS = 30 * 60 * 1000
// 기다리는 동안 바꿀 수 있게 되었는지 보는 간격
const RETRY_MS = 15 * 1000

// 지금 바꾸면(새로고침되면) 사라지는 것이 있는지
function busy() {
  const typing = (el: Element | null) =>
    (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NOT_TEXT.includes(el.type))) && el.value.trim() !== ''
  // 쓰고 있는 칸, 채팅·메모 입력칸, 열어 둔 입력 양식(고객 추가·수정, 비밀번호 등)
  if (typing(document.activeElement)) return true
  for (const el of document.querySelectorAll('textarea, form.form input')) if (typing(el)) return true
  // 창(확인·입력·부서 이동 등), 사진 크게 보기, 보낼 사진·파일 고른 중, 올리는 중
  if (document.querySelector('.modal-backdrop, .viewer, .previews, .file-chips')) return true
  if (document.body.innerText.includes('올리는 중')) return true
  return false
}
const NOT_TEXT = ['checkbox', 'radio', 'button', 'submit', 'hidden', 'file']

export function setupUpdateNotice() {
  if (!('serviceWorker' in navigator)) return

  let registration: ServiceWorkerRegistration | undefined
  let pending = false
  let applying = false

  const apply = () => {
    if (applying) return
    applying = true
    // 대기 중인 새 서비스 워커를 활성화하고, 활성화되면 페이지를 새로고침한다.
    void updateSW(true)
  }
  const tryApply = () => {
    if (!pending || applying) return
    if (!busy()) apply()
    else showUpdateBanner(apply)
  }

  const updateSW = registerSW({
    onNeedRefresh() {
      if (!pending) setInterval(tryApply, RETRY_MS)
      pending = true
      tryApply()
    },
    onRegisteredSW(_swUrl, reg) {
      registration = reg
    },
  })

  const checkForUpdate = () => {
    if (!registration || registration.installing || !navigator.onLine) return
    registration.update().catch(() => {})
  }

  setInterval(checkForUpdate, CHECK_INTERVAL_MS)
  // 앱을 다시 열거나(백그라운드 → 화면) 전화 후 돌아올 때도 확인한다. 내릴 때는 기다리던 업데이트를 적용해 본다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
    else tryApply()
  })
  window.addEventListener('online', checkForUpdate)
  // PC: 다른 창을 보다가 이 창으로 돌아올 때도 (5분에 한 번까지)
  let lastFocusCheck = 0
  window.addEventListener('focus', () => {
    if (Date.now() - lastFocusCheck < 5 * 60 * 1000) return
    lastFocusCheck = Date.now()
    checkForUpdate()
  })
}

function showUpdateBanner(onUpdate: () => void) {
  if (document.getElementById('update-banner')) return

  const banner = document.createElement('div')
  banner.id = 'update-banner'
  banner.setAttribute('role', 'status')
  banner.innerHTML = `
    <span>새 버전이 있어요 · 쓰던 것을 마치면 저절로 바뀌어요</span>
    <button type="button">지금 업데이트</button>
  `
  const button = banner.querySelector('button')!
  button.addEventListener('click', () => {
    button.disabled = true
    button.textContent = '업데이트 중…'
    onUpdate()
  })
  document.body.appendChild(banner)
}
