import { useState } from 'react'
import { hasPhoneNative } from '../phone.ts'
import { toast } from '../ui/dialogs.tsx'

// 설정: 📝 통신사 앱(에이닷 등) 통화 요약 → 상담 메모 안내. 녹음 파일은 올리지 않고 요약 글만.
const SHORTCUT_URL = 'https://ysdwcc-s.web.app/?memo='
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
// 갤럭시(앱·크롬)에서는 아이폰 단축어 안내를 숨긴다
const isAndroid = /Android/i.test(navigator.userAgent)

export function SummaryGuideCard() {
  const [open, setOpen] = useState(isIOS)
  async function copy() {
    try {
      await navigator.clipboard.writeText(SHORTCUT_URL)
      toast('주소를 복사했어요. 단축어의 "텍스트"에 붙여넣으세요.')
    } catch {
      toast('복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.', { error: true })
    }
  }
  return (
    <section className="card summary-guide">
      <h3>📝 통화 요약 → 상담 메모</h3>
      <p className="muted small">
        에이닷(SKT) 같은 통신사 앱이 만든 <strong>통화 요약 글</strong>을 고객 상담 이력에 바로 남겨요. 녹음 파일은 올리지 않아요. 요약 속 전화번호로 고객을 찾고, 없으면 고객을 골라요.
      </p>
      <ul className="summary-ways small">
        <li>
          <strong>어디서나:</strong> 요약을 <strong>복사</strong> → 이 앱 📞 전화 → <strong>📋 복사한 통화 요약으로 메모하기</strong>
        </li>
        {(hasPhoneNative || !isIOS) && (
          <li>
            <strong>갤럭시:</strong> 요약에서 <strong>공유</strong> → <strong>양산동원로얄CC지원팀</strong> (갤럭시 앱 1.3.0, 또는 크롬에서 "앱 설치"한 홈 화면 앱)
          </li>
        )}
        {!isAndroid && (
          <li>
            <strong>아이폰:</strong> 요약에서 <strong>공유</strong> → <strong>지원팀 메모</strong> (아래 단축어를 한 번 만들어 두면 나와요)
          </li>
        )}
      </ul>
      {!isAndroid && (
      <button type="button" className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} 아이폰 "지원팀 메모" 단축어 만들기 (한 번만)
      </button>
      )}
      {open && !isAndroid && (
        <ol className="summary-steps small">
          <li>아이폰 기본 앱 <strong>단축어</strong>를 열고 오른쪽 위 <strong>＋</strong>.</li>
          <li>
            아래 <strong>동작 검색</strong>에서 <strong>URL 인코딩</strong>을 추가 → 파란 글자를 눌러 <strong>단축어 입력</strong>으로 바꾸기.
          </li>
          <li>
            <strong>텍스트</strong> 동작을 추가하고 아래 주소를 붙여넣은 뒤, 끝에 <strong>URL 인코딩된 텍스트</strong>(변수)를 붙이기.
            <div className="summary-url">
              <code>{SHORTCUT_URL}</code>
              <button type="button" className="ghost" onClick={() => void copy()}>
                복사
              </button>
            </div>
          </li>
          <li>
            <strong>URL 열기</strong> 동작을 추가(입력: 텍스트).
          </li>
          <li>
            위쪽 이름을 <strong>지원팀 메모</strong>로 바꾸고, 아래 ⓘ(설정) → <strong>공유 시트에서 보기</strong> 켜기 → 받는 유형은 <strong>텍스트</strong>만.
          </li>
          <li>이제 에이닷 요약 화면에서 공유 → 지원팀 메모를 누르면 이 앱이 열리고 메모 창에 요약이 채워져요.</li>
        </ol>
      )}
      {isIOS && (
        <p className="muted small">
          💡 단축어는 주소를 <strong>Safari</strong>로 열 수 있어요. Safari에서도 이 앱(ysdwcc-s.web.app)에 한 번 로그인해 두세요.
        </p>
      )}
    </section>
  )
}
