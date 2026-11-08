package com.fitai.coach.ui.privacy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.ConsentType
import com.fitai.coach.core.api.generated.PostConsentsRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Whether the first-run privacy notice has to be shown. */
sealed interface PrivacyNoticeState {
    data object Checking : PrivacyNoticeState

    data class Needed(val saving: Boolean = false, val error: String? = null) : PrivacyNoticeState

    data object Acknowledged : PrivacyNoticeState
}

/**
 * The first-run privacy notice (docs/mobile-app-plan.md, Phase 3), recorded
 * through the consent API as the web's PrivacyConsentBanner does: the notice
 * as `privacy_notice`, and the analytics choice as `error_reporting`. The
 * server's consent records decide whether it shows, so it appears once per
 * account, on any device. Error reporting starts only once it is granted
 * (Sentry, Phase 6).
 */
class PrivacyNoticeViewModel(private val api: ApiClient) : ViewModel() {
    private val mutableState = MutableStateFlow<PrivacyNoticeState>(PrivacyNoticeState.Checking)
    val state: StateFlow<PrivacyNoticeState> = mutableState.asStateFlow()

    init {
        viewModelScope.launch { mutableState.value = check() }
    }

    @Suppress("TooGenericExceptionCaught", "SwallowedException")
    private suspend fun check(): PrivacyNoticeState = try {
        val consents = api.call(ApiEndpoints.GetConsents).consents
        val acknowledged = consents.any { it.consentType == ConsentType.PrivacyNotice && it.granted }
        if (acknowledged) PrivacyNoticeState.Acknowledged else PrivacyNoticeState.Needed()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        // Unknown (offline, server down): don't block the app on a disclosure
        // check; it runs again on the next launch.
        PrivacyNoticeState.Acknowledged
    }

    /** "accept" ([errorReporting] true) or "decline analytics" (false). */
    @Suppress("TooGenericExceptionCaught", "SwallowedException")
    fun acknowledge(errorReporting: Boolean) {
        val current = state.value as? PrivacyNoticeState.Needed ?: return
        if (current.saving) return
        mutableState.value = current.copy(saving = true, error = null)
        viewModelScope.launch {
            try {
                api.call(ApiEndpoints.PostConsents, PostConsentsRequest(PostConsentsRequest.ConsentType.ErrorReporting, errorReporting))
                api.call(ApiEndpoints.PostConsents, PostConsentsRequest(PostConsentsRequest.ConsentType.PrivacyNotice, true))
                mutableState.value = PrivacyNoticeState.Acknowledged
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                mutableState.update { PrivacyNoticeState.Needed(error = "couldn't save your choice. check your connection and retry.") }
            }
        }
    }
}
