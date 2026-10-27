import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { errorMessage } from '../auth.ts'
import { ask, toast } from '../ui/dialogs.tsx'

// 최고 관리자: 채팅 #검색에 쓰는 카카오 REST API 키.
// 코드·저장소에 넣지 않고 여기서 넣으면 서버 전용 문서(meta/kakaoSearch)에만 저장된다 (앱은 다시 읽을 수 없음).
export function SearchKeyCard() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.searchKeyInfo().then((r) => setConfigured(r.configured), () => setConfigured(false))
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!key.trim()) return
    setBusy(true)
    try {
      await api.setSearchKey({ key: key.trim() })
      setKey('')
      setConfigured(true)
      toast('검색 키를 저장했어요. 채팅방에서 "#검색어"로 써 보세요.')
    } catch (err) {
      toast(errorMessage(err), { error: true, long: true })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!(await ask({ message: '검색 키를 지울까요? 채팅 #검색을 쓸 수 없게 됩니다.', ok: '지우기', danger: true }))) return
    try {
      await api.setSearchKey({ key: '' })
      setConfigured(false)
      toast('검색 키를 지웠어요.')
    } catch (err) {
      toast(errorMessage(err), { error: true })
    }
  }

  return (
    <form className="card form" onSubmit={save}>
      <h3>🔎 채팅 #검색 (카카오 검색 키)</h3>
      <p className="muted small">
        채팅 입력칸에 "#검색어"를 치면 다음(Daum) 웹·이미지·동영상 검색 결과가 뜨고, 눌러서 채팅방에 보낼 수 있어요. 카카오 검색 API를 쓰며
        무료 사용량 안에서 돼요.
      </p>
      <p className="small">
        지금: <strong>{configured === null ? '확인 중…' : configured ? '키 설정됨 (보안상 다시 보여 주지 않아요)' : '키 없음'}</strong>
      </p>
      <details className="small">
        <summary>키 받는 방법</summary>
        <ol>
          <li>
            <a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener noreferrer">
              카카오 디벨로퍼스
            </a>
            에 카카오 계정으로 로그인 → "애플리케이션 추가하기"(이름은 아무거나, 예: 지원팀 검색)
          </li>
          <li>만든 앱 → "앱 키"의 <strong>REST API 키</strong>를 복사해 아래에 붙여 넣기</li>
          <li>프론트 앱 #검색에 이미 넣은 카카오 키가 있으면 그 키를 그대로 넣어도 돼요 (하루 검색 횟수를 같이 씀)</li>
        </ol>
        <p className="muted">저장할 때 한 번 검색해 보아 맞는 키인지 확인해요.</p>
      </details>
      <label>
        REST API 키
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={configured ? '새 키로 바꾸려면 붙여 넣기' : '카카오 REST API 키 붙여 넣기'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="modal-actions">
        {configured && (
          <button type="button" onClick={() => void remove()}>
            키 지우기
          </button>
        )}
        <button className="primary" disabled={busy || !key.trim()}>
          {busy ? '확인하는 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}
