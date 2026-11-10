package com.fitai.coach.ui.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.CoachInsights
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.data.AnalyticsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class CoachInsightsState(
    val insights: CoachInsights? = null,
    val loading: Boolean = true,
    val generating: Boolean = false,
    /** Why the last generate (or load) failed, in words for the athlete. */
    val error: String? = null,
    /** The athlete hasn't turned the AI Coach on: Generate is off, and the panel says why. */
    val aiCoachOff: Boolean = false,
) {
    val hasInsights: Boolean get() = insights?.insights != null
}

/**
 * Coach Insights (CoachInsightsTab): the stored analysis shows at once;
 * Generate (or Regenerate) runs the AI now, which can take tens of seconds.
 */
@Suppress("TooGenericExceptionCaught")
class CoachInsightsViewModel(private val analytics: AnalyticsRepository, user: Flow<User?>) : ViewModel() {
    private val status = MutableStateFlow(Status(loading = true))

    val state: StateFlow<CoachInsightsState> = combine(analytics.coachInsights, user, status) { insights, account, st ->
        CoachInsightsState(
            insights = insights,
            loading = insights == null && st.loading,
            generating = st.generating,
            error = st.error,
            aiCoachOff = account?.aiCoachEnabled == false,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), CoachInsightsState())

    init {
        run(generate = false)
    }

    fun generate() = run(generate = true)

    private fun run(generate: Boolean) {
        if (status.value.generating) return
        status.value = Status(loading = !generate, generating = generate)
        viewModelScope.launch {
            val error = try {
                if (generate) analytics.regenerateCoachInsights() else analytics.refreshCoachInsights()
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                describeAiFailure(e, "requesting insights", "Sorry, I couldn't generate your coach insights right now. Please try again.")
            }
            status.value = Status(error = error)
        }
    }

    private data class Status(val loading: Boolean = false, val generating: Boolean = false, val error: String? = null)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
