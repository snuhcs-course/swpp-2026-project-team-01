package com.findmeatime.kakaorelay.core

// One row of KakaoTalk's chat list: its title and a key that tells two rows
// with the same title apart (the row's full visible text).
data class ChatRow(val title: String, val key: String)

// The screen operations the nudge needs. NudgeAccessibilityService implements
// them with AccessibilityNodeInfo; tests use a fake.
interface ScreenDriver {
    fun available(): Boolean
    fun openChatList(): Boolean
    fun scrollToTop()
    fun visibleRows(): List<ChatRow>
    fun scrollForward(): Boolean
    fun openRow(row: ChatRow): Boolean
    // True when a chat room is open and its header shows exactly name.
    fun roomTitleIs(name: String): Boolean
    // Puts text in the message field; true when the field then shows it.
    fun typeMessage(text: String): Boolean
    fun clearMessage()
    // True when a send control was found and clicked.
    fun tapSend(): Boolean
    // True when a sent bubble shows text and the field is empty.
    fun messageVisible(text: String): Boolean
    fun leave()
    fun pause(millis: Long)
}

// Opens the chat named displayName and sends text, refusing unless exactly one
// chat in the list has that name (design 1, spec "Ambiguous nudge recipient").
class NudgeFlow(
    private val driver: ScreenDriver,
    private val maxPages: Int = 8,
    private val pollMillis: Long = 250,
    private val roomWaitMillis: Long = 4_000,
    private val confirmWaitMillis: Long = 6_000,
) : NudgePath {
    override fun nudge(displayName: String, text: String): Outcome {
        if (!driver.available()) return Outcome.NOT_STARTED
        val name = displayName.trim()
        if (name.isEmpty()) return Outcome.FAILED
        var tapped = false
        return try {
            if (!driver.openChatList()) return finish(Outcome.NOT_STARTED)
            val matches = findMatches(name)
            if (matches.size != 1) return finish(Outcome.FAILED)
            val row = locate(matches.values.first()) ?: return finish(Outcome.NOT_STARTED)
            if (!driver.openRow(row)) return finish(Outcome.NOT_STARTED)
            if (!waitFor(roomWaitMillis) { driver.roomTitleIs(name) }) return finish(Outcome.FAILED)
            if (!driver.typeMessage(text)) {
                driver.clearMessage()
                return finish(Outcome.NOT_STARTED)
            }
            // From here a throw may mean the tap went through.
            tapped = true
            if (!driver.tapSend()) {
                driver.clearMessage()
                return finish(Outcome.NOT_STARTED)
            }
            finish(if (waitFor(confirmWaitMillis) { driver.messageVisible(text) }) Outcome.ACCEPTED else Outcome.UNCERTAIN)
        } catch (e: Exception) {
            finish(if (tapped) Outcome.UNCERTAIN else Outcome.NOT_STARTED)
        }
    }

    private fun findMatches(name: String): Map<String, ChatRow> {
        val matches = LinkedHashMap<String, ChatRow>()
        driver.scrollToTop()
        for (page in 0 until maxPages) {
            for (row in driver.visibleRows()) if (row.title.trim() == name) matches[row.key] = row
            if (!driver.scrollForward()) break
        }
        return matches
    }

    private fun locate(target: ChatRow): ChatRow? {
        driver.scrollToTop()
        for (page in 0 until maxPages) {
            driver.visibleRows().firstOrNull { it.key == target.key }?.let { return it }
            if (!driver.scrollForward()) break
        }
        return null
    }

    private fun waitFor(totalMillis: Long, check: () -> Boolean): Boolean {
        var waited = 0L
        while (true) {
            if (check()) return true
            if (waited >= totalMillis) return false
            driver.pause(pollMillis)
            waited += pollMillis
        }
    }

    private fun finish(outcome: Outcome): Outcome {
        runCatching { driver.leave() }
        return outcome
    }
}
