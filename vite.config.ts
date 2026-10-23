import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
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
    // 화면에 표시할 버전. 배포마다 package.json의 version을 올린다.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      // 'prompt': 새 버전을 바로 적용하지 않고 대기시킨 뒤, 사용자가 알림을 누르면 적용한다.
      // (작성 중인 메모가 새로고침으로 날아가지 않게 하기 위함)
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: '업무폰',
        short_name: '업무폰',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f6feb',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
}
