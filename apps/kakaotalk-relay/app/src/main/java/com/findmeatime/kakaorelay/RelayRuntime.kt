package com.findmeatime.kakaorelay

import android.app.KeyguardManager
import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.findmeatime.kakaorelay.core.EventForwarder
import com.findmeatime.kakaorelay.core.Heartbeat
import com.findmeatime.kakaorelay.core.KAKAO_PACKAGE
import com.findmeatime.kakaorelay.core.KakaoNotificationParser
import com.findmeatime.kakaorelay.core.ParseResult
import com.findmeatime.kakaorelay.core.RawMessage
import com.findmeatime.kakaorelay.core.RawNotification
import com.findmeatime.kakaorelay.core.RelayProtocol
import com.findmeatime.kakaorelay.core.ReplyActionCache
import com.findmeatime.kakaorelay.core.ReplyPath
import com.findmeatime.kakaorelay.core.ReplyResult
import java.util.concurrent.Executors

// Process-wide state shared by the listener, the accessibility service, the
// foreground service and the settings screen. Logs never carry message text,
// names or room IDs.
object RelayRuntime {
    private const val LOG = "KakaoRelay"

    lateinit var app: Context
        private set
    lateinit var settings: RelaySettings
        private set
    lateinit var http: RelayHttp
        private set
    lateinit var forwarder: EventForwarder
        private set

    private val io = Executors.newSingleThreadExecutor()

    // Reply actions of 1:1 rooms, posted now or cached after removal.
    private val replies = ReplyActionCache<Notification.Action> { a, b -> a.actionIntent == b.actionIntent }

    @Volatile var listenerConnected = false
    @Volatile var lastHeartbeat: String = "never"
    @Volatile var lastClaim: String = "never"
    @Volatile var lastForward: String = "never"

    @Synchronized
    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        settings = RelaySettings(app)
        http = RelayHttp(settings)
        forwarder = EventForwarder(settings, { settings.inboundSecret })
    }

    fun saveSettings(url: String, inbound: String, outbox: String): String? {
        val result = settings.save(url, inbound, outbox)
        // On the I/O thread: a flush in progress holds the forwarder.
        if (result.baseUrlChanged) io.execute { forwarder.reset() }
        return result.error
    }

    fun postedRooms(): List<String> = replies.postedRooms()

    fun replyableRooms(): List<String> = replies.replyableRooms()

    fun cachedActionCount(): Int = replies.cachedCount()

    fun replyCollisionCount(): Int = replies.collisionCount()

    fun onPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != KAKAO_PACKAGE) return
        val raw = toRaw(sbn) ?: return
        val secret = settings.inboundSecret ?: ""
        val cutoff = settings.configuredAt ?: Long.MAX_VALUE
        val parsed = KakaoNotificationParser.parse(raw, secret, cutoff)
        if (parsed !is ParseResult.Parsed) return
        if (parsed.oneToOne) {
            replyAction(sbn.notification)?.let { replies.onPosted(parsed.roomId, sbn.key, it) }
        }
        // Without the inbound secret a void_code hash cannot be made; such
        // events wait for the next post of the notification.
        if (secret.isEmpty()) return
        // Enqueue on the I/O thread: a flush in progress holds the forwarder.
        io.execute { forwarder.enqueue(parsed.events) }
        flushAsync()
    }

    fun onRemoved(sbn: StatusBarNotification) {
        if (sbn.packageName != KAKAO_PACKAGE) return
        val room = KakaoNotificationParser.roomIdFromTag(sbn.tag) ?: return
        replies.onRemoved(room, sbn.key)
    }

    fun resetPosted(active: Array<StatusBarNotification>?) {
        replies.clearPosted()
        active?.forEach { onPosted(it) }
    }

    fun flushAsync() {
        io.execute {
            val result = forwarder.flush { body -> http.postEvent(body) }
            if (result.sent > 0 || result.blocked) {
                lastForward = "${now()}: sent ${result.sent}, waiting ${result.remaining}" + if (result.blocked) " (retrying)" else ""
            }
        }
    }

    val replyPath = ReplyPath { roomId, text ->
        val action = replies.select(roomId) ?: return@ReplyPath ReplyResult.NOT_POSTED
        val input = action.remoteInputs?.firstOrNull() ?: return@ReplyPath ReplyResult.NOT_POSTED
        val intent = Intent()
        RemoteInput.addResultsToIntent(arrayOf(input), intent, Bundle().apply { putCharSequence(input.resultKey, text) })
        RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT)
        try {
            action.actionIntent.send(app, 0, intent)
            ReplyResult.FIRED
        } catch (e: PendingIntent.CanceledException) {
            replies.drop(roomId)
            ReplyResult.NOT_POSTED
        } catch (e: Exception) {
            Log.w(LOG, "reply action failed: ${e.javaClass.simpleName}")
            ReplyResult.UNKNOWN
        }
    }

    // Locked means the keyguard is up or the screen is off: the accessibility
    // path cannot run either way.
    fun isLocked(): Boolean {
        val keyguard = app.getSystemService(KeyguardManager::class.java)
        val power = app.getSystemService(PowerManager::class.java)
        return keyguard.isKeyguardLocked || !power.isInteractive
    }

    fun listenerEnabled(): Boolean =
        listenerConnected && NotificationManagerCompat.getEnabledListenerPackages(app).contains(app.packageName)

    fun accessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(app.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val ours = ComponentName(app, NudgeAccessibilityService::class.java).flattenToString()
        return enabled.split(':').any { it.equals(ours, ignoreCase = true) } && NudgeAccessibilityService.instance != null
    }

    fun kakaoVersion(): String? =
        runCatching { app.packageManager.getPackageInfo(KAKAO_PACKAGE, 0).versionName }.getOrNull()

    fun heartbeat(): Heartbeat = Heartbeat(listenerEnabled(), accessibilityEnabled(), isLocked(), kakaoVersion(), postedRooms(), replyableRooms())

    fun sendHeartbeat() {
        val status = http.heartbeat(RelayProtocol.heartbeatBody(heartbeat()))
        lastHeartbeat = "${now()}: " + (status?.toString() ?: "network error")
    }

    fun now(): String = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())

    private fun replyAction(n: Notification): Notification.Action? =
        n.actions?.firstOrNull { it.remoteInputs?.isNotEmpty() == true && it.actionIntent != null }

    private fun toRaw(sbn: StatusBarNotification): RawNotification? {
        val n = sbn.notification ?: return null
        val extras = n.extras
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
        val userKey = style?.user?.key
        val messages = style?.messages.orEmpty().map { m ->
            val person = m.person
            RawMessage(
                senderName = person?.name?.toString(),
                text = m.text?.toString(),
                timestamp = m.timestamp,
                isSelf = person == null || (userKey != null && person.key == userKey),
                hasMedia = m.dataMimeType != null,
            )
        }
        return RawNotification(
            packageName = sbn.packageName,
            tag = sbn.tag,
            channelId = n.channelId,
            isGroupSummary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            isMessagingStyle = style != null,
            isGroupConversation = if (extras.containsKey(Notification.EXTRA_IS_GROUP_CONVERSATION)) {
                extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION)
            } else {
                null
            },
            conversationTitle = (
                extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)
                    ?: extras.getCharSequence("android.hiddenConversationTitle")
                )?.toString(),
            hasReplyInput = replyAction(n) != null,
            category = n.category,
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            actionCount = n.actions?.size ?: 0,
            replyActionIndex = n.actions?.indexOfFirst { it.remoteInputs?.isNotEmpty() == true && it.actionIntent != null } ?: -1,
            messages = messages,
        )
    }
}
