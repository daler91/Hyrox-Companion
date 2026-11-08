package com.fitai.coach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.SessionEvent
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.auth.SignInScreen
import com.fitai.coach.ui.components.NexusMark
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import org.koin.compose.koinInject

/**
 * The app's root, shared by every platform's entry point: the session
 * decides the screen. A 401 from the API signs out locally; a 426 shows the
 * update-required screen (Android also opens a Play In-App Update).
 */
@Composable
fun App() {
    val auth = koinInject<AuthGateway>()
    val api = koinInject<ApiClient>()
    val authState by auth.state.collectAsStateWithLifecycle()
    var updateRequired by remember { mutableStateOf(false) }

    LaunchedEffect(api) {
        api.events.collect { event ->
            when (event) {
                SessionEvent.SignedOut -> runCatching { auth.signOut() }
                is SessionEvent.UpdateRequired -> updateRequired = true
            }
        }
    }

    FitaiTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = FitaiTheme.colors.background) {
            val current = authState
            when {
                updateRequired -> UpdateRequiredScreen()
                current is AuthState.SignedIn -> SignedInRoot(current.userId)
                current is AuthState.SignedOut -> SignInScreen()
                else -> Splash()
            }
        }
    }
}

@Composable
private fun Splash() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { NexusMark(size = 96.dp) }
}

@Composable
private fun UpdateRequiredScreen() {
    Column(
        modifier = Modifier.fillMaxSize().padding(Spacing.Gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        NexusMark(size = 64.dp)
        Text("update required", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
        Text(
            "this version of the app is no longer supported. update it from the play store to keep going.",
            style = FitaiTheme.typography.body,
            color = FitaiTheme.colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}
