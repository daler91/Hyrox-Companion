package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalUriHandler

@Composable
actual fun rememberBrowser(): Browser {
    val uriHandler = LocalUriHandler.current
    return remember(uriHandler) { Browser { url -> runCatching { uriHandler.openUri(url) } } }
}
