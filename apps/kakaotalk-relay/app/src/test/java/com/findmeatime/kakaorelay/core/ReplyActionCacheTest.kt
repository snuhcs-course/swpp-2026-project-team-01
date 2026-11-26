package com.findmeatime.kakaorelay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReplyActionCacheTest {
    @Test
    fun postedActionIsPreferredAndNewestReplaces() {
        val c = ReplyActionCache<String> { a, b -> a == b }
        c.onPosted("r", "k1", "a1")
        c.onPosted("r", "k2", "a2")
        assertEquals("a2", c.select("r"))
        assertEquals(listOf("r"), c.postedRooms())
    }

    @Test
    fun cachedActionSurvivesRemoval() {
        val c = ReplyActionCache<String> { a, b -> a == b }
        c.onPosted("r", "k1", "a1")
        c.onRemoved("r", "k1")
        assertEquals(emptyList<String>(), c.postedRooms())
        assertEquals(listOf("r"), c.replyableRooms())
        assertEquals("a1", c.select("r"))
        c.clearPosted()
        assertEquals("a1", c.select("r"))
    }

    @Test
    fun removalOfAnOlderNotificationKeepsThePostedOne() {
        val c = ReplyActionCache<String> { a, b -> a == b }
        c.onPosted("r", "k1", "a1")
        c.onPosted("r", "k2", "a2")
        c.onRemoved("r", "k1")
        assertEquals(listOf("r"), c.postedRooms())
    }

    @Test
    fun cancelledDropsTheRoom() {
        val c = ReplyActionCache<String> { a, b -> a == b }
        c.onPosted("r", "k1", "a1")
        c.onPosted("s", "k2", "b1")
        c.drop("r")
        assertNull(c.select("r"))
        assertEquals(listOf("s"), c.replyableRooms())
        assertEquals(1, c.cachedCount())
    }

    @Test
    fun replyableRoomsAreSortedAndDistinct() {
        val c = ReplyActionCache<String> { a, b -> a == b }
        c.onPosted("9", "k9", "x")
        c.onPosted("1", "k1", "y")
        c.onRemoved("9", "k9")
        assertEquals(listOf("1", "9"), c.replyableRooms())
        assertEquals(listOf("1"), c.postedRooms())
        assertNull(c.select("5"))
    }

    private data class FakeAction(val intent: String, val label: String)

    private fun guarded() = ReplyActionCache<FakeAction> { a, b -> a.intent == b.intent }

    @Test
    fun newActionWithTheSameIntentDropsTheOtherRoom() {
        val c = guarded()
        c.onPosted("A", "kA", FakeAction("shared", "a"))
        c.onRemoved("A", "kA")
        c.onPosted("B", "kB", FakeAction("shared", "b"))
        assertNull(c.select("A"))
        assertEquals(listOf("B"), c.replyableRooms())
        assertEquals("b", c.select("B")?.label)
        assertEquals(1, c.collisionCount())
    }

    @Test
    fun postedOtherRoomWithTheSameIntentIsDroppedToo() {
        val c = guarded()
        c.onPosted("A", "kA", FakeAction("shared", "a"))
        c.onPosted("B", "kB", FakeAction("shared", "b"))
        assertEquals(listOf("B"), c.postedRooms())
        assertNull(c.select("A"))
    }

    @Test
    fun distinctIntentsAreKeptPerRoom() {
        val c = guarded()
        c.onPosted("A", "kA", FakeAction("ia", "a"))
        c.onRemoved("A", "kA")
        c.onPosted("B", "kB", FakeAction("ib", "b"))
        assertEquals("a", c.select("A")?.label)
        assertEquals("b", c.select("B")?.label)
        assertEquals(0, c.collisionCount())
    }

    @Test
    fun selectNeverHandsOutAnActionAnotherRoomHolds() {
        // A collision the posting guard could not see: equality that appears
        // later (sameTarget is evaluated at select time).
        var aliased = false
        val c = ReplyActionCache<FakeAction> { a, b -> a.intent == b.intent || aliased }
        c.onPosted("A", "kA", FakeAction("ia", "a"))
        c.onPosted("B", "kB", FakeAction("ib", "b"))
        aliased = true
        assertNull(c.select("A"))
        assertNull(c.select("B"))
        assertEquals(2, c.collisionCount())
    }
}
