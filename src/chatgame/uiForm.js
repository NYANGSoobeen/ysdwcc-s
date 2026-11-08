// 🎲 채팅 미니 게임용 폼 (프론트 앱 js/core.js 의 uiForm 과 같은 동작, 모양만 우리 앱 창(.modal)).
// uiForm(제목, 칸들, {okLabel, message, danger}) → 값 객체, 취소면 null.
// 칸 종류: 글(text) · textarea · checkbox · number · datetime-local · file · list(form-list.js 그대로 끼워 넣음)
// 이 파일은 src/chatgame/index.ts 가 chatgame.js 와 한 덩어리로 묶어 돌린다 (전역에 안 나감).
// formNoFile 이 참이면 사진(file) 칸을 빼고 보여 준다 (🏌️ 프론트 방: 게스트는 사진을 올릴 수 없음).
let formResolve = null, formBg = null
function $(id) { return formBg ? formBg.querySelector('#' + id) : null }
function enterPressed(e) { return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 }
function closeForm(val) {
  if (formBg) { formBg.remove(); formBg = null }
  document.removeEventListener('keydown', formKey, true)
  const r = formResolve; formResolve = null; if (r) r(val)
}
function formKey(e) { if (e.key === 'Escape' && formBg) { e.stopPropagation(); closeForm(null) } }
function uiForm(title, fields, opts) {
  opts = opts || {}
  return new Promise(resolve => {
    if (formResolve) closeForm(null)
    formResolve = resolve
    formBg = document.createElement('div'); formBg.className = 'modal-backdrop game-form-bg'
    const box = document.createElement('div'); box.className = 'modal game-form'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true')
    const h = document.createElement('h3'); h.textContent = title
    const body = document.createElement('div'); body.className = 'form game-form-body'
    const acts = document.createElement('div'); acts.className = 'modal-actions'
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소'
    const ok = document.createElement('button'); ok.type = 'button'; ok.id = 'formOk'; ok.className = opts.danger ? 'primary danger-fill' : 'primary'
    acts.append(cancel, ok); box.append(h, body, acts); formBg.appendChild(box)
    const getters = {}
    let firstInput = null, singleText = null
    if (opts.message) { const m = document.createElement('div'); m.className = 'modal-message'; m.textContent = opts.message; body.appendChild(m) }
    fields.forEach(f => {
      if (f.type === 'file' && formNoFile) return
      if (f.label && f.type !== 'checkbox') { const l = document.createElement('div'); l.className = 'field-label'; l.textContent = f.label; body.appendChild(l) }
      let el
      /*FORM_LIST*/
      else if (f.type === 'textarea') {
        el = document.createElement('textarea'); el.value = f.value || ''; el.rows = f.rows || 4; if (f.maxlength) el.maxLength = f.maxlength; if (f.placeholder) el.placeholder = f.placeholder
        getters[f.key] = () => el.value
      } else if (f.type === 'checkbox') {
        const row = document.createElement('label'); row.className = 'check'
        el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!f.value
        row.appendChild(el); row.appendChild(document.createTextNode(f.label || ''))
        body.appendChild(row); getters[f.key] = () => el.checked; return
      } else if (f.type === 'file') {
        el = document.createElement('input'); el.type = 'file'; if (f.accept) el.accept = f.accept
        getters[f.key] = () => el.files[0] || null
      } else {
        el = document.createElement('input'); el.type = f.type || 'text'; el.value = f.value || ''; if (f.placeholder) el.placeholder = f.placeholder; if (f.maxlength) el.maxLength = f.maxlength
        if (f.type === 'number') el.inputMode = 'numeric'
        getters[f.key] = () => el.value
        if (!singleText && (!f.type || f.type === 'text')) singleText = el
      }
      body.appendChild(el)
      if (!firstInput && f.type !== 'file') firstInput = el
    })
    if (fields.filter(f => !f.type || f.type === 'text').length === 1 && singleText) {
      singleText.addEventListener('keydown', e => { if (enterPressed(e)) { e.preventDefault(); ok.click() } })
    }
    ok.textContent = opts.okLabel || '저장'
    ok.onclick = () => { const out = {}; Object.keys(getters).forEach(k => out[k] = getters[k]()); closeForm(out) }
    cancel.onclick = () => closeForm(null)
    // 바깥을 눌러 닫기는 휴대폰(터치)만, PC는 Esc·취소 (우리 앱 창과 같게)
    let downOut = false
    formBg.addEventListener('pointerdown', e => { downOut = e.target === formBg })
    formBg.addEventListener('click', e => { const out = e.target === formBg && downOut; downOut = false; if (out && touchUI()) closeForm(null) })
    document.addEventListener('keydown', formKey, true)
    document.body.appendChild(formBg)
    // 휴대폰은 처음부터 키보드가 올라오면 칸이 가려져서 첫 칸에 바로 포커스는 PC만
    if (firstInput && !touchUI()) setTimeout(() => { firstInput.focus() }, 30)
  })
}
