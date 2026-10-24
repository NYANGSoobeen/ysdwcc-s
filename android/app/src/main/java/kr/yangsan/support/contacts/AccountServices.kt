package kr.yangsan.support.contacts

import android.accounts.AbstractAccountAuthenticator
import android.accounts.Account
import android.accounts.AccountAuthenticatorResponse
import android.app.Service
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.os.Bundle
import android.os.IBinder

// "지원팀" 연락처 계정을 폰에 등록하기 위한 최소한의 구성.
// 실제 동기화는 앱이 열려 있을 때 웹앱이 ContactsSyncPlugin.sync 로 한다. 여기서는 아무것도 하지 않는다.

class Authenticator(context: Context) : AbstractAccountAuthenticator(context) {
    override fun editProperties(r: AccountAuthenticatorResponse?, accountType: String?): Bundle? = null
    override fun addAccount(r: AccountAuthenticatorResponse?, accountType: String?, authTokenType: String?, features: Array<out String>?, options: Bundle?): Bundle? = null
    override fun confirmCredentials(r: AccountAuthenticatorResponse?, account: Account?, options: Bundle?): Bundle? = null
    override fun getAuthToken(r: AccountAuthenticatorResponse?, account: Account?, authTokenType: String?, options: Bundle?): Bundle? = null
    override fun getAuthTokenLabel(authTokenType: String?): String? = null
    override fun updateCredentials(r: AccountAuthenticatorResponse?, account: Account?, authTokenType: String?, options: Bundle?): Bundle? = null
    override fun hasFeatures(r: AccountAuthenticatorResponse?, account: Account?, features: Array<out String>?): Bundle? = null
}

class AuthenticatorService : Service() {
    private lateinit var authenticator: Authenticator
    override fun onCreate() {
        authenticator = Authenticator(this)
    }
    override fun onBind(intent: Intent?): IBinder? = authenticator.iBinder
}

class NoopSyncAdapter(context: Context) : AbstractThreadedSyncAdapter(context, true) {
    override fun onPerformSync(account: Account?, extras: Bundle?, authority: String?, provider: ContentProviderClient?, syncResult: SyncResult?) {}
}

class SyncService : Service() {
    private lateinit var adapter: NoopSyncAdapter
    override fun onCreate() {
        adapter = NoopSyncAdapter(applicationContext)
    }
    override fun onBind(intent: Intent?): IBinder? = adapter.syncAdapterBinder
}
