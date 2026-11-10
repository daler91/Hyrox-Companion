package com.fitai.coach.ui.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.SessionGradesResponse
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.data.AnalyticsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SessionGradesState(
    val grades: SessionGradesResponse? = null,
    val loading: Boolean = true,
    val failed: Boolean = false,
    /** The plan picked; null for the active one. */
    val planId: String? = null,
    /** The plans to pick from; the picker shows only when there are two or more. */
    val plans: List<TrainingPlan> = emptyList(),
)

/**
 * "Did the session do its job?" across one plan (SessionGradesTab): fetched
 * fresh, since the server computes it on read.
 */
@Suppress("TooGenericExceptionCaught")
class SessionGradesViewModel(private val analytics: AnalyticsRepository, plans: Flow<List<TrainingPlan>?>) : ViewModel() {
    private val loaded = MutableStateFlow(SessionGradesState())
    private var job: Job? = null

    val state: StateFlow<SessionGradesState> = combine(loaded, plans) { s, all -> s.copy(plans = all.orEmpty()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), SessionGradesState())

    init {
        load(null)
    }

    fun selectPlan(planId: String?) = load(planId)

    fun retry() = load(loaded.value.planId)

    private fun load(planId: String?) {
        job?.cancel()
        loaded.update { it.copy(planId = planId, loading = true, failed = false) }
        job = viewModelScope.launch {
            try {
                val grades = analytics.sessionGrades(planId)
                loaded.update { it.copy(grades = grades, loading = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                loaded.update { it.copy(grades = null, loading = false, failed = true) }
            }
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
