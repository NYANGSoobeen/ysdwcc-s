import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  setPersistence,
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

// 로그인 유지: 로그인 화면의 "로그인 유지" 체크칸. 기본값은 휴대폰 켬, PC 끔. 갤럭시 앱은 항상 켬.
// 켬: 로그인을 계속 유지하고 오프라인 캐시를 쓴다.
// 끔(여러 사람이 쓰는 컴퓨터): 브라우저를 닫으면 로그아웃(세션 저장), 고객 정보를 디스크에 남기지 않음
// (메모리 캐시), 15분 넘게 앱을 닫아 두었으면 다시 로그인 (src/session.ts).
export const isNativeApp = Boolean(
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
)
const isPc = !isNativeApp && matchMedia('(hover: hover) and (pointer: fine)').matches
const KEEP_KEY = 'keep-signed-in'

export function keepSignedIn() {
  if (isNativeApp) return true
  try {
    const saved = localStorage.getItem(KEEP_KEY)
    if (saved !== null) return saved === '1'
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return !isPc
}

function saveKeepSignedIn(keep: boolean) {
  try {
    localStorage.setItem(KEEP_KEY, keep ? '1' : '0')
  } catch {
    // 기억하지 못하면 다음에 기본값으로 나온다.
  }
}

// 앱을 열 때의 설정으로 캐시 방식을 정한다 (바꾼 설정은 다음에 앱을 열 때부터 캐시에 적용).
const shortSession = !keepSignedIn()

// 로그인 정보는 유지(IndexedDB) 또는 세션(브라우저를 닫으면 사라짐) 중 있는 곳에서 찾는다.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
})

// 로그인 직전에 부른다: 체크칸에 맞춰 로그인 정보를 어디에 둘지 정한다.
export async function applyKeepSignedIn(keep: boolean) {
  const value = isNativeApp || keep
  saveKeepSignedIn(value)
  await setPersistence(auth, value ? indexedDBLocalPersistence : browserSessionPersistence)
}

// 오프라인 캐시: 미국 서버까지의 지연을 가리고, 같은 데이터를 다시 읽지 않아 무료 사용량을 아낀다.
export const db = initializeFirestore(app, {
  localCache: shortSession
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

// 로그인 유지를 끈 컴퓨터: 예전에 디스크에 남은 오프라인 캐시를 지운다.
if (shortSession && 'databases' in indexedDB) {
  void indexedDB
    .databases()
    .then((list) => {
      for (const { name } of list) if (name?.startsWith('firestore/')) indexedDB.deleteDatabase(name)
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
