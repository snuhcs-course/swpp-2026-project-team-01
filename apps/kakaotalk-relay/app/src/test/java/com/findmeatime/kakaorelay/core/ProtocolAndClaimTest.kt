package com.findmeatime.kakaorelay.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolAndClaimTest {
    @Test
    fun messageEventShape() {
        val json = JSONObject(RelayProtocol.eventBody(MessageEvent("r:1795662000123:0", "r", "Test Host", "hi", 1795662000123, false)))
        assertEquals(setOf("eventId", "roomId", "isGroup", "senderName", "text", "postedAt"), json.keySet())
        assertEquals(false, json.getBoolean("isGroup"))
        assertEquals("2026-11-26T03:00:00.123Z", json.getString("postedAt"))
        val media = JSONObject(RelayProtocol.eventBody(MessageEvent("r:1:0", "r", "Test Host", "", 1, true)))
        assertTrue(media.getBoolean("nonText"))
    }

    @Test
    fun voidCodeShape() {
        val json = JSONObject(RelayProtocol.eventBody(VoidCodeEvent("void:r:1:0:0", "ab")))
        assertEquals(setOf("kind", "eventId", "codeHash"), json.keySet())
        assertEquals("void_code", json.getString("kind"))
    }

    @Test
    fun heartbeatShape() {
        val json = JSONObject(RelayProtocol.heartbeatBody(Heartbeat(true, false, true, null, listOf("2", "1"), listOf("3", "2", "1"))))
        assertEquals(setOf("listenerEnabled", "accessibilityEnabled", "locked", "kakaoVersion", "postedRooms", "replyableRooms"), json.keySet())
        assertTrue(json.isNull("kakaoVersion"))
        assertEquals("1", json.getJSONArray("postedRooms").getString(0))
        assertEquals(3, json.getJSONArray("replyableRooms").length())
    }

    @Test
    fun resultPathEncodesTheId() {
        assertEquals("/kakaotalk/outbox/3f2a-01/result", RelayProtocol.resultPath("3f2a-01"))
        assertEquals("/kakaotalk/outbox/a%2Fb/result", RelayProtocol.resultPath("a/b"))
    }

    @Test
    fun parseClaims() {
        assertEquals(ClaimParse.Empty, RelayProtocol.parseClaim(204, null))
        assertEquals(ClaimParse.Empty, RelayProtocol.parseClaim(200, ""))
        assertEquals(ClaimParse.Empty, RelayProtocol.parseClaim(200, "null"))
        assertEquals(ClaimParse.Invalid, RelayProtocol.parseClaim(200, "not json"))
        val reply = RelayProtocol.parseClaim(200, """{"id":"m1","leaseToken":"t","mode":"reply","roomId":"r","text":"hi"}""")
        assertEquals(ClaimParse.Ok(Claim("m1", "t", ClaimMode.REPLY, "r", null, "hi")), reply)
        val nudge = RelayProtocol.parseClaim(200, """{"id":"m2","leaseToken":"t","mode":"nudge","displayName":"Test Host","text":"$FIXED_NUDGE"}""")
        assertEquals(ClaimMode.NUDGE, (nudge as ClaimParse.Ok).claim.mode)
        assertEquals(ClaimParse.Malformed("m3", "t"), RelayProtocol.parseClaim(200, """{"id":"m3","leaseToken":"t","mode":"reply","text":"hi"}"""))
        assertEquals(ClaimParse.Malformed("m4", "t"), RelayProtocol.parseClaim(200, """{"id":"m4","leaseToken":"t","mode":"other","text":"hi"}"""))
    }

    private val claimReply = Claim("m1", "lease", ClaimMode.REPLY, "r", null, "private summary")
    private val claimNudge = Claim("m2", "lease", ClaimMode.NUDGE, null, "Test Host", FIXED_NUDGE)

    @Test
    fun replyOutcomes() {
        fun outcome(r: ReplyResult) = ClaimHandler({ _, _ -> r }, { _, _ -> error("no nudge") }, { false }).handle(claimReply)
        assertEquals(Outcome.ACCEPTED, outcome(ReplyResult.FIRED))
        assertEquals(Outcome.NOT_STARTED, outcome(ReplyResult.NOT_POSTED))
        assertEquals(Outcome.UNCERTAIN, outcome(ReplyResult.UNKNOWN))
    }

    @Test
    fun replyUsesOnlyTheRoomPath() {
        var nudged = false
        var repliedTo: String? = null
        ClaimHandler({ room, _ -> repliedTo = room; ReplyResult.FIRED }, { _, _ -> nudged = true; Outcome.ACCEPTED }, { false }).handle(claimReply)
        assertEquals("r", repliedTo)
        assertFalse(nudged)
    }

    @Test
    fun nudgeRefusesAnyOtherText() {
        var nudged = false
        val handler = ClaimHandler({ _, _ -> ReplyResult.FIRED }, { _, _ -> nudged = true; Outcome.ACCEPTED }, { false })
        assertEquals(Outcome.FAILED, handler.handle(claimNudge.copy(text = "Your meeting with Kim is at 3pm")))
        assertFalse(nudged)
        assertEquals(Outcome.ACCEPTED, handler.handle(claimNudge))
    }

    @Test
    fun lockedPhoneDoesNotStartANudge() {
        val handler = ClaimHandler({ _, _ -> ReplyResult.FIRED }, { _, _ -> error("must not run") }, { true })
        assertEquals(Outcome.NOT_STARTED, handler.handle(claimNudge))
    }

    private class FakeTransport(val claims: ArrayDeque<HttpResult?>, val results: ArrayDeque<Int?>) : OutboxTransport {
        val claimBodies = mutableListOf<String>()
        val reports = mutableListOf<Pair<String, String>>()
        override fun claim(body: String): HttpResult? { claimBodies += body; return claims.removeFirst() }
        override fun result(path: String, body: String): Int? { reports += path to body; return results.removeFirst() }
    }

    private fun cycle(t: FakeTransport, reply: ReplyResult = ReplyResult.FIRED, clock: () -> Long = { 0L }) = ClaimCycle(
        t,
        ClaimHandler({ _, _ -> reply }, { _, _ -> Outcome.FAILED }, { false }),
        { listOf("r") }, { listOf("r", "s") }, { false }, clock = clock, pause = {},
    )

    @Test
    fun claimSendsPostedRoomsAndReportsAccepted() {
        val t = FakeTransport(
            ArrayDeque(listOf(HttpResult(200, """{"id":"m1","leaseToken":"lease","mode":"reply","roomId":"r","text":"x"}"""))),
            ArrayDeque(listOf(200)),
        )
        assertEquals(CycleResult.Handled("m1", Outcome.ACCEPTED, true), cycle(t).runOnce())
        val claimBody = JSONObject(t.claimBodies.single())
        assertEquals("r", claimBody.getJSONArray("postedRooms").getString(0))
        assertEquals(2, claimBody.getJSONArray("replyableRooms").length())
        val (path, body) = t.reports.single()
        assertEquals("/kakaotalk/outbox/m1/result", path)
        assertEquals("lease", JSONObject(body).getString("leaseToken"))
        assertEquals("accepted", JSONObject(body).getString("outcome"))
    }

    @Test
    fun emptyClaimIsIdleAndErrorsAreErrors() {
        assertEquals(CycleResult.Idle, cycle(FakeTransport(ArrayDeque(listOf(HttpResult(204, null))), ArrayDeque())).runOnce())
        assertEquals(CycleResult.Error(401), cycle(FakeTransport(ArrayDeque(listOf(HttpResult(401, ""))), ArrayDeque())).runOnce())
        assertEquals(CycleResult.Error(null), cycle(FakeTransport(ArrayDeque(listOf(null)), ArrayDeque())).runOnce())
    }

    @Test
    fun notPostedReportsNotStarted() {
        val t = FakeTransport(
            ArrayDeque(listOf(HttpResult(200, """{"id":"m1","leaseToken":"lease","mode":"reply","roomId":"r","text":"x"}"""))),
            ArrayDeque(listOf(200)),
        )
        cycle(t, ReplyResult.NOT_POSTED).runOnce()
        assertEquals("not_started", JSONObject(t.reports.single().second).getString("outcome"))
    }

    @Test
    fun malformedClaimReportsFailed() {
        val t = FakeTransport(ArrayDeque(listOf(HttpResult(200, """{"id":"m9","leaseToken":"lease","mode":"reply"}"""))), ArrayDeque(listOf(200)))
        assertEquals(CycleResult.Handled("m9", Outcome.FAILED, true), cycle(t).runOnce())
    }

    @Test
    fun reportRetriesOnServerErrorsAndStopsOnRefusal() {
        val retried = FakeTransport(
            ArrayDeque(listOf(HttpResult(200, """{"id":"m1","leaseToken":"lease","mode":"reply","roomId":"r","text":"x"}"""))),
            ArrayDeque(listOf(null, 503, 200)),
        )
        assertEquals(CycleResult.Handled("m1", Outcome.ACCEPTED, true), cycle(retried).runOnce())
        assertEquals(3, retried.reports.size)

        val refused = FakeTransport(
            ArrayDeque(listOf(HttpResult(200, """{"id":"m1","leaseToken":"stale","mode":"reply","roomId":"r","text":"x"}"""))),
            ArrayDeque(listOf(409)),
        )
        assertEquals(CycleResult.Handled("m1", Outcome.ACCEPTED, false), cycle(refused).runOnce())
        assertEquals(1, refused.reports.size)
    }

    @Test
    fun reportGivesUpBeforeTheLeaseEnds() {
        var now = 0L
        val t = FakeTransport(
            ArrayDeque(listOf(HttpResult(200, """{"id":"m1","leaseToken":"lease","mode":"reply","roomId":"r","text":"x"}"""))),
            ArrayDeque(List(100) { 503 }),
        )
        val c = ClaimCycle(t, ClaimHandler({ _, _ -> ReplyResult.FIRED }, { _, _ -> Outcome.FAILED }, { false }), { emptyList() }, { emptyList() }, { false },
            clock = { now }, pause = { now += it })
        assertEquals(CycleResult.Handled("m1", Outcome.ACCEPTED, false), c.runOnce())
        assertTrue(now <= 100_000)
    }
}
