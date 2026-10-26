import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import pkg from './package.json' with { type: 'json' }

const REQUIRED_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

export default defineConfig(({ command, mode }) => {
  // 설정값 없이 빌드하면 배포 후 빈 화면(auth/invalid-api-key)이 되므로 빌드 단계에서 막는다.
  const env = loadEnv(mode, process.cwd())
  if (command === 'build' && env.VITE_USE_EMULATORS !== 'true') {
    const missing = REQUIRED_ENV.filter((key) => !env[key])
    if (missing.length > 0) {
      throw new Error(
        `\n.env.local 파일에 Firebase 설정값이 없습니다: ${missing.join(', ')}\n` +
          '프로젝트 폴더(package.json이 있는 곳)에 .env.local 파일이 있는지, 이름이 .env.local.txt가 아닌지 확인하세요.\n',
      )
    }
  }
  return config
})

const config = {
  define: {
    // 화면(메뉴 왼쪽 아래, 내 정보)에 표시할 버전: package.json 버전 · 빌드 날짜 · 커밋.
    // 어떤 배포가 폰에 떠 있는지 바로 알 수 있게 한다.
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  plugins: [
    VitePWA({
      // 'prompt': 새 버전을 바로 적용하지 않고 대기시킨 뒤, 사용자가 알림을 누르면 적용한다.
      // (작성 중인 메모가 새로고침으로 날아가지 않게 하기 위함)
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: '양산동원 지원팀',
        short_name: '양산동원지원팀',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#f5eedd',
        theme_color: '#16587b',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // 안쪽 내용이 안전 영역 안에 있어 안드로이드 원형/물방울 모양으로 잘려도 그대로 보인다.
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // pdf.js(약 1.3MB)는 스케줄을 올릴 때만 받는다 (업데이트마다 내려받지 않게).
        globIgnores: ['**/pdf-*.js', '**/pdf.worker*.js'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
}

function buildVersion() {
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(2).replaceAll('-', '.')
  let commit = ''
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // git이 없으면 커밋은 생략
  }
  return [pkg.version, date, commit].filter(Boolean).join(' · ')
}
