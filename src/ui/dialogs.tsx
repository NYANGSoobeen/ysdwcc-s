import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

// 브라우저 기본 alert/confirm/prompt 대신 쓰는 앱 안 창과 토스트 알림.
// 어디서든 await ask(...), await askText(...), toast(...)로 부르고, 화면에는 <DialogHost />가 그린다.

type ConfirmOptions = {
  title?: string
  message: ReactNode
  ok?: string
  cancel?: string | null // null이면 확인 버튼만 (알림 창)
  danger?: boolean
}

type PromptOptions = {
  title?: string
  message?: ReactNode
  label?: string
  value?: string
  placeholder?: string
  ok?: string
  required?: string // 비워 두면 안 될 때 보여 줄 문구
  multiline?: boolean
}

type Dialog =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

type Toast = { id: number; text: string; error: boolean; onClick?: () => void }

let dialogs: Dialog[] = []
let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function closeDialog(id: number) {
  dialogs = dialogs.filter((d) => d.id !== id)
  emit()
}

// 확인 창. 확인을 누르면 true.
export function ask(options: ConfirmOptions | string) {
  const opts = typeof options === 'string' ? { message: options } : options
  return new Promise<boolean>((resolve) => {
    dialogs = [...dialogs, { id: nextId++, kind: 'confirm', options: opts, resolve }]
    emit()
  })
}

// 알림 창 (확인 버튼 하나). 꼭 읽어야 하는 내용(임시 비밀번호 등)에 쓴다. 나머지는 toast.
export async function tell(options: Omit<ConfirmOptions, 'cancel'> | string) {
  const opts = typeof options === 'string' ? { message: options } : options
  await ask({ ...opts, cancel: null })
}

// 입력 창. 취소하면 null.
export function askText(options: PromptOptions) {
  return new Promise<string | null>((resolve) => {
    dialogs = [...dialogs, { id: nextId++, kind: 'prompt', options, resolve }]
    emit()
  })
}

// 화면 아래에 잠깐 떴다 사라지는 알림.
// onClick을 주면 알림을 눌러 그 자리로 갈 수 있다 (예: "○○님이 나를 불렀어요" → 그 방).
export function toast(text: string, opts: { error?: boolean; onClick?: () => void; long?: boolean } = {}) {
  const item = { id: nextId++, text, error: Boolean(opts.error), onClick: opts.onClick }
  toasts = [...toasts.slice(-2), item]
  emit()
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== item.id)
      emit()
    },
    item.error || opts.long ? 5000 : 2600,
  )
}

// ── 창 틀 ─────────────────────────────────────────────────────
// 바깥을 눌러 닫기는 휴대폰(터치)에서만. PC는 창 안에서 끌다가 바깥에서 놓아도 닫히지 않게
// 바깥 클릭으로는 닫지 않고, Esc나 버튼으로 닫는다.
export const isTouchUi = () => !matchMedia('(hover: hover) and (pointer: fine)').matches

export function Modal(props: {
  onClose: () => void
  children: ReactNode
  labelledBy?: string
  className?: string
  closeOnOutside?: boolean
}) {
  const downOnBackdrop = useRef(false)
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        const outside = e.target === e.currentTarget && downOnBackdrop.current
        downOnBackdrop.current = false
        if (outside && (props.closeOnOutside ?? true) && isTouchUi()) onClose()
      }}
    >
      <div className={`modal ${props.className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={props.labelledBy}>
        {props.children}
      </div>
    </div>
  )
}

function ConfirmView({ dialog }: { dialog: Extract<Dialog, { kind: 'confirm' }> }) {
  const { options } = dialog
  const titleId = useId()
  const done = (ok: boolean) => {
    closeDialog(dialog.id)
    dialog.resolve(ok)
  }
  return (
    <Modal onClose={() => done(false)} labelledBy={titleId}>
      {options.title && <h3 id={titleId}>{options.title}</h3>}
      <div className="modal-message">{options.message}</div>
      <div className="modal-actions">
        {options.cancel !== null && (
          <button type="button" onClick={() => done(false)}>
            {options.cancel ?? '취소'}
          </button>
        )}
        <button
          type="button"
          className={options.danger ? 'primary danger-fill' : 'primary'}
          onClick={() => done(true)}
          autoFocus
        >
          {options.ok ?? '확인'}
        </button>
      </div>
    </Modal>
  )
}

function PromptView({ dialog }: { dialog: Extract<Dialog, { kind: 'prompt' }> }) {
  const { options } = dialog
  const [value, setValue] = useState(options.value ?? '')
  const [error, setError] = useState('')
  const titleId = useId()
  const done = (result: string | null) => {
    closeDialog(dialog.id)
    dialog.resolve(result)
  }
  function submit() {
    if (options.required && !value.trim()) return setError(options.required)
    done(value)
  }
  const field = {
    value,
    autoFocus: true,
    placeholder: options.placeholder,
    'aria-label': options.label ?? options.title,
    onChange: (e: { target: { value: string } }) => {
      setValue(e.target.value)
      setError('')
    },
  }
  return (
    <Modal onClose={() => done(null)} labelledBy={titleId}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {options.title && <h3 id={titleId}>{options.title}</h3>}
        {options.message && <div className="modal-message">{options.message}</div>}
        {options.multiline ? <textarea rows={3} {...field} /> : <input {...field} />}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => done(null)}>
            취소
          </button>
          <button className="primary">{options.ok ?? '확인'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function DialogHost() {
  const state = useSyncExternalStore(subscribe, () => dialogs)
  const toastList = useSyncExternalStore(subscribe, () => toasts)
  return (
    <>
      {state.map((d) =>
        d.kind === 'confirm' ? <ConfirmView key={d.id} dialog={d} /> : <PromptView key={d.id} dialog={d} />,
      )}
      {toastList.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {toastList.map((t) =>
            t.onClick ? (
              <button
                key={t.id}
                type="button"
                className="toast action"
                onClick={() => {
                  toasts = toasts.filter((x) => x.id !== t.id)
                  emit()
                  t.onClick!()
                }}
              >
                {t.text}
              </button>
            ) : (
              <div key={t.id} className={t.error ? 'toast error' : 'toast'}>
                {t.text}
              </div>
            ),
          )}
        </div>
      )}
    </>
  )
}
