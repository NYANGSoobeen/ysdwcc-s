import { useEffect, useState } from 'react'
import { isPcDevice, PC_LINK_CHANGED, pcPhoneLinked, setPcPhoneLinked } from '../phone.ts'
import { toast } from '../ui/dialogs.tsx'

// 설정(PC에서만): 💻 PC에서 휴대폰으로 전화. 윈도우 "휴대폰과 연결" / 맥 "iPhone에서 통화"로 PC와 휴대폰을 이어 두면
// 앱의 📞가 "휴대폰으로 걸어주세요" 안내 대신 바로 걸린다(tel:). 통화가 끝나 앱으로 돌아오면 통화 메모 창도 뜬다.
const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent)

export function PcPhoneLinkCard() {
  const [linked, setLinked] = useState(pcPhoneLinked)
  const [test, setTest] = useState('')
  useEffect(() => {
    const on = () => setLinked(pcPhoneLinked())
    window.addEventListener(PC_LINK_CHANGED, on)
    return () => window.removeEventListener(PC_LINK_CHANGED, on)
  }, [])
  if (!isPcDevice()) return null

  return (
    <section className="card pc-link-card">
      <h3>💻 PC에서 휴대폰으로 전화</h3>
      <p className="muted small">
        컴퓨터와 내 휴대폰을 한 번 연결해 두면, 이 앱에서 📞를 누를 때 <strong>휴대폰을 통해 PC에서 바로 걸려요</strong>(PC 스피커·마이크 또는 이어폰으로 통화). 원할 때만 켜세요.
      </p>
      {isMac ? (
        <ol className="summary-steps small">
          <li>
            <strong>아이폰</strong>: 설정 → 앱 → 전화 → <strong>다른 기기에서 통화</strong> → 켜고 이 맥 선택 (같은 Apple 계정, 같은 와이파이).
          </li>
          <li>
            <strong>맥</strong>: FaceTime 앱 → 설정 → <strong>iPhone에서 통화</strong> 켜기.
          </li>
          <li>갤럭시는 맥과 전화 연결이 안 돼요. 갤럭시는 휴대폰에서 걸어 주세요.</li>
        </ol>
      ) : (
        <ol className="summary-steps small">
          <li>
            윈도우 시작 메뉴에서 <strong>휴대폰과 연결</strong>(Phone Link) 앱을 열어요. 없으면 Microsoft Store에서 "휴대폰과 연결"을 설치해요.
          </li>
          <li>
            <strong>갤럭시</strong>는 휴대폰 빠른 설정의 <strong>Windows와 연결</strong>을 켜고, PC 화면의 QR 코드를 찍어요. <strong>아이폰</strong>은 앱에서 "iPhone"을 고르고 QR 코드를 찍은 뒤 블루투스 연결을 허용해요.
          </li>
          <li>
            휴대폰과 연결 앱의 <strong>통화</strong> 탭에서 블루투스 연결·권한을 허용해요 (PC에 블루투스가 있어야 해요).
          </li>
          <li>
            아래에서 시험 전화를 걸어 봐요. "어떤 앱으로 열까요?"가 뜨면 <strong>휴대폰과 연결</strong>을 고르고 "항상"을 체크해요.
          </li>
        </ol>
      )}
      <div className="pc-link-test">
        <input value={test} onChange={(e) => setTest(e.target.value.replace(/[^\d-]/g, ''))} placeholder="시험으로 걸 번호" inputMode="tel" aria-label="시험 전화 번호" />
        <a
          className={test.replace(/\D/g, '').length >= 3 ? 'button' : 'button disabled'}
          href={`tel:${test.replace(/\D/g, '')}`}
          onClick={() => toast('휴대폰과 연결 앱(맥은 FaceTime)이 열리면 성공이에요.', { long: true })}
        >
          📞 시험 전화
        </a>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={linked}
          onChange={(e) => {
            setPcPhoneLinked(e.target.checked)
            toast(e.target.checked ? '이제 이 PC에서 📞를 누르면 바로 걸려요.' : '다시 "휴대폰으로 걸어주세요" 안내를 보여 드려요.')
          }}
        />
        <span>이 PC는 휴대폰과 연결했어요 — 📞를 누르면 바로 걸기</span>
      </label>
      <p className="muted small">이 설정은 이 컴퓨터에만 저장돼요. 문자는 휴대폰과 연결 앱의 메시지에서 보낼 수 있어요.</p>
    </section>
  )
}
