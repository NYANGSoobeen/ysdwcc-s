import { useRef, useState } from 'react'
import { errorMessage } from '../auth.ts'
import { StorageImage } from '../components/StorageImage.tsx'
import { addEmoticons, addPack, deleteEmoticon, deletePack, EmoticonFileError, movePack, renamePack, useEmoticons } from '../emoticons.ts'
import { ask, askText, toast } from '../ui/dialogs.tsx'

// 최고 관리자: 😊 이모티콘 테마·이모티콘 추가/삭제 (모든 팀 공용).
export function EmoticonAdminCard() {
  const { packs, items, loaded } = useEmoticons(true)
  const [busy, setBusy] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<string | null>(null)

  async function run(label: string, job: () => Promise<unknown>) {
    setBusy(label)
    try {
      await job()
    } catch (err) {
      toast(err instanceof EmoticonFileError ? err.message : errorMessage(err), { error: true, long: true })
    } finally {
      setBusy(null)
    }
  }

  async function newPack() {
    const name = await askText({ title: '새 이모티콘 테마', label: '테마 이름', placeholder: '예: 강아지', ok: '만들기', required: '이름을 넣어 주세요.' })
    if (name?.trim()) await run('테마 만드는 중…', () => addPack(name))
  }

  async function rename(id: string, now: string) {
    const name = await askText({ title: '테마 이름 바꾸기', label: '테마 이름', value: now, ok: '바꾸기', required: '이름을 넣어 주세요.' })
    if (name?.trim() && name.trim() !== now) await run('바꾸는 중…', () => renamePack(id, name))
  }

  async function removePack(id: string, name: string, count: number) {
    if (!(await ask({ message: `"${name}" 테마와 이모티콘 ${count}개를 지울까요?\n이미 보낸 채팅의 이 이모티콘도 안 보이게 됩니다.`, ok: '지우기', danger: true }))) return
    await run('지우는 중…', () => deletePack(id))
  }

  async function removeOne(id: string) {
    if (!(await ask({ message: '이 이모티콘을 지울까요? 이미 보낸 채팅에서도 안 보이게 됩니다.', ok: '지우기', danger: true }))) return
    await run('지우는 중…', () => deleteEmoticon(id))
  }

  function pickFiles(packId: string) {
    setTarget(packId)
    fileInput.current?.click()
  }

  return (
    <section className="card emoticon-admin">
      <h3>😊 이모티콘 (모든 팀 공용)</h3>
      <p className="muted small">
        테마별로 그림을 올리면 모든 직원이 채팅 입력칸 😊에서 골라 보낼 수 있어요. PNG·JPG는 256px로 줄여 저장하고, 움직이는 GIF는 1MB까지 그대로 올려요.
      </p>
      {!loaded && <p className="muted small">불러오는 중…</p>}
      {packs.map((p, i) => {
        const list = items.filter((s) => s.packId === p.id)
        return (
          <div key={p.id} className="emoticon-pack">
            <div className="emoticon-pack-head">
              <strong>{p.name}</strong>
              <span className="muted small">{list.length}개</span>
              <span className="spacer" />
              <button type="button" className="ghost icon" onClick={() => void run('옮기는 중…', () => movePack(p.id, -1))} disabled={i === 0 || !!busy} aria-label="위로">
                ▲
              </button>
              <button type="button" className="ghost icon" onClick={() => void run('옮기는 중…', () => movePack(p.id, 1))} disabled={i === packs.length - 1 || !!busy} aria-label="아래로">
                ▼
              </button>
              <button type="button" className="ghost" onClick={() => void rename(p.id, p.name)} disabled={!!busy}>
                이름
              </button>
              <button type="button" className="ghost danger-text" onClick={() => void removePack(p.id, p.name, list.length)} disabled={!!busy}>
                삭제
              </button>
            </div>
            <div className="emoticon-admin-grid">
              {list.map((s) => (
                <div key={s.id} className="emoticon-admin-item">
                  <StorageImage path={s.assetId} alt={s.name || '이모티콘'} />
                  <button type="button" className="remove" onClick={() => void removeOne(s.id)} disabled={!!busy} aria-label={`${s.name || '이모티콘'} 지우기`}>
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="emoticon-add" onClick={() => pickFiles(p.id)} disabled={!!busy}>
                ＋<span>추가</span>
              </button>
            </div>
          </div>
        )
      })}
      {busy && <p className="notice">{busy}</p>}
      <button type="button" onClick={() => void newPack()} disabled={!!busy}>
        ＋ 새 테마 만들기
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/gif,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (target && files.length) void run(`올리는 중… 0/${files.length}`, () => addEmoticons(target, files, (d, t) => setBusy(`올리는 중… ${d}/${t}`)))
        }}
      />
    </section>
  )
}
