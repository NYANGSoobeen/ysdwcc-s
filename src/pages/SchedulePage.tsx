import { onSnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { errorMessage } from '../auth.ts'
import type { Team } from '../hooks.ts'
import { MenuButton } from '../menu.tsx'
import { findCell } from '../schedule/cells.ts'
import {
  changeMarks,
  deleteSchedule,
  downloadUrl,
  EXCEL_HINT,
  loadPageImage,
  pagePixels,
  renameSchedule,
  scheduleRef,
  ScheduleFileError,
  uploadSchedule,
  type LoadedImage,
  type Schedule,
  type SchedulePage as Page,
} from '../schedule/data.ts'
import { StickerLayer, stickerColors } from '../schedule/StickerLayer.tsx'
import { drawSticker, sameCell, STICKERS, type Mark } from '../schedule/stickers.ts'
import { ZoomViewer } from '../schedule/ZoomViewer.tsx'

const stickerRows = [...new Set(STICKERS.map((s) => s.row))].sort()
const ZOOM_STEP = 1.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 5

export function SchedulePage({ team, uid }: { team: Team; uid: string }) {
  const canEdit = team.members[uid] !== 'viewer'
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(undefined)
  const [sticker, setSticker] = useState<string | null>(null)
  const [pending, setPending] = useState<Mark[]>([])
  const [zoom, setZoom] = useState(1)
  const [viewport, setViewport] = useState(0)
  const [progress, setProgress] = useState('')
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [full, setFull] = useState<{ src: string; marks: Mark[]; page: Page; revoke: boolean } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 모든 직원이 실시간으로 같은 스케줄과 스티커를 본다.
  useEffect(
    () =>
      onSnapshot(
        scheduleRef(team.id),
        (snap) => setSchedule(snap.exists() ? (snap.data() as Schedule) : null),
        () => setSchedule(null),
      ),
    [team.id],
  )

  // 화면 너비에 맞춘 크기를 기준(확대 1)으로 삼는다.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setViewport(el.clientWidth - 24)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [schedule === undefined])

  const say = useCallback((text: string) => {
    clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  async function pickFile(file: File) {
    if (schedule && !confirm(`새 스케줄을 올리면 지금 스케줄(${schedule.fileName})은 영구 삭제돼요. 계속할까요?`)) return
    try {
      setProgress('준비하는 중…')
      await uploadSchedule(team.id, file, setProgress)
      setZoom(1)
      setSticker(null)
      say('스케줄을 올렸어요.')
    } catch (err) {
      alert(err instanceof ScheduleFileError ? err.message : `올리지 못했어요. ${errorMessage(err)}`)
    } finally {
      setProgress('')
    }
  }

  async function place(pageIndex: number, fx: number, fy: number) {
    if (!schedule || !sticker) return
    const page = schedule.images[pageIndex]
    const px = await pagePixels(page.assetId)
    const cell = px ? findCell(px, fx, fy) : null
    const mark: Mark = cell
      ? { p: pageIndex, x: (cell.l + cell.r) / 2, y: (cell.t + cell.b) / 2, w: cell.r - cell.l, h: cell.b - cell.t, t: sticker }
      : { p: pageIndex, x: fx, y: fy, t: sticker }
    setPending((list) => [...list, mark])
    try {
      // 같은 칸에 이미 스티커가 있으면 새 것으로 바꿔 붙인다.
      await changeMarks(team.id, (marks) => [...marks.filter((m) => !sameCell(m, mark)), mark])
    } catch (err) {
      say(`스티커를 붙이지 못했어요. ${errorMessage(err)}`)
    } finally {
      setPending((list) => list.filter((m) => m !== mark))
    }
  }

  async function remove(mark: Mark) {
    try {
      await changeMarks(team.id, (marks) =>
        marks.filter((m) => !(m.p === mark.p && m.x === mark.x && m.y === mark.y && m.t === mark.t)),
      )
    } catch (err) {
      say(`스티커를 떼지 못했어요. ${errorMessage(err)}`)
    }
  }

  async function replace(mark: Mark, t: string) {
    const next: Mark = { ...mark, t }
    setPending((list) => [...list, next])
    try {
      await changeMarks(team.id, (marks) => [...marks.filter((m) => !sameCell(m, mark)), next])
    } catch (err) {
      say(`스티커를 바꾸지 못했어요. ${errorMessage(err)}`)
    } finally {
      setPending((list) => list.filter((m) => m !== next))
    }
  }

  async function removeAll() {
    if (!confirm('붙인 스티커를 모두 뗄까요?')) return
    try {
      await changeMarks(team.id, () => [])
    } catch (err) {
      say(errorMessage(err))
    }
  }

  // 크게 보기: 스티커가 있으면 원본 크기 그림에 스티커를 그려 PNG로 만들어 보여 준다 (길게 눌러 저장 가능).
  async function openFull(pageIndex: number) {
    if (!schedule) return
    const page = schedule.images[pageIndex]
    const marks = schedule.marks.filter((m) => m.p === pageIndex)
    const loaded = await loadPageImage(page.assetId)
    if (marks.length === 0 || !loaded.blob) {
      setFull({ src: loaded.url, marks: loaded.blob ? [] : marks, page, revoke: false })
      return
    }
    const bitmap = await createImageBitmap(loaded.blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    for (const m of marks) drawSticker(ctx, m, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    setFull({ src: blob ? URL.createObjectURL(blob) : loaded.url, marks: blob ? [] : marks, page, revoke: !!blob })
  }

  function closeFull() {
    if (full?.revoke) URL.revokeObjectURL(full.src)
    setFull(null)
  }

  const marks = schedule ? [...schedule.marks, ...pending] : []
  const pageWidth = Math.max(160, viewport * zoom)

  return (
    <div className="page schedule">
      <header className="page-header">
        <MenuButton />
        <h2>스케줄</h2>
        {schedule ? (
          <button type="button" className="ghost" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="파일 메뉴">
            파일 ▾
          </button>
        ) : (
          <span />
        )}
      </header>

      {menuOpen && schedule && (
        <FileMenu
          schedule={schedule}
          canEdit={canEdit}
          onClose={() => setMenuOpen(false)}
          onUpload={() => fileInput.current?.click()}
          onRename={async () => {
            const name = prompt('파일 이름', schedule.fileName)?.trim()
            if (!name || name === schedule.fileName) return
            try {
              await renameSchedule(team.id, name)
            } catch (err) {
              alert(errorMessage(err))
            }
          }}
          onDelete={async () => {
            if (!confirm(`스케줄(${schedule.fileName})을 삭제할까요?\n원본, 쪽 그림, 스티커가 모두 영구 삭제되며 되돌릴 수 없어요.`)) return
            try {
              await deleteSchedule(team.id)
              say('스케줄을 삭제했어요.')
            } catch (err) {
              alert(errorMessage(err))
            }
          }}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void pickFile(file)
        }}
      />

      {schedule && (
        <div className="sched-tools">
          <div className="sticker-rows" role="toolbar" aria-label="수정 표시 스티커">
            {/* 스티커가 있는 줄만 그리고, "모두 떼기"는 마지막 줄 끝에 둔다 */}
            {stickerRows.map((row) => (
              <div key={row} className="sticker-row">
                {STICKERS.filter((s) => s.row === row).map((s) => (
                  <button
                    key={s.t}
                    type="button"
                    className={sticker === s.t ? 'sticker-button active' : 'sticker-button'}
                    style={stickerColors(s.kind)}
                    aria-pressed={sticker === s.t}
                    onClick={() => setSticker(sticker === s.t ? null : s.t)}
                  >
                    {s.t}
                  </button>
                ))}
                {row === stickerRows.at(-1) && schedule.marks.length > 0 && (
                  <button type="button" className="sticker-clear" onClick={removeAll}>
                    모두 떼기
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className={sticker ? 'sched-hint on' : 'sched-hint'}>
            {sticker
              ? `붙이기 모드 [${sticker}] · 칸을 누르면 붙어요. 다른 스티커를 누르면 [${sticker}]로 바뀌고, 같은 [${sticker}]를 누르면 떼져요. 끝내려면 버튼을 다시 누르세요.`
              : '스티커를 고른 뒤 근무표 칸을 누르면 붙어요. 그림을 누르면 크게 볼 수 있어요.'}
          </p>
          <div className="zoom-row">
            <span className="muted small sched-name" title={schedule.fileName}>
              {schedule.fileName}
            </span>
            <button type="button" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))} aria-label="축소">
              −
            </button>
            <button type="button" onClick={() => setZoom(1)}>
              화면맞춤
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))} aria-label="확대">
              ＋
            </button>
          </div>
        </div>
      )}

      <div className="sched-scroll" ref={scroller}>
        {schedule === undefined && <p className="center muted">불러오는 중…</p>}
        {schedule === null && (
          <div className="sched-empty">
            <div className="sched-empty-icon" aria-hidden="true">📅</div>
            <p>아직 올린 스케줄이 없어요</p>
            {canEdit ? (
              <button type="button" className="primary" onClick={() => fileInput.current?.click()}>
                📎 스케줄 올리기 (사진·PDF)
              </button>
            ) : (
              <p className="muted small">편집 권한이 있는 팀원이 올릴 수 있어요.</p>
            )}
            <p className="muted small">{EXCEL_HINT}</p>
          </div>
        )}
        {schedule &&
          viewport > 0 &&
          schedule.images.map((page, i) => (
            <PageView
              key={page.assetId}
              page={page}
              width={pageWidth}
              marks={marks.filter((m) => m.p === i)}
              pending={pending}
              onTap={(fx, fy) => (sticker ? void place(i, fx, fy) : void openFull(i))}
              onMarkTap={(m) => {
                if (!sticker) return say('떼려면 스티커 버튼을 하나 고른 뒤 눌러 주세요.')
                // 스티커가 칸을 덮고 있으므로: 고른 것과 같은 스티커면 떼고, 다른 스티커면 고른 것으로 바꿔 붙인다.
                if (m.t === sticker) void remove(m)
                else void replace(m, sticker)
              }}
            />
          ))}
      </div>

      {progress && (
        <div className="sched-progress" role="status">
          <div className="card">{progress}</div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {full && <ZoomViewer src={full.src} page={full.page} marks={full.marks} title={full.page.name} onClose={closeFull} />}
    </div>
  )
}

function PageView(props: {
  page: Page
  width: number
  marks: Mark[]
  pending: Mark[]
  onTap: (fx: number, fy: number) => void
  onMarkTap: (mark: Mark) => void
}) {
  const { page, width, marks, pending, onTap, onMarkTap } = props
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    loadPageImage(page.assetId).then(
      (img) => active && setImage(img),
      () => active && setFailed(true),
    )
    // 스티커를 붙이기 전에 미리 칸 찾기용 밝기를 계산해 둔다.
    void pagePixels(page.assetId)
    return () => {
      active = false
    }
  }, [page.assetId])

  function tap(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    onTap((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  }

  return (
    <div
      className="sched-page"
      style={{ width, aspectRatio: `${page.w} / ${page.h}` }}
      onClick={tap}
      role="img"
      aria-label={`근무표 ${page.name}`}
    >
      {image ? (
        <img src={image.url} alt="" draggable={false} />
      ) : (
        <div className="photo-loading">{failed ? '그림을 불러오지 못했어요' : '불러오는 중…'}</div>
      )}
      <StickerLayer page={page} marks={marks} pending={pending} onMarkTap={onMarkTap} />
    </div>
  )
}

function FileMenu(props: {
  schedule: Schedule
  canEdit: boolean
  onClose: () => void
  onUpload: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const { schedule, canEdit, onClose, onUpload, onRename, onDelete } = props
  const [links, setLinks] = useState<{ label: string; url: string }[] | null>(null)

  useEffect(() => {
    let active = true
    const files = [
      ...(schedule.assetId ? [{ label: `원본 (${schedule.fileName})`, id: schedule.assetId }] : []),
      ...schedule.images.map((p) => ({ label: `${p.name} 그림`, id: p.assetId })),
    ]
    Promise.all(files.map(async (f) => ({ label: f.label, url: await downloadUrl(f.id) }))).then(
      (list) => active && setLinks(list),
      () => active && setLinks([]),
    )
    return () => {
      active = false
    }
  }, [schedule])

  const run = (action: () => void) => () => {
    onClose()
    action()
  }

  return (
    <div className="file-menu card" role="menu">
      <p className="small">
        <strong>{schedule.fileName}</strong>
        <br />
        <span className="muted">
          {schedule.images.length}쪽
          {schedule.pdfDropped && ' · 원본 PDF가 1MB를 넘어 쪽 그림만 저장했어요'}
        </span>
      </p>
      {canEdit && (
        <>
          <button type="button" role="menuitem" onClick={run(onUpload)}>
            📎 새 스케줄 올리기
          </button>
          <button type="button" role="menuitem" onClick={run(onRename)}>
            ✏️ 파일 이름 변경
          </button>
          <button type="button" role="menuitem" className="danger-text" onClick={run(onDelete)}>
            🗑️ 이 스케줄 삭제
          </button>
        </>
      )}
      <div className="download-list">
        {links === null ? (
          <span className="muted small">다운로드 주소 준비 중…</span>
        ) : (
          links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener" download>
              ⬇ {l.label}
            </a>
          ))
        )}
      </div>
      <button type="button" className="ghost" onClick={onClose}>
        닫기
      </button>
    </div>
  )
}
