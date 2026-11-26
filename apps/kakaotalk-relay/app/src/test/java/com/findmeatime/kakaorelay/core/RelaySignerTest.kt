package com.findmeatime.kakaorelay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The vectors are copied into PROTOCOL.md; the service tests assert the same.
class RelaySignerTest {
    @Test
    fun webhookKnownAnswer() {
        val body = """{"eventId":"486083133936417:1795662000123:0","roomId":"486083133936417","isGroup":false,"senderName":"Test Host","text":"hello","postedAt":"2026-11-26T03:00:00.123Z"}"""
        assertEquals(
            "83ea0d183792ab410a9b1795d8837af1c85087b3c04263f43d8358b7117a90e9",
            RelaySigner.sign("test-inbound-secret", "POST", "/kakaotalk/webhook", 1795662000, "00112233445566778899aabbccddeeff", body),
        )
    }

    @Test
    fun claimKnownAnswer() {
        assertEquals(
            "c7760506fd48489399251e46543b56529c93fc1a425b560bc9d46ac7e205e7a5",
            RelaySigner.sign(
                "test-outbox-secret", "post", "/kakaotalk/outbox/claim", 1795662000,
                "ffeeddccbbaa99887766554433221100", """{"postedRooms":["486083133936417"],"locked":false}""",
            ),
        )
    }

    @Test
    fun canonicalStringLayout() {
        assertEquals("POST\n/p\n12\nab\n{}", RelaySigner.canonical("post", "/p", 12, "ab", "{}"))
    }

    @Test
    fun signatureBindsThePath() {
        val a = RelaySigner.sign("s", "POST", "/kakaotalk/webhook", 1, "n", "{}")
        val b = RelaySigner.sign("s", "POST", "/kakaotalk/outbox/claim", 1, "n", "{}")
        assertNotEquals(a, b)
    }

    @Test
    fun nonceIs16BytesHex() {
        val nonce = RelaySigner.newNonce()
        assertTrue(nonce.matches(Regex("^[0-9a-f]{32}$")))
        assertNotEquals(nonce, RelaySigner.newNonce())
    }

    @Test
    fun headersCarryAllThree() {
        val h = RelaySigner.headers("s", "POST", "/kakaotalk/heartbeat", "{}", 1795662000, "00112233445566778899aabbccddeeff")
        assertEquals("1795662000", h[RelaySigner.HEADER_TIMESTAMP])
        assertEquals("00112233445566778899aabbccddeeff", h[RelaySigner.HEADER_NONCE])
        assertEquals(RelaySigner.sign("s", "POST", "/kakaotalk/heartbeat", 1795662000, "00112233445566778899aabbccddeeff", "{}"), h[RelaySigner.HEADER_SIGNATURE])
    }
}
