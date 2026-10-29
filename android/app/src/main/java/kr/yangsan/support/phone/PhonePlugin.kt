package kr.yangsan.support.phone

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Settings
import android.provider.Telephony
import android.telephony.SmsManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// 📞 전화·✉️ 문자 (갤럭시 앱 1.3.0). 웹앱의 "전화", "문자" 화면이 부른다.
// - 통화 기록과 문자는 이 폰 안에서 읽기만 하고, 서버에는 올리지 않는다 (CLAUDE.md 데이터 저장 규칙).
// - 전화 걸기·받기 화면과 문자 알림은 삼성 기본 앱 그대로 (기본 전화·문자 앱을 바꾸지 않음).
// - 문자 보내기는 SmsManager로 바로 보낸다. 기본 문자 앱이 아니면 안드로이드가 보낸 문자를 문자함에 저절로 적어 준다.
@CapacitorPlugin(
    name = "Phone",
    permissions = [
        Permission(alias = "calls", strings = [Manifest.permission.READ_CALL_LOG, Manifest.permission.CALL_PHONE]),
        Permission(alias = "sms", strings = [Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS]),
        Permission(alias = "contacts", strings = [Manifest.permission.READ_CONTACTS]),
    ],
)
class PhonePlugin : Plugin() {
    private var observers: List<ContentObserver> = emptyList()

    override fun load() {
        // 통화 기록·문자가 바뀌면 웹앱에 알려 화면을 새로 그리게 한다.
        val handler = Handler(Looper.getMainLooper())
        fun observer(what: String) = object : ContentObserver(handler) {
            private var pending = false
            override fun onChange(selfChange: Boolean) {
                // 한꺼번에 여러 번 바뀌어도 한 번만 알린다.
                if (pending) return
                pending = true
                handler.postDelayed({
                    pending = false
                    notifyListeners("changed", JSObject().put("what", what))
                }, 400)
            }
        }
        val calls = observer("calls")
        val sms = observer("sms")
        try {
            context.contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, calls)
            context.contentResolver.registerContentObserver(Uri.parse("content://mms-sms/"), true, sms)
            observers = listOf(calls, sms)
        } catch (_: Exception) {
            // 권한을 받기 전에는 등록이 안 될 수 있다 → 권한을 받으면 다시 등록
        }
    }

    override fun handleOnDestroy() {
        observers.forEach { context.contentResolver.unregisterContentObserver(it) }
    }

    private fun granted(alias: String) = getPermissionState(alias) == PermissionState.GRANTED

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("calls", granted("calls"))
                .put("sms", granted("sms"))
                .put("contacts", granted("contacts")),
        )
    }

    @PluginMethod
    fun requestCalls(call: PluginCall) = ask(call, "calls")

    @PluginMethod
    fun requestSms(call: PluginCall) = ask(call, "sms")

    @PluginMethod
    fun requestContacts(call: PluginCall) = ask(call, "contacts")

    private fun ask(call: PluginCall, alias: String) {
        if (granted(alias)) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        call.data.put("alias", alias)
        requestPermissionForAlias(alias, call, "askResult")
    }

    @PermissionCallback
    private fun askResult(call: PluginCall) {
        val ok = granted(call.getString("alias") ?: "calls")
        if (ok) {
            handleOnDestroy()
            load()
        }
        call.resolve(JSObject().put("granted", ok))
    }

    // 앱 정보 화면 (권한이 막혔을 때: "제한된 설정 허용" → 권한)
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    // ── 통화 ──
    // 최근 통화 기록 (최신순). type: 1 받은 전화, 2 건 전화, 3 부재중, 5 거절, 6 차단
    @PluginMethod
    fun callLog(call: PluginCall) {
        if (!granted("calls")) return call.reject("통화 기록 권한이 없습니다.", "NO_PERMISSION")
        val limit = call.getInt("limit", 300)!!
        val since = call.getLong("since", 0L)!!
        execute {
            try {
                val out = JSArray()
                val cols = arrayOf(
                    CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION,
                )
                context.contentResolver.query(
                    CallLog.Calls.CONTENT_URI, cols, "${CallLog.Calls.DATE} > ?", arrayOf(since.toString()),
                    "${CallLog.Calls.DATE} DESC",
                )?.use { c ->
                    while (c.moveToNext() && out.length() < limit) {
                        out.put(
                            JSObject()
                                .put("id", c.getLong(0).toString())
                                .put("number", c.getString(1) ?: "")
                                .put("name", c.getString(2) ?: "")
                                .put("type", c.getInt(3))
                                .put("date", c.getLong(4))
                                .put("duration", c.getLong(5)),
                        )
                    }
                }
                call.resolve(JSObject().put("calls", out))
            } catch (e: Exception) {
                call.reject("통화 기록을 읽지 못했습니다: ${e.message}", e)
            }
        }
    }

    // 전화 걸기: 권한이 있으면 바로 걸고(삼성 통화 화면), 없으면 번호를 넣은 전화 앱을 연다.
    @PluginMethod
    fun dial(call: PluginCall) {
        val number = call.getString("number")?.trim().orEmpty()
        if (number.isEmpty()) return call.reject("번호가 없습니다.")
        val uri = Uri.fromParts("tel", number, null)
        val direct = granted("calls")
        val intent = Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, uri)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            call.resolve(JSObject().put("direct", direct))
        } catch (e: Exception) {
            call.reject("전화를 걸지 못했습니다: ${e.message}", e)
        }
    }

    // ── 문자 ──
    // 대화 목록: 대화마다 마지막 문자 1개 + 안 읽은 수. 문자(SMS)와 사진 문자(MMS) 모두.
    @PluginMethod
    fun threads(call: PluginCall) {
        if (!granted("sms")) return call.reject("문자 권한이 없습니다.", "NO_PERMISSION")
        val limit = call.getInt("limit", 200)!!
        execute {
            try {
                val latest = LinkedHashMap<Long, JSObject>()
                val unread = HashMap<Long, Int>()
                // SMS: 최근 것부터 훑어 대화마다 첫 줄만 남긴다.
                context.contentResolver.query(
                    Telephony.Sms.CONTENT_URI,
                    arrayOf(Telephony.Sms.THREAD_ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.READ),
                    null, null, "${Telephony.Sms.DATE} DESC LIMIT 5000",
                )?.use { c ->
                    while (c.moveToNext()) {
                        val t = c.getLong(0)
                        if (c.getInt(4) == Telephony.Sms.MESSAGE_TYPE_INBOX && c.getInt(5) == 0) unread[t] = (unread[t] ?: 0) + 1
                        if (latest.containsKey(t)) continue
                        latest[t] = JSObject()
                            .put("threadId", t.toString())
                            .put("address", c.getString(1) ?: "")
                            .put("text", c.getString(2) ?: "")
                            .put("date", c.getLong(3))
                            .put("mine", c.getInt(4) != Telephony.Sms.MESSAGE_TYPE_INBOX)
                    }
                }
                // MMS: 대화의 마지막이 사진 문자면 그것으로 바꾼다.
                context.contentResolver.query(
                    Telephony.Mms.CONTENT_URI,
                    arrayOf(Telephony.Mms._ID, Telephony.Mms.THREAD_ID, Telephony.Mms.DATE, Telephony.Mms.MESSAGE_BOX, Telephony.Mms.READ),
                    null, null, "${Telephony.Mms.DATE} DESC LIMIT 1000",
                )?.use { c ->
                    val seen = HashSet<Long>()
                    while (c.moveToNext()) {
                        val id = c.getLong(0)
                        val t = c.getLong(1)
                        val date = c.getLong(2) * 1000
                        val inbox = c.getInt(3) == Telephony.Mms.MESSAGE_BOX_INBOX
                        if (inbox && c.getInt(4) == 0) unread[t] = (unread[t] ?: 0) + 1
                        if (!seen.add(t)) continue
                        val cur = latest[t]
                        if (cur == null || cur.getLong("date") < date) {
                            latest[t] = JSObject()
                                .put("threadId", t.toString())
                                .put("address", cur?.getString("address")?.takeIf { it.isNotEmpty() } ?: Mms.address(context, id, inbox))
                                .put("text", Mms.text(context, id).ifEmpty { "📷 사진" })
                                .put("date", date)
                                .put("mine", !inbox)
                        }
                    }
                }
                val out = JSArray()
                latest.values.sortedByDescending { it.getLong("date") }.take(limit).forEach {
                    it.put("unread", unread[it.getString("threadId")!!.toLong()] ?: 0)
                    out.put(it)
                }
                call.resolve(JSObject().put("threads", out))
            } catch (e: Exception) {
                call.reject("문자 목록을 읽지 못했습니다: ${e.message}", e)
            }
        }
    }

    // 한 대화의 문자 (오래된 것 → 최신). before(ms) 앞의 limit개.
    @PluginMethod
    fun messages(call: PluginCall) {
        if (!granted("sms")) return call.reject("문자 권한이 없습니다.", "NO_PERMISSION")
        val threadId = call.getString("threadId")?.toLongOrNull() ?: return call.reject("대화가 없습니다.")
        val limit = call.getInt("limit", 200)!!
        val before = call.getLong("before", Long.MAX_VALUE)!!
        execute {
            try {
                val list = ArrayList<JSObject>()
                context.contentResolver.query(
                    Telephony.Sms.CONTENT_URI,
                    arrayOf(Telephony.Sms._ID, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.STATUS),
                    "${Telephony.Sms.THREAD_ID} = ? AND ${Telephony.Sms.DATE} < ?", arrayOf(threadId.toString(), before.toString()),
                    "${Telephony.Sms.DATE} DESC LIMIT $limit",
                )?.use { c ->
                    while (c.moveToNext()) {
                        val type = c.getInt(3)
                        list.add(
                            JSObject()
                                .put("id", "s${c.getLong(0)}")
                                .put("text", c.getString(1) ?: "")
                                .put("date", c.getLong(2))
                                .put("mine", type != Telephony.Sms.MESSAGE_TYPE_INBOX)
                                .put("failed", type == Telephony.Sms.MESSAGE_TYPE_FAILED)
                                .put("sending", type == Telephony.Sms.MESSAGE_TYPE_OUTBOX || type == Telephony.Sms.MESSAGE_TYPE_QUEUED),
                        )
                    }
                }
                context.contentResolver.query(
                    Telephony.Mms.CONTENT_URI,
                    arrayOf(Telephony.Mms._ID, Telephony.Mms.DATE, Telephony.Mms.MESSAGE_BOX),
                    "${Telephony.Mms.THREAD_ID} = ? AND ${Telephony.Mms.DATE} < ?", arrayOf(threadId.toString(), (before / 1000).toString()),
                    "${Telephony.Mms.DATE} DESC LIMIT $limit",
                )?.use { c ->
                    while (c.moveToNext()) {
                        val id = c.getLong(0)
                        list.add(
                            JSObject()
                                .put("id", "m$id")
                                .put("text", Mms.text(context, id))
                                .put("images", Mms.imageCount(context, id))
                                .put("date", c.getLong(1) * 1000)
                                .put("mine", c.getInt(2) != Telephony.Mms.MESSAGE_BOX_INBOX),
                        )
                    }
                }
                val out = JSArray()
                list.sortedBy { it.getLong("date") }.takeLast(limit).forEach { out.put(it) }
                call.resolve(JSObject().put("messages", out))
            } catch (e: Exception) {
                call.reject("문자를 읽지 못했습니다: ${e.message}", e)
            }
        }
    }

    // 번호로 대화 찾기 (없으면 첫 문자를 보낼 때 생긴다)
    @PluginMethod
    fun threadFor(call: PluginCall) {
        if (!granted("sms")) return call.reject("문자 권한이 없습니다.", "NO_PERMISSION")
        val number = call.getString("number")?.trim().orEmpty()
        try {
            val id = Telephony.Threads.getOrCreateThreadId(context, number)
            call.resolve(JSObject().put("threadId", id.toString()))
        } catch (e: Exception) {
            call.reject("대화를 찾지 못했습니다: ${e.message}", e)
        }
    }

    // 문자 보내기. 긴 글은 여러 통으로 나눠 보내고, 다 보내졌는지 기다렸다 알려 준다.
    @PluginMethod
    fun sendSms(call: PluginCall) {
        if (!granted("sms")) return call.reject("문자 권한이 없습니다.", "NO_PERMISSION")
        val number = call.getString("number")?.trim().orEmpty()
        val text = call.getString("text").orEmpty()
        if (number.isEmpty() || text.isEmpty()) return call.reject("번호와 내용을 넣어 주세요.")
        try {
            val sms: SmsManager = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            val parts = sms.divideMessage(text)
            val action = "kr.yangsan.support.SMS_SENT_${System.nanoTime()}"
            var left = parts.size
            var failed = false
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    if (resultCode != Activity.RESULT_OK) failed = true
                    left -= 1
                    if (left > 0) return
                    try { context.unregisterReceiver(this) } catch (_: Exception) {}
                    if (failed) call.reject("문자를 보내지 못했습니다. 신호와 요금제를 확인해 주세요.", "SEND_FAILED")
                    else call.resolve(JSObject().put("parts", parts.size))
                }
            }
            val filter = IntentFilter(action)
            if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            else @Suppress("UnspecifiedRegisterReceiverFlag") context.registerReceiver(receiver, filter)
            val sent = ArrayList<PendingIntent>()
            for (i in parts.indices) {
                val intent = Intent(action).setPackage(context.packageName)
                sent.add(PendingIntent.getBroadcast(context, i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT))
            }
            sms.sendMultipartTextMessage(number, null, parts, sent, null)
        } catch (e: Exception) {
            call.reject("문자를 보내지 못했습니다: ${e.message}", e)
        }
    }

    // ── 폰 연락처 (개인 연락처 이름 보여 주기, "폰 연락처에서 고객 골라 오기"에 읽기만) ──
    // [{ name, number, company }] — 우리 앱이 넣은 "[업무]" 고객 연락처는 뺀다.
    @PluginMethod
    fun contacts(call: PluginCall) {
        if (!granted("contacts")) return call.reject("연락처 권한이 없습니다.", "NO_PERMISSION")
        execute {
            try {
                // 회사(직장) 이름: 연락처마다 하나
                val companies = HashMap<Long, String>()
                context.contentResolver.query(
                    ContactsContract.Data.CONTENT_URI,
                    arrayOf(ContactsContract.Data.CONTACT_ID, ContactsContract.CommonDataKinds.Organization.COMPANY),
                    "${ContactsContract.Data.MIMETYPE} = ?", arrayOf(ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE), null,
                )?.use { c ->
                    while (c.moveToNext()) {
                        val company = c.getString(1)
                        if (!company.isNullOrBlank()) companies.putIfAbsent(c.getLong(0), company.trim())
                    }
                }
                val out = JSArray()
                val seen = HashSet<String>()
                context.contentResolver.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    arrayOf(
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                        ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.RawContacts.ACCOUNT_TYPE,
                        ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                    ),
                    null, null, "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC",
                )?.use { c ->
                    while (c.moveToNext()) {
                        if (c.getString(2) == "kr.yangsan.support.account") continue
                        val name = c.getString(0) ?: continue
                        val number = c.getString(1) ?: continue
                        if (!seen.add(name + number.filter { it.isDigit() })) continue
                        out.put(
                            JSObject()
                                .put("name", name)
                                .put("number", number)
                                .put("company", companies[c.getLong(3)] ?: ""),
                        )
                    }
                }
                call.resolve(JSObject().put("contacts", out))
            } catch (e: Exception) {
                call.reject("연락처를 읽지 못했습니다: ${e.message}", e)
            }
        }
    }
}

// 사진 문자(MMS) 읽기 도우미
private object Mms {
    fun text(context: Context, id: Long): String {
        val sb = StringBuilder()
        context.contentResolver.query(
            Uri.parse("content://mms/part"), arrayOf("_id", "ct", "text"), "mid = ?", arrayOf(id.toString()), null,
        )?.use { c ->
            while (c.moveToNext()) if (c.getString(1) == "text/plain") sb.append(c.getString(2) ?: "")
        }
        return sb.toString()
    }

    fun imageCount(context: Context, id: Long): Int {
        var n = 0
        context.contentResolver.query(
            Uri.parse("content://mms/part"), arrayOf("ct"), "mid = ?", arrayOf(id.toString()), null,
        )?.use { c -> while (c.moveToNext()) if (c.getString(0)?.startsWith("image/") == true) n++ }
        return n
    }

    // 받은 사진 문자는 보낸 사람(137), 보낸 것은 받는 사람(151)
    fun address(context: Context, id: Long, inbox: Boolean): String {
        context.contentResolver.query(
            Uri.parse("content://mms/$id/addr"), arrayOf("address", "type"), null, null, null,
        )?.use { c ->
            while (c.moveToNext()) {
                val type = c.getInt(1)
                if ((inbox && type == 137) || (!inbox && type == 151)) return c.getString(0) ?: ""
            }
        }
        return ""
    }
}
