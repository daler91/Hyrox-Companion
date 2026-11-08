package com.fitai.coach.ui.timeline

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest
import com.fitai.coach.core.api.generated.PlanDayRecoveryPreview
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingOverviewSummary
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.data.PreferencesRepository
import com.fitai.coach.core.data.RecoveryAction
import com.fitai.coach.core.data.TimelineRepository
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TimelineUiState(
    val loaded: Boolean = false,
    val today: String = "",
    val rows: TimelineRows = TimelineRows(emptyList(), 0, 0),
    val plans: List<TrainingPlan> = emptyList(),
    val selectedPlanId: String? = null,
    val summary: TrainingOverviewSummary? = null,
    val refreshing: Boolean = false,
    /** The last refresh failed and there is nothing cached to show. */
    val loadFailed: Boolean = false,
    val hasAnyEntries: Boolean = false,
)

/** The recovery sheet for a missed day: loading, the options, or why they couldn't load. */
sealed interface RecoveryState {
    data class Loading(val entry: TimelineEntry) : RecoveryState

    data class Ready(val entry: TimelineEntry, val preview: PlanDayRecoveryPreview, val saving: Boolean = false) : RecoveryState

    data class Failed(val entry: TimelineEntry, val message: String) : RecoveryState
}

/**
 * The training timeline: entries grouped by day from the device's cache,
 * refreshed from the server, with the actions on a plan day.
 */
@Suppress("TooGenericExceptionCaught")
class TimelineViewModel(
    private val timeline: TimelineRepository,
    preferences: PreferencesRepository,
    private val todayIn: (String?) -> String,
) : ViewModel() {
    private val selectedPlan = MutableStateFlow<String?>(null)
    private val expanded = MutableStateFlow(INITIAL_DAYS to INITIAL_DAYS)
    private val status = MutableStateFlow(RefreshStatus())
    private val toasts = Channel<String>(Channel.BUFFERED)

    val messages: Flow<String> = toasts.receiveAsFlow()

    private val _recovery = MutableStateFlow<RecoveryState?>(null)
    val recovery: StateFlow<RecoveryState?> = _recovery

    val state: StateFlow<TimelineUiState> = combine(
        timeline.entries,
        combine(timeline.plans, timeline.weekSummary, ::Pair),
        preferences.preferences,
        combine(selectedPlan, expanded, ::Pair),
        status,
    ) { entries, (plans, summary), prefs, (planId, days), refresh ->
        val today = todayIn(prefs?.userTimezone)
        TimelineUiState(
            loaded = true,
            today = today,
            rows = buildTimelineRows(entries, today, planId, days.first, days.second),
            plans = plans.orEmpty().filter { it.retiredOn == null || it.id == planId },
            selectedPlanId = planId,
            summary = summary,
            refreshing = refresh.refreshing,
            loadFailed = refresh.failed && entries.isEmpty(),
            hasAnyEntries = entries.isNotEmpty(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), TimelineUiState())

    init {
        refresh()
    }

    fun refresh() {
        if (status.value.refreshing) return
        viewModelScope.launch {
            status.value = RefreshStatus(refreshing = true)
            val ok = attempt { timeline.refresh() }
            attempt { timeline.refreshPlans() }
            attempt { timeline.refreshSummary() }
            status.value = RefreshStatus(refreshing = false, failed = !ok)
        }
    }

    fun selectPlan(planId: String?) {
        selectedPlan.value = planId
    }

    fun showMorePast() = expanded.update { (past, upcoming) -> past + INITIAL_DAYS to upcoming }

    fun showMoreUpcoming() = expanded.update { (past, upcoming) -> past to upcoming + INITIAL_DAYS }

    fun markDone(entry: TimelineEntry, rpe: Int? = null, notes: String? = null) = act("Couldn't log that workout") {
        timeline.markDone(entry, rpe, notes?.takeIf { it.isNotBlank() })
        toasts.send("Workout logged")
    }

    fun skip(entry: TimelineEntry, reason: PatchPlansDaysByDayIdStatusRequest.SkipReason?) = act("Couldn't skip that workout") {
        timeline.skip(entry, reason)
        toasts.send("Workout skipped")
    }

    fun reopen(entry: TimelineEntry) = act("Couldn't reopen that workout") {
        timeline.reopen(entry)
        toasts.send("Back on your plan")
    }

    fun openRecovery(entry: TimelineEntry) {
        val planDayId = entry.planDayId ?: return
        _recovery.value = RecoveryState.Loading(entry)
        viewModelScope.launch {
            _recovery.value = try {
                RecoveryState.Ready(entry, timeline.recoveryPreview(planDayId))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                RecoveryState.Failed(entry, e.userMessage("Couldn't work out the options. Check your connection and try again."))
            }
        }
    }

    fun closeRecovery() {
        _recovery.value = null
    }

    fun recover(action: RecoveryAction) {
        val ready = _recovery.value as? RecoveryState.Ready ?: return
        val planDayId = ready.entry.planDayId ?: return
        _recovery.value = ready.copy(saving = true)
        viewModelScope.launch {
            try {
                timeline.recover(planDayId, action)
                _recovery.value = null
                toasts.send(
                    when (action) {
                        is RecoveryAction.Fold -> "Session moved"
                        is RecoveryAction.Shorten -> "Shorter session planned"
                        RecoveryAction.LetGo -> "Let go — the plan carries on"
                        RecoveryAction.Reopen -> "Back on your list to decide"
                    },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _recovery.value = RecoveryState.Failed(ready.entry, e.userMessage("Couldn't update the session"))
            }
        }
    }

    /** Undoes an earlier fold, shorten or let go, straight from the card. */
    fun undoRecovery(entry: TimelineEntry) = act("Couldn't update the session") {
        timeline.recover(requireNotNull(entry.planDayId), RecoveryAction.Reopen)
        toasts.send("Back on your list to decide")
    }

    fun tomorrow(today: String): String = addDaysToIsoDate(today, 1)

    private fun act(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage(failure))
            }
        }
    }

    private suspend fun attempt(block: suspend () -> Unit): Boolean = try {
        block()
        true
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }

    private data class RefreshStatus(val refreshing: Boolean = false, val failed: Boolean = false)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
