package com.fitai.coach.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.privacy.PrivacyNoticeContent
import com.fitai.coach.ui.privacy.PrivacyNoticeState
import com.fitai.coach.ui.privacy.PrivacyNoticeViewModel
import com.fitai.coach.ui.shell.AppShell
import org.koin.compose.viewmodel.koinViewModel

/**
 * What a signed-in user sees: the first-run privacy notice until it is
 * acknowledged, then the app. Keyed by [userId], so another account on the
 * same device gets its own check.
 */
@Composable
fun SignedInRoot(userId: String) {
    val privacy = koinViewModel<PrivacyNoticeViewModel>(key = "privacy-$userId")
    val state by privacy.state.collectAsStateWithLifecycle()
    when (val current = state) {
        PrivacyNoticeState.Checking -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingState() }
        is PrivacyNoticeState.Needed -> PrivacyNoticeContent(current, privacy::acknowledge)
        PrivacyNoticeState.Acknowledged -> AppShell()
    }
}
