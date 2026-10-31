package kr.yangsan.support.phone

import android.content.Context
import android.database.Cursor
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

// 💬 삼성 메시지 채팅+(RCS) 내역을 직접 읽어 보기 (갤럭시 앱 1.6.5, 2026-10-31 사용자 요청 "삼성 채팅 메세지도 읽게 해줘").
// 채팅+는 안드로이드 공개 문자함(SMS/MMS)에 없다. 삼성 폰은 채팅+를 전화 저장소의 비공개 표("im" 등)에 두는 것으로 알려져 있어,
// 문자 읽기 권한으로 열리는 곳이 있는지 몇 군데를 차례로 열어 본다. 공식 방법이 아니라 폰·One UI 버전에 따라 막혀 있을 수 있다.
// 열리면 보낸 것·받은 것 모두 ✉️ 대화에 합친다(폰 안에서만, 서버에 안 올림). 안 열리면 지금처럼 알림에서 받은 글만(ChatListener).
// 점검(probe)은 열리는지·몇 줄인지·칸 이름만 돌려준다(글 내용은 안 보냄) → 설정 화면에서 복사해 개발자에게 보낸다.
object SamsungIm {
    private val CANDIDATES = listOf(
        "content://im/chat",
        "content://im/message",
        "content://im/messages",
        "content://com.samsung.rcs.im/chat",
        "content://com.samsung.rcs.im/message",
        "content://rcsim/chat",
        "content://mms-sms/im",
    )
    private val BODY = listOf("body", "text", "content", "message", "msg_body")
    private val DATE = listOf("date", "timestamp", "sent_time", "date_sent", "inserted_timestamp", "delivered_timestamp")
    private val ADDRESS = listOf("address", "remote_uri", "recipients", "sender", "normalized_sender", "from_address", "conversation_id")
    private val TYPE = listOf("type", "msg_box", "message_box", "box", "message_type")
    private val DIRECTION = listOf("direction", "is_outgoing", "outgoing")

    @Volatile private var working: String? = null
    @Volatile private var checked = false

    private fun col(c: Cursor, names: List<String>): Int {
        for (n in names) {
            val i = c.getColumnIndex(n)
            if (i >= 0) return i
        }
        return -1
    }

    // 설정 화면 점검: 주소마다 열림 여부·줄 수·칸 이름 (내용은 안 읽음)
    fun probe(ctx: Context): JSONArray {
        val out = JSONArray()
        for (u in CANDIDATES) {
            val o = JSONObject().put("uri", u)
            try {
                ctx.contentResolver.query(Uri.parse(u), null, null, null, null).use { c ->
                    if (c == null) {
                        o.put("ok", false).put("error", "없음")
                    } else {
                        o.put("ok", true).put("count", c.count).put("columns", JSONArray(c.columnNames.toList()))
                        o.put("usable", col(c, BODY) >= 0 && col(c, DATE) >= 0 && col(c, ADDRESS) >= 0)
                    }
                }
            } catch (e: Exception) {
                o.put("ok", false).put("error", (e.javaClass.simpleName + ": " + (e.message ?: "")).take(160))
            }
            out.put(o)
        }
        return out
    }

    // 읽을 수 있는 곳 (한 번 찾으면 기억)
    private fun source(ctx: Context): String? {
        if (checked) return working
        for (u in CANDIDATES) {
            try {
                ctx.contentResolver.query(Uri.parse(u), null, null, null, null).use { c ->
                    if (c != null && col(c, BODY) >= 0 && col(c, DATE) >= 0 && col(c, ADDRESS) >= 0) {
                        working = u
                    }
                }
            } catch (_: Exception) {
                // 막혀 있으면 다음
            }
            if (working != null) break
        }
        checked = true
        return working
    }

    fun available(ctx: Context) = source(ctx) != null

    private fun addressOf(raw: String) = Uri.decode(raw.removePrefix("tel:").substringBefore(";").substringBefore("@"))

    // 그 번호의 채팅+ (보낸 것·받은 것), 최신 limit개
    fun messages(ctx: Context, address: String, before: Long, limit: Int): List<JSONObject> {
        val u = source(ctx) ?: return emptyList()
        val key = OffDay.local(address)
        val out = ArrayList<JSONObject>()
        try {
            ctx.contentResolver.query(Uri.parse(u), null, null, null, null).use { c ->
                if (c == null) return emptyList()
                val iBody = col(c, BODY)
                val iDate = col(c, DATE)
                val iAddr = col(c, ADDRESS)
                val iType = col(c, TYPE)
                val iDir = col(c, DIRECTION)
                val iId = c.getColumnIndex("_id")
                // 끝(최신)에서부터 읽는다 (정렬 칸 이름을 몰라 직접)
                if (!c.moveToLast()) return emptyList()
                var scanned = 0
                do {
                    scanned += 1
                    val addr = OffDay.local(addressOf(c.getString(iAddr) ?: ""))
                    if (addr != key) continue
                    var date = c.getLong(iDate)
                    if (date in 1 until 100_000_000_000L) date *= 1000 // 초 단위
                    if (date >= before) continue
                    val mine = when {
                        iDir >= 0 -> c.getInt(iDir) == 1
                        iType >= 0 -> c.getInt(iType) != 1 // 문자함과 같은 뜻(1 = 받은 것)으로 짐작
                        else -> false
                    }
                    val text = c.getString(iBody).orEmpty()
                    if (text.isBlank()) continue
                    val id = if (iId >= 0) c.getLong(iId).toString() else "$date"
                    out.add(JSONObject().put("id", "i$id").put("text", text).put("date", date).put("mine", mine).put("rcs", true).put("im", true))
                    if (out.size >= limit) break
                } while (c.moveToPrevious() && scanned < 20_000)
            }
        } catch (_: Exception) {
            return emptyList()
        }
        return out
    }
}
