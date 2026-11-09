import { useEffect, type RefObject } from 'react'
import { CHAT_FX, chatFxCheck, chatFxPlay, fxIcon, setChatFxHost, type ChatFx } from '../chatfx.ts'

// 🎉 채팅 효과 화면 조각 (src/chatfx.ts). 우리 채팅방(ChatPage)과 🏌️ 프론트 방(FrontChatPage)이 같이 쓴다.

// 말풍선 안: "🎉 승진 축하해요!" (누르면 효과를 다시 봄)
export function FxTag({ fx }: { fx: ChatFx }) {
  return (
    <button
      type="button"
      className="fx-tag"
      title="누르면 효과를 다시 봐요"
      onClick={(e) => {
        e.stopPropagation()
        chatFxPlay(fx.key)
      }}
    >
      <span className="fx-icon" aria-hidden="true">
        {fxIcon(fx)}
      </span>
      <span className="fx-text">{fx.rest || fx.say}</span>
    </button>
  )
}

// 방 화면: 효과를 그릴 대화 영역을 알리고, 메시지가 바뀔 때마다 방금 올라온 효과 말을 찾는다
export function useChatFx(hostRef: RefObject<HTMLElement | null>, list: { id: string; text: string; at: number | null; deleted?: boolean }[]) {
  useEffect(() => {
    setChatFxHost(hostRef.current)
    return () => setChatFxHost(null)
  }, [hostRef])
  useEffect(() => {
    chatFxCheck(list)
  }, [list])
}

// 입력칸에 / 를 치면 입력칸 위에 효과 고르는 줄. 누르면 "/축하 " 를 채우고 미리 보기
export function ChatFxPick({ text, onPick }: { text: string; onPick: (value: string) => void }) {
  if (!/^\/\S*$/.test(text)) return null
  return (
    <div className="fx-pick" role="listbox" aria-label="채팅 효과">
      {CHAT_FX.map((f) => (
        <button
          key={f.key}
          type="button"
          title={`${f.say} (보내면 모두의 채팅 배경에 ${fxIcon(f)} 효과)`}
          onPointerDown={(e) => e.preventDefault()} // 입력칸 포커스(휴대폰 키보드) 유지
          onClick={() => {
            onPick(`/${f.cmd[0]} `)
            chatFxPlay(f.key)
          }}
        >
          <span aria-hidden="true">{fxIcon(f)}</span>/{f.cmd[0]}
        </button>
      ))}
    </div>
  )
}
