package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.UriHandler

/** Opens web pages outside the app's screens. */
fun interface Browser {
    fun open(url: String)
}

/** A Custom Tab on Android (the athlete stays in the app's task); the system browser elsewhere. */
@Composable
expect fun rememberBrowser(): Browser

/** Links the UI opens through LocalUriHandler (Markdown, policy links) go to [browser]. */
class BrowserUriHandler(private val browser: Browser) : UriHandler {
    override fun openUri(uri: String) = browser.open(uri)
}
