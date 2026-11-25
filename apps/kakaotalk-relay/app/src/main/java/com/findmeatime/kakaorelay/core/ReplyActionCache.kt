package com.findmeatime.kakaorelay.core

// Reply actions per 1:1 room (A is Notification.Action on the phone, a fake in
// tests). The posted map follows the notifications that are on screen now. The
// cached map keeps the newest action per room after its notification is
// removed, on the hypothesis (2026-11-26, under test) that KakaoTalk's 답장
// PendingIntent stays valid. A cancelled PendingIntent drops the room from
// both maps. The cache lives in memory only.
//
// Android identifies a PendingIntent by its intent and request code, not its
// extras. If KakaoTalk reused one PendingIntent for several rooms
// (FLAG_UPDATE_CURRENT), an action kept for room A would now deliver to room
// B. sameTarget compares two actions' PendingIntents (PendingIntent.equals).
// An action that shares its target with another room's action is dropped when
// the newer one is posted, and is never handed out.
class ReplyActionCache<A : Any>(private val sameTarget: (A, A) -> Boolean) {
    private class Entry<A>(val key: String, val action: A)

    private val posted = HashMap<String, Entry<A>>()
    private val cached = HashMap<String, A>()
    private var collisions = 0

    @Synchronized
    fun onPosted(roomId: String, notificationKey: String, action: A) {
        for (other in (posted.keys + cached.keys).filter { it != roomId }) {
            var hit = false
            posted[other]?.let { if (sameTarget(it.action, action)) { posted.remove(other); hit = true } }
            cached[other]?.let { if (sameTarget(it, action)) { cached.remove(other); hit = true } }
            if (hit) collisions++
        }
        posted[roomId] = Entry(notificationKey, action)
        cached[roomId] = action
    }

    // Only the removal of the notification that set the posted entry clears it.
    @Synchronized
    fun onRemoved(roomId: String, notificationKey: String) {
        if (posted[roomId]?.key == notificationKey) posted.remove(roomId)
    }

    // The listener disconnected or reconnected: posted state is unknown, the
    // cache stays.
    @Synchronized
    fun clearPosted() = posted.clear()

    // The posted action when there is one, else the cached one, but never an
    // action whose target any other room also holds.
    @Synchronized
    fun select(roomId: String): A? {
        var refused = false
        for (candidate in listOfNotNull(posted[roomId]?.action, cached[roomId])) {
            if (heldByOtherRoom(roomId, candidate)) {
                refused = true
                continue
            }
            return candidate
        }
        // Counted once per refused selection.
        if (refused) collisions++
        return null
    }

    // The action's PendingIntent was cancelled.
    @Synchronized
    fun drop(roomId: String) {
        posted.remove(roomId)
        cached.remove(roomId)
    }

    @Synchronized
    fun postedRooms(): List<String> = posted.keys.sorted()

    @Synchronized
    fun replyableRooms(): List<String> = (posted.keys + cached.keys).toSortedSet().toList()

    @Synchronized
    fun cachedCount(): Int = cached.size

    @Synchronized
    fun collisionCount(): Int = collisions

    private fun heldByOtherRoom(roomId: String, action: A): Boolean =
        posted.any { (room, e) -> room != roomId && sameTarget(e.action, action) } ||
            cached.any { (room, a) -> room != roomId && sameTarget(a, action) }
}
