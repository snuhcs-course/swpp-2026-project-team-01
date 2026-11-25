package com.findmeatime.kakaorelay.core

import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// Request signing for every relay route (host-kakaotalk-channel design 2).
//
// The signature is lowercase hex HMAC-SHA256, keyed by the UTF-8 bytes of the
// route class's secret, over the UTF-8 bytes of
//   METHOD \n path \n timestamp \n nonce \n body
// where METHOD is upper case, path is the request path exactly as sent (no
// query), timestamp is Unix seconds in decimal and body is the exact request
// body ("" when there is none). PROTOCOL.md carries a known-answer vector.
object RelaySigner {
    const val HEADER_TIMESTAMP = "X-FMAT-Relay-Timestamp"
    const val HEADER_NONCE = "X-FMAT-Relay-Nonce"
    const val HEADER_SIGNATURE = "X-FMAT-Relay-Signature"

    private val random = SecureRandom()

    fun canonical(method: String, path: String, timestamp: Long, nonce: String, body: String): String =
        "${method.uppercase()}\n$path\n$timestamp\n$nonce\n$body"

    fun sign(secret: String, method: String, path: String, timestamp: Long, nonce: String, body: String): String =
        hmacHex(secret, canonical(method, path, timestamp, nonce, body))

    fun hmacHex(key: String, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return hex(mac.doFinal(message.toByteArray(Charsets.UTF_8)))
    }

    // 16 random bytes as 32 lowercase hex characters.
    fun newNonce(): String = ByteArray(16).also { random.nextBytes(it) }.let(::hex)

    fun headers(secret: String, method: String, path: String, body: String, timestamp: Long, nonce: String): Map<String, String> =
        mapOf(
            HEADER_TIMESTAMP to timestamp.toString(),
            HEADER_NONCE to nonce,
            HEADER_SIGNATURE to sign(secret, method, path, timestamp, nonce, body),
        )

    private fun hex(bytes: ByteArray): String {
        val out = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            out.append(HEX[v ushr 4]).append(HEX[v and 0x0f])
        }
        return out.toString()
    }

    private const val HEX = "0123456789abcdef"
}
