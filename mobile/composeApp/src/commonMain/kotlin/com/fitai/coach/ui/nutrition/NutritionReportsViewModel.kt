package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetNutritionInsightsResponse
import com.fitai.coach.core.api.generated.GetNutritionMicrosResponse
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.data.NutritionReports
import com.fitai.coach.ui.analytics.describeAiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** A day's micronutrients: null rows until they've loaded (or while they can't). */
data class MicrosState(val rows: List<GetNutritionMicrosResponse.MicrosItem>? = null, val loading: Boolean = true)

/** The nutrition insights panel (NutritionInsightsPanel.tsx). */
data class NutritionInsightsState(
    val insights: GetNutritionInsightsResponse? = null,
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
 * What the day's log adds up to: its micronutrients, fetched for the day on
 * screen ([showMicros]); and the AI's insights on recent fuelling, the stored
 * analysis at once and a new one on [generateInsights].
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooGenericExceptionCaught")
class NutritionReportsViewModel(private val reports: NutritionReports, user: Flow<User?>) : ViewModel() {
    private val microsDate = MutableStateFlow<String?>(null)
    private val microsLoading = MutableStateFlow(false)
    private val insightsStatus = MutableStateFlow(Status(loading = true))

    val micros: StateFlow<MicrosState> = microsDate
        .flatMapLatest { date -> date?.let { reports.micros(it) } ?: flowOf(null) }
        .combine(microsLoading) { micros, loading -> MicrosState(micros?.micros, loading = micros == null && loading) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), MicrosState())

    val insights: StateFlow<NutritionInsightsState> =
        combine(reports.insights, user.map { it?.aiCoachEnabled == false }, insightsStatus) { insights, off, status ->
            NutritionInsightsState(
                insights = insights,
                loading = insights == null && status.loading,
                generating = status.generating,
                error = status.error,
                aiCoachOff = off,
            )
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), NutritionInsightsState())

    init {
        runInsights(generate = false)
    }

    /**
     * Shows [date]'s micros, fetching them again: called when the day on
     * screen or what's logged on it changes. A failure keeps what's cached.
     */
    fun showMicros(date: String) {
        microsDate.value = date
        microsLoading.value = true
        viewModelScope.launch {
            try {
                reports.refreshMicros(date)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The panel shows what's on the device, or its empty state.
            } finally {
                microsLoading.value = false
            }
        }
    }

    fun generateInsights() = runInsights(generate = true)

    private fun runInsights(generate: Boolean) {
        if (insightsStatus.value.generating) return
        insightsStatus.value = Status(loading = !generate, generating = generate)
        viewModelScope.launch {
            val error = try {
                if (generate) reports.regenerateInsights() else reports.refreshInsights()
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                describeAiFailure(
                    e,
                    "requesting nutrition insights",
                    "Sorry, I couldn't generate your nutrition insights right now. Please try again.",
                )
            }
            insightsStatus.value = Status(error = error)
        }
    }

    private data class Status(val loading: Boolean = false, val generating: Boolean = false, val error: String? = null)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
