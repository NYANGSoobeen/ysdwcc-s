package kr.yangsan.support.contacts

import android.accounts.Account
import android.accounts.AccountManager
import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Note
import android.provider.ContactsContract.CommonDataKinds.Organization
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import android.provider.ContactsContract.Data
import android.provider.ContactsContract.RawContacts

data class Customer(val id: String, val name: String, val company: String, val phones: List<String>)

data class SyncResult(val added: Int, val updated: Int, val removed: Int)

// 전용 계정의 연락처만 다룬다. 개인 연락처(삼성 계정, 구글 계정, 휴대전화)는 읽지도 건드리지도 않는다.
class ContactsWriter(private val context: Context) {

    companion object {
        const val ACCOUNT_TYPE = "kr.yangsan.support.account"
        const val ACCOUNT_NAME = "지원팀"
        const val NAME_PREFIX = "[업무] "
        private const val BATCH = 300
    }

    private val account = Account(ACCOUNT_NAME, ACCOUNT_TYPE)
    private val resolver: ContentResolver = context.contentResolver

    // 동기화 어댑터로서 쓰면 "수정됨" 표시가 남지 않고, 계정의 연락처로 바로 반영된다.
    private fun asSyncAdapter(uri: Uri): Uri = uri.buildUpon()
        .appendQueryParameter(ContactsContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(RawContacts.ACCOUNT_NAME, ACCOUNT_NAME)
        .appendQueryParameter(RawContacts.ACCOUNT_TYPE, ACCOUNT_TYPE)
        .build()

    private fun ensureAccount() {
        val manager = AccountManager.get(context)
        if (manager.getAccountsByType(ACCOUNT_TYPE).none { it.name == ACCOUNT_NAME }) {
            manager.addAccountExplicitly(account, null, null)
        }
        // 연락처 앱에서 이 계정의 연락처가 보이게 한다. 폰마다 이미 있거나 지원하지 않을 수 있어 실패해도 넘어간다.
        ContentResolver.setIsSyncable(account, ContactsContract.AUTHORITY, 1)
        ContentResolver.setSyncAutomatically(account, ContactsContract.AUTHORITY, false)
        try {
            val settings = android.content.ContentValues().apply {
                put(ContactsContract.Settings.ACCOUNT_NAME, ACCOUNT_NAME)
                put(ContactsContract.Settings.ACCOUNT_TYPE, ACCOUNT_TYPE)
                put(ContactsContract.Settings.UNGROUPED_VISIBLE, 1)
            }
            resolver.insert(asSyncAdapter(ContactsContract.Settings.CONTENT_URI), settings)
        } catch (_: Exception) {
        }
    }

    // 고객 id(SOURCE_ID) → (raw contact id, 내용 지문)
    private fun existing(): Map<String, Pair<Long, String>> {
        val result = mutableMapOf<String, Pair<Long, String>>()
        resolver.query(
            asSyncAdapter(RawContacts.CONTENT_URI),
            arrayOf(RawContacts._ID, RawContacts.SOURCE_ID, RawContacts.SYNC1),
            "${RawContacts.ACCOUNT_TYPE}=? AND ${RawContacts.ACCOUNT_NAME}=? AND ${RawContacts.DELETED}=0",
            arrayOf(ACCOUNT_TYPE, ACCOUNT_NAME),
            null,
        )?.use { c ->
            while (c.moveToNext()) {
                val sourceId = c.getString(1) ?: continue
                result[sourceId] = c.getLong(0) to (c.getString(2) ?: "")
            }
        }
        return result
    }

    fun count(): Int = existing().size

    private fun fingerprint(c: Customer) = listOf(c.name, c.company, c.phones.joinToString(",")).joinToString("|")

    fun sync(customers: List<Customer>): SyncResult {
        ensureAccount()
        val current = existing()
        val wanted = customers.associateBy { it.id }
        val ops = ArrayList<ContentProviderOperation>()
        var added = 0
        var updated = 0
        var removed = 0

        for ((sourceId, entry) in current) {
            if (sourceId !in wanted) {
                ops += ContentProviderOperation.newDelete(asSyncAdapter(RawContacts.CONTENT_URI))
                    .withSelection("${RawContacts._ID}=?", arrayOf(entry.first.toString()))
                    .build()
                removed++
                ops.flushIfFull()
            }
        }
        for (customer in customers) {
            val entry = current[customer.id]
            val print = fingerprint(customer)
            if (entry == null) {
                addContact(ops, customer, print)
                added++
            } else if (entry.second != print) {
                updateContact(ops, entry.first, customer, print)
                updated++
            }
            ops.flushIfFull()
        }
        ops.flush()
        return SyncResult(added, updated, removed)
    }

    private fun addContact(ops: ArrayList<ContentProviderOperation>, c: Customer, print: String) {
        val back = ops.size
        ops += ContentProviderOperation.newInsert(asSyncAdapter(RawContacts.CONTENT_URI))
            .withValue(RawContacts.ACCOUNT_TYPE, ACCOUNT_TYPE)
            .withValue(RawContacts.ACCOUNT_NAME, ACCOUNT_NAME)
            .withValue(RawContacts.SOURCE_ID, c.id)
            .withValue(RawContacts.SYNC1, print)
            .build()
        dataRows(c).forEach { values ->
            ops += ContentProviderOperation.newInsert(asSyncAdapter(Data.CONTENT_URI))
                .withValueBackReference(Data.RAW_CONTACT_ID, back)
                .withValues(values)
                .build()
        }
    }

    private fun updateContact(ops: ArrayList<ContentProviderOperation>, rawId: Long, c: Customer, print: String) {
        ops += ContentProviderOperation.newDelete(asSyncAdapter(Data.CONTENT_URI))
            .withSelection("${Data.RAW_CONTACT_ID}=?", arrayOf(rawId.toString()))
            .build()
        dataRows(c).forEach { values ->
            ops += ContentProviderOperation.newInsert(asSyncAdapter(Data.CONTENT_URI))
                .withValue(Data.RAW_CONTACT_ID, rawId)
                .withValues(values)
                .build()
        }
        ops += ContentProviderOperation.newUpdate(asSyncAdapter(RawContacts.CONTENT_URI))
            .withSelection("${RawContacts._ID}=?", arrayOf(rawId.toString()))
            .withValue(RawContacts.SYNC1, print)
            .build()
    }

    private fun dataRows(c: Customer): List<android.content.ContentValues> {
        val rows = mutableListOf<android.content.ContentValues>()
        // 한국 이름은 성/이름을 나누지 않고 표시 이름 그대로 넣어야 폰에서 그대로 보인다.
        rows += android.content.ContentValues().apply {
            put(Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
            put(StructuredName.DISPLAY_NAME, NAME_PREFIX + c.name.ifBlank { "이름 없음" })
        }
        if (c.company.isNotBlank()) {
            rows += android.content.ContentValues().apply {
                put(Data.MIMETYPE, Organization.CONTENT_ITEM_TYPE)
                put(Organization.COMPANY, c.company)
                put(Organization.TYPE, Organization.TYPE_WORK)
            }
        }
        c.phones.forEach { phone ->
            rows += android.content.ContentValues().apply {
                put(Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                put(Phone.NUMBER, phone)
                put(Phone.TYPE, Phone.TYPE_MOBILE)
            }
        }
        rows += android.content.ContentValues().apply {
            put(Data.MIMETYPE, Note.CONTENT_ITEM_TYPE)
            put(Note.NOTE, "양산동원 지원팀 앱에서 동기화한 연락처입니다. 수정은 앱에서 하세요.")
        }
        return rows
    }

    private fun ArrayList<ContentProviderOperation>.flushIfFull() {
        // 한 연락처의 작업이 나뉘지 않도록, 연락처 단위로 넣은 뒤에만 묶음을 보낸다.
        if (size >= BATCH) flush()
    }

    private fun ArrayList<ContentProviderOperation>.flush() {
        if (isEmpty()) return
        resolver.applyBatch(ContactsContract.AUTHORITY, this)
        clear()
    }

    fun clear() {
        resolver.delete(
            asSyncAdapter(RawContacts.CONTENT_URI),
            "${RawContacts.ACCOUNT_TYPE}=? AND ${RawContacts.ACCOUNT_NAME}=?",
            arrayOf(ACCOUNT_TYPE, ACCOUNT_NAME),
        )
        val manager = AccountManager.get(context)
        manager.getAccountsByType(ACCOUNT_TYPE).forEach { manager.removeAccountExplicitly(it) }
    }
}
