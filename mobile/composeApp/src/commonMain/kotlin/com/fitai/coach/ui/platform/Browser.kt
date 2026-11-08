package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable

/** Opens web pages outside the app's screens. */
fun interface Browser {
    fun open(url: String)
}

/** A Custom Tab on Android (the athlete stays in the app's task); the system browser elsewhere. */
@Composable
expect fun rememberBrowser(): Browser
