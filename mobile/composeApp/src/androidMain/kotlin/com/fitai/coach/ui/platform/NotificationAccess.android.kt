package com.fitai.coach.ui.platform

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

@Composable
actual fun rememberNotificationAccess(): NotificationAccess {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<((Boolean) -> Unit)?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pending?.invoke(granted && NotificationManagerCompat.from(context).areNotificationsEnabled())
        pending = null
    }
    return remember(context, launcher) {
        object : NotificationAccess {
            override fun request(onResult: (granted: Boolean) -> Unit) {
                val needsAsking = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                if (needsAsking) {
                    pending = onResult
                    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    onResult(NotificationManagerCompat.from(context).areNotificationsEnabled())
                }
            }

            override fun openSettings() {
                val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(intent) }
            }
        }
    }
}
