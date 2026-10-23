import './style.css'
import { setupUpdateNotice } from './update.ts'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <h1>업무폰</h1>
    <p class="version">버전 ${__APP_VERSION__}</p>
  </main>
`

setupUpdateNotice()
