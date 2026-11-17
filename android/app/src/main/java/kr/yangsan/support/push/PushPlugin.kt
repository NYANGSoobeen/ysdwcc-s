package kr.yangsan.support.push

import android.Manifest
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.firebase.messaging.FirebaseMessaging

// 웹앱(src/push.ts)이 쓰는 채팅 푸시 다리 (갤럭시 앱 1.8.0, 플러그인 이름 "Push").
@CapacitorPlugin(
    name = "Push",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class PushPlugin : Plugin() {
    private fun allowed() = NotificationManagerCompat.from(context).areNotificationsEnabled()

    // available: google-services.json을 넣어 만든 앱인지, permission: 알림 허용 여부
    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("available", ChatPush.ready(context))
                .put("permission", allowed())
                .put("asked", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") != PermissionState.PROMPT),
        )
    }

    // 알림 허용을 묻고(안드로이드 13+) FCM 토큰을 돌려준다
    @PluginMethod
    fun token(call: PluginCall) {
        if (!ChatPush.ready(context)) return call.reject("이 갤럭시 앱은 채팅 알림을 받을 수 없어요. 앱을 업데이트해 주세요.")
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            return requestPermissionForAlias("notifications", call, "afterPermission")
        }
        fetchToken(call)
    }

    @PermissionCallback
    private fun afterPermission(call: PluginCall) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            return call.reject("알림이 허용되지 않았어요. 설정 → 애플리케이션 → 양산동원로얄CC지원팀 → 알림에서 허용해 주세요.")
        }
        fetchToken(call)
    }

    private fun fetchToken(call: PluginCall) {
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { call.resolve(JSObject().put("token", it)) }
            .addOnFailureListener { call.reject("알림 등록에 실패했어요: ${it.message}") }
    }

    @PluginMethod
    fun deleteToken(call: PluginCall) {
        if (!ChatPush.ready(context)) return call.resolve()
        FirebaseMessaging.getInstance().deleteToken()
            .addOnCompleteListener { call.resolve() }
    }

    // 🔔 소리+알림창 / 🔕 소리 없이 / 🔇 무음(숫자만)
    @PluginMethod
    fun setSound(call: PluginCall) {
        ChatPush.prefs(context).edit().putString("sound", call.getString("mode") ?: "sound").apply()
        call.resolve()
    }

    // 지금 보고 있는 방(tag). 그 방 알림은 안 띄우고 이미 뜬 것은 지운다.
    @PluginMethod
    fun viewing(call: PluginCall) {
        val tag = call.getString("tag")
        ChatPush.viewing = tag
        if (!tag.isNullOrEmpty()) ChatPush.clear(context, tag)
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        call.getString("tag")?.let { ChatPush.clear(context, it) }
        call.resolve()
    }

    // 🔔 이 기기에서 테스트
    @PluginMethod
    fun test(call: PluginCall) {
        ChatPush.show(context, "🔔 테스트 알림", "이 기기에서 알림이 잘 보여요.", "/", "test", "chat")
        call.resolve()
    }
}
