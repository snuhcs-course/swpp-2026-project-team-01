package com.findmeatime.kakaorelay.core

data class HttpResult(val status: Int, val body: String?)

// The signed outbox calls. Implementations return null on a network error.
interface OutboxTransport {
    fun claim(body: String): HttpResult?
    fun result(path: String, body: String): Int?
}

sealed interface CycleResult {
    data object Idle : CycleResult
    data class Error(val status: Int?) : CycleResult
    data class Handled(val id: String, val outcome: Outcome, val reported: Boolean) : CycleResult
}

// One claim long poll, the send it asks for, and the result report
// (design 5). The report is retried while the 120-second lease can still take
// it; a 4xx other than 429 means the service refused it (wrong or ended lease)
// and is not retried.
class ClaimCycle(
    private val transport: OutboxTransport,
    private val handler: ClaimHandler,
    private val postedRooms: () -> Collection<String>,
    private val replyableRooms: () -> Collection<String>,
    private val isLocked: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pause: (Long) -> Unit = { Thread.sleep(it) },
    private val reportWindowMillis: Long = 100_000,
    private val reportRetryMillis: Long = 3_000,
) {
    fun runOnce(): CycleResult {
        val response = transport.claim(RelayProtocol.claimBody(postedRooms(), replyableRooms(), isLocked()))
            ?: return CycleResult.Error(null)
        if (response.status !in 200..299) return CycleResult.Error(response.status)
        val claimedAt = clock()
        return when (val parsed = RelayProtocol.parseClaim(response.status, response.body)) {
            ClaimParse.Empty -> CycleResult.Idle
            ClaimParse.Invalid -> CycleResult.Error(response.status)
            is ClaimParse.Malformed -> report(parsed.id, parsed.leaseToken, Outcome.FAILED, claimedAt)
            is ClaimParse.Ok -> {
                val outcome = try {
                    handler.handle(parsed.claim)
                } catch (e: Exception) {
                    Outcome.UNCERTAIN
                }
                report(parsed.claim.id, parsed.claim.leaseToken, outcome, claimedAt)
            }
        }
    }

    private fun report(id: String, leaseToken: String, outcome: Outcome, claimedAt: Long): CycleResult {
        val path = RelayProtocol.resultPath(id)
        val body = RelayProtocol.resultBody(leaseToken, outcome)
        while (true) {
            val status = transport.result(path, body)
            if (status != null && status in 200..299) return CycleResult.Handled(id, outcome, true)
            if (status != null && status in 400..499 && status != 429) return CycleResult.Handled(id, outcome, false)
            if (clock() - claimedAt + reportRetryMillis > reportWindowMillis) return CycleResult.Handled(id, outcome, false)
            pause(reportRetryMillis)
        }
    }
}
