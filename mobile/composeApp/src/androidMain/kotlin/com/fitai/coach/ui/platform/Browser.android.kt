package com.fitai.coach.ui.platform

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri

@Composable
actual fun rememberBrowser(): Browser {
    val context = LocalContext.current
    return remember(context) {
        Browser { url ->
            val uri = url.toUri()
            val view = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (uri.scheme != "https" && uri.scheme != "http") {
                // mailto: and the like open in their own app.
                runCatching { context.startActivity(view) }
                return@Browser
            }
            try {
                CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
            } catch (_: ActivityNotFoundException) {
                // No browser supports Custom Tabs: any that opens links will do.
                runCatching { context.startActivity(view) }
            }
        }
    }
}
