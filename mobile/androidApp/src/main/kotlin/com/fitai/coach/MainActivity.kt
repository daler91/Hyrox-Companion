package com.fitai.coach

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.SessionEvent
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.health.HealthSync
import com.fitai.coach.core.health.HealthSyncScheduler
import com.fitai.coach.ui.App
import com.fitai.coach.ui.links.DeepLinks
import com.fitai.coach.ui.links.LinkSource
import com.fitai.coach.ui.links.parseDeepLink
import com.fitai.coach.ui.platform.AppBuild
import com.fitai.coach.ui.platform.LocalAppBuild
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {
    private val api: ApiClient by inject()
    private val sessions: SessionManager by inject()
    private val deepLinks: DeepLinks by inject()
    private val health: HealthSync by inject()
    private val healthScheduler: HealthSyncScheduler by inject()
    private val inAppUpdate = InAppUpdate(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Back in the foreground: a device that never lost its network
                // gets no reconnect signal, so this is the other moment to send.
                sessions.syncNow()
                // And pick up workouts recorded since, when the Health Connect sync is on.
                if (health.enabledFor.value != null) {
                    healthScheduler.schedule()
                    healthScheduler.syncNow()
                }
                api.events.filterIsInstance<SessionEvent.UpdateRequired>().collect { inAppUpdate.prompt() }
            }
        }
        // A recreated activity (rotation, process restore) already handled its intent.
        if (savedInstanceState == null) openLink(intent)
        val build = AppBuild(version = BuildConfig.VERSION_NAME, label = BuildConfig.BUILD_LABEL)
        setContent { CompositionLocalProvider(LocalAppBuild provides build) { App() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openLink(intent)
    }

    /**
     * An App Link (an email, Strava's return) carries its URL as the intent's
     * data; a tapped notification carries the server's path in its "url"
     * extra, which only ever opens one of the app's own screens.
     */
    private fun openLink(intent: Intent) {
        val appLink = intent.data?.takeIf { intent.action == Intent.ACTION_VIEW }?.toString()
        val notificationUrl = intent.getStringExtra(EXTRA_NOTIFICATION_URL)
        when {
            appLink != null -> deepLinks.open(parseDeepLink(appLink, BuildConfig.API_BASE_URL, LinkSource.AppLink))
            notificationUrl != null -> deepLinks.open(parseDeepLink(notificationUrl, BuildConfig.API_BASE_URL, LinkSource.Notification))
        }
    }

    companion object {
        /** The extra a notification's tap intent carries the server's path in (FCM's data key "url"). */
        const val EXTRA_NOTIFICATION_URL = "url"
    }
}
