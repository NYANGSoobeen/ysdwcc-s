import { useEffect, useState, type RefObject } from 'react'
import { hasPhoneNative, PhoneNative } from '../phone.ts'
import { toast } from './dialogs.tsx'

const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches

// 📋 입력칸을 누르면 위에 "복사한 글 붙여넣기" 칩 (2026-10-30, 사용자 요청: 문자·채팅·프론트 채팅 입력칸)
// - 갤럭시 앱(1.6.3): 복사한 글이 있을 때만 칩을 보이고(Phone.readClipboard peek, 내용은 안 읽음), 누르면 읽는다.
// - 아이폰·갤럭시 크롬: 브라우저는 몰래 읽을 수 없어서 칩을 늘 보이고 누를 때 읽는다(아이폰은 "붙여넣기" 확인 말풍선).
// - PC(마우스): Ctrl+V가 있어 칩을 안 띄운다.
// 누르면 커서 자리에 넣는다. 입력칸 포커스(키보드)는 그대로 둔다.
async function readClip(): Promise<string> {
  if (hasPhoneNative) {
    const r = await PhoneNative.readClipboard().catch(() => null)
    if (r && typeof r.text === 'string') return r.text
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export function insertAt(el: HTMLTextAreaElement | null, value: string, add: string, set: (v: string) => void) {
  const a = el?.selectionStart ?? value.length
  const b = el?.selectionEnd ?? value.length
  set(value.slice(0, a) + add + value.slice(b))
  requestAnimationFrame(() => {
    el?.focus()
    el?.setSelectionRange(a + add.length, a + add.length)
  })
}

export function ClipboardChip({ inputRef, onPaste }: { inputRef: RefObject<HTMLTextAreaElement | null>; onPaste: (text: string) => void }) {
  const [focused, setFocused] = useState(false)
  // 갤럭시 앱: 복사한 글이 있는지 (null = 모름 → 칩을 보이고 누를 때 읽음)
  const [has, setHas] = useState<boolean | null>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onFocus = () => {
      setFocused(true)
      if (hasPhoneNative)
        void PhoneNative.readClipboard({ peek: true })
          .then((r) => setHas(typeof r.has === 'boolean' ? r.has : null))
          .catch(() => setHas(null))
    }
    const onBlur = () => setTimeout(() => setFocused(false), 150)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('focus', onFocus)
      el.removeEventListener('blur', onBlur)
    }
  }, [inputRef])

  if (!focused || has === false || (!hasPhoneNative && !touch)) return null
  return (
    <button
      type="button"
      className="clip-chip"
      onPointerDown={(e) => e.preventDefault()}
      onClick={async () => {
        const text = (await readClip()).trim()
        if (!text) {
          toast('복사한 글이 없어요')
          return
        }
        onPaste(text)
      }}
    >
      📋 복사한 글 붙여넣기
    </button>
  )
}
