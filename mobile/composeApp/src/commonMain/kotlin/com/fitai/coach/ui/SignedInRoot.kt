package com.fitai.coach.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.privacy.PrivacyNoticeContent
import com.fitai.coach.ui.privacy.PrivacyNoticeState
import com.fitai.coach.ui.privacy.PrivacyNoticeViewModel
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.shell.AppShell
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

/**
 * What a signed-in user sees: the first-run privacy notice until it is
 * acknowledged, then the app. Keyed by [userId], so another account on the
 * same device gets its own check. Waits for the user's session (their
 * database) to open, then provides it to the screens below, and keeps the
 * athlete's saved timezone the phone's each time the app comes back.
 */
@Composable
fun SignedInRoot(userId: String) {
    val sessions = koinInject<SessionManager>()
    val session by sessions.session.collectAsStateWithLifecycle()
    val current = session?.takeIf { it.userId == userId }
    if (current == null) {
        Centered { LoadingState() }
        return
    }
    // Back in the foreground, perhaps after a flight: the server dates the
    // athlete's days in their saved timezone, so keep it the phone's.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { current.resumed() }
    CompositionLocalProvider(LocalUserSession provides current) {
        val privacy = koinViewModel<PrivacyNoticeViewModel>(key = "privacy-$userId")
        val state by privacy.state.collectAsStateWithLifecycle()
        when (val notice = state) {
            PrivacyNoticeState.Checking -> Centered { LoadingState() }
            is PrivacyNoticeState.Needed -> PrivacyNoticeContent(notice, privacy::acknowledge)
            PrivacyNoticeState.Acknowledged -> AppShell()
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
