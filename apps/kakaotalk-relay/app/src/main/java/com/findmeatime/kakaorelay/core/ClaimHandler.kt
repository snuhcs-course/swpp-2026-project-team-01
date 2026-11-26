package com.findmeatime.kakaorelay.core

// What the relay does with one claimed message, and which outcome it reports
// (design 5). Private content goes only through the reply action of a posted
// notification for the claimed room; the accessibility path only ever types
// the fixed nudge.

// The fixed nudge from design 1. A nudge claim with any other text is refused,
// so a fault on the service side cannot push private content down the path
// that chooses its chat by name.
const val FIXED_NUDGE = "Find Me a Time에 새 소식이 있어요. 아무 말이나 답장해 주시면 바로 보내드릴게요."

enum class ReplyResult {
    // The reply action's PendingIntent fired.
    FIRED,
    // No posted notification for the room, or its PendingIntent was cancelled.
    NOT_POSTED,
    // Firing started and failed in a way that may have sent it.
    UNKNOWN,
}

fun interface ReplyPath {
    fun reply(roomId: String, text: String): ReplyResult
}

fun interface NudgePath {
    fun nudge(displayName: String, text: String): Outcome
}

class ClaimHandler(
    private val replyPath: ReplyPath,
    private val nudgePath: NudgePath,
    private val isLocked: () -> Boolean,
) {
    fun handle(claim: Claim): Outcome = when (claim.mode) {
        ClaimMode.REPLY -> when (replyPath.reply(claim.roomId!!, claim.text)) {
            ReplyResult.FIRED -> Outcome.ACCEPTED
            ReplyResult.NOT_POSTED -> Outcome.NOT_STARTED
            ReplyResult.UNKNOWN -> Outcome.UNCERTAIN
        }
        ClaimMode.NUDGE -> when {
            claim.text != FIXED_NUDGE -> Outcome.FAILED
            isLocked() -> Outcome.NOT_STARTED
            else -> nudgePath.nudge(claim.displayName!!, claim.text)
        }
    }
}
