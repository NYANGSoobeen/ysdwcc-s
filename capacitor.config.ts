import type { CapacitorConfig } from '@capacitor/cli'

// 갤럭시(안드로이드)용 설치형 앱. 화면은 배포된 웹앱(Firebase Hosting)을 그대로 불러오므로,
// 웹앱을 배포하면 앱을 다시 설치하지 않아도 바로 반영된다. APK를 새로 만들어야 하는 건
// 안드로이드 쪽 코드(android/, 연락처 플러그인)를 바꿨을 때뿐이다.
const config: CapacitorConfig = {
  appId: 'kr.yangsan.support',
  appName: '양산동원지원팀',
  webDir: 'dist',
  server: {
    url: 'https://ysdwcc-s.web.app',
    androidScheme: 'https',
  },
}

export default config
