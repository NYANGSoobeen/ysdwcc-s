import { deleteDoc, doc } from 'firebase/firestore'
import { db } from './firebase.ts'

// 바로 영구 삭제한다. 메모와 수정 기록은 서버(Functions)가 함께 지운다.
// 되돌릴 수 없으므로 화면에서 반드시 확인 창을 띄운 뒤 호출한다.
export async function deleteCustomer(customerId: string) {
  await deleteDoc(doc(db, 'customers', customerId))
}
