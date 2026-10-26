import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

// 화면 위쪽 검색칸: 지금 보고 있는 탭 안에서만 찾는다 (고객, 채팅, 팀원, 관리자).
// 검색어는 탭마다 따로 기억하고(App), 휴대폰은 검색칸을 누르고 있는 동안 아래 탭과 입력칸을 숨긴다.
export type SearchState = {
  query: string
  setQuery: (query: string) => void
  setFocused: (focused: boolean) => void
}

export const SearchContext = createContext<SearchState>({ query: '', setQuery: () => {}, setFocused: () => {} })

export const useTabSearch = () => useContext(SearchContext)

export function SearchBar(props: {
  placeholder: string
  onEnter?: () => void
  onCancel?: () => void
  autoFocus?: boolean
  children?: ReactNode
}) {
  const { query, setQuery, setFocused } = useTabSearch()
  const input = useRef<HTMLInputElement>(null)
  // 검색칸이 닫히면(포커스가 있는 채로 사라져도) 숨겼던 탭과 입력칸을 다시 보인다.
  useEffect(() => {
    if (document.activeElement === input.current) setFocused(true)
    return () => setFocused(false)
  }, [setFocused])
  return (
    <div className="search-bar" role="search">
      <span aria-hidden="true">🔍</span>
      <input
        ref={input}
        type="search"
        enterKeyHint="search"
        value={query}
        autoFocus={props.autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            props.onEnter?.()
          }
          if (e.key === 'Escape') {
            setQuery('')
            props.onCancel?.()
          }
        }}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
      />
      {props.children}
      {(query || props.onCancel) && (
        <button
          type="button"
          className="ghost search-clear"
          aria-label="검색 지우기"
          // 누르는 동안 검색칸에서 포커스가 빠지지 않게 (휴대폰 키보드가 닫혔다 열리지 않게)
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            setQuery('')
            if (props.onCancel) props.onCancel()
            else input.current?.focus()
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
