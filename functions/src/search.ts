// 🔎 채팅 #검색: 입력칸에 "#검색어"를 치면 다음(Daum) 웹·이미지·동영상 검색 결과를 보여 준다 (프론트 앱과 같은 방식).
// 카카오 검색 API(무료 사용량 안). REST API 키는 코드에 넣지 않고 최고 관리자가 관리자 화면에서 넣는다
// → 서버 전용 문서 meta/kakaoSearch.key (앱은 읽을 수 없음).

export type SearchKind = 'web' | 'image' | 'vclip'
export type SearchResult = { title: string; url: string; desc: string; image: string; site: string }

const BASE = () => process.env.KAKAO_API_BASE || 'https://dapi.kakao.com'

const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export class SearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function kakaoSearch(key: string, q: string, kind: SearchKind): Promise<SearchResult[]> {
  let res: Response
  try {
    res = await fetch(`${BASE()}/v2/search/${kind}?${new URLSearchParams({ query: q, size: kind === 'image' ? '24' : '10' })}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new SearchError('검색 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.', 0)
  }
  if (!res.ok) {
    const message =
      res.status === 401 || res.status === 403
        ? '검색 키가 맞지 않아요. 최고 관리자가 관리자 화면에서 다시 넣어 주세요.'
        : res.status === 429
          ? '오늘 검색 횟수를 다 썼어요. 내일 다시 해 주세요.'
          : `검색이 안 돼요 (${res.status}). 잠시 뒤 다시 해 주세요.`
    throw new SearchError(message, res.status)
  }
  const json = (await res.json()) as { documents?: Record<string, unknown>[] }
  const docs = (json.documents ?? []).slice(0, 24)
  const results: SearchResult[] =
    kind === 'image'
      ? docs.map((d) => ({
          title: clean(d.display_sitename) || '이미지',
          url: String(d.doc_url || d.image_url || ''),
          desc: '',
          image: String(d.thumbnail_url || ''),
          site: clean(d.display_sitename) || host(String(d.doc_url ?? '')),
        }))
      : kind === 'vclip'
        ? docs.map((d) => ({
            title: clean(d.title),
            url: String(d.url ?? ''),
            desc: [clean(d.author), d.play_time ? playTime(Number(d.play_time)) : ''].filter(Boolean).join(' · '),
            image: String(d.thumbnail ?? ''),
            site: host(String(d.url ?? '')),
          }))
        : docs.map((d) => ({
            title: clean(d.title),
            url: String(d.url ?? ''),
            desc: clean(d.contents).slice(0, 160),
            image: '',
            site: host(String(d.url ?? '')),
          }))
  return results.filter((r) => /^https?:\/\//.test(r.url)).map((r) => ({ ...r, image: /^https?:\/\//.test(r.image) ? r.image : '' }))
}

const playTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
