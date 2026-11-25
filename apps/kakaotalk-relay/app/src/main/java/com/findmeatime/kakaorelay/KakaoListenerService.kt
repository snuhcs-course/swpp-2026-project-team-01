package com.findmeatime.kakaorelay

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Reads com.kakao.talk notifications (design 1). Parsing and forwarding live in
// RelayRuntime and core/KakaoNotificationParser.
class KakaoListenerService : NotificationListenerService() {
    override fun onCreate() {
        super.onCreate()
        RelayRuntime.init(this)
    }

    override fun onListenerConnected() {
        RelayRuntime.listenerConnected = true
        // Rebuild the posted rooms and pick up messages that arrived while the
        // listener was away; the acknowledged-ID ring drops repeats.
        RelayRuntime.resetPosted(runCatching { activeNotifications }.getOrNull())
    }

    override fun onListenerDisconnected() {
        RelayRuntime.listenerConnected = false
        RelayRuntime.resetPosted(null)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        RelayRuntime.onPosted(sbn)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        RelayRuntime.onRemoved(sbn)
    }
}
