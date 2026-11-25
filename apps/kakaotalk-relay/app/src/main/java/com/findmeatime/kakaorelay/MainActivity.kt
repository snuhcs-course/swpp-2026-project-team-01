package com.findmeatime.kakaorelay

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

// Settings (base URL and the two secrets) and status. Secrets are never shown
// back; a blank field keeps the stored one.
class MainActivity : Activity() {
    private lateinit var baseUrl: EditText
    private lateinit var inbound: EditText
    private lateinit var outbox: EditText
    private lateinit var status: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 2_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        RelayRuntime.init(this)
        val settings = RelayRuntime.settings
        val pad = (16 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        fun label(text: String) = column.addView(TextView(this).apply { this.text = text })
        fun field(hint: String, secret: Boolean) = EditText(this).apply {
            this.hint = hint
            inputType = if (secret) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            }
            column.addView(this, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        fun button(text: String, action: () -> Unit) = column.addView(
            Button(this).apply {
                this.text = text
                setOnClickListener { action() }
            },
            LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT),
        )

        label("Service base URL")
        baseUrl = field("https://findmeatime.com", secret = false).apply { setText(settings.baseUrl ?: "") }
        label("Inbound secret (KAKAOTALK_RELAY_INBOUND_SECRET)")
        inbound = field(if (settings.inboundSecret.isNullOrEmpty()) "not set" else "set; leave blank to keep", secret = true)
        label("Outbox secret (KAKAOTALK_RELAY_OUTBOX_SECRET)")
        outbox = field(if (settings.outboxSecret.isNullOrEmpty()) "not set" else "set; leave blank to keep", secret = true)
        button("Save and start relay") { save() }
        button("Notification access") { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        button("Accessibility") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        button("Battery optimization off") { requestBatteryExemption() }
        status = TextView(this).apply { setPadding(0, pad, 0, 0) }
        column.addView(status)
        setContentView(ScrollView(this).apply { addView(column) })

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        if (settings.configured) RelayService.start(this)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    private fun save() {
        val error = RelayRuntime.saveSettings(baseUrl.text.toString(), inbound.text.toString(), outbox.text.toString())
        if (error != null) {
            Toast.makeText(this, error, Toast.LENGTH_LONG).show()
            return
        }
        inbound.text.clear()
        outbox.text.clear()
        if (RelayRuntime.settings.configured) {
            RelayService.start(this)
            Toast.makeText(this, "Saved; relay started", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Saved; both secrets are needed to start", Toast.LENGTH_LONG).show()
        }
        recreate()
    }

    private fun requestBatteryExemption() {
        val power = getSystemService(PowerManager::class.java)
        val intent = if (power.isIgnoringBatteryOptimizations(packageName)) {
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        } else {
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        }
        startActivity(intent)
    }

    private fun renderStatus() {
        val r = RelayRuntime
        val power = getSystemService(PowerManager::class.java)
        status.text = buildString {
            appendLine("Configured: ${r.settings.configured}")
            appendLine("Notification listener: ${if (r.listenerEnabled()) "on" else "off"}")
            appendLine("Accessibility: ${if (r.accessibilityEnabled()) "on" else "off"}")
            appendLine("Battery optimization: ${if (power.isIgnoringBatteryOptimizations(packageName)) "off" else "ON (turn off)"}")
            appendLine("Locked: ${r.isLocked()}")
            appendLine("KakaoTalk: ${r.kakaoVersion() ?: "not installed"}")
            appendLine("Rooms with a posted notification: ${r.postedRooms().size}")
            if (BuildConfig.DEBUG) appendLine("Cached reply actions (debug): ${r.cachedActionCount()}")
            if (BuildConfig.DEBUG) appendLine("Reply action collisions (debug): ${r.replyCollisionCount()}")
            appendLine("Events waiting: ${r.forwarder.pendingCount()}, dropped: ${r.forwarder.dropped}")
            appendLine("Last forward: ${r.lastForward}")
            appendLine("Last heartbeat: ${r.lastHeartbeat}")
            appendLine("Last claim: ${r.lastClaim}")
        }
    }
}
