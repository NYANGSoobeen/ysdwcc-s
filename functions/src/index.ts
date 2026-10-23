import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onDocumentDeleted } from 'firebase-functions/v2/firestore'

// Firestore와 같은 리전. 무료 사용량을 넘지 않도록 동시 실행 수를 제한한다.
setGlobalOptions({ region: 'us-west1', maxInstances: 3 })
initializeApp()

// 채팅 메시지를 지우면 첨부 사진도 바로 지운다.
export const onMessageDeleted = onDocumentDeleted(
  'teams/{teamId}/messages/{msgId}',
  async (event) => {
    const { teamId, msgId } = event.params
    await getStorage().bucket().deleteFiles({ prefix: `teams/${teamId}/chat/${msgId}/` })
  },
)

// Firestore는 문서를 지워도 하위 컬렉션이 남으므로, 고객을 지우면 메모와 수정 기록을 함께 지운다.
export const onCustomerDeleted = onDocumentDeleted('customers/{customerId}', async (event) => {
  const db = getFirestore()
  await db.recursiveDelete(db.doc(`customers/${event.params.customerId}`))
})

// 메모를 지우면 수정 기록도 함께 지운다.
export const onNoteDeleted = onDocumentDeleted(
  'customers/{customerId}/notes/{noteId}',
  async (event) => {
    const { customerId, noteId } = event.params
    const db = getFirestore()
    await db.recursiveDelete(db.doc(`customers/${customerId}/notes/${noteId}`))
  },
)
