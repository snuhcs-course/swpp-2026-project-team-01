package com.findmeatime.kakaorelay

import com.findmeatime.kakaorelay.core.HttpResult
import com.findmeatime.kakaorelay.core.OutboxTransport
import com.findmeatime.kakaorelay.core.RelayProtocol
import com.findmeatime.kakaorelay.core.RelaySigner
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// Signed POSTs to the relay routes. The signed path is the URL path as sent,
// so a base URL with a path prefix signs the prefix too.
class RelayHttp(private val settings: RelaySettings) : OutboxTransport {
    fun postEvent(body: String): Int? = post(RelayProtocol.WEBHOOK_PATH, body, settings.inboundSecret, SHORT_READ_MS)?.status

    override fun claim(body: String): HttpResult? = post(RelayProtocol.CLAIM_PATH, body, settings.outboxSecret, CLAIM_READ_MS)

    override fun result(path: String, body: String): Int? = post(path, body, settings.outboxSecret, SHORT_READ_MS)?.status

    fun heartbeat(body: String): Int? = post(RelayProtocol.HEARTBEAT_PATH, body, settings.outboxSecret, SHORT_READ_MS)?.status

    private fun post(route: String, body: String, secret: String?, readTimeoutMs: Int): HttpResult? {
        val base = settings.baseUrl
        if (base.isNullOrEmpty() || secret.isNullOrEmpty()) return null
        return try {
            val url = URL(base + route)
            val headers = RelaySigner.headers(secret, "POST", url.path, body, System.currentTimeMillis() / 1000, RelaySigner.newNonce())
            val bytes = body.toByteArray(Charsets.UTF_8)
            val connection = url.openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = CONNECT_MS
                connection.readTimeout = readTimeoutMs
                connection.doOutput = true
                connection.instanceFollowRedirects = false
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                headers.forEach { (k, v) -> connection.setRequestProperty(k, v) }
                connection.outputStream.use { it.write(bytes) }
                val status = connection.responseCode
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }
                HttpResult(status, text)
            } finally {
                connection.disconnect()
            }
        } catch (e: IOException) {
            null
        }
    }

    companion object {
        private const val CONNECT_MS = 10_000
        private const val SHORT_READ_MS = 20_000
        // The claim is a long poll of up to 25 seconds.
        private const val CLAIM_READ_MS = 40_000
    }
}
