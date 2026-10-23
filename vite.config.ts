import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
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
})
