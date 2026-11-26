package com.findmeatime.kakaorelay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import com.findmeatime.kakaorelay.core.ClaimCycle
import com.findmeatime.kakaorelay.core.ClaimHandler
import com.findmeatime.kakaorelay.core.CycleResult
import com.findmeatime.kakaorelay.core.NudgeFlow
import com.findmeatime.kakaorelay.core.NudgePath
import com.findmeatime.kakaorelay.core.Outcome
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

// The foreground service: the claim long poll (design 5) and the heartbeat
// every minute (design 7), plus a retry of unacknowledged events each minute.
class RelayService : Service() {
    @Volatile private var running = false
    private var claimThread: Thread? = null
    private var timer: ScheduledExecutorService? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        RelayRuntime.init(this)
        startInForeground()
        if (!running) start()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        claimThread?.interrupt()
        timer?.shutdownNow()
        wakeLock?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    private fun start() {
        running = true
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kakaorelay:relay")
            .apply { setReferenceCounted(false); acquire() }
        timer = Executors.newSingleThreadScheduledExecutor().apply {
            scheduleWithFixedDelay({
                runCatching {
                    if (RelayRuntime.settings.configured) {
                        RelayRuntime.sendHeartbeat()
                        RelayRuntime.flushAsync()
                    }
                }
            }, 0, 60, TimeUnit.SECONDS)
        }
        claimThread = Thread(::claimLoop, "relay-claim").apply { start() }
    }

    private fun claimLoop() {
        val nudge = NudgePath { name, text ->
            NudgeAccessibilityService.instance?.let { NudgeFlow(it).nudge(name, text) } ?: Outcome.NOT_STARTED
        }
        val handler = ClaimHandler(RelayRuntime.replyPath, nudge, RelayRuntime::isLocked)
        val cycle = ClaimCycle(RelayRuntime.http, handler, RelayRuntime::postedRooms, RelayRuntime::replyableRooms, RelayRuntime::isLocked)
        var backoff = 5_000L
        while (running) {
            try {
                if (!RelayRuntime.settings.configured) {
                    Thread.sleep(15_000)
                    continue
                }
                val started = System.currentTimeMillis()
                when (val result = cycle.runOnce()) {
                    CycleResult.Idle -> {
                        backoff = 5_000
                        // Keep a floor in case the service answers at once.
                        val elapsed = System.currentTimeMillis() - started
                        if (elapsed < 2_000) Thread.sleep(2_000 - elapsed)
                    }
                    is CycleResult.Handled -> {
                        backoff = 5_000
                        RelayRuntime.lastClaim = "${RelayRuntime.now()}: ${result.outcome.wire}" +
                            if (result.reported) "" else " (report not accepted)"
                    }
                    is CycleResult.Error -> {
                        RelayRuntime.lastClaim = "${RelayRuntime.now()}: error ${result.status ?: "network"}"
                        Thread.sleep(backoff)
                        backoff = (backoff * 2).coerceAtMost(60_000)
                    }
                }
            } catch (e: InterruptedException) {
                return
            } catch (e: Exception) {
                runCatching { Thread.sleep(backoff) }
            }
        }
    }

    private fun startInForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.relay_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.relay_running))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL = "relay_status"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            context.startForegroundService(Intent(context, RelayService::class.java))
        }
    }
}
