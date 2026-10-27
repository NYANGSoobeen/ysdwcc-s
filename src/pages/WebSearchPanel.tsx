import { useEffect, useRef, useState } from 'react'
import { api, type SearchKind, type SearchResult } from '../api.ts'
import { errorMessage } from '../auth.ts'

// 🔎 채팅 #검색 (카톡처럼): 입력칸에 "#검색어"를 치면 입력칸 위에 다음(Daum) 검색 결과가 뜨고,
// 하나를 누르면 카드로 채팅방에 보낸다. 검색은 서버 함수 webSearch(카카오 검색 API)가 한다.
// 잠깐(0.9초) 멈추거나 Enter·보내기를 누르면 검색한다. 같은 검색은 이 화면에서 다시 묻지 않는다.

export const KINDS: [SearchKind, string][] = [
  ['web', '웹'],
  ['image', '이미지'],
  ['vclip', '동영상'],
]

// "#검색어" → 검색어 (아니면 null). "#"만 친 것도 패널은 연다 ('').
export function webQueryOf(text: string): string | null {
  const m = /^#\s*([\s\S]*)$/.exec(text.trim())
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 100) : null
}

const cache = new Map<string, SearchResult[]>()

export function WebSearchPanel(props: {
  query: string
  runNow: number // 바뀌면 바로 검색 (Enter, 보내기)
  onPick: (result: SearchResult, kind: SearchKind) => void
  onRaw: () => void // 검색하지 않고 "#…" 글자 그대로 보내기
  onClose: () => void
}) {
  const { query } = props
  const [kind, setKind] = useState<SearchKind>('web')
  const [state, setState] = useState<{ key: string; results?: SearchResult[]; error?: string; loading?: boolean } | null>(null)
  const seq = useRef(0)

  function run(q: string, k: SearchKind) {
    if (!q) return
    const key = `${k}:${q}`
    const hit = cache.get(key)
    if (hit) return setState({ key, results: hit })
    const my = ++seq.current
    setState({ key, loading: true })
    api.webSearch({ q, kind: k }).then(
      ({ results }) => {
        cache.set(key, results)
        if (my === seq.current) setState({ key, results })
      },
      (err) => my === seq.current && setState({ key, error: errorMessage(err) }),
    )
  }

  // 글자를 치다 잠깐 멈추면 검색
  useEffect(() => {
    if (!query) return
    const t = setTimeout(() => run(query, kind), 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind])
  // Enter·보내기: 바로 검색
  useEffect(() => {
    if (props.runNow) run(query, kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.runNow])

  const current = state?.key === `${kind}:${query}` ? state : null
  return (
    <div className="web-search" role="region" aria-label="검색 결과">
      <div className="web-search-tabs">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" className={k === kind ? 'active' : ''} onPointerDown={(e) => e.preventDefault()} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="ghost small" title='검색하지 않고 "#…" 글자 그대로 보내기' onPointerDown={(e) => e.preventDefault()} onClick={props.onRaw}>
          # 그대로 보내기
        </button>
        <button type="button" className="ghost small" aria-label="검색 닫기" onPointerDown={(e) => e.preventDefault()} onClick={props.onClose}>
          ✕
        </button>
      </div>
      <div className={kind === 'image' ? 'web-search-body images' : 'web-search-body'}>
        {!query && <p className="muted small">검색어를 적어 주세요. 예) #양산 날씨</p>}
        {query && !current && <p className="muted small">"{query}" 잠깐 기다리거나 Enter(휴대폰은 ↑)를 누르면 검색해요</p>}
        {current?.loading && <p className="muted small">검색하는 중…</p>}
        {current?.error && <p className="error small">{current.error}</p>}
        {current?.results?.length === 0 && <p className="muted small">검색 결과가 없어요.</p>}
        {current?.results?.map((r) => (
          <button key={r.url} type="button" className="web-result" title="눌러서 채팅방에 보내기" onPointerDown={(e) => e.preventDefault()} onClick={() => props.onPick(r, kind)}>
            {r.image && <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
            {kind !== 'image' && (
              <span className="web-result-text">
                <strong>{r.title}</strong>
                {r.desc && <span className="link-desc">{r.desc}</span>}
                <span className="link-site">{r.site}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="web-search-foot muted">다음(Daum) 검색 · 결과를 누르면 카드로 보내져요</p>
    </div>
  )
}
