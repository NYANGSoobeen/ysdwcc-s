package kr.yangsan.support.contacts

import android.Manifest
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

// 웹앱이 부르는 "휴대폰 연락처에 고객 표시" 기능.
// 팀 고객을 폰 연락처의 "지원팀" 전용 계정에 넣어, 전화가 오면 삼성 전화 앱이 "[업무] 이름"을 보여 준다.
@CapacitorPlugin(
    name = "ContactsSync",
    permissions = [
        Permission(
            alias = "contacts",
            strings = [Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS],
        ),
    ],
)
class ContactsSyncPlugin : Plugin() {

    @PluginMethod
    fun status(call: PluginCall) {
        val granted = getPermissionState("contacts") == PermissionState.GRANTED
        val result = JSObject()
        result.put("available", true)
        result.put("permission", granted)
        result.put("count", if (granted) ContactsWriter(context).count() else 0)
        call.resolve(result)
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("permission", true))
        } else {
            requestPermissionForAlias("contacts", call, "permissionResult")
        }
    }

    @PermissionCallback
    private fun permissionResult(call: PluginCall) {
        call.resolve(JSObject().put("permission", getPermissionState("contacts") == PermissionState.GRANTED))
    }

    // contacts: [{ id, name, company, phones: [] }] — 이 목록과 똑같아지도록 추가, 수정, 삭제한다.
    @PluginMethod
    fun sync(call: PluginCall) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("연락처 권한이 없습니다.", "NO_PERMISSION")
            return
        }
        val list = call.getArray("contacts", JSArray()) ?: JSArray()
        val customers = (0 until list.length()).map { toCustomer(list.getJSONObject(it)) }
        execute {
            try {
                val result = ContactsWriter(context).sync(customers)
                call.resolve(
                    JSObject()
                        .put("added", result.added)
                        .put("updated", result.updated)
                        .put("removed", result.removed)
                        .put("count", customers.size),
                )
            } catch (e: Exception) {
                call.reject("연락처를 저장하지 못했습니다: ${e.message}", e)
            }
        }
    }

    // 로그아웃, 팀 제외, 끄기: 전용 계정째 지워 고객 연락처를 모두 없앤다.
    @PluginMethod
    fun clear(call: PluginCall) {
        execute {
            try {
                ContactsWriter(context).clear()
                call.resolve()
            } catch (e: Exception) {
                call.reject("연락처를 지우지 못했습니다: ${e.message}", e)
            }
        }
    }

    private fun toCustomer(json: JSONObject): Customer {
        val phones = json.optJSONArray("phones")
        return Customer(
            id = json.getString("id"),
            name = json.optString("name"),
            company = json.optString("company"),
            phones = if (phones == null) emptyList() else (0 until phones.length()).map { phones.getString(it) },
        )
    }
}
