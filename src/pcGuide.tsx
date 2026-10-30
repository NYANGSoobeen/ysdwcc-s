import { dialByLink, prettyNumber } from './phone.ts'
import { tell, toast } from './ui/dialogs.tsx'

// 💻 PC(마우스로 쓰는 컴퓨터)에는 전화 회선이 없어서, 전화·문자는 휴대폰으로 하도록 번호를 크게 보여 준다.
// 윈도우 "휴대폰과 연결"·맥(아이폰 연결)이 있으면 "이 PC에서 걸기"로 휴대폰을 통해 걸 수도 있다.
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what}를 복사했어요.`)
  } catch {
    toast('복사하지 못했어요. 길게 눌러(드래그해) 복사해 주세요.', { error: true })
  }
}

function Who({ number, name }: { number: string; name?: string }) {
  return (
    <span className="pc-guide-who">
      {name && <strong>{name}</strong>}
      <span className="pc-guide-number">{prettyNumber(number)}</span>
      <button type="button" className="ghost" onClick={() => void copy(prettyNumber(number), '번호')}>
        📋 번호 복사
      </button>
    </span>
  )
}

export function showCallGuide(number: string, name?: string, customerId?: string) {
  void tell({
    title: '📞 휴대폰으로 걸어주세요',
    message: (
      <span className="pc-guide">
        <Who number={number} name={name} />
        <span className="muted small">컴퓨터에는 전화 회선이 없어요. 휴대폰에서 이 번호로 걸어 주세요.</span>
        <button type="button" className="ghost pc-guide-link small" onClick={() => dialByLink(number, customerId)}>
          💻 이 PC에 휴대폰을 연결해 두었다면 → 여기서 걸기
        </button>
        <span className="muted small">⚙️ 설정 → "💻 PC에서 휴대폰으로 전화"에서 연결해 두면 다음부터 📞를 누르면 바로 걸려요.</span>
      </span>
    ),
    ok: '확인',
  })
}

export function showSmsGuide(number: string, name?: string, body?: string) {
  void tell({
    title: '✉️ 휴대폰으로 보내주세요',
    message: (
      <span className="pc-guide">
        <Who number={number} name={name} />
        {body && (
          <span className="pc-guide-body">
            <span>{body}</span>
            <button type="button" className="ghost" onClick={() => void copy(body, '내용')}>
              📋 내용 복사
            </button>
          </span>
        )}
        <span className="muted small">컴퓨터에서는 문자를 보낼 수 없어요. 휴대폰 문자로 보내 주세요. 윈도우 "휴대폰과 연결" 앱을 쓰면 그 앱의 메시지에 붙여넣어 PC에서 보낼 수도 있어요.</span>
      </span>
    ),
    ok: '확인',
  })
}
