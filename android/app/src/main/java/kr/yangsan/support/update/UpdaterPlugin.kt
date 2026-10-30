package kr.yangsan.support.update

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// 📱 갤럭시 앱 업데이트 (1.3.2부터): 인터넷 앱·Download 폴더를 거치지 않고, 앱이 새 APK를 직접 받아
// 바로 안드로이드 설치 화면을 연다. 스토어 밖 앱이라 마지막 "설치"(처음 한 번은 "이 앱에서 설치 허용")는 사용자가 누른다.
// 받은 파일은 앱 전용 캐시에 두고 다음에 받을 때 덮어쓴다 (Download 폴더에 안 쌓임).
@CapacitorPlugin(name = "Updater")
class UpdaterPlugin : Plugin() {

    // 이 앱이 APK를 설치해도 되는지 (안드로이드 8+는 앱마다 "출처를 알 수 없는 앱 설치" 허용이 필요)
    @PluginMethod
    fun canInstall(call: PluginCall) {
        val ok = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()
        call.resolve(JSObject().put("allowed", ok))
    }

    // 허용 화면 열기 (돌아오면 웹앱이 canInstall을 다시 묻는다)
    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 26) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
        call.resolve()
    }

    // 받기 → 설치 화면. 받는 동안 "progress" {percent} 이벤트.
    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("주소가 없어요")
        Thread {
            try {
                val dir = File(context.cacheDir, "update").apply { mkdirs() }
                val file = File(dir, "yangsan-support.apk")
                var conn = URL(url).openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 15000
                conn.readTimeout = 30000
                // GitHub raw는 다른 주소로 넘겨 준다 (https → https는 저절로 따라가지만, 혹시 몰라 한 번 더)
                if (conn.responseCode in 300..399) {
                    val next = conn.getHeaderField("Location")
                    conn.disconnect()
                    conn = URL(next).openConnection() as HttpURLConnection
                }
                if (conn.responseCode != 200) throw Exception("받기 실패 (${conn.responseCode})")
                val total = conn.contentLengthLong
                var done = 0L
                var lastPercent = -1
                conn.inputStream.use { input ->
                    file.outputStream().use { output ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            done += n
                            if (total > 0) {
                                val p = (done * 100 / total).toInt()
                                if (p != lastPercent) {
                                    lastPercent = p
                                    notifyListeners("progress", JSObject().put("percent", p))
                                }
                            }
                        }
                    }
                }
                conn.disconnect()
                val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "받기 실패")
            }
        }.start()
    }
}
