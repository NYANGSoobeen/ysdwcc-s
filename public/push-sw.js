/* 푸시 알림 받기 (서비스 워커에 붙는다: vite.config.ts workbox.importScripts)
 * 서버(functions/src/push.ts)는 데이터만 보낸다: { title, body, url, tag }
 * - 앱을 지금 보고 있으면 알림을 띄우지 않는다 (앱 안의 빨간 숫자·알림으로 충분)
 * - 알림을 누르면 열려 있는 앱을 앞으로 가져와 그 방을 열고, 없으면 새로 연다.
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    payload = {}
  }
  const d = payload.data || {}
  const n = payload.notification || {}
  const title = d.title || n.title || '양산동원로얄CC 지원팀'
  const body = d.body || n.body || ''
  const tag = d.tag || undefined
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return
      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: Boolean(tag),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        lang: 'ko',
        data: { url: d.url || '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue
        await w.focus()
        w.postMessage({ type: 'open-url', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
