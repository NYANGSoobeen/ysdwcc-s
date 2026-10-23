import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

// VITE_USE_EMULATORS=true 이면 로컬 에뮬레이터에 연결한다 (npm run dev:emulators).
const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true'

// 값은 Firebase 콘솔 → 프로젝트 설정 → 웹 앱에서 복사해 .env.local에 넣는다.
export const app = initializeApp(
  useEmulators
    ? { apiKey: 'demo', projectId: 'demo-workphone', storageBucket: 'demo-workphone.appspot.com' }
    : {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      },
)

export const auth = getAuth(app)
// 오프라인 캐시: 미국 서버까지의 지연을 가리고, 같은 데이터를 다시 읽지 않아 무료 사용량을 아낀다.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
export const storage = getStorage(app)
export const functions = getFunctions(app, 'us-west1')

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
