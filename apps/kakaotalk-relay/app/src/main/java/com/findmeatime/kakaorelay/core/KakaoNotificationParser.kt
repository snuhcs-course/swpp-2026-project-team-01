package com.findmeatime.kakaorelay.core

// Turns one KakaoTalk notification into relay events (host-kakaotalk-channel
// design 1 and 3). The Android listener copies the fields it needs into
// RawNotification, so this file has no Android dependency and is unit-tested.
//
// Measured on KakaoTalk 26.10.1 (2026-11-26):
// - message notifications use MessagingStyle on channel `new_message_v1`,
//   category `msg`, tag `<accountId>_<roomId>`, actions 읽음 and 답장 (the
//   one with a RemoteInput);
// - `android.isGroupConversation` is false for 1:1 chats and true for groups;
// - group summaries (GROUP_SUMMARY, channel `quiet_new_message`, tag null) and
//   account notices (no RemoteInput) carry nothing to forward.
// Open chats were not measured. The relay therefore forwards text only when
// the notification matches that measured 1:1 shape exactly (see isOneToOne),
// and treats anything else as a group or open chat.

const val KAKAO_PACKAGE = "com.kakao.talk"
val ONE_TO_ONE_CHANNELS = setOf("new_message_v1")

data class RawMessage(
    // Null when the message is the relay account's own (MessagingStyle self).
    val senderName: String?,
    val text: String?,
    // Epoch milliseconds as the notification reports it.
    val timestamp: Long,
    val isSelf: Boolean = false,
    val hasMedia: Boolean = false,
)

data class RawNotification(
    val packageName: String,
    val tag: String?,
    val channelId: String?,
    val isGroupSummary: Boolean,
    val isMessagingStyle: Boolean,
    // Null when the extra is absent.
    val isGroupConversation: Boolean?,
    val conversationTitle: String?,
    val hasReplyInput: Boolean,
    val messages: List<RawMessage>,
    val category: String?,
    // EXTRA_TITLE; in a measured 1:1 notification, the sender's name.
    val title: String?,
    val actionCount: Int,
    // Index of the action with a RemoteInput, or -1.
    val replyActionIndex: Int,
)

sealed interface RelayEvent {
    val eventId: String
}

data class MessageEvent(
    override val eventId: String,
    val roomId: String,
    val senderName: String,
    val text: String,
    val postedAtMillis: Long,
    val nonText: Boolean,
) : RelayEvent

data class VoidCodeEvent(
    override val eventId: String,
    val codeHash: String,
) : RelayEvent

sealed interface ParseResult {
    data class Ignored(val reason: String) : ParseResult

    // oneToOne rooms may receive replies; others never do.
    data class Parsed(val roomId: String, val oneToOne: Boolean, val events: List<RelayEvent>) : ParseResult
}

object KakaoNotificationParser {
    private val TAG = Regex("^(\\d+)_(\\d+)$")

    fun roomIdFromTag(tag: String?): String? = tag?.let { TAG.matchEntire(it)?.groupValues?.get(2) }

    fun eventId(roomId: String, timestamp: Long, index: Int) = "$roomId:$timestamp:$index"

    // Only the exact measured 1:1 shape counts. Any other shape, which may be
    // an open chat we have not measured, sends code hashes only.
    fun isOneToOne(n: RawNotification): Boolean {
        val senders = n.messages.filter { !it.isSelf && it.senderName != null }.map { it.senderName }
        return n.isGroupConversation == false &&
            n.conversationTitle.isNullOrEmpty() &&
            n.channelId in ONE_TO_ONE_CHANNELS &&
            n.category == "msg" &&
            n.actionCount == 2 &&
            n.replyActionIndex == 1 &&
            !n.title.isNullOrEmpty() &&
            senders.isNotEmpty() &&
            senders.all { it == n.title }
    }

    // inboundSecret keys the void_code hash; see LinkCodes. Messages posted
    // before notBeforeMillis (the moment the relay was first configured for
    // its base URL) are never forwarded.
    fun parse(n: RawNotification, inboundSecret: String, notBeforeMillis: Long = 0): ParseResult {
        if (n.packageName != KAKAO_PACKAGE) return ParseResult.Ignored("package")
        if (n.isGroupSummary) return ParseResult.Ignored("group_summary")
        if (!n.isMessagingStyle) return ParseResult.Ignored("not_messaging_style")
        val roomId = roomIdFromTag(n.tag) ?: return ParseResult.Ignored("tag")
        if (!n.hasReplyInput) return ParseResult.Ignored("no_reply_action")

        val oneToOne = isOneToOne(n)
        val events = mutableListOf<RelayEvent>()
        // The index counts the messages in this notification that share a
        // timestamp, in notification order, so an updated notification keeps
        // each earlier message's ID.
        val seenPerTimestamp = HashMap<Long, Int>()
        for (message in n.messages) {
            val index = seenPerTimestamp.getOrDefault(message.timestamp, 0)
            seenPerTimestamp[message.timestamp] = index + 1
            if (message.isSelf || message.senderName == null) continue
            if (message.timestamp < notBeforeMillis) continue
            val id = eventId(roomId, message.timestamp, index)
            val text = message.text ?: ""
            if (oneToOne) {
                events += MessageEvent(id, roomId, message.senderName, text, message.timestamp, message.hasMedia)
            } else {
                // Group or open chat: no text leaves the phone, only code hashes.
                LinkCodes.find(text).forEachIndexed { k, code ->
                    events += VoidCodeEvent("void:$id:$k", LinkCodes.hash(inboundSecret, code))
                }
            }
        }
        return ParseResult.Parsed(roomId, oneToOne, events)
    }
}

object LinkCodes {
    // The service's LINK_CODE (lib/server/redaction.ts) with JavaScript's
    // ASCII-only \b spelled out, since Java's \b also treats Hangul as a word
    // character.
    private val CODE = Regex("(?<![A-Za-z0-9_])FMAT-[0-9A-HJKMNP-TV-Z]{10}(?![A-Za-z0-9_])", RegexOption.IGNORE_CASE)

    fun find(text: String): List<String> = CODE.findAll(text).map { it.value.uppercase() }.distinct().toList()

    // Lowercase hex HMAC-SHA256 of the upper-cased code under the inbound secret.
    fun hash(inboundSecret: String, code: String): String = RelaySigner.hmacHex(inboundSecret, code.uppercase())
}
