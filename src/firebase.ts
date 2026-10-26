import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
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

// PC는 안내 데스크 같은 공용 컴퓨터로 본다 (마우스를 쓰고, 갤럭시 앱이 아닌 브라우저).
// 공용 컴퓨터: 브라우저를 닫으면 로그아웃(세션 저장), 고객 정보를 디스크에 남기지 않음(메모리 캐시),
// 15분 넘게 앱을 닫아 두었으면 다시 로그인 (src/session.ts).
// 휴대폰: 로그인을 계속 유지하고 오프라인 캐시를 쓴다.
const isNativeApp = Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
export const sharedComputer = !isNativeApp && matchMedia('(hover: hover) and (pointer: fine)').matches

export const auth = initializeAuth(app, {
  persistence: sharedComputer ? browserSessionPersistence : [indexedDBLocalPersistence, browserLocalPersistence],
})
// 오프라인 캐시: 미국 서버까지의 지연을 가리고, 같은 데이터를 다시 읽지 않아 무료 사용량을 아낀다.
export const db = initializeFirestore(app, {
  localCache: sharedComputer
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// 예전 버전이 공용 컴퓨터 디스크에 남긴 로그인 정보와 오프라인 캐시를 지운다.
if (sharedComputer && 'databases' in indexedDB) {
  void indexedDB
    .databases()
    .then((list) => {
      for (const { name } of list) {
        if (name && (name === 'firebaseLocalStorageDb' || name.startsWith('firestore/'))) indexedDB.deleteDatabase(name)
      }
    })
    .catch(() => {})
}
export const storage = getStorage(app)
export const functions = getFunctions(app, 'us-west1')

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
