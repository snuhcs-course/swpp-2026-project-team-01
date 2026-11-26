package com.findmeatime.kakaorelay.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NudgeFlowTest {
    private class FakeScreen(
        val pages: List<List<ChatRow>>,
        var titleMatches: Boolean = true,
        var typeWorks: Boolean = true,
        var sendFound: Boolean = true,
        var bubbleShows: Boolean = true,
        var throwOnSend: Boolean = false,
    ) : ScreenDriver {
        var page = 0
        var opened: ChatRow? = null
        var typed: String? = null
        var sent = false
        var left = false
        override fun available() = true
        override fun openChatList() = true
        override fun scrollToTop() { page = 0 }
        override fun visibleRows() = pages.getOrElse(page) { emptyList() }
        override fun scrollForward() = (page + 1 < pages.size).also { if (it) page++ }
        override fun openRow(row: ChatRow) = true.also { opened = row }
        override fun roomTitleIs(name: String) = titleMatches
        override fun typeMessage(text: String) = typeWorks.also { if (it) typed = text }
        override fun clearMessage() { typed = null }
        override fun tapSend(): Boolean {
            if (throwOnSend) { sent = true; throw IllegalStateException("gone") }
            return sendFound.also { sent = it }
        }
        override fun messageVisible(text: String) = bubbleShows
        override fun leave() { left = true }
        override fun pause(millis: Long) = Unit
    }

    private fun row(title: String, preview: String = "p") = ChatRow(title, "$title\u0001$preview")

    @Test
    fun exactlyOneMatchIsNudged() {
        val screen = FakeScreen(listOf(listOf(row("Other"), row("Test Host")), listOf(row("Third"))))
        assertEquals(Outcome.ACCEPTED, NudgeFlow(screen).nudge("Test Host", FIXED_NUDGE))
        assertEquals("Test Host", screen.opened?.title)
        assertEquals(FIXED_NUDGE, screen.typed)
        assertTrue(screen.left)
    }

    @Test
    fun noMatchFailsAndSendsNothing() {
        val screen = FakeScreen(listOf(listOf(row("Other"))))
        assertEquals(Outcome.FAILED, NudgeFlow(screen).nudge("Test Host", FIXED_NUDGE))
        assertFalse(screen.sent)
        assertEquals(null, screen.opened)
    }

    @Test
    fun twoMatchesAcrossPagesFailAndSendNothing() {
        val screen = FakeScreen(listOf(listOf(row("Test Host", "a")), listOf(row("Test Host", "b"))))
        assertEquals(Outcome.FAILED, NudgeFlow(screen).nudge("Test Host", FIXED_NUDGE))
        assertFalse(screen.sent)
    }

    @Test
    fun sameRowSeenTwiceAfterScrollIsOneMatch() {
        val r = row("Test Host")
        val screen = FakeScreen(listOf(listOf(row("A"), r), listOf(r, row("B"))))
        assertEquals(Outcome.ACCEPTED, NudgeFlow(screen).nudge("Test Host", FIXED_NUDGE))
    }

    @Test
    fun wrongRoomHeaderFails() {
        val screen = FakeScreen(listOf(listOf(row("Test Host"))), titleMatches = false)
        assertEquals(Outcome.FAILED, NudgeFlow(screen).nudge("Test Host", FIXED_NUDGE))
        assertFalse(screen.sent)
    }

    @Test
    fun uiHiccupsBeforeSendAreNotStarted() {
        assertEquals(Outcome.NOT_STARTED, NudgeFlow(FakeScreen(listOf(listOf(row("Test Host"))), typeWorks = false)).nudge("Test Host", FIXED_NUDGE))
        val noSend = FakeScreen(listOf(listOf(row("Test Host"))), sendFound = false)
        assertEquals(Outcome.NOT_STARTED, NudgeFlow(noSend).nudge("Test Host", FIXED_NUDGE))
        assertEquals(null, noSend.typed)
    }

    @Test
    fun unconfirmedSendIsUncertain() {
        assertEquals(Outcome.UNCERTAIN, NudgeFlow(FakeScreen(listOf(listOf(row("Test Host"))), bubbleShows = false)).nudge("Test Host", FIXED_NUDGE))
        assertEquals(Outcome.UNCERTAIN, NudgeFlow(FakeScreen(listOf(listOf(row("Test Host"))), throwOnSend = true)).nudge("Test Host", FIXED_NUDGE))
    }
}
