package com.fitai.coach

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Prompts a Play In-App Update when the server reports this build is below
 * its minimum (HTTP 426, `MIN_APP_VERSION_ANDROID`). An immediate update
 * blocks the app until it is installed, which is what a retired build needs.
 * Builds not installed from Play get no prompt; the shared UI still shows its
 * update-required screen.
 */
class InAppUpdate(private val activity: ComponentActivity) {
    private val launcher: ActivityResultLauncher<IntentSenderRequest> =
        activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { }

    fun prompt() {
        val manager = AppUpdateManagerFactory.create(activity)
        manager.appUpdateInfo.addOnSuccessListener { info ->
            val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
                info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
            if (available && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                manager.startUpdateFlowForResult(info, launcher, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build())
            }
        }
    }
}
