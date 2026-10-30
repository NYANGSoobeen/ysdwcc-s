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
        // 🌙 휴무일 자동 응답: 걸려 온 번호 알기
        Permission(alias = "phonestate", strings = [Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG]),
        // 🔔 전화·문자 알림 (1.4.0): 문자 받기 방송, 알림 띄우기(안드로이드 13+만 묻는 권한)
        Permission(alias = "smsnotify", strings = [Manifest.permission.RECEIVE_SMS]),
        Permission(alias = "notify", strings = ["android.permission.POST_NOTIFICATIONS"]),
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
                    // 삼성 앱에서 읽었으면 우리 알림도 지운다 (1.6.1)
                    Thread { PhoneAlerts.syncWithPhone(context) }.start()
                }, 400)
            }
        }
        val calls = observer("calls")
        val sms = observer("sms")
        try {
            context.contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, calls)
            context.contentResolver.registerContentObserver(Uri.parse("content://mms-sms/"), true, sms)
            context.contentResolver.registerContentObserver(Uri.parse("content://sms/"), true, sms)
            observers = listOf(calls, sms)
        } catch (_: Exception) {
            // 권한을 받기 전에는 등록이 안 될 수 있다 → 앱으로 돌아올 때 다시 등록
        }
        // 💬 채팅+(RCS)가 오면 (ChatListener.kt) 문자 목록을 새로 그리게
        ChatStore.onChange = { handler.post { notifyListeners("changed", JSObject().put("what", "sms")) } }
    }

    override fun handleOnDestroy() {
        observers.forEach { context.contentResolver.unregisterContentObserver(it) }
        observers = emptyList()
    }

    // 앱으로 돌아올 때마다 다시 등록 (설정에서 권한을 켜고 돌아온 경우, 등록이 풀린 경우) + 화면에 새로 읽으라고 알림
    override fun handleOnResume() {
        super.handleOnResume()
        handleOnDestroy()
        load()
        Thread { PhoneAlerts.syncWithPhone(context) }.start()
    }

    private fun granted(alias: String) = getPermissionState(alias) == PermissionState.GRANTED

    // 설치된 갤럭시 앱 버전 (웹앱이 "새 버전이 있어요" 띠를 띄울지 정한다, 1.3.1부터)
    @PluginMethod
    fun appInfo(call: PluginCall) {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
        call.resolve(JSObject().put("versionCode", code).put("versionName", info.versionName ?: ""))
    }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("calls", granted("calls"))
                .put("sms", granted("sms"))
                .put("contacts", granted("contacts"))
                .put("phonestate", granted("phonestate"))
                .put("chat", ChatStore.listenerEnabled(context)),
        )
    }

    // 💬 채팅+ 받기: "알림 접근" 설정 화면 (안드로이드 11+는 우리 앱 항목을 바로 연다)
    @PluginMethod
    fun openChatAccess(call: PluginCall) {
        val intent = if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ChatStore.componentName(context).flattenToString())
        } else {
            Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: Exception) {
            context.startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        call.resolve()
    }

    // 📝 받은 전화 끝나면 우리 앱을 바로 열기: "다른 앱 위에 표시" 권한 (1.6.0)
    @PluginMethod
    fun overlayStatus(call: PluginCall) {
        call.resolve(JSObject().put("granted", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context)))
    }

    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.fromParts("package", context.packageName, null))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: Exception) {
            openSettings(call)
            return
        }
        call.resolve()
    }

    @PluginMethod
    fun clearAfterCall(call: PluginCall) {
        PhoneAlerts.clearAfterCall(context)
        call.resolve()
    }

    // 지금 보고 있는 문자 대화 (그 대화의 우리 알림은 안 띄움)
    @PluginMethod
    fun alertsViewing(call: PluginCall) {
        PhoneAlerts.viewing = call.getString("number")
        call.resolve()
    }

    @PluginMethod
    fun requestCalls(call: PluginCall) = ask(call, "calls")

    @PluginMethod
    fun requestSms(call: PluginCall) = ask(call, "sms")

    @PluginMethod
    fun requestContacts(call: PluginCall) = ask(call, "contacts")

    @PluginMethod
    fun requestPhoneState(call: PluginCall) = ask(call, "phonestate")

    // ── 🌙 휴무일 자동 응답 (OffDay.kt) ──
    // { enabled, dates: ['2026-11-03'], numbers: ['+821012345678'], message }
    @PluginMethod
    fun offDayConfig(call: PluginCall) {
        val dates = call.getArray("dates", JSArray())!!
        val numbers = call.getArray("numbers", JSArray())!!
        OffDay.save(
            context,
            call.getBoolean("enabled", false)!!,
            (0 until dates.length()).map { dates.getString(it) },
            (0 until numbers.length()).map { numbers.getString(it) },
            call.getString("message", "")!!,
        )
        call.resolve()
    }

    @PluginMethod
    fun offDayStatus(call: PluginCall) {
        val log = OffDay.log(context)
        call.resolve(
            JSObject()
                .put("phonestate", granted("phonestate"))
                .put("sms", granted("sms"))
                .put("silence", OffDay.canSilence(context))
                .put("offToday", OffDay.isOffToday(context))
                .put("log", log),
        )
    }

    // ── 🔔 전화·문자 알림 (PhoneAlerts.kt) ──
    // { customers: { 번호: { n, c, o, x } }, sms, missed, caller }
    @PluginMethod
    fun alertsConfig(call: PluginCall) {
        PhoneAlerts.save(
            context,
            call.getObject("customers", JSObject())!!,
            call.getBoolean("sms", true)!!,
            call.getBoolean("missed", true)!!,
            call.getBoolean("caller", true)!!,
            call.getBoolean("personal", false)!!,
            call.getBoolean("memo", true)!!,
        )
        call.resolve()
    }

    @PluginMethod
    fun alertsStatus(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("notify", PhoneAlerts.canPost(context))
                .put("sms", granted("smsnotify"))
                .put("phonestate", granted("phonestate"))
                .put("chat", ChatStore.listenerEnabled(context)),
        )
    }


    // 알림·문자 받기·전화 상태 권한을 한 번에 묻는다 (안드로이드 13 미만은 알림 권한을 묻지 않음)
    @PluginMethod
    fun requestAlerts(call: PluginCall) {
        val aliases = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 33 && !granted("notify")) aliases.add("notify")
        if (!granted("smsnotify")) aliases.add("smsnotify")
        if (!granted("phonestate")) aliases.add("phonestate")
        if (aliases.isEmpty()) return alertsStatus(call)
        requestPermissionForAliases(aliases.toTypedArray(), call, "alertsResult")
    }

    @PermissionCallback
    private fun alertsResult(call: PluginCall) = alertsStatus(call)

    @PluginMethod
    fun clearAlerts(call: PluginCall) {
        PhoneAlerts.clear(context, call.getString("kind", "")!!, call.getString("number"))
        call.resolve()
    }

    // 로그아웃: 고객 정보와 알림을 지운다
    @PluginMethod
    fun alertsOff(call: PluginCall) {
        PhoneAlerts.clearAll(context)
        call.resolve()
    }

    // 방해 금지 접근 설정 (무음 모드로 바꾸려면 필요)
    @PluginMethod
    fun openDndSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

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
                    CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.NEW,
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
                                .put("duration", c.getLong(5))
                                // 부재중을 아직 안 봄 (삼성 전화 앱에서 보면 0이 된다)
                                .put("isNew", c.getInt(6) == 1),
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
                // MMS: 대화의 마지막이 사진 문자면 그것으로 바꾼다. 글·주소는 목록에 보일 대화만 아래에서 읽는다
                // (예전엔 사진 문자 대화마다 바로 두 번씩 더 읽어서, 광고 사진 문자가 많으면 목록이 느렸다).
                val mmsOf = HashMap<Long, Pair<Long, Boolean>>() // 대화 → (MMS id, 받은 것)
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
                                .put("address", cur?.getString("address") ?: "")
                                .put("text", "")
                                .put("date", date)
                                .put("mine", !inbox)
                            mmsOf[t] = Pair(id, inbox)
                        }
                    }
                }
                // 💬 채팅+(RCS): 번호가 같은 대화에 합치고, 없으면 "rcs:번호" 대화로 (ChatListener.kt)
                val byAddr = HashMap<String, JSObject>()
                latest.values.forEach { byAddr[OffDay.local(it.getString("address") ?: "")] = it }
                val chats = ChatStore.all(context)
                for (i in 0 until chats.length()) {
                    val o = chats.getJSONObject(i)
                    val a = o.optString("a")
                    val d = o.optLong("d")
                    var t = byAddr[a]
                    if (t == null) {
                        t = JSObject().put("threadId", "rcs:$a").put("address", a).put("text", "").put("date", 0L).put("mine", false)
                        byAddr[a] = t
                        latest[-(i + 1).toLong() - 1_000_000_000L] = t
                    }
                    if (t.getLong("date") <= d) t.put("text", o.optString("t")).put("date", d).put("mine", false).put("rcs", true)
                    if (o.optBoolean("u")) t.put("rcsUnread", t.optInt("rcsUnread") + 1)
                }
                val out = JSArray()
                val shown = latest.values.sortedByDescending { it.getLong("date") }.take(limit)
                // 보일 사진 문자들의 글을 한 번에 읽는다
                val texts = Mms.texts(context, shown.mapNotNull { mmsOf[it.getString("threadId")!!.toLong()]?.first })
                shown.forEach {
                    val t = it.getString("threadId")!!.toLongOrNull() ?: -1L
                    if (it.optBoolean("rcs")) mmsOf.remove(t)
                    mmsOf[t]?.let { (id, inbox) ->
                        if (it.getString("address").isNullOrEmpty()) it.put("address", Mms.address(context, id, inbox))
                        it.put("text", texts[id]?.takeIf { s -> s.isNotEmpty() } ?: "📷 사진")
                    }
                    it.put("unread", (unread[t] ?: 0) + it.optInt("rcsUnread"))
                    it.remove("rcsUnread")
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
        val rawId = call.getString("threadId").orEmpty()
        val address = call.getString("address") ?: rawId.removePrefix("rcs:").takeIf { rawId.startsWith("rcs:") }
        val threadId = rawId.toLongOrNull() ?: if (rawId.startsWith("rcs:")) -1L else return call.reject("대화가 없습니다.")
        val limit = call.getInt("limit", 200)!!
        val before = call.getLong("before", Long.MAX_VALUE)!!
        execute {
            try {
                val list = ArrayList<JSObject>()
                // 💬 채팅+(RCS) 받은 글 (ChatListener.kt), 본 것으로 표시
                if (!address.isNullOrBlank()) {
                    val key = OffDay.local(address)
                    val chats = ChatStore.all(context)
                    for (i in 0 until chats.length()) {
                        val o = chats.getJSONObject(i)
                        if (o.optString("a") != key || o.optLong("d") >= before) continue
                        list.add(JSObject().put("id", o.optString("id")).put("text", o.optString("t")).put("date", o.optLong("d")).put("mine", false).put("rcs", true))
                    }
                    ChatStore.markRead(context, address)
                }
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

    // 여러 사진 문자의 글을 한 번에: { MMS id → 글 }
    fun texts(context: Context, ids: List<Long>): Map<Long, String> {
        val out = HashMap<Long, StringBuilder>()
        ids.chunked(200).forEach { chunk ->
            if (chunk.isEmpty()) return@forEach
            context.contentResolver.query(
                Uri.parse("content://mms/part"), arrayOf("mid", "text"),
                "ct = 'text/plain' AND mid IN (${chunk.joinToString(",")})", null, null,
            )?.use { c -> while (c.moveToNext()) out.getOrPut(c.getLong(0)) { StringBuilder() }.append(c.getString(1) ?: "") }
        }
        return out.mapValues { it.value.toString() }
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
