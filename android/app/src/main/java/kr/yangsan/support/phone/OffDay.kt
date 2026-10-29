package kr.yangsan.support.phone

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.telephony.SmsManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 🌙 휴무일 자동 응답 (갤럭시 앱 1.3.0).
// 근무표(웹앱 📋 근무표)에서 내가 "휴"인 날, 업무 고객 번호로 전화가 오면
//   1) 벨을 무음으로 (방해 금지 접근을 허용했으면 무음 모드로, 통화가 끝나면 원래대로)
//   2) 내가 정한 문구로 그 번호에 문자를 보낸다 (전화 올 때마다)
// 설정(휴무 날짜, 고객 번호, 문구)은 웹앱이 PhonePlugin.offDayConfig로 넣어 주고 이 폰에만 둔다.
// 앱이 꺼져 있어도 전화 상태 방송(PHONE_STATE)을 받아 동작한다. 개인 번호는 건드리지 않는다.
object OffDay {
    private const val PREFS = "offday"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // 번호를 국내 숫자로: +82 10-1234-5678 → 01012345678
    fun local(number: String): String {
        val d = number.filter { it.isDigit() }
        return if (d.startsWith("82") && d.length >= 10) "0" + d.substring(2) else d
    }

    fun save(ctx: Context, enabled: Boolean, dates: List<String>, numbers: List<String>, message: String) {
        prefs(ctx).edit()
            .putBoolean("enabled", enabled)
            .putStringSet("dates", dates.toSet())
            .putStringSet("numbers", numbers.map { local(it) }.filter { it.length >= 8 }.toSet())
            .putString("message", message)
            .apply()
    }

    fun isOffToday(ctx: Context): Boolean {
        val p = prefs(ctx)
        return p.getBoolean("enabled", false) && (p.getStringSet("dates", emptySet()) ?: emptySet()).contains(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))
    }

    fun isCustomer(ctx: Context, number: String) =
        (prefs(ctx).getStringSet("numbers", emptySet()) ?: emptySet()).contains(local(number))

    fun canSilence(ctx: Context): Boolean {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        return nm.isNotificationPolicyAccessGranted
    }

    fun log(ctx: Context): JSONArray = try {
        JSONArray(prefs(ctx).getString("log", "[]"))
    } catch (_: Exception) {
        JSONArray()
    }

    private fun addLog(ctx: Context, number: String, silenced: Boolean, sent: Boolean) {
        val list = log(ctx)
        val next = JSONArray()
        next.put(JSONObject().put("at", System.currentTimeMillis()).put("number", number).put("silenced", silenced).put("sent", sent))
        for (i in 0 until minOf(list.length(), 49)) next.put(list.get(i))
        prefs(ctx).edit().putString("log", next.toString()).apply()
    }

    fun onRinging(ctx: Context, number: String) {
        if (!isOffToday(ctx) || !isCustomer(ctx, number)) return
        val p = prefs(ctx)
        // 같은 전화로 방송이 두 번 오는 기기가 있어 15초 안 같은 번호는 한 번만
        val last = p.getString("last_number", "")
        if (last == local(number) && System.currentTimeMillis() - p.getLong("last_at", 0) < 15_000) return
        p.edit().putString("last_number", local(number)).putLong("last_at", System.currentTimeMillis()).apply()

        val silenced = silence(ctx)
        val sent = sendReply(ctx, number, p.getString("message", "") ?: "")
        addLog(ctx, number, silenced, sent)
    }

    // 무음: 방해 금지 접근이 있으면 무음 모드로 바꾸고 원래 모드를 기억한다. 없으면 벨소리 볼륨만 잠깐 끈다.
    private fun silence(ctx: Context): Boolean {
        val audio = ctx.getSystemService(AudioManager::class.java)
        val p = prefs(ctx)
        return try {
            if (canSilence(ctx)) {
                if (!p.contains("saved_ringer")) p.edit().putInt("saved_ringer", audio.ringerMode).apply()
                audio.ringerMode = AudioManager.RINGER_MODE_SILENT
            } else {
                audio.adjustStreamVolume(AudioManager.STREAM_RING, AudioManager.ADJUST_MUTE, 0)
                p.edit().putBoolean("muted_stream", true).apply()
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    // 통화가 끝나면(받았다 끊거나 끊어지면) 원래대로
    fun restore(ctx: Context) {
        val audio = ctx.getSystemService(AudioManager::class.java)
        val p = prefs(ctx)
        try {
            if (p.contains("saved_ringer") && canSilence(ctx)) audio.ringerMode = p.getInt("saved_ringer", AudioManager.RINGER_MODE_NORMAL)
            if (p.getBoolean("muted_stream", false)) audio.adjustStreamVolume(AudioManager.STREAM_RING, AudioManager.ADJUST_UNMUTE, 0)
        } catch (_: Exception) {
            // 되돌리지 못하면 사용자가 직접 소리를 켜야 한다
        }
        p.edit().remove("saved_ringer").remove("muted_stream").apply()
    }

    private fun sendReply(ctx: Context, number: String, message: String): Boolean {
        if (message.isBlank()) return false
        return try {
            val sms: SmsManager = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            sms.sendMultipartTextMessage(number, null, sms.divideMessage(message), null, null)
            true
        } catch (_: Exception) {
            false
        }
    }
}

class OffDayReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                // 번호는 통화 기록 권한이 있을 때만 들어온다 (없으면 null인 방송이 한 번 더 오지 않음)
                @Suppress("DEPRECATION")
                val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: return
                OffDay.onRinging(context, number)
            }
            TelephonyManager.EXTRA_STATE_IDLE -> OffDay.restore(context)
        }
    }
}
