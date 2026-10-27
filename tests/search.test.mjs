// 🔎 채팅 #검색: 가짜 카카오 서버로 키 설정(최고 관리자만, 틀린 키 거절)과 검색 결과 모양을 확인한다.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'

const kakao = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.headers.authorization !== 'KakaoAK good-key')
    return res.writeHead(401).end(JSON.stringify({ errorType: 'AccessDeniedError', message: `appKey(${req.headers.authorization}) does not exist` }))
  const kind = url.pathname.split('/').pop()
  const q = url.searchParams.get('query')
  const documents =
    kind === 'image'
      ? [{ display_sitename: '블로그', doc_url: 'https://blog.example/1', thumbnail_url: 'https://img.example/t.jpg', image_url: 'https://img.example/i.jpg' }]
      : kind === 'vclip'
        ? [{ title: `${q} 영상`, url: 'https://tv.example/v', thumbnail: 'https://img.example/v.jpg', author: '채널', play_time: 125 }]
        : [
            { title: `<b>${q}</b> &amp; 날씨`, url: 'https://www.weather.example/a', contents: '오늘 <b>맑음</b>' },
            { title: '주소 없음', url: 'javascript:alert(1)', contents: '' },
          ]
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ documents }))
})
await new Promise((r) => kakao.listen(5055, '127.0.0.1', r))
process.env.KAKAO_API_BASE = 'http://127.0.0.1:5055'
process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' })
const fn = await import('../functions/lib/index.js')
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { getFirestore } = require('firebase-admin/firestore')
const db = getFirestore()
const as = (uid, data) => ({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} })
const fails = (p, code) => assert.rejects(p, (e) => e.code === code || e.httpErrorCode?.canonicalName === code)

before(async () => {
  for (const c of ['users', 'meta']) await db.recursiveDelete(db.collection(c))
  await db.doc('meta/setup').set({ ownerUid: 'boss' })
  await db.doc('users/boss').set({ name: '최고', teamIds: ['t1'], superAdmin: true })
  await db.doc('users/kim').set({ name: '김', teamIds: ['t1'] })
  await db.doc('users/gone').set({ name: '퇴사', teamIds: [] })
})
after(() => kakao.close())

test('키가 없으면 안내, 키는 최고 관리자만 넣고 틀린 키는 거절', async () => {
  await fails(fn.webSearch.run(as('kim', { q: '양산 날씨' })), 'failed-precondition')
  await fails(fn.setSearchKey.run(as('kim', { key: 'good-key' })), 'permission-denied')
  await assert.rejects(fn.setSearchKey.run(as('boss', { key: 'wrong-key' })), (e) => {
    assert.match(e.message, /REST API 키/)
    assert.match(e.message, /카카오: appKey\(…\) does not exist/)
    assert.doesNotMatch(e.message, /wrong-key/, '키 값은 화면에 보이지 않게')
    return true
  })
  await fn.setSearchKey.run(as('boss', { key: ' good-key ' }))
  assert.equal((await db.doc('meta/kakaoSearch').get()).get('key'), 'good-key')
  assert.equal((await fn.searchKeyInfo.run(as('boss', {}))).configured, true)
})

test('팀원만 검색, 웹·이미지·동영상 결과 모양 (태그 지우기, http 주소만)', async () => {
  await fails(fn.webSearch.run(as(null, { q: 'x' })), 'unauthenticated')
  await fails(fn.webSearch.run(as('gone', { q: 'x' })), 'permission-denied')
  const web = await fn.webSearch.run(as('kim', { q: '양산', kind: 'web' }))
  assert.deepEqual(web.results, [{ title: '양산 & 날씨', url: 'https://www.weather.example/a', desc: '오늘 맑음', image: '', site: 'weather.example' }])
  const img = await fn.webSearch.run(as('kim', { q: '양산', kind: 'image' }))
  assert.deepEqual(img.results[0], { title: '블로그', url: 'https://blog.example/1', desc: '', image: 'https://img.example/t.jpg', site: '블로그' })
  const v = await fn.webSearch.run(as('kim', { q: '양산', kind: 'vclip' }))
  assert.equal(v.results[0].desc, '채널 · 2:05')
  // 키 지우기
  await fn.setSearchKey.run(as('boss', { key: '' }))
  await fails(fn.webSearch.run(as('kim', { q: '양산' })), 'failed-precondition')
})
