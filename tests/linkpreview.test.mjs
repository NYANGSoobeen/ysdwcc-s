// 링크 미리보기: 페이지에서 제목·설명·사진 뽑기, 내부 주소 막기, 팀원만 쓰기
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT = 'demo-workphone'
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' })
const { parsePreview, fetchPreview } = await import('../functions/lib/linkPreview.js')
const fn = await import('../functions/lib/index.js')

test('og 태그와 title에서 제목·설명·사진을 뽑는다', () => {
  const html = `<html><head><title>예비 제목</title>
    <meta property="og:title" content="견적 안내 &amp; 가격표">
    <meta name="description" content="양산동원 지원팀  설명">
    <meta property="og:image" content="/img/cover.png">
    <meta property="og:site_name" content="동원로얄">
  </head></html>`
  const p = parsePreview(html, new URL('https://example.co.kr/page/1'))
  assert.deepEqual(p, {
    url: 'https://example.co.kr/page/1',
    title: '견적 안내 & 가격표',
    desc: '양산동원 지원팀 설명',
    image: 'https://example.co.kr/img/cover.png',
    site: '동원로얄',
  })
  const plain = parsePreview('<title>그냥 제목</title>', new URL('https://www.naver.com/'))
  assert.equal(plain.title, '그냥 제목')
  assert.equal(plain.site, 'naver.com')
})

test('회사 내부망·서버 주소는 읽지 않는다', async () => {
  for (const url of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'ftp://example.com/', 'http://example.com:22/']) {
    await assert.rejects(fetchPreview(url), undefined, url)
  }
})

test('linkPreview 함수는 로그인한 팀원만 부를 수 있다', async () => {
  await assert.rejects(fn.linkPreview.run({ data: { url: 'https://example.com' }, rawRequest: {} }), (e) => e.code === 'unauthenticated')
  await assert.rejects(
    fn.linkPreview.run({ data: { url: 'https://example.com' }, auth: { uid: 'nobody', token: {} }, rawRequest: {} }),
    (e) => e.code === 'permission-denied',
  )
})
