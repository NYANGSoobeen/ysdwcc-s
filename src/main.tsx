import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './style.css'
import { ContextMenuHost } from './ui/ContextMenu.tsx'
import { DialogHost } from './ui/dialogs.tsx'
import { setupInstallPrompt, setupMobileViewport } from './mobile.ts'
import { setupUpdateNotice } from './update.ts'

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
