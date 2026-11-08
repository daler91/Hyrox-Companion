package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

@Composable
actual fun rememberNotificationAccess(): NotificationAccess = remember {
    object : NotificationAccess {
        override fun request(onResult: (granted: Boolean) -> Unit) = onResult(true)

        override fun openSettings() = Unit
    }
}
