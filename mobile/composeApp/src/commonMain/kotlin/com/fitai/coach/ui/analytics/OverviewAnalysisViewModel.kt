package com.fitai.coach.ui.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.OverviewAnalysis
import com.fitai.coach.core.api.generated.OverviewAnalysisSections
import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.data.AnalyticsRange
import com.fitai.coach.core.data.AnalyticsRepository
import com.fitai.coach.core.data.AnnotationRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OverviewAnalysisState(
    val range: AnalyticsRange = AnalyticsRange.Quarter,
    val analysis: OverviewAnalysis? = null,
    val generating: Boolean = false,
    /** Why the last generate failed, in words for the athlete. */
    val error: String? = null,
    /** The athlete hasn't turned the AI Coach on: Generate is off, and the header says why. */
    val aiCoachOff: Boolean = false,
    /** Injury, illness, travel and rest notes, shaded on the weekly chart. */
    val annotations: List<TimelineAnnotation> = emptyList(),
) {
    val sections: OverviewAnalysisSections? get() = analysis?.sections
    val hasAnalysis: Boolean get() = sections != null
}

/**
 * The AI's plain-language reading of the Overview charts (useOverviewAnalysis),
 * one per range: the stored reading shows at once, and Generate runs the AI
 * now. A generate keeps running if the athlete switches range; its spinner and
 * any error stay with the range it was for.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooGenericExceptionCaught")
class OverviewAnalysisViewModel(
    private val analytics: AnalyticsRepository,
    user: Flow<User?>,
    private val notes: AnnotationRepository,
    range: AnalyticsRange,
) : ViewModel() {
    private val selected = MutableStateFlow(range)
    private val runs = MutableStateFlow<Map<AnalyticsRange, Run>>(emptyMap())

    val state: StateFlow<OverviewAnalysisState> = combine(
        selected,
        selected.flatMapLatest { analytics.overviewAnalysis(it) },
        user,
        notes.annotations,
        runs,
    ) { current, analysis, account, annotations, all ->
        val run = all[current] ?: Run()
        OverviewAnalysisState(
            range = current,
            analysis = analysis,
            generating = run.generating,
            error = run.error,
            aiCoachOff = account?.aiCoachEnabled == false,
            annotations = annotations.orEmpty(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), OverviewAnalysisState(range))

    init {
        load(range)
        viewModelScope.launch { quietly { notes.refresh() } }
    }

    /** Shows [range]'s reading, fetching the stored one. */
    fun select(range: AnalyticsRange) {
        if (selected.value == range) return
        selected.value = range
        load(range)
    }

    fun generate() {
        val range = selected.value
        if (runs.value[range]?.generating == true) return
        runs.update { it + (range to Run(generating = true)) }
        viewModelScope.launch {
            val error = try {
                analytics.regenerateOverviewAnalysis(range)
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                describeAiFailure(e, "requesting analysis", "Sorry, I couldn't generate the chart analysis right now. Please try again.")
            }
            runs.update { it + (range to Run(error = error)) }
        }
    }

    /** A stored reading is a bonus over the charts: one that won't load leaves them as they are. */
    private fun load(range: AnalyticsRange) {
        viewModelScope.launch { quietly { analytics.refreshOverviewAnalysis(range) } }
    }

    private suspend fun quietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Offline or not generated yet: the cached copy, if any, still shows.
        }
    }

    private data class Run(val generating: Boolean = false, val error: String? = null)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
