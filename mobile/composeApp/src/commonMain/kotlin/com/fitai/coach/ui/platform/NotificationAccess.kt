package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable

/** Whether the app may show notifications, and the system's controls for them. */
interface NotificationAccess {
    /** Asks for permission where the platform needs it, then reports whether notifications may be shown. */
    fun request(onResult: (granted: Boolean) -> Unit)

    /** Opens the system's notification settings for the app, where each kind can be muted. */
    fun openSettings()
}

@Composable
expect fun rememberNotificationAccess(): NotificationAccess
