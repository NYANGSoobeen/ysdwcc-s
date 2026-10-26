import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// 채팅 링크 미리보기: 서버가 그 페이지를 읽어 제목·설명·사진(og:title, og:description, og:image)을 뽑는다.
// - 회사 내부망·서버 자체 주소(localhost, 10.x, 192.168.x, 169.254.x 등)는 읽지 않는다.
// - 6초 안에, 앞부분 512KB만 읽는다. 다른 주소로 넘기는 것(redirect)은 3번까지, 매번 주소를 다시 검사한다.

export type LinkPreview = { url: string; title: string; desc: string; image: string; site: string }

const MAX_BYTES = 512 * 1024
const TIMEOUT_MS = 6000
const MAX_REDIRECTS = 3

export const previewKey = (url: string) => createHash('sha1').update(url).digest('hex')

function privateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase()
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? privateAddress(mapped[1]) : false
  }
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http/https 주소만 읽습니다.')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('일반 웹 주소만 읽습니다.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('내부 주소는 읽지 않습니다.')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new Error('내부 주소는 읽지 않습니다.')
}

async function readHtml(start: string) {
  let url = new URL(start)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(url)
      const res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // 일부 사이트는 브라우저가 아니면 미리보기 정보를 주지 않는다.
          'user-agent': 'Mozilla/5.0 (compatible; YangsanSupportLinkPreview/1.0)',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ko-KR,ko;q=0.9',
        },
      })
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url)
        continue
      }
      if (!res.ok) throw new Error(`페이지를 읽지 못했습니다 (${res.status}).`)
      const type = res.headers.get('content-type') ?? ''
      if (!/html/i.test(type)) return { url, bytes: undefined, charset: 'utf-8' }
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.length
      }
      void reader.cancel().catch(() => {})
      const bytes = Buffer.concat(chunks).subarray(0, MAX_BYTES)
      // 글자 인코딩: 응답 머리 → 문서 안 meta charset → utf-8 (euc-kr 사이트도 읽는다)
      let charset = type.match(/charset=([\w-]+)/i)?.[1]
      if (!charset) charset = bytes.toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
      return { url, bytes, charset: charset ?? 'utf-8' }
    }
    throw new Error('주소를 너무 많이 넘겨서 읽지 않았습니다.')
  } finally {
    clearTimeout(timer)
  }
}

function decode(bytes: Uint8Array | undefined, charset: string) {
  if (!bytes) return ''
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
function unescape(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+|#39);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

function meta(html: string, keys: string[]) {
  for (const key of keys) {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i'))?.[0]
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1]
    if (content) return unescape(content)
  }
  return ''
}

export async function fetchPreview(rawUrl: string): Promise<LinkPreview> {
  const { url, bytes, charset } = await readHtml(rawUrl)
  return parsePreview(decode(bytes, charset).slice(0, MAX_BYTES), url, rawUrl)
}

// 페이지 글에서 미리보기 정보를 뽑는다 (테스트에서 따로 부른다).
export function parsePreview(html: string, url: URL, rawUrl = url.toString()): LinkPreview {
  const title = meta(html, ['og:title', 'twitter:title']) || unescape(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '')
  const desc = meta(html, ['og:description', 'twitter:description', 'description'])
  let image = meta(html, ['og:image', 'og:image:url', 'twitter:image'])
  try {
    image = image ? new URL(image, url).toString() : ''
    if (image && !/^https?:/.test(image)) image = ''
  } catch {
    image = ''
  }
  const site = meta(html, ['og:site_name']) || url.hostname.replace(/^www\./, '')
  return {
    url: rawUrl,
    title: title.slice(0, 200),
    desc: desc.slice(0, 300),
    image: image.slice(0, 1000),
    site: site.slice(0, 100),
  }
}
