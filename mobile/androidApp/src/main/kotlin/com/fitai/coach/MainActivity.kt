package com.fitai.coach

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.SessionEvent
import com.fitai.coach.ui.App
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {
    private val api: ApiClient by inject()
    private val inAppUpdate = InAppUpdate(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                api.events.filterIsInstance<SessionEvent.UpdateRequired>().collect { inAppUpdate.prompt() }
            }
        }
        setContent { App() }
    }
}
