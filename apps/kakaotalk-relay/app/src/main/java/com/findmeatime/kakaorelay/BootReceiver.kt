package com.findmeatime.kakaorelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Restarts the relay after a reboot or an app update.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        RelayRuntime.init(context)
        if (RelayRuntime.settings.configured) RelayService.start(context)
    }
}
