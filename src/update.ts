import { registerSW } from 'virtual:pwa-register'

// 아이폰 홈 화면 앱은 브라우저가 업데이트를 자주 확인하지 않으므로 직접 확인한다.
const CHECK_INTERVAL_MS = 30 * 60 * 1000

export function setupUpdateNotice() {
  if (!('serviceWorker' in navigator)) return

  let registration: ServiceWorkerRegistration | undefined

  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateBanner(async () => {
        // 대기 중인 새 서비스 워커를 활성화하고, 활성화되면 페이지를 새로고침한다.
        await updateSW(true)
      })
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
  // 앱을 다시 열거나(백그라운드 → 화면) 전화 후 돌아올 때도 확인한다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.addEventListener('online', checkForUpdate)
}

function showUpdateBanner(onUpdate: () => Promise<void>) {
  if (document.getElementById('update-banner')) return

  const banner = document.createElement('div')
  banner.id = 'update-banner'
  banner.setAttribute('role', 'status')
  banner.innerHTML = `
    <span>새 버전이 있습니다</span>
    <button type="button">업데이트</button>
  `
  const button = banner.querySelector('button')!
  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = '업데이트 중…'
    await onUpdate()
  })
  document.body.appendChild(banner)
}
