package kr.yangsan.support.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kr.yangsan.support.MainActivity
import kr.yangsan.support.R
import kr.yangsan.support.phone.PhoneAlerts
import org.json.JSONArray

// 🔔 채팅·공지·프론트 채팅 푸시 (갤럭시 앱 1.8.0).
// 서버(functions/src/push.ts buildMessage)는 갤럭시 앱에 "데이터만" 보낸다 {title, body, url, tag, kind}
// → 앱이 꺼져 있어도 여기서 알림을 그린다(보고 있는 방은 안 띄움, 알림 방식은 웹앱이 정한 값).
// 같은 방(tag)의 알림은 하나로 묶어 최근 5줄을 보여 준다. 누르면 MainActivity가 "open" 주소로 그 방을 연다.
class ChatPush : FirebaseMessagingService() {
    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        val title = d["title"] ?: msg.notification?.title ?: return
        val body = d["body"] ?: msg.notification?.body ?: ""
        show(this, title, body, d["url"] ?: "/", d["tag"] ?: "chat", d["kind"] ?: "chat")
    }

    override fun onNewToken(token: String) {
        // 웹앱이 다음에 열릴 때 refreshPush가 새 토큰을 서버에 적는다.
        prefs(this).edit().putString("newToken", token).apply()
    }

    companion object {
        const val PREFS = "chat_push"
        const val CH_SOUND = "chat_sound"
        const val CH_QUIET = "chat_quiet"

        @Volatile var viewing: String? = null // 지금 보고 있는 방(알림 tag), 앱이 앞에 있을 때만 뜻이 있음

        fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun ready(ctx: Context) = FirebaseApp.getApps(ctx).isNotEmpty()

        private fun channels(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CH_SOUND, "채팅·공지 (소리)", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "새 채팅·나를 부른 말·공지·프론트 채팅"
                    setShowBadge(true)
                },
            )
            nm.createNotificationChannel(
                NotificationChannel(CH_QUIET, "채팅·공지 (조용히)", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "소리 없이 알림창·숫자만"
                    setShowBadge(true)
                },
            )
        }

        private fun id(tag: String) = 7000 + (tag.hashCode() and 0xffff)

        fun show(ctx: Context, title: String, body: String, url: String, tag: String, kind: String) {
            if (PhoneAlerts.foreground && viewing == tag) return
            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
            val mode = prefs(ctx).getString("sound", "sound") ?: "sound"
            channels(ctx)
            // 같은 방은 최근 5줄을 모아 보여 준다
            val key = "lines_$tag"
            val lines = try { JSONArray(prefs(ctx).getString(key, "[]")) } catch (_: Exception) { JSONArray() }
            lines.put(body.take(300))
            while (lines.length() > 5) lines.remove(0)
            prefs(ctx).edit().putString(key, lines.toString()).apply()
            val style = NotificationCompat.InboxStyle().setBigContentTitle(title)
            for (i in 0 until lines.length()) style.addLine(lines.getString(i))
            val open = Intent(ctx, MainActivity::class.java)
                .setAction("kr.yangsan.support.PUSH_${id(tag)}")
                .putExtra("open", if (url.startsWith("/?")) url else "/")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val pi = PendingIntent.getActivity(ctx, id(tag), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(ctx, if (mode == "sound") CH_SOUND else CH_QUIET)
                .setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(if (lines.length() > 1) style else NotificationCompat.BigTextStyle().bigText(body))
                .setNumber(lines.length())
                .setCategory(if (kind == "notice") NotificationCompat.CATEGORY_SOCIAL else NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(if (mode == "sound") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW)
                .setSilent(mode != "sound")
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build()
            try {
                val nm = NotificationManagerCompat.from(ctx)
                nm.notify(tag, id(tag), n)
                // 🔇 무음(숫자만): 알림창은 바로 지운다 (웹과 같은 방식)
                if (mode == "badge") nm.cancel(tag, id(tag))
            } catch (_: SecurityException) {
                // 알림 권한이 없으면 조용히 넘어간다
            }
        }

        // 그 방을 보면 알림을 지운다 (모아 둔 줄도)
        fun clear(ctx: Context, tag: String) {
            NotificationManagerCompat.from(ctx).cancel(tag, id(tag))
            prefs(ctx).edit().remove("lines_$tag").apply()
        }
    }
}
