import { useEffect, useState } from 'react'
import { StorageImage } from '../components/StorageImage.tsx'
import { useEmoticons } from '../emoticons.ts'
import { recentStickers, type StickerChoice, type StuckSticker } from '../stuck.ts'
import { ask, Modal, tell } from './dialogs.tsx'

// 🏷️ 붙이는 스티커 화면 조각: 고르는 창, 붙인 스티커 층, 누가 붙였는지 보기, 배경 스티커 목록.

type Group = { icon: string; label: string; list: string[] }
let emojiGroups: Promise<Group[]> | null = null
const loadEmojiGroups = () => (emojiGroups ??= import('../emojiData.ts').then((m) => m.EMOJI_GROUPS))

// 고르는 창: 🕘 최근 · 이모지 묶음(Win + . 과 같은 9묶음) · 이모티콘 테마 전부
export function StickerPicker({ onPick, onClose }: { onPick: (choice: StickerChoice) => void; onClose: () => void }) {
  const recent = recentStickers()
  const [tab, setTab] = useState<string>(recent.length ? 'recent' : 'g0')
  const [groups, setGroups] = useState<Group[]>([])
  const { packs, items } = useEmoticons(true)
  useEffect(() => {
    loadEmojiGroups().then(setGroups, () => {})
  }, [])
  const tabs = [
    ...(recent.length ? [{ id: 'recent', label: '🕘 최근' }] : []),
    ...groups.map((g, i) => ({ id: `g${i}`, label: `${g.icon} ${g.label}` })),
    ...packs.map((p) => ({ id: `p:${p.id}`, label: `😊 ${p.name}` })),
  ]
  let choices: StickerChoice[] = []
  if (tab === 'recent') choices = recent
  else if (tab.startsWith('g')) choices = (groups[Number(tab.slice(1))]?.list ?? []).map((e) => ({ e }))
  else choices = items.filter((i) => `p:${i.packId}` === tab).map((i) => ({ a: i.assetId }))
  return (
    <Modal onClose={onClose} labelledBy="sticker-picker-title" className="sticker-picker">
      <h3 id="sticker-picker-title">🏷️ 붙일 스티커 고르기</h3>
      <div className="sticker-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="sticker-choices" role="listbox" aria-label="스티커">
        {!groups.length && tab.startsWith('g') && <p className="muted small">불러오는 중…</p>}
        {choices.map((c) => (
          <button
            key={'e' in c ? c.e : c.a}
            type="button"
            role="option"
            aria-selected={false}
            className={'a' in c ? 'pick emoticon' : 'pick'}
            onClick={() => onPick(c)}
          >
            {'e' in c ? c.e : <StorageImage path={c.a} alt="이모티콘" />}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}

export function StuckFace({ s }: { s: Pick<StuckSticker, 'e' | 'a'> }) {
  return s.e ? <span className="stk-emoji">{s.e}</span> : <StorageImage path={s.a!} alt="이모티콘" className="stk-img" />
}

const when = (s: StuckSticker) =>
  s.at ? s.at.toDate().toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '방금'

// 스티커를 누르면: 누가 언제 붙였는지 + 내 것이면 떼기
export async function showStickerInfo(s: StuckSticker, names: Record<string, string>, me: string, onRemove: () => Promise<void>) {
  const message = (
    <span className="stk-info">
      <StuckFace s={s} />
      <span>
        <strong>{names[s.by] ?? '나간 팀원'}</strong>님이 붙였어요
        <br />
        <span className="muted small">{when(s)}</span>
      </span>
    </span>
  )
  if (s.by !== me) return tell({ title: '🏷️ 스티커', message })
  if (await ask({ title: '🏷️ 내 스티커', message, ok: '떼기', cancel: '닫기', danger: true })) await onRemove()
}

// 붙인 곳 위에 겹쳐 그리는 층 (붙인 곳이 position: relative 여야 한다)
export function StuckLayer(props: {
  stickers: StuckSticker[]
  onTap?: (s: StuckSticker) => void
  className?: string
}) {
  if (!props.stickers.length) return null
  return (
    <div className={`stk-layer ${props.className ?? ''}`}>
      {props.stickers.map((s) =>
        props.onTap ? (
          <button
            key={s.id}
            type="button"
            className="stk"
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              props.onTap!(s)
            }}
            aria-label="붙인 스티커 보기"
          >
            <StuckFace s={s} />
          </button>
        ) : (
          <span key={s.id} className="stk" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }} aria-hidden="true">
            <StuckFace s={s} />
          </span>
        ),
      )}
    </div>
  )
}

// 🧹 배경 스티커 보기·떼기
export function StuckList(props: {
  title: string
  stickers: StuckSticker[]
  names: Record<string, string>
  me: string
  onRemove: (id: string) => Promise<void>
  onClose: () => void
}) {
  return (
    <Modal onClose={props.onClose} labelledBy="stuck-list-title">
      <h3 id="stuck-list-title">{props.title}</h3>
      {props.stickers.length === 0 && <p className="muted">붙인 스티커가 없어요.</p>}
      <ul className="stuck-list">
        {props.stickers.map((s) => (
          <li key={s.id}>
            <StuckFace s={s} />
            <span className="stuck-who">
              <strong>{props.names[s.by] ?? '나간 팀원'}</strong>
              <span className="muted small">{when(s)}</span>
            </span>
            {s.by === props.me && (
              <button type="button" className="ghost danger-text" onClick={() => void props.onRemove(s.id)}>
                떼기
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
