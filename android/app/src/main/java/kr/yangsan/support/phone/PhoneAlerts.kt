package kr.yangsan.support.phone

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kr.yangsan.support.MainActivity
import kr.yangsan.support.R
import org.json.JSONArray
import org.json.JSONObject

// 🔔 전화·문자 알림 (갤럭시 앱 1.4.0). 삼성 기본 전화·메시지 앱 알림은 그대로 두고, 우리 앱도 알림을 띄워
// 누르면 우리 앱의 그 화면(✉️ 문자 대화, 📞 최근기록, 📇 고객)이 열리게 한다. 소리는 삼성 앱이 내므로 우리 알림은 조용히.
//   1) 문자가 오면: "이름(또는 [업무] 고객 이름) · 내용" → ✉️ 그 대화 (앱을 보고 있을 때는 안 띄움)
//   2) 부재중 전화: "부재중 전화 N통 · 이름" → 📞 최근기록 (거절한 전화는 빼려고 통화 기록으로 확인)
//   3) 고객 전화가 울릴 때: "📞 [업무] 이름 · 회사 · 다음 연락" 띠 → 📇 그 고객 (통화가 끝나면 사라짐)
// 고객 정보(번호 → 이름·회사·다음 연락)는 웹앱이 PhonePlugin.alertsConfig로 넣어 주고 이 폰에만 둔다.
// 문자 내용·통화 기록은 서버에 올리지 않는다 (CLAUDE.md 데이터 저장 규칙).
object PhoneAlerts {
    private const val PREFS = "phone_alerts"
    // 1.5.0: 앱 아이콘 빨간 숫자는 업무(고객) 문자만 세도록 채널을 새로 만든다 (채널 설정은 만든 뒤 못 바꿈)
    private const val CH_SMS = "sms_work"
    // 1.5.1: "개인 문자도 세기"를 켰을 때 개인 문자 알림 (앱 아이콘 숫자에 들어감)
    private const val CH_SMS_PERSONAL = "sms_personal"
    private const val CH_MISSED = "missed2"
    private const val CH_CALLER = "caller2"
    private val OLD_CHANNELS = listOf("sms", "missed", "caller")
    private const val ID_CALLER = 1001
    private const val ID_MISSED = 1002
    private const val ID_AFTER = 1003

    // 우리 앱 화면이 앞에 있으면 문자·부재중 알림은 띄우지 않는다 (앱 안 빨간 숫자로 보임)
    @Volatile var foreground = false
    // 지금 우리 앱에서 보고 있는 문자 대화 번호 (그 대화의 알림은 안 띄움)
    @Volatile var viewing: String? = null

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // { customers: { "01012345678": { n: 이름, c: 회사, x: 다음 연락 } }, sms, missed, caller }
    fun save(ctx: Context, customers: JSONObject, sms: Boolean, missed: Boolean, caller: Boolean, personal: Boolean, memo: Boolean) {
        prefs(ctx).edit()
            .putString("customers", customers.toString())
            .putBoolean("sms", sms)
            .putBoolean("missed", missed)
            .putBoolean("caller", caller)
            .putBoolean("personal", personal)
            .putBoolean("memo", memo)
            .apply()
    }

    fun clearAll(ctx: Context) {
        prefs(ctx).edit().clear().apply()
        ChatStore.clear(ctx)
        NotificationManagerCompat.from(ctx).cancelAll()
    }

    fun canPost(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    private fun on(ctx: Context, kind: String) = prefs(ctx).getBoolean(kind, false)

    private fun customer(ctx: Context, number: String): JSONObject? = try {
        JSONObject(prefs(ctx).getString("customers", "{}") ?: "{}").optJSONObject(OffDay.local(number))
    } catch (_: Exception) {
        null
    }

    // "[업무] 이름" 알림 제목 → 고객 번호 (같은 이름 고객이 둘 이상이면 모름)
    fun customerNumber(ctx: Context, name: String): String? = try {
        val all = JSONObject(prefs(ctx).getString("customers", "{}") ?: "{}")
        val hits = all.keys().asSequence().filter { all.optJSONObject(it)?.optString("n") == name }.toList()
        hits.singleOrNull()
    } catch (_: Exception) {
        null
    }

    fun isCustomer(ctx: Context, number: String) = customer(ctx, number) != null

    // 알림에 보일 이름: 고객이면 "[업무] 이름", 아니면 폰 연락처 이름, 없으면 번호
    fun nameFor(ctx: Context, number: String): String {
        customer(ctx, number)?.optString("n")?.takeIf { it.isNotBlank() }?.let { return "[업무] $it" }
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            try {
                ctx.contentResolver.query(
                    Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)),
                    arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null,
                )?.use { c -> if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() }?.let { return it } }
            } catch (_: Exception) {
                // 번호로 보인다
            }
        }
        return format(number)
    }

    private fun format(number: String): String {
        val d = OffDay.local(number)
        return when {
            d.length == 11 -> "${d.substring(0, 3)}-${d.substring(3, 7)}-${d.substring(7)}"
            d.length == 10 && d.startsWith("02") -> "02-${d.substring(2, 6)}-${d.substring(6)}"
            d.length == 10 -> "${d.substring(0, 3)}-${d.substring(3, 6)}-${d.substring(6)}"
            else -> number
        }
    }

    private fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        fun ch(id: String, name: String, importance: Int, badge: Boolean) =
            NotificationChannel(id, name, importance).apply { setSound(null, null); enableVibration(false); setShowBadge(badge) }
        OLD_CHANNELS.forEach { nm.deleteNotificationChannel(it) }
        nm.createNotificationChannel(ch(CH_SMS, "업무 문자", NotificationManager.IMPORTANCE_DEFAULT, true))
        nm.createNotificationChannel(ch(CH_SMS_PERSONAL, "개인 문자", NotificationManager.IMPORTANCE_DEFAULT, true))
        nm.createNotificationChannel(ch(CH_MISSED, "부재중 전화", NotificationManager.IMPORTANCE_DEFAULT, false))
        nm.createNotificationChannel(ch(CH_CALLER, "고객 전화 정보", NotificationManager.IMPORTANCE_HIGH, false))
    }

    // 알림을 누르면 우리 앱을 열고 그 화면으로 (MainActivity가 "open" 값을 웹앱 주소로 넘김)
    private fun open(ctx: Context, path: String, code: Int): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .setAction("kr.yangsan.support.OPEN_$code")
            .putExtra("open", path)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun post(ctx: Context, id: Int, build: NotificationCompat.Builder) {
        if (!canPost(ctx)) return
        channels(ctx)
        try {
            NotificationManagerCompat.from(ctx).notify(id, build.build())
        } catch (_: SecurityException) {
            // 알림 권한이 없으면 조용히 넘어간다
        }
    }

    private fun smsId(number: String) = 3000 + (OffDay.local(number).hashCode() and 0xffff)

    // ── 1) 문자 ──
    // 업무(고객) 문자만 알린다 (2026-10-30 사용자 요청: 개인 연락은 빼고 업무 연락만 앱 아이콘 숫자로).
    // 개인 문자는 삼성 메시지 알림이 그대로 온다. 앱을 보고 있어도 띄워 숫자를 올리되, 그 대화를 보고 있으면 안 띄운다.
    fun onSms(ctx: Context, address: String, body: String) {
        val work = isCustomer(ctx, address)
        // 개인 문자는 "개인 문자도 세기"를 켰을 때만 (사용자 요청: 선택적으로)
        if (!on(ctx, "sms") || address.isBlank() || (!work && !on(ctx, "personal"))) return
        if (foreground && viewing?.let { OffDay.local(it) == OffDay.local(address) } == true) return
        val key = "sms_" + OffDay.local(address)
        val lines = try { JSONArray(prefs(ctx).getString(key, "[]")) } catch (_: Exception) { JSONArray() }
        if (lines.length() > 0 && lines.getString(lines.length() - 1) == body.take(300)) return
        lines.put(body.take(300))
        while (lines.length() > 5) lines.remove(0)
        prefs(ctx).edit().putString(key, lines.toString()).apply()
        val name = nameFor(ctx, address)
        val style = NotificationCompat.InboxStyle().setBigContentTitle(name)
        for (i in 0 until lines.length()) style.addLine(lines.getString(i))
        post(
            ctx, smsId(address),
            NotificationCompat.Builder(ctx, if (work) CH_SMS else CH_SMS_PERSONAL)
                .setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle(name)
                .setContentText(body)
                .setStyle(if (lines.length() > 1) style else NotificationCompat.BigTextStyle().bigText(body))
                .setNumber(lines.length())
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setSilent(true)
                .setAutoCancel(true)
                .setContentIntent(open(ctx, "/?sms=" + Uri.encode(address), smsId(address))),
        )
    }

    // ── 2·3) 전화 ──
    fun onRinging(ctx: Context, number: String?) {
        val p = prefs(ctx)
        if (p.getLong("ring_at", 0) == 0L || System.currentTimeMillis() - p.getLong("ring_at", 0) > 120_000) {
            p.edit().putLong("ring_at", System.currentTimeMillis()).putBoolean("offhook", false).apply()
        }
        if (number.isNullOrBlank()) return
        p.edit().putString("ring_number", number).apply()
        val c = customer(ctx, number) ?: return
        if (!on(ctx, "caller")) return
        val info = listOf(c.optString("c"), c.optString("o")).filter { it.isNotBlank() }.joinToString(" · ")
        val next = c.optString("x")
        val text = listOf(info, if (next.isNotBlank()) "다음 연락: $next" else "").filter { it.isNotBlank() }.joinToString("\n")
        post(
            ctx, ID_CALLER,
            NotificationCompat.Builder(ctx, CH_CALLER)
                .setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle("📞 [업무] ${c.optString("n")}")
                .setContentText(text.ifBlank { "고객 전화" })
                .setStyle(NotificationCompat.BigTextStyle().bigText(text.ifBlank { "고객 전화" }))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setSilent(true)
                .setOngoing(true)
                .setTimeoutAfter(120_000)
                .setContentIntent(open(ctx, "/?customer=" + Uri.encode(number), ID_CALLER)),
        )
    }

    fun onOffhook(ctx: Context) {
        prefs(ctx).edit().putBoolean("offhook", true).apply()
    }

    // 통화가 끝남: 고객 띠를 내리고, 받지 않은 전화였으면 통화 기록에서 부재중인지 확인해 알린다.
    fun onIdle(ctx: Context, done: () -> Unit) {
        NotificationManagerCompat.from(ctx).cancel(ID_CALLER)
        val p = prefs(ctx)
        val ringAt = p.getLong("ring_at", 0)
        val answered = p.getBoolean("offhook", false)
        val ringNumber = p.getString("ring_number", null)
        p.edit().remove("ring_at").remove("ring_number").remove("offhook").apply()
        // 받은 전화를 끊으면 바로 메모 (1.6.0): 고객이거나 모르는 번호일 때 우리 앱을 앞으로 (폰 연락처에 있는 개인 번호는 그대로)
        if (ringAt != 0L && answered) {
            if (!ringNumber.isNullOrBlank() && on(ctx, "memo")) afterCall(ctx, ringNumber)
            return done()
        }
        if (ringAt == 0L || answered || !on(ctx, "missed")) return done()
        // 통화 기록에 적히기까지 조금 걸린다 (폰마다 달라 2.5초 → 5초 → 9초에 다시 본다)
        Thread {
            try {
                for (wait in listOf(2500L, 2500L, 4000L)) {
                    Thread.sleep(wait)
                    if (checkMissed(ctx, ringAt - 10_000)) break
                }
            } catch (_: Exception) {
            } finally {
                done()
            }
        }.start()
    }

    // 통화 기록에 이번 통화가 적혀 있으면 true (부재중이면 알림). 아직 안 적혔으면 false → 조금 뒤 다시.
    // 1.5.2: 예전엔 우리 앱이 앞에 있으면 안 띄웠는데, 부재중 뒤 통화 화면이 닫히면서 우리 앱이 다시 앞으로 오는 경우가 많아
    // 알림이 거의 안 떴다 → 늘 띄운다 (📞 최근기록을 보면 지워짐).
    private fun checkMissed(ctx: Context, since: Long): Boolean {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return true
        var found = false
        var number: String? = null
        ctx.contentResolver.query(
            CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE),
            "${CallLog.Calls.DATE} > ?", arrayOf(since.toString()), "${CallLog.Calls.DATE} DESC",
        )?.use { c ->
            if (c.moveToFirst()) {
                found = true
                if (c.getInt(1) == CallLog.Calls.MISSED_TYPE) number = c.getString(0) ?: ""
            }
        }
        val n = number ?: return found
        val p = prefs(ctx)
        val names = try { JSONArray(p.getString("missed_names", "[]")) } catch (_: Exception) { JSONArray() }
        val name = if (n.isBlank()) "발신자 정보 없음" else nameFor(ctx, n)
        names.put(name)
        while (names.length() > 5) names.remove(0)
        val count = p.getInt("missed_count", 0) + 1
        p.edit().putString("missed_names", names.toString()).putInt("missed_count", count).apply()
        val style = NotificationCompat.InboxStyle().setBigContentTitle("부재중 전화 ${count}통")
        for (i in names.length() - 1 downTo 0) style.addLine(names.getString(i))
        post(
            ctx, ID_MISSED,
            NotificationCompat.Builder(ctx, CH_MISSED)
                .setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle(if (count > 1) "부재중 전화 ${count}통" else "부재중 전화")
                .setContentText(name)
                .setStyle(style)
                .setNumber(count)
                .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                .setSilent(true)
                .setAutoCancel(true)
                .setContentIntent(open(ctx, "/?calls=missed", ID_MISSED)),
        )
        return true
    }

    // 받은 전화가 끝남 → "다른 앱 위에 표시"를 허용했으면 우리 앱을 바로 열고(메모 창은 웹앱이 통화 기록을 보고 띄움),
    // 아니면 눌러서 여는 알림(소리 없이 위에 잠깐 뜸). 우리 앱이 이미 앞에 있으면 웹앱이 알아서 띄우므로 아무것도 안 한다.
    private fun afterCall(ctx: Context, number: String) {
        if (foreground) return
        val work = isCustomer(ctx, number)
        if (!work && hasContactName(ctx, number)) return
        val path = "/?callend=" + Uri.encode(number)
        if (Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(ctx)) {
            try {
                ctx.startActivity(
                    Intent(ctx, MainActivity::class.java)
                        .setAction("kr.yangsan.support.CALLEND")
                        .putExtra("open", path)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                )
                return
            } catch (_: Exception) {
                // 막히면 아래 알림으로
            }
        }
        val title = if (work) "📝 ${nameFor(ctx, number)} 통화 메모" else "📝 모르는 번호 · ${format(number)}"
        post(
            ctx, ID_AFTER,
            NotificationCompat.Builder(ctx, CH_CALLER)
                .setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle(title)
                .setContentText(if (work) "방금 받은 전화 · 눌러서 메모 남기기" else "고객으로 저장할까요? 눌러서 정하기")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setSilent(true)
                .setAutoCancel(true)
                .setTimeoutAfter(10 * 60_000)
                .setContentIntent(open(ctx, path, ID_AFTER)),
        )
    }

    private fun hasContactName(ctx: Context, number: String): Boolean {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return false
        return try {
            ctx.contentResolver.query(
                Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)),
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null,
            )?.use { it.moveToFirst() } ?: false
        } catch (_: Exception) {
            false
        }
    }

    fun clearAfterCall(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID_AFTER)

    // 앱에서 그 화면을 보면 알림을 지운다
    fun clear(ctx: Context, kind: String, number: String?) {
        val nm = NotificationManagerCompat.from(ctx)
        val p = prefs(ctx)
        when (kind) {
            "missed" -> {
                nm.cancel(ID_MISSED)
                p.edit().remove("missed_count").remove("missed_names").apply()
            }
            "sms" -> if (!number.isNullOrBlank()) {
                nm.cancel(smsId(number))
                p.edit().remove("sms_" + OffDay.local(number)).apply()
            }
        }
    }
}

// 문자가 오면 (앱이 꺼져 있어도) 알림
class SmsAlertReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = try { Telephony.Sms.Intents.getMessagesFromIntent(intent) } catch (_: Exception) { null } ?: return
        if (parts.isEmpty()) return
        val address = parts[0].displayOriginatingAddress ?: parts[0].originatingAddress ?: return
        val body = parts.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
        PhoneAlerts.onSms(context, address, body)
    }
}
