package com.findmeatime.kakaorelay

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.findmeatime.kakaorelay.core.BaseUrls
import com.findmeatime.kakaorelay.core.ForwarderStore
import org.json.JSONArray
import java.net.URI

// The base URL and the two relay secrets, in EncryptedSharedPreferences. Events
// waiting for acknowledgment hold message text, so they live here too and are
// removed as soon as the service acknowledges them.
@Suppress("DEPRECATION")
class RelaySettings(context: Context) : ForwarderStore {
    private val secure: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "relay_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    // Acknowledged IDs carry no text.
    private val state: SharedPreferences = context.getSharedPreferences("relay_state", Context.MODE_PRIVATE)

    val baseUrl: String? get() = secure.getString(KEY_BASE_URL, null)
    val inboundSecret: String? get() = secure.getString(KEY_INBOUND, null)
    val outboxSecret: String? get() = secure.getString(KEY_OUTBOX, null)

    init {
        // An install configured before the cutoff existed starts it now.
        if (!baseUrl.isNullOrEmpty() && configuredAt == null) {
            secure.edit().putLong(KEY_CONFIGURED_AT, System.currentTimeMillis()).apply()
        }
    }

    // When the relay was first configured for the current base URL (epoch ms).
    val configuredAt: Long? get() = if (secure.contains(KEY_CONFIGURED_AT)) secure.getLong(KEY_CONFIGURED_AT, 0) else null

    val configured get() = !baseUrl.isNullOrEmpty() && !inboundSecret.isNullOrEmpty() && !outboxSecret.isNullOrEmpty()

    // Blank secrets keep the stored value. The cutoff for old messages is set
    // once per base URL; new secrets keep it. A new base URL also clears the
    // waiting events and the acknowledged-ID ring, which belong to the old
    // service (RelayRuntime.saveSettings clears the forwarder's memory).
    fun save(url: String, inbound: String, outbox: String): SaveResult {
        val next = BaseUrls.normalize(url)
        validateBaseUrl(next)?.let { return SaveResult(it, false) }
        val changed = BaseUrls.changed(this.baseUrl, next)
        val resetCutoff = changed || configuredAt == null
        if (changed) {
            state.edit().remove(KEY_ACKED).apply()
            secure.edit().remove(KEY_PENDING).apply()
        }
        secure.edit().apply {
            if (resetCutoff) putLong(KEY_CONFIGURED_AT, System.currentTimeMillis())
            putString(KEY_BASE_URL, next)
            if (inbound.isNotBlank()) putString(KEY_INBOUND, inbound.trim())
            if (outbox.isNotBlank()) putString(KEY_OUTBOX, outbox.trim())
        }.apply()
        return SaveResult(null, changed)
    }

    data class SaveResult(val error: String?, val baseUrlChanged: Boolean)

    override fun loadAcked(): List<String> = readList(state.getString(KEY_ACKED, null))
    override fun saveAcked(ids: List<String>) = state.edit().putString(KEY_ACKED, JSONArray(ids).toString()).apply()
    override fun loadPending(): List<String> = readList(secure.getString(KEY_PENDING, null))
    override fun savePending(bodies: List<String>) = secure.edit().putString(KEY_PENDING, JSONArray(bodies).toString()).apply()

    private fun readList(json: String?): List<String> {
        if (json == null) return emptyList()
        return runCatching {
            val array = JSONArray(json)
            List(array.length()) { array.getString(it) }
        }.getOrDefault(emptyList())
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_INBOUND = "inbound_secret"
        private const val KEY_OUTBOX = "outbox_secret"
        private const val KEY_PENDING = "pending_events"
        private const val KEY_ACKED = "acked_ids"
        private const val KEY_CONFIGURED_AT = "configured_at"

        private val LOOPBACK = setOf("localhost", "127.0.0.1", "10.0.2.2")

        // HTTPS, or plain HTTP only to a loopback relay stand-in.
        fun validateBaseUrl(url: String): String? {
            val uri = runCatching { URI(url) }.getOrNull() ?: return "Base URL is not a URL"
            val host = uri.host ?: return "Base URL has no host"
            if (uri.query != null || uri.fragment != null) return "Base URL must not have a query or fragment"
            return when (uri.scheme) {
                "https" -> null
                "http" -> if (host in LOOPBACK) null else "Use https (http only for localhost)"
                else -> "Use https"
            }
        }
    }
}
