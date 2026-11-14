/* 푸시 알림 받기 (서비스 워커에 붙는다: vite.config.ts workbox.importScripts)
 * 서버(functions/src/push.ts)는 데이터만 보낸다: { title, body, url, tag, kind }
 * - 지금 보고 있는 방(앱이 알려 준 tag)의 알림은 띄우지 않는다. 다른 방이면 앱이 열려 있어도 띄운다.
 * - 📛 앱 아이콘 숫자: 앱이 열려 있을 때 앱이 알려 준 수에서, 알림이 올 때마다 하나씩 올린다 (앱 꺼져 있어도).
 * - 알림을 누르면 열려 있는 앱을 앞으로 가져와 그 방을 열고, 없으면 새로 연다.
 */
const viewing = new Map() // 창(client id) → { tag, at } 보고 있는 방과 알려 준 시각
// 📱 아이폰(2026-11-14 "프론트 채팅 알림이 안 와, 앱에 들어갔다 나와야 숫자가 떠"): 앱을 내릴 때 "이제 안 봐요"가
//    서비스 워커에 닿기 전에 앱이 멈춰서 "그 방을 보는 중"이 남고, 창 상태도 '보임'으로 남아 알림을 계속 건너뛰었다.
//    → 앱이 보는 동안 15초마다 다시 알리고, 40초 넘게 소식이 없으면 안 보는 것으로 친다.
const VIEW_FRESH_MS = 40 * 1000
// 애플(아이폰·맥 사파리)은 푸시를 받고 알림을 안 띄우면 알림 구독을 끊어 버릴 수 있다 → 건너뛸 때도 띄웠다 바로 닫는다.
const APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Edg|Firefox|FxiOS/.test(self.navigator.userAgent)
const BADGE_CACHE = 'app-badge'
// 🔔 알림 방식 (알림 설정 화면, 기기마다): 'sound' 소리 + 알림창 · 'quiet' 소리 없이 알림창만 · 'badge' 무음(숫자만)
async function readMode() {
  try {
    const res = await (await caches.open(BADGE_CACHE)).match('/__mode')
    return res ? await res.text() : 'sound'
  } catch (e) {
    return 'sound'
  }
}
async function writeMode(m) {
  try {
    await (await caches.open(BADGE_CACHE)).put('/__mode', new Response(String(m)))
  } catch (e) {
    /* 기억 못 하면 소리 + 알림창 */
  }
}
// 알림 띄우기: 무음이면 잠깐 띄웠다 바로 닫는다 (아이폰은 푸시를 받으면 알림을 꼭 띄워야 해서)
async function show(title, options) {
  const mode = await readMode()
  await self.registration.showNotification(title, { ...options, silent: mode !== 'sound' })
  if (mode === 'badge') {
    const list = await self.registration.getNotifications({ tag: options.tag })
    list.forEach((n) => n.close())
  }
}

async function readBadge() {
  try {
    const res = await (await caches.open(BADGE_CACHE)).match('/__badge')
    return res ? Number(await res.text()) || 0 : 0
  } catch (e) {
    return 0
  }
}
async function writeBadge(n) {
  try {
    await (await caches.open(BADGE_CACHE)).put('/__badge', new Response(String(n)))
  } catch (e) {
    /* 기억 못 해도 숫자만 안 맞을 뿐 */
  }
  try {
    if (n > 0) await self.navigator.setAppBadge(n)
    else await self.navigator.clearAppBadge()
  } catch (e) {
    /* 앱 아이콘 숫자를 지원하지 않는 기기 */
  }
}

self.addEventListener('message', (event) => {
  const d = event.data || {}
  const id = event.source && event.source.id
  if (d.type === 'viewing' && id) {
    if (d.tag) viewing.set(id, { tag: d.tag, at: Date.now() })
    else viewing.delete(id)
  }
  if (d.type === 'badge') event.waitUntil(writeBadge(Number(d.count) || 0))
  if (d.type === 'mode') event.waitUntil(writeMode(d.mode))
  if (d.type === 'test')
    event.waitUntil(
      (async () => {
        if (d.mode) await writeMode(d.mode)
        await show('🔔 알림 테스트', { body: '채팅 알림이 이렇게 와요', tag: `test-${Date.now()}`, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'ko', data: { url: '/' } })
      })(),
    )
})

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
      // 그 방을 지금 보고 있는 창이 있으면 알리지 않는다 (최근 40초 안에 앱이 알려 준 것만 믿음).
      const now = Date.now()
      const seen = (w) => {
        const v = viewing.get(w.id)
        return v && v.tag === tag && now - v.at <= VIEW_FRESH_MS
      }
      if (tag && windows.some((w) => w.visibilityState === 'visible' && seen(w))) {
        if (APPLE) {
          const t = `skip-${now}`
          await self.registration.showNotification(title, { body, tag: t, silent: true })
          ;(await self.registration.getNotifications({ tag: t })).forEach((x) => x.close())
        }
        return
      }
      // 채팅 알림이면 앱 아이콘 숫자를 하나 올린다 (공지는 안 읽은 채팅 수가 아니라서 제외).
      if (d.kind !== 'notice') await writeBadge((await readBadge()) + 1)
      await show(title, {
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
