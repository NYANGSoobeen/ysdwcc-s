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
    // 카카오가 알려 준 이유를 같이 보여 준다 (키 값은 가림).
    const body = (await res.json().catch(() => ({}))) as { errorType?: string; message?: string }
    const reason = String(body.message ?? '').replace(/appKey\([^)]*\)/gi, 'appKey(…)').slice(0, 160)
    console.warn('kakao search', res.status, body.errorType, reason)
    throw new SearchError(`${kakaoHint(res.status, reason)}${reason ? `\n(카카오: ${reason})` : ''}`, res.status)
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

// 카카오 오류를 한국어 안내로
function kakaoHint(status: number, reason: string) {
  if (/does not exist|invalid/i.test(reason)) return '카카오에 없는 키예요. 앱 키 중 "REST API 키"를 그대로 복사했는지 확인해 주세요 (JavaScript·네이티브 앱·Admin 키는 안 돼요).'
  if (/ip mismatch/i.test(reason)) return '키에 허용 IP가 정해져 있어요. 카카오 디벨로퍼스 → 앱 키 → REST API 키 설정에서 허용 IP를 비워 주세요.'
  if (/disabled|not allowed|activate|service/i.test(reason)) return '이 앱에서 검색 기능이 꺼져 있어요. 카카오 디벨로퍼스 앱 설정에서 검색(다음 검색) 사용을 켜 주세요.'
  if (status === 429) return '오늘 검색 횟수를 다 썼어요. 내일 다시 해 주세요.'
  if (status === 401 || status === 403) return '검색 키가 맞지 않아요. 최고 관리자가 관리자 화면에서 다시 넣어 주세요.'
  return `검색이 안 돼요 (${status}). 잠시 뒤 다시 해 주세요.`
}
