package com.findmeatime.kakaorelay.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EventForwarderTest {
    private class MemoryStore : ForwarderStore {
        var acked = listOf<String>()
        var pending = listOf<String>()
        override fun loadAcked() = acked
        override fun saveAcked(ids: List<String>) { acked = ids }
        override fun loadPending() = pending
        override fun savePending(bodies: List<String>) { pending = bodies }
    }

    private fun event(i: Int) = MessageEvent("room:$i:0", "room", "Test Host", "text $i", i.toLong(), false)

    @Test
    fun ringKeepsTheLast500() {
        val ring = AckRing()
        repeat(501) { ring.add("id$it") }
        assertEquals(500, ring.size)
        assertFalse("id0" in ring)
        assertTrue("id500" in ring)
        assertEquals(ring.toList(), AckRing(initial = ring.toList()).toList())
    }

    @Test
    fun forwardsOnceInOrderAndSkipsAcked() {
        val store = MemoryStore()
        val f = EventForwarder(store, { "s" })
        f.enqueue(listOf(event(1), event(2)))
        val posted = mutableListOf<String>()
        f.flush { posted += JSONObject(it).getString("eventId"); 200 }
        assertEquals(listOf("room:1:0", "room:2:0"), posted)
        assertEquals(0, f.enqueue(listOf(event(1), event(2))))
        assertTrue(store.pending.isEmpty())
        // The ring survives a restart.
        assertEquals(0, EventForwarder(store, { "s" }).enqueue(listOf(event(2))))
    }

    @Test
    fun retriesUntilAcknowledged() {
        val store = MemoryStore()
        val f = EventForwarder(store, { "s" })
        f.enqueue(listOf(event(1), event(2)))
        var calls = 0
        val r1 = f.flush { calls++; 503 }
        assertTrue(r1.blocked)
        assertEquals(1, calls)
        assertEquals(2, f.pendingCount())
        assertEquals(1, f.flush { null }.let { if (it.blocked) 1 else 0 })
        // Pending events survive a restart and are sent later.
        val restarted = EventForwarder(store, { "s" })
        assertEquals(2, restarted.pendingCount())
        assertEquals(2, restarted.flush { 200 }.sent)
        assertEquals(0, restarted.pendingCount())
    }

    @Test
    fun unauthorizedIsRetriedNotDropped() {
        val f = EventForwarder(MemoryStore(), { "s" })
        f.enqueue(listOf(event(1)))
        assertTrue(f.flush { 401 }.blocked)
        assertEquals(1, f.pendingCount())
    }

    @Test
    fun finalRefusalIsDroppedAndDoesNotBlock() {
        val f = EventForwarder(MemoryStore(), { "s" })
        f.enqueue(listOf(event(1), event(2)))
        val statuses = ArrayDeque(listOf(409, 200))
        val r = f.flush { statuses.removeFirst() }
        assertEquals(1, r.sent)
        assertEquals(1, f.dropped)
        assertEquals(0, f.pendingCount())
    }

    @Test
    fun resetForgetsPendingAndAcked() {
        val store = MemoryStore()
        val f = EventForwarder(store, { "s" })
        f.enqueue(listOf(event(1)))
        f.flush { 200 }
        f.enqueue(listOf(event(2)))
        f.reset()
        assertEquals(0, f.pendingCount())
        assertTrue(store.pending.isEmpty())
        assertTrue(store.acked.isEmpty())
        // The old ID is no longer in the ring, so the new service gets it.
        assertEquals(1, f.enqueue(listOf(event(1))))
    }

    @Test
    fun baseUrlChange() {
        assertTrue(BaseUrls.changed(null, "https://a.example"))
        assertTrue(BaseUrls.changed("", "https://a.example"))
        assertFalse(BaseUrls.changed("https://a.example", "https://a.example/"))
        assertFalse(BaseUrls.changed("https://a.example", " https://a.example "))
        assertTrue(BaseUrls.changed("https://a.example", "https://b.example"))
        assertTrue(BaseUrls.changed("https://a.example", "https://a.example/prefix"))
    }

    @Test
    fun noSecretNoSend() {
        val f = EventForwarder(MemoryStore(), { null })
        f.enqueue(listOf(event(1)))
        var called = false
        f.flush { called = true; 200 }
        assertFalse(called)
    }
}
