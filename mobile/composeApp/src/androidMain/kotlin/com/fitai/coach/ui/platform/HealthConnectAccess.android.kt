package com.fitai.coach.ui.platform

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import androidx.health.connect.client.PermissionController
import com.fitai.coach.core.health.HealthConnectSource
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

private const val HEALTH_CONNECT_PACKAGE = "com.google.android.apps.healthdata"

@Composable
actual fun rememberHealthConnectAccess(): HealthConnectAccess? {
    val context = LocalContext.current
    val source = koinInject<HealthConnectSource>()
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<((Boolean) -> Unit)?>(null) }
    val launcher = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        pending?.invoke(granted.containsAll(HealthConnectSource.READ_PERMISSIONS))
        pending = null
    }
    return remember(context, source, launcher) {
        object : HealthConnectAccess {
            override fun requestPermissions(onResult: (granted: Boolean) -> Unit) {
                pending = onResult
                scope.launch { launcher.launch(source.permissionsToRequest()) }
            }

            override fun openInstall() {
                // Health Connect's own onboarding link, so it opens set up for the app.
                val market = Intent(
                    Intent.ACTION_VIEW,
                    "market://details?id=$HEALTH_CONNECT_PACKAGE&url=healthconnect%3A%2F%2Fonboarding".toUri(),
                ).setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val web = Intent(Intent.ACTION_VIEW, "https://play.google.com/store/apps/details?id=$HEALTH_CONNECT_PACKAGE".toUri())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(market) }.onFailure { runCatching { context.startActivity(web) } }
            }
        }
    }
}
