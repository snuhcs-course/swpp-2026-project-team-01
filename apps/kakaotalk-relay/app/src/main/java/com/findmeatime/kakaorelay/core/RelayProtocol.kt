package com.findmeatime.kakaorelay.core

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// The JSON shapes on the wire. PROTOCOL.md is the readable copy; keep both in step.
object RelayProtocol {
    const val WEBHOOK_PATH = "/kakaotalk/webhook"
    const val CLAIM_PATH = "/kakaotalk/outbox/claim"
    const val HEARTBEAT_PATH = "/kakaotalk/heartbeat"

    fun resultPath(id: String) = "/kakaotalk/outbox/${encodeSegment(id)}/result"

    fun eventBody(event: RelayEvent): String = when (event) {
        is MessageEvent -> JSONObject()
            .put("eventId", event.eventId)
            .put("roomId", event.roomId)
            .put("isGroup", false)
            .put("senderName", event.senderName)
            .put("text", event.text)
            .put("postedAt", isoUtc(event.postedAtMillis))
            .also { if (event.nonText) it.put("nonText", true) }
            .toString()
        is VoidCodeEvent -> JSONObject()
            .put("kind", "void_code")
            .put("eventId", event.eventId)
            .put("codeHash", event.codeHash)
            .toString()
    }

    fun eventIdOf(body: String): String? = runCatching { JSONObject(body).optString("eventId").ifEmpty { null } }.getOrNull()

    fun claimBody(postedRooms: Collection<String>, replyableRooms: Collection<String>, locked: Boolean): String = JSONObject()
        .put("postedRooms", JSONArray(postedRooms.sorted()))
        .put("replyableRooms", JSONArray(replyableRooms.sorted()))
        .put("locked", locked)
        .toString()

    fun resultBody(leaseToken: String, outcome: Outcome): String = JSONObject()
        .put("leaseToken", leaseToken)
        .put("outcome", outcome.wire)
        .toString()

    fun heartbeatBody(h: Heartbeat): String = JSONObject()
        .put("listenerEnabled", h.listenerEnabled)
        .put("accessibilityEnabled", h.accessibilityEnabled)
        .put("locked", h.locked)
        .put("kakaoVersion", h.kakaoVersion ?: JSONObject.NULL)
        .put("postedRooms", JSONArray(h.postedRooms.sorted()))
        .put("replyableRooms", JSONArray(h.replyableRooms.sorted()))
        .toString()

    // A claim answer: 204 or an empty body means nothing to send. A body that
    // has an id and a lease token but is otherwise unusable comes back as
    // Malformed, so the relay can report `failed` and release the lease.
    fun parseClaim(status: Int, body: String?): ClaimParse {
        if (status == 204 || body.isNullOrBlank() || body.trim() == "null") return ClaimParse.Empty
        val json = runCatching { JSONObject(body) }.getOrNull() ?: return ClaimParse.Invalid
        if (json.length() == 0) return ClaimParse.Empty
        val id = json.optStringOrNull("id") ?: return ClaimParse.Invalid
        val leaseToken = json.optStringOrNull("leaseToken") ?: return ClaimParse.Invalid
        val text = json.optStringOrNull("text")
        val roomId = json.optStringOrNull("roomId")
        val displayName = json.optStringOrNull("displayName")
        val claim = when (json.optStringOrNull("mode")) {
            "reply" -> if (roomId != null && text != null) Claim(id, leaseToken, ClaimMode.REPLY, roomId, displayName, text) else null
            "nudge" -> if (displayName != null && text != null) Claim(id, leaseToken, ClaimMode.NUDGE, roomId, displayName, text) else null
            else -> null
        }
        return claim?.let { ClaimParse.Ok(it) } ?: ClaimParse.Malformed(id, leaseToken)
    }

    fun isoUtc(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(millis))

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (!has(key) || isNull(key)) null else (opt(key) as? String)

    private fun encodeSegment(s: String): String {
        val out = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xff
            if (c.toChar().isLetterOrDigit() && c < 0x80 || c.toChar() in "-._~") out.append(c.toChar())
            else out.append('%').append("0123456789ABCDEF"[c ushr 4]).append("0123456789ABCDEF"[c and 0x0f])
        }
        return out.toString()
    }
}

enum class ClaimMode { REPLY, NUDGE }

data class Claim(
    val id: String,
    val leaseToken: String,
    val mode: ClaimMode,
    val roomId: String?,
    val displayName: String?,
    val text: String,
)

sealed interface ClaimParse {
    data object Empty : ClaimParse
    data object Invalid : ClaimParse
    data class Ok(val claim: Claim) : ClaimParse
    data class Malformed(val id: String, val leaseToken: String) : ClaimParse
}

enum class Outcome(val wire: String) {
    ACCEPTED("accepted"),
    FAILED("failed"),
    UNCERTAIN("uncertain"),
    NOT_STARTED("not_started"),
}

data class Heartbeat(
    val listenerEnabled: Boolean,
    val accessibilityEnabled: Boolean,
    val locked: Boolean,
    val kakaoVersion: String?,
    val postedRooms: Collection<String>,
    val replyableRooms: Collection<String>,
)
