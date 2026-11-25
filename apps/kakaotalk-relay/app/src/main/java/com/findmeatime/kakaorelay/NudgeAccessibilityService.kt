package com.findmeatime.kakaorelay

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.findmeatime.kakaorelay.core.ChatRow
import com.findmeatime.kakaorelay.core.KAKAO_PACKAGE
import com.findmeatime.kakaorelay.core.ScreenDriver

// The accessibility path for the fixed nudge (design 1). NudgeFlow decides;
// this class only reads and taps KakaoTalk's screen. It is called from the
// claim thread, never the main thread.
//
// The view lookups go by visible text and roles, not view IDs: the chat tab
// is labelled 채팅 and the send control 전송. They were not exercised on the
// relay phone when this was written (tasks 4.3).
class NudgeAccessibilityService : AccessibilityService(), ScreenDriver {
    override fun onServiceConnected() {
        RelayRuntime.init(this)
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    // ScreenDriver

    override fun available() = instance === this

    override fun openChatList(): Boolean {
        val launch = packageManager.getLaunchIntentForPackage(KAKAO_PACKAGE) ?: return false
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        startActivity(launch)
        if (!waitUntil(5_000) { kakaoRoot() != null }) return false
        // Leave an open chat room first.
        repeat(3) {
            if (kakaoRoot()?.let(::findInput) == null) return@repeat
            performGlobalAction(GLOBAL_ACTION_BACK)
            pause(500)
        }
        val tab = kakaoRoot()?.let { root -> find(root) { labelOf(it) == "채팅" || labelOf(it).startsWith("채팅 ") } }
            ?: return false
        clickable(tab)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: return false
        return waitUntil(3_000) { list() != null }
    }

    override fun scrollToTop() {
        repeat(30) {
            val list = list() ?: return
            if (!list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) return
            pause(300)
        }
    }

    override fun visibleRows(): List<ChatRow> {
        val list = list() ?: return emptyList()
        return (0 until list.childCount).mapNotNull { i ->
            val row = list.getChild(i) ?: return@mapNotNull null
            val texts = texts(row)
            if (texts.isEmpty()) null else ChatRow(title = texts.first(), key = texts.joinToString("\u0001"))
        }
    }

    override fun scrollForward(): Boolean {
        val list = list() ?: return false
        val moved = list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        if (moved) pause(400)
        return moved
    }

    override fun openRow(row: ChatRow): Boolean {
        val list = list() ?: return false
        val node = (0 until list.childCount).mapNotNull { list.getChild(it) }
            .firstOrNull { texts(it).joinToString("\u0001") == row.key } ?: return false
        return clickable(node)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    override fun roomTitleIs(name: String): Boolean {
        val root = kakaoRoot() ?: return false
        if (findInput(root) == null) return false
        val screen = Rect().also { root.getBoundsInScreen(it) }
        val headerBottom = screen.top + screen.height() / 6
        return find(root) { node ->
            node.text?.toString()?.trim() == name &&
                Rect().also { node.getBoundsInScreen(it) }.top < headerBottom
        } != null
    }

    override fun typeMessage(text: String): Boolean {
        val input = kakaoRoot()?.let(::findInput) ?: return false
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        pause(300)
        val fresh = kakaoRoot()?.let(::findInput) ?: return false
        return !fresh.isShowingHintText && fresh.text?.toString() == text
    }

    override fun clearMessage() {
        val input = kakaoRoot()?.let(::findInput) ?: return
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "") }
        input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    override fun tapSend(): Boolean {
        val root = kakaoRoot() ?: return false
        val send = find(root) { labelOf(it) == "전송" } ?: return false
        return clickable(send)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    override fun messageVisible(text: String): Boolean {
        val root = kakaoRoot() ?: return false
        val input = findInput(root) ?: return false
        val inputEmpty = input.isShowingHintText || input.text.isNullOrEmpty()
        return inputEmpty && find(root) { !it.isEditable && it.text?.toString() == text } != null
    }

    override fun leave() {
        performGlobalAction(GLOBAL_ACTION_HOME)
    }

    override fun pause(millis: Long) = Thread.sleep(millis)

    // Helpers

    private fun kakaoRoot(): AccessibilityNodeInfo? =
        rootInActiveWindow?.takeIf { it.packageName?.toString() == KAKAO_PACKAGE }

    private fun list(): AccessibilityNodeInfo? {
        val root = kakaoRoot() ?: return null
        var best: AccessibilityNodeInfo? = null
        var bestArea = 0
        walk(root) { node ->
            // Only vertical lists; a ViewPager would scroll to another tab.
            val cls = node.className?.toString() ?: ""
            if (node.isScrollable && (cls.endsWith("RecyclerView") || cls.endsWith("ListView"))) {
                val r = Rect().also { node.getBoundsInScreen(it) }
                val area = r.width() * r.height()
                if (area > bestArea) {
                    best = node
                    bestArea = area
                }
            }
            false
        }
        return best
    }

    private fun findInput(root: AccessibilityNodeInfo) =
        find(root) { it.isEditable && it.className?.toString()?.endsWith("EditText") == true }

    private fun labelOf(node: AccessibilityNodeInfo): String =
        (node.contentDescription ?: node.text)?.toString()?.trim() ?: ""

    private fun texts(node: AccessibilityNodeInfo): List<String> {
        val out = mutableListOf<String>()
        walk(node) { n ->
            n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let(out::add)
            false
        }
        return out
    }

    private fun clickable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        while (current != null && !current.isClickable) current = current.parent
        return current
    }

    private fun find(root: AccessibilityNodeInfo, match: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        var found: AccessibilityNodeInfo? = null
        walk(root) { node -> match(node).also { if (it) found = node } }
        return found
    }

    // Depth-first; visit returns true to stop.
    private fun walk(root: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Boolean): Boolean {
        if (visit(root)) return true
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            if (walk(child, visit)) return true
        }
        return false
    }

    private fun waitUntil(totalMillis: Long, check: () -> Boolean): Boolean {
        var waited = 0L
        while (waited <= totalMillis) {
            if (check()) return true
            pause(250)
            waited += 250
        }
        return false
    }

    companion object {
        @Volatile var instance: NudgeAccessibilityService? = null
    }
}
