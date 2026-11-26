package com.findmeatime.kakaorelay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Fixtures follow the structure of the 2026-11-26 device dump (KakaoTalk
// 26.10.1) with made-up names, IDs and text.
class KakaoNotificationParserTest {
    private val secret = "test-inbound-secret"
    private val room = "486083133936417"

    private fun oneToOne(vararg messages: RawMessage) = RawNotification(
        packageName = "com.kakao.talk",
        tag = "448221044_$room",
        channelId = "new_message_v1",
        isGroupSummary = false,
        isMessagingStyle = true,
        isGroupConversation = false,
        conversationTitle = null,
        hasReplyInput = true,
        messages = messages.toList(),
        category = "msg",
        title = "Test Host",
        actionCount = 2,
        replyActionIndex = 1,
    )

    private fun group(vararg messages: RawMessage) = oneToOne(*messages).copy(isGroupConversation = true, conversationTitle = "Test group")

    private fun msg(text: String, ts: Long, sender: String? = "Test Host") = RawMessage(sender, text, ts)

    private fun events(n: RawNotification) = (KakaoNotificationParser.parse(n, secret) as ParseResult.Parsed).events

    @Test
    fun oneToOneMessageBecomesEvent() {
        val result = KakaoNotificationParser.parse(oneToOne(msg("hello", 1795662000123)), secret) as ParseResult.Parsed
        assertTrue(result.oneToOne)
        assertEquals(room, result.roomId)
        assertEquals(listOf(MessageEvent("$room:1795662000123:0", room, "Test Host", "hello", 1795662000123, false)), result.events)
    }

    @Test
    fun indexCountsMessagesSharingATimestamp() {
        val ids = events(oneToOne(msg("a", 100), msg("b", 100), msg("c", 200), msg("d", 100))).map { it.eventId }
        assertEquals(listOf("$room:100:0", "$room:100:1", "$room:200:0", "$room:100:2"), ids)
    }

    @Test
    fun updatedNotificationKeepsEarlierIds() {
        val first = events(oneToOne(msg("a", 100))).map { it.eventId }
        val second = events(oneToOne(msg("a", 100), msg("b", 150))).map { it.eventId }
        assertEquals(first, second.take(1))
        assertEquals("$room:150:0", second[1])
    }

    @Test
    fun messagesBeforeConfigurationAreNotForwarded() {
        val n = oneToOne(msg("old", 100), msg("old too", 200), msg("new", 300), msg("same ms", 300))
        val ids = (KakaoNotificationParser.parse(n, secret, notBeforeMillis = 300) as ParseResult.Parsed).events.map { it.eventId }
        // The cutoff is inclusive, and skipped messages keep later indexes stable.
        assertEquals(listOf("$room:300:0", "$room:300:1"), ids)
        val oldGroupCode = group(msg("FMAT-7K3Q9M2XWA", 100))
        assertTrue((KakaoNotificationParser.parse(oldGroupCode, secret, notBeforeMillis = 300) as ParseResult.Parsed).events.isEmpty())
    }

    @Test
    fun selfMessagesAreSkippedButKeepIndexes() {
        val n = oneToOne(msg("mine", 100, sender = null), msg("theirs", 100))
        assertEquals(listOf("$room:100:1"), events(n).map { it.eventId })
        val flagged = oneToOne(RawMessage("Relay", "mine", 100, isSelf = true), msg("theirs", 100))
        assertEquals(listOf("$room:100:1"), events(flagged).map { it.eventId })
    }

    @Test
    fun mediaIsMarkedNonText() {
        val e = events(oneToOne(RawMessage("Test Host", "", 100, hasMedia = true))).single() as MessageEvent
        assertTrue(e.nonText)
    }

    @Test
    fun groupTextNeverLeaves() {
        val result = KakaoNotificationParser.parse(group(msg("plain group text", 100)), secret) as ParseResult.Parsed
        assertFalse(result.oneToOne)
        assertTrue(result.events.isEmpty())
    }

    @Test
    fun groupCodeBecomesVoidCode() {
        val e = events(group(msg("내 코드FMAT-7k3q9m2xwa 입니다", 100))).single() as VoidCodeEvent
        assertEquals("void:$room:100:0:0", e.eventId)
        assertEquals("2a6f0e5c45fef716cd8c61d3ebfce454cb918bd2a0fccf178aa204356fa23fa2", e.codeHash)
    }

    @Test
    fun suspectedOpenChatIsTreatedAsGroup() {
        // Not 1:1 unless every signal holds: a conversation title, a missing
        // flag or another channel all keep text on the phone.
        val titled = oneToOne(msg("FMAT-7K3Q9M2XWA", 100)).copy(conversationTitle = "Open chat")
        val noFlag = oneToOne(msg("x", 100)).copy(isGroupConversation = null)
        val otherChannel = oneToOne(msg("x", 100)).copy(channelId = "open_chat_message")
        assertTrue(events(titled).single() is VoidCodeEvent)
        assertTrue(events(noFlag).isEmpty())
        assertTrue(events(otherChannel).isEmpty())
    }

    @Test
    fun anyOtherShapeIsNotOneToOne() {
        val base = oneToOne(msg("FMAT-7K3Q9M2XWA", 100))
        val variants = listOf(
            base.copy(category = "social"),
            base.copy(category = null),
            base.copy(actionCount = 3),
            base.copy(replyActionIndex = 0),
            base.copy(title = null),
            base.copy(title = "Someone else"),
            oneToOne(msg("FMAT-7K3Q9M2XWA", 100), msg("x", 101, sender = "Second person")),
        )
        for (v in variants) {
            val r = KakaoNotificationParser.parse(v, secret) as ParseResult.Parsed
            assertFalse(r.oneToOne)
            assertTrue(r.events.all { it is VoidCodeEvent })
        }
        assertTrue(KakaoNotificationParser.isOneToOne(base))
        // A notification with only the relay's own messages is not taken as 1:1.
        assertFalse(KakaoNotificationParser.isOneToOne(oneToOne(msg("mine", 100, sender = null))))
    }

    @Test
    fun ignoredNotifications() {
        fun reason(n: RawNotification) = (KakaoNotificationParser.parse(n, secret) as ParseResult.Ignored).reason
        val base = oneToOne(msg("x", 1))
        assertEquals("package", reason(base.copy(packageName = "com.example")))
        assertEquals("group_summary", reason(base.copy(isGroupSummary = true, channelId = "quiet_new_message", tag = null)))
        assertEquals("not_messaging_style", reason(base.copy(isMessagingStyle = false)))
        assertEquals("tag", reason(base.copy(tag = null)))
        assertEquals("tag", reason(base.copy(tag = "abc")))
        // 카카오계정 notices have only 읽음.
        assertEquals("no_reply_action", reason(base.copy(hasReplyInput = false)))
    }

    @Test
    fun roomIdFromTag() {
        assertEquals("486083133936417", KakaoNotificationParser.roomIdFromTag("448221044_486083133936417"))
        assertEquals(null, KakaoNotificationParser.roomIdFromTag("448221044"))
    }

    @Test
    fun linkCodesMatchTheServicePattern() {
        assertEquals(listOf("FMAT-7K3Q9M2XWA"), LinkCodes.find("fmat-7k3q9m2xwa"))
        assertEquals(listOf("FMAT-7K3Q9M2XWA"), LinkCodes.find("코드:FMAT-7K3Q9M2XWA."))
        // I, L, O and U are not in the alphabet; 9 or 11 characters do not match.
        assertTrue(LinkCodes.find("FMAT-7K3Q9M2XWI").isEmpty())
        assertTrue(LinkCodes.find("FMAT-7K3Q9M2XW").isEmpty())
        assertTrue(LinkCodes.find("FMAT-7K3Q9M2XWAB").isEmpty())
        assertTrue(LinkCodes.find("XFMAT-7K3Q9M2XWA").isEmpty())
        assertEquals(1, LinkCodes.find("FMAT-7K3Q9M2XWA fmat-7k3q9m2xwa").size)
    }
}
