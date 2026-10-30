package kr.yangsan.support

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.getcapacitor.BridgeActivity
import kr.yangsan.support.contacts.ContactsSyncPlugin
import kr.yangsan.support.files.FileSaverPlugin
import kr.yangsan.support.phone.PhoneAlerts
import kr.yangsan.support.phone.PhonePlugin
import kr.yangsan.support.update.UpdaterPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // 플러그인은 super.onCreate 전에 등록해야 웹앱에서 보인다.
        registerPlugin(ContactsSyncPlugin::class.java)
        registerPlugin(FileSaverPlugin::class.java)
        registerPlugin(PhonePlugin::class.java)
        registerPlugin(UpdaterPlugin::class.java)
        super.onCreate(savedInstanceState)
        openSharedText(intent)
        openFromAlert(intent, coldStart = true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openSharedText(intent)
        openFromAlert(intent, coldStart = false)
    }

    override fun onResume() {
        super.onResume()
        PhoneAlerts.foreground = true
    }

    override fun onPause() {
        super.onPause()
        PhoneAlerts.foreground = false
    }

    // 🔔 전화·문자 알림(PhoneAlerts.kt)을 누르면 "open" = "/?sms=번호" 같은 주소가 온다.
    // 앱이 꺼져 있었으면 그 주소로 웹앱을 열고, 열려 있으면 다시 불러오지 않고 웹앱에 알려 그 화면으로 간다(src/push.ts).
    private fun openFromAlert(intent: Intent?, coldStart: Boolean) {
        val path = intent?.getStringExtra("open") ?: return
        if (!path.startsWith("/?")) return
        intent.removeExtra("open") // 화면을 돌려도 다시 열지 않게
        val base = (bridge?.serverUrl ?: "https://ysdwcc-s.web.app").trimEnd('/')
        bridge?.webView?.post {
            if (coldStart) bridge?.webView?.loadUrl(base + path)
            else bridge?.webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('native-open', { detail: ${org.json.JSONObject.quote(path)} }))", null,
            )
        }
    }

    // 📝 통신사 앱(에이닷 등)에서 통화 요약을 "공유"로 보내면, 웹앱을 ?memo=요약 으로 열어 메모 창에 채운다 (src/sharedMemo.ts).
    private fun openSharedText(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        val title = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
        if (text.isEmpty() && title.isEmpty()) return
        intent.action = Intent.ACTION_MAIN // 화면을 돌려도 다시 열지 않게
        val base = (bridge?.serverUrl ?: "https://ysdwcc-s.web.app").trimEnd('/')
        val url = "$base/?memo=${Uri.encode(text.take(4000))}&memo_title=${Uri.encode(title.take(200))}"
        bridge?.webView?.post { bridge?.webView?.loadUrl(url) }
    }
}
