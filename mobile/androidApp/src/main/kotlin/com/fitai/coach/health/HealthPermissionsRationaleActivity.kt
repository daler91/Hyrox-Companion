package com.fitai.coach.health

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.fitai.coach.ui.health.HealthRationaleRoot

/** Opened by Health Connect to explain why the app asks for its health permissions. */
class HealthPermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { HealthRationaleRoot(onClose = ::finish) }
    }
}
