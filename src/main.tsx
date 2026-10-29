import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { captureSharedMemo } from './sharedMemo.ts'
import { App } from './App.tsx'
import './style.css'
import { ContextMenuHost } from './ui/ContextMenu.tsx'
import { DialogHost } from './ui/dialogs.tsx'
import { setupInstallPrompt, setupMobileViewport } from './mobile.ts'
import { setupUpdateNotice } from './update.ts'

// 통화 요약 공유(?memo=)는 화면을 그리기 전에 꺼내 둔다
captureSharedMemo()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
    <DialogHost />
    <ContextMenuHost />
  </StrictMode>,
)

setupUpdateNotice()
setupMobileViewport()
setupInstallPrompt()
