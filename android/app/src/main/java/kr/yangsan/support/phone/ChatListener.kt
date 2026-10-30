package kr.yangsan.support.phone

import android.Manifest
import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// 💬 채팅+(RCS) 문자 받기 (갤럭시 앱 1.5.0, 2026-10-30).
// 삼성 메시지의 "채팅+"로 온 문자는 안드로이드 문자함(SMS/MMS)에 들어가지 않아 다른 앱이 읽을 수 없고, 문자 받기 방송도 오지 않는다.
// (실제 폰에서 확인: 삼성 메시지에 파란 말풍선 표시가 있는 대화가 우리 목록에서 빠졌다.)
// 그래서 사용자가 "알림 접근"을 허용하면, 삼성·구글 메시지 앱이 띄우는 알림에서 보낸 사람과 글을 읽어
// 이 폰 안(앱 전용 파일)에만 모아 두고 ✉️ 문자 목록·대화에 함께 보여 준다. 서버에는 올리지 않는다.
// 한계: 받은 채팅+만 (내가 삼성 앱에서 보낸 채팅+는 알림이 없어 못 봄), 알림에 보인 글만, 사진은 "📷 사진".
object ChatStore {
    private const val FILE = "rcs-chats.json"
    private const val MAX = 1000
    var onChange: (() -> Unit)? = null

    private fun file(ctx: Context) = File(ctx.filesDir, FILE)

    @Synchronized
    fun all(ctx: Context): JSONArray = try {
        JSONArray(file(ctx).takeIf { it.exists() }?.readText() ?: "[]")
    } catch (_: Exception) {
        JSONArray()
    }

    @Synchronized
    private fun save(ctx: Context, list: JSONArray) {
        try {
            file(ctx).writeText(list.toString())
        } catch (_: Exception) {
            // 저장하지 못하면 이번 글만 목록에 안 보인다
        }
    }

    @Synchronized
    fun add(ctx: Context, address: String, text: String, date: Long): Boolean {
        val list = all(ctx)
        val key = OffDay.local(address)
        // 같은 알림이 여러 번 올라와도(알림 갱신) 한 번만
        for (i in maxOf(0, list.length() - 50) until list.length()) {
            val o = list.getJSONObject(i)
            if (o.optString("a") == key && o.optString("t") == text && Math.abs(o.optLong("d") - date) < 120_000) return false
        }
        list.put(JSONObject().put("id", "r$date${text.hashCode() and 0xffff}").put("a", key).put("t", text).put("d", date).put("u", true))
        val trimmed = JSONArray()
        for (i in maxOf(0, list.length() - MAX) until list.length()) trimmed.put(list.get(i))
        save(ctx, trimmed)
        return true
    }

    // 그 번호의 채팅+를 이 앱에서 봤다 (안 읽은 수 지우기)
    @Synchronized
    fun markRead(ctx: Context, address: String) {
        val key = OffDay.local(address)
        val list = all(ctx)
        var changed = false
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            if (o.optString("a") == key && o.optBoolean("u")) {
                o.put("u", false)
                changed = true
            }
        }
        if (changed) save(ctx, list)
    }

    fun clear(ctx: Context) {
        file(ctx).delete()
    }

    fun listenerEnabled(ctx: Context) = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    fun componentName(ctx: Context) = ComponentName(ctx, ChatListener::class.java)
}

class ChatListener : NotificationListenerService() {
    private val apps = MESSAGING_APPS

    companion object {
        val MESSAGING_APPS = setOf("com.samsung.android.messaging", "com.google.android.apps.messaging")
        // 알림 접근이 켜져 있을 때만 살아 있다
        @Volatile private var instance: ChatListener? = null

        // 우리 앱에서 확인함 → 삼성 메시지(그 번호)·전화 앱(부재중)의 알림도 지운다 (1.6.1)
        fun cancelOthers(kind: String, number: String?) {
            val me = instance ?: return
            try {
                val active = me.activeNotifications ?: return
                when (kind) {
                    "sms" -> {
                        if (number.isNullOrBlank()) return
                        val key = OffDay.local(number)
                        val mine = active.filter { it.packageName in MESSAGING_APPS && it.notification.flags and Notification.FLAG_GROUP_SUMMARY == 0 }
                        val hit = mine.filter { sbn ->
                            val n = sbn.notification
                            val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
                            val person = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)?.messages?.lastOrNull()?.person
                            me.numberOf(person?.uri, person?.name?.toString() ?: title)?.let { OffDay.local(it) == key } == true
                        }
                        hit.forEach { me.cancelNotification(it.key) }
                        // 그 앱의 남은 알림이 없으면 묶음(요약) 알림도
                        hit.map { it.packageName }.toSet().forEach { pkg ->
                            if (mine.none { it.packageName == pkg && it !in hit }) {
                                active.filter { it.packageName == pkg && it.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0 }.forEach { me.cancelNotification(it.key) }
                            }
                        }
                    }
                    "missed" -> active
                        .filter { it.packageName != me.packageName && it.notification.category == Notification.CATEGORY_MISSED_CALL }
                        .forEach { me.cancelNotification(it.key) }
                }
            } catch (_: Exception) {
                // 못 지우면 그 앱 알림은 남는다
            }
        }
    }

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in apps) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        try {
            val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
            val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
            val messages = style?.messages?.takeLast(3).orEmpty()
            if (messages.isNotEmpty()) {
                for (m in messages) {
                    val person = m.person
                    if (person == null && style?.isGroupConversation == true) continue
                    val number = numberOf(person?.uri, person?.name?.toString() ?: title) ?: continue
                    take(number, m.text?.toString().orEmpty().ifBlank { "📷 사진" }, if (m.timestamp > 0) m.timestamp else sbn.postTime)
                }
            } else {
                val text = (n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
                val number = numberOf(null, title) ?: return
                if (text.isNotBlank()) take(number, text, sbn.postTime)
            }
        } catch (_: Exception) {
            // 알림 모양이 달라 읽지 못하면 넘어간다
        }
    }

    // 삼성 메시지 알림을 지우면(삼성 앱에서 읽음) 우리 알림도 지운다
    // 삼성 메시지·전화 앱에서 확인해 그 앱 알림이 사라지면 우리 알림도 지운다
    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        val n = sbn.notification ?: return
        if (sbn.packageName != packageName && n.category == Notification.CATEGORY_MISSED_CALL) {
            PhoneAlerts.clear(this, "missed", null, others = false)
            return
        }
        if (sbn.packageName !in apps) return
        val title = n.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val number = numberOf(null, title) ?: return
        // 삼성 앱에서 읽음 → 우리 목록의 채팅+ 안 읽은 표시도 지운다
        ChatStore.markRead(this, number)
        ChatStore.onChange?.invoke()
        PhoneAlerts.clear(this, "sms", number, others = false)
    }

    private fun take(number: String, text: String, date: Long) {
        // 보통 문자(SMS)면 이미 문자함에 있고 문자 받기 방송으로 알렸다 → 채팅+만 모은다
        if (inSmsBox(number, text, date)) return
        if (!ChatStore.add(this, number, text, date)) return
        PhoneAlerts.onSms(this, number, text)
        ChatStore.onChange?.invoke()
    }

    private fun inSmsBox(number: String, text: String, date: Long): Boolean {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return false
        return try {
            contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms.ADDRESS),
                "${Telephony.Sms.DATE} > ? AND ${Telephony.Sms.BODY} = ?", arrayOf((date - 180_000).toString(), text), null,
            )?.use { c ->
                var hit = false
                while (c.moveToNext()) if (OffDay.local(c.getString(0) ?: "") == OffDay.local(number)) hit = true
                hit
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    // 보낸 사람 번호 찾기: 알림 속 사람 주소(tel:) → 제목이 번호면 그대로 → "[업무] 이름"이면 우리 고객 이름 → 폰 연락처 이름
    fun numberOf(uri: String?, name: String): String? {
        uri?.takeIf { it.startsWith("tel:") }?.let { return Uri.decode(it.removePrefix("tel:")) }
        val digits = name.filter { it.isDigit() }
        if (digits.length >= 7 && name.count { it.isLetter() } == 0) return digits
        val clean = name.replace("[업무]", "").trim()
        if (clean.isEmpty()) return null
        PhoneAlerts.customerNumber(this, clean)?.let { return it }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return null
        return try {
            contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} = ? OR ${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} = ?", arrayOf(name, clean), null,
            )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        } catch (_: Exception) {
            null
        }
    }
}
