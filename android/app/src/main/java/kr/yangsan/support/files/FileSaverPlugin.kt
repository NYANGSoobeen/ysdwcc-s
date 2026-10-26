package kr.yangsan.support.files

import android.Manifest
import android.content.ContentValues
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File

// 웹앱의 "저장" 버튼: 사진·파일을 폰의 Download 폴더에 바로 저장한다.
// 사진은 갤러리의 "Download" 앨범에 보인다. (앱 안 웹 화면은 브라우저처럼 다운로드를 받지 못해 따로 둔다.)
@CapacitorPlugin(
    name = "FileSaver",
    permissions = [
        // 안드로이드 9 이하만 필요 (10부터는 권한 없이 Download에 저장 가능)
        Permission(alias = "storage", strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE]),
    ],
)
class FileSaverPlugin : Plugin() {

    // { data: base64, name: "사진.jpg", mime: "image/jpeg" }
    @PluginMethod
    fun save(call: PluginCall) {
        if (call.getString("data").isNullOrEmpty()) {
            call.reject("저장할 내용이 없습니다.")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageResult")
            return
        }
        write(call)
    }

    @PermissionCallback
    private fun storageResult(call: PluginCall) {
        if (getPermissionState("storage") == PermissionState.GRANTED) write(call)
        else call.reject("저장 권한이 없습니다.", "NO_PERMISSION")
    }

    private fun write(call: PluginCall) {
        val name = safeName(call.getString("name") ?: "download")
        val mime = call.getString("mime") ?: "application/octet-stream"
        val bytes = Base64.decode(call.getString("data"), Base64.DEFAULT)
        execute {
            try {
                val saved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveToMediaStore(name, mime, bytes) else saveToFolder(name, mime, bytes)
                call.resolve(JSObject().put("name", saved))
            } catch (e: Exception) {
                call.reject("저장하지 못했습니다: ${e.message}")
            }
        }
    }

    private fun saveToMediaStore(name: String, mime: String, bytes: ByteArray): String {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("저장 위치를 만들지 못했습니다.")
        try {
            resolver.openOutputStream(uri)!!.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return name
    }

    @Suppress("DEPRECATION")
    private fun saveToFolder(name: String, mime: String, bytes: ByteArray): String {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.mkdirs()
        var file = File(dir, name)
        var n = 1
        while (file.exists()) {
            val dot = name.lastIndexOf('.')
            file = File(dir, if (dot > 0) "${name.substring(0, dot)} ($n)${name.substring(dot)}" else "$name ($n)")
            n++
        }
        file.writeBytes(bytes)
        // 갤러리와 파일 앱에 바로 보이게 알린다.
        MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mime), null)
        return file.name
    }

    private fun safeName(name: String) = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "download" }
}
