package com.findmeatime.kakaorelay.core

// The last acknowledged event IDs, oldest first (design 3: a ring of 500).
class AckRing(private val capacity: Int = 500, initial: List<String> = emptyList()) {
    private val ids = LinkedHashSet<String>()

    init {
        initial.takeLast(capacity).forEach { ids.add(it) }
    }

    operator fun contains(id: String) = id in ids

    fun add(id: String) {
        ids.remove(id)
        ids.add(id)
        while (ids.size > capacity) ids.remove(ids.first())
    }

    fun toList(): List<String> = ids.toList()

    fun clear() = ids.clear()

    val size get() = ids.size
}

object BaseUrls {
    fun normalize(url: String) = url.trim().trimEnd('/')

    // True on the first configuration and on any real change; a trailing
    // slash or surrounding space is not a change.
    fun changed(previous: String?, next: String) = previous.isNullOrEmpty() || normalize(previous) != normalize(next)
}

// Persistence for the forwarder. The Android side stores the ring in private
// preferences and pending events (which hold text until acknowledged) in the
// encrypted ones.
interface ForwarderStore {
    fun loadAcked(): List<String>
    fun saveAcked(ids: List<String>)
    fun loadPending(): List<String>
    fun savePending(bodies: List<String>)
}

// Forwards each event once, in order, retrying until the service answers 2xx
// (spec: "retry until it is acknowledged"). A 400, 409, 413 or 422 is a final
// refusal (for example a changed payload under a stored ID) and is dropped so
// it cannot block later messages. Anything else, including 401 and network
// errors, keeps the event and stops the flush for a later retry.
class EventForwarder(
    private val store: ForwarderStore,
    private val inboundSecret: () -> String?,
    capacity: Int = 500,
) {
    private val ring = AckRing(capacity, store.loadAcked())
    private val pending = ArrayList<Pair<String, String>>() // eventId to JSON body

    @Volatile var dropped = 0
        private set

    // Readable without the lock, which a flush holds across network calls.
    @Volatile private var waiting = 0

    init {
        for (body in store.loadPending()) {
            val id = RelayProtocol.eventIdOf(body) ?: continue
            pending += id to body
        }
        waiting = pending.size
    }

    @Synchronized
    fun enqueue(events: List<RelayEvent>): Int {
        var added = 0
        for (event in events) {
            if (event.eventId in ring || pending.any { it.first == event.eventId }) continue
            pending += event.eventId to RelayProtocol.eventBody(event)
            added++
        }
        if (added > 0) store.savePending(pending.map { it.second })
        waiting = pending.size
        return added
    }

    fun pendingCount() = waiting

    // The base URL changed: events and IDs of the old service are forgotten.
    @Synchronized
    fun reset() {
        pending.clear()
        ring.clear()
        store.savePending(emptyList())
        store.saveAcked(emptyList())
        waiting = 0
    }

    // post returns the HTTP status, or null on a network error.
    @Synchronized
    fun flush(post: (String) -> Int?): FlushResult {
        if (inboundSecret().isNullOrEmpty()) return FlushResult(0, pending.size, false)
        var sent = 0
        var blocked = false
        while (pending.isNotEmpty()) {
            val (id, body) = pending.first()
            val status = post(body)
            when {
                status != null && status in 200..299 -> {
                    ring.add(id)
                    pending.removeAt(0)
                    sent++
                }
                status in FINAL_REFUSALS -> {
                    pending.removeAt(0)
                    dropped++
                }
                else -> {
                    blocked = true
                    break
                }
            }
            store.saveAcked(ring.toList())
            store.savePending(pending.map { it.second })
            waiting = pending.size
        }
        return FlushResult(sent, pending.size, blocked)
    }

    data class FlushResult(val sent: Int, val remaining: Int, val blocked: Boolean)

    companion object {
        val FINAL_REFUSALS = setOf(400, 409, 413, 422)
    }
}
