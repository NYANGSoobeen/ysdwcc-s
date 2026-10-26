package kr.yangsan.support

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import kr.yangsan.support.contacts.ContactsSyncPlugin
import kr.yangsan.support.files.FileSaverPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // 플러그인은 super.onCreate 전에 등록해야 웹앱에서 보인다.
        registerPlugin(ContactsSyncPlugin::class.java)
        registerPlugin(FileSaverPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
