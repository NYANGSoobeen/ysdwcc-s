package kr.yangsan.support.phone

import android.content.ContentProviderOperation
import android.content.Context
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import org.json.JSONArray
import org.json.JSONObject

// 🏷️ 폰에 원래 있던 고객 연락처에 "[업무]" 붙이기 (갤럭시 앱 1.6.8, 2026-11-02 사용자가 정함).
// 같은 사람이 폰 연락처 "홍길동"과 우리 앱 계정 "[업무] 홍길동"으로 두 번 있으면, 전화가 올 때 폰이 아무거나 골라
// [업무]가 안 붙은 이름이 뜰 수 있다 → 직원이 고른 연락처만 이름 앞에 "[업무] "를 붙인다(개인 연락처를 고치는 유일한 곳).
// 원래 이름 칸(성·이름·중간·앞·뒤)은 이 폰 안(SharedPreferences "work_contacts")에 기억해 두고 "되돌리기"로 그대로 돌려놓는다.
object WorkContacts {
    const val PREFIX = "[업무] "
    private const val OUR_ACCOUNT = "kr.yangsan.support.account"
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("work_contacts", Context.MODE_PRIVATE)

    // 고객 번호와 같은 번호가 있는 폰 연락처(우리 계정 것 제외). 연락처(rawId)마다 한 줄.
    fun find(ctx: Context): JSONArray {
        val customers = PhoneAlerts.allCustomers(ctx)
        val out = JSONArray()
        if (customers.length() == 0) return out
        val byRaw = LinkedHashMap<Long, JSONObject>()
        ctx.contentResolver.query(
            Phone.CONTENT_URI,
            arrayOf(Phone.RAW_CONTACT_ID, Phone.NUMBER, ContactsContract.RawContacts.ACCOUNT_TYPE, Phone.DISPLAY_NAME),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(2) == OUR_ACCOUNT) continue
                val number = c.getString(1) ?: continue
                val customer = customers.optJSONObject(OffDay.local(number)) ?: continue
                val raw = c.getLong(0)
                if (byRaw.containsKey(raw)) continue
                byRaw[raw] = JSONObject()
                    .put("rawId", raw)
                    .put("number", number)
                    .put("customer", customer.optString("n"))
                    .put("company", customer.optString("c"))
                    .put("contactName", c.getString(3) ?: "")
            }
        }
        val marked = prefs(ctx).all.keys
        for ((raw, o) in byRaw) {
            val name = nameRow(ctx, raw)
            val display = name?.optString("display").orEmpty().ifBlank { o.optString("contactName") }
            o.put("name", display)
            o.put("marked", display.startsWith(PREFIX.trim()))
            o.put("canUndo", marked.contains(raw.toString()))
            o.remove("contactName")
            out.put(o)
        }
        return out
    }

    // 그 연락처(raw)의 이름 줄: 줄 id와 칸들
    private fun nameRow(ctx: Context, raw: Long): JSONObject? =
        ctx.contentResolver.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(
                ContactsContract.Data._ID, StructuredName.DISPLAY_NAME, StructuredName.GIVEN_NAME, StructuredName.FAMILY_NAME,
                StructuredName.MIDDLE_NAME, StructuredName.PREFIX, StructuredName.SUFFIX,
            ),
            "${ContactsContract.Data.RAW_CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} = ?",
            arrayOf(raw.toString(), StructuredName.CONTENT_ITEM_TYPE), null,
        )?.use { c ->
            if (!c.moveToFirst()) null
            else JSONObject()
                .put("id", c.getLong(0))
                .put("display", c.getString(1) ?: "")
                .put("given", c.getString(2) ?: JSONObject.NULL)
                .put("family", c.getString(3) ?: JSONObject.NULL)
                .put("middle", c.getString(4) ?: JSONObject.NULL)
                .put("prefix", c.getString(5) ?: JSONObject.NULL)
                .put("suffix", c.getString(6) ?: JSONObject.NULL)
        }

    private fun str(o: JSONObject, k: String): String? = if (o.isNull(k)) null else o.optString(k)

    // "[업무] " 붙이기: 원래 칸을 기억하고, 이름 전체를 "[업무] 원래이름" 한 칸으로 (성·이름으로 나눠 두면 폰이 다시 합치며 [업무]가 사라짐)
    fun mark(ctx: Context, rawIds: List<Long>): Int {
        val ops = ArrayList<ContentProviderOperation>()
        val edit = prefs(ctx).edit()
        for (raw in rawIds) {
            val row = nameRow(ctx, raw) ?: continue
            val display = row.optString("display").trim()
            if (display.isEmpty() || display.startsWith(PREFIX.trim())) continue
            edit.putString(raw.toString(), row.toString())
            ops.add(
                ContentProviderOperation.newUpdate(ContactsContract.Data.CONTENT_URI)
                    .withSelection("${ContactsContract.Data._ID} = ?", arrayOf(row.getLong("id").toString()))
                    .withValue(StructuredName.DISPLAY_NAME, PREFIX + display)
                    .withValue(StructuredName.GIVEN_NAME, PREFIX + display)
                    .withValue(StructuredName.FAMILY_NAME, null)
                    .withValue(StructuredName.MIDDLE_NAME, null)
                    .withValue(StructuredName.PREFIX, null)
                    .withValue(StructuredName.SUFFIX, null)
                    .build(),
            )
        }
        if (ops.isEmpty()) return 0
        ctx.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
        edit.apply()
        return ops.size
    }

    // 되돌리기: 기억해 둔 원래 이름 칸 그대로
    fun unmark(ctx: Context, rawIds: List<Long>): Int {
        val ops = ArrayList<ContentProviderOperation>()
        val p = prefs(ctx)
        val edit = p.edit()
        for (raw in rawIds) {
            val saved = p.getString(raw.toString(), null)?.let { JSONObject(it) } ?: continue
            val row = nameRow(ctx, raw) ?: continue
            ops.add(
                ContentProviderOperation.newUpdate(ContactsContract.Data.CONTENT_URI)
                    .withSelection("${ContactsContract.Data._ID} = ?", arrayOf(row.getLong("id").toString()))
                    .withValue(StructuredName.DISPLAY_NAME, saved.optString("display"))
                    .withValue(StructuredName.GIVEN_NAME, str(saved, "given"))
                    .withValue(StructuredName.FAMILY_NAME, str(saved, "family"))
                    .withValue(StructuredName.MIDDLE_NAME, str(saved, "middle"))
                    .withValue(StructuredName.PREFIX, str(saved, "prefix"))
                    .withValue(StructuredName.SUFFIX, str(saved, "suffix"))
                    .build(),
            )
            edit.remove(raw.toString())
        }
        if (ops.isEmpty()) return 0
        ctx.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
        edit.apply()
        return ops.size
    }
}
