package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable

/** The platform's health-data permission screen and its store page. */
interface HealthConnectAccess {
    /** Shows the permission screen; reports whether every read the sync needs was granted. */
    fun requestPermissions(onResult: (granted: Boolean) -> Unit)

    /** Opens the store page to install or update Health Connect. */
    fun openInstall()
}

/** Null where the platform has no health store the app reads. */
@Composable
expect fun rememberHealthConnectAccess(): HealthConnectAccess?
