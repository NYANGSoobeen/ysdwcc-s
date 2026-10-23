import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, initializeFirestore, persistentLocalCache } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// 값은 Firebase 콘솔 → 프로젝트 설정 → 웹 앱에서 복사해 .env.local에 넣는다.
export const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

// 오프라인 캐시: 미국 서버까지의 지연을 가리고, 같은 데이터를 다시 읽지 않아 무료 사용량을 아낀다.
initializeFirestore(app, { localCache: persistentLocalCache() })

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
