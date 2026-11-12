package com.fitai.coach.ui.timeline

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.PlanDayRecoveryPreview
import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingOverviewSummary
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.data.AnalyticsRange
import com.fitai.coach.core.data.AnnotationDraft
import com.fitai.coach.core.data.RecoveryAction
import com.fitai.coach.core.data.TimelineRepository
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.currentHourIn
import com.fitai.coach.ui.components.UndoOffer
import com.fitai.coach.ui.format.userMessage
import com.fitai.coach.ui.fuelling.DateRange
import com.fitai.coach.ui.fuelling.DayFuelling
import com.fitai.coach.ui.fuelling.EstimateResult
import com.fitai.coach.ui.fuelling.then
import com.fitai.coach.ui.review.ReviewPrompt
import com.fitai.coach.ui.review.reviewPrompt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    /** The status filter; null shows everything. */
    val statusFilter: TimelineEntry.Status? = null,
    /** The "This week" card; null before there is anything to show. */
    val week: WeekSummary? = null,
    /** All-time personal records, for the trophies on exercise chips. */
    val records: Map<String, PersonalRecord> = emptyMap(),
    /** The auto-coach is reviewing a workout and may change upcoming sessions. */
    val coachReviewing: Boolean = false,
    /** Sunday evening to Tuesday: the nudge into last week's review, unless dismissed for that week. */
    val reviewPrompt: ReviewPrompt? = null,
    /** Older history can be loaded from the server. */
    val hasOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    /** Each day's fuelling chip, by date; days without one are absent. */
    val fuelling: Map<String, DayFuelling> = emptyMap(),
    /** For the planned-session fuelling targets; null without one in the profile. */
    val bodyweightKg: Double? = null,
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
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class TimelineViewModel(
    private val session: UserSession,
    private val todayIn: (String?) -> String,
    private val hourIn: (String?) -> Int = ::currentHourIn,
) : ViewModel() {
    private val timeline: TimelineRepository = session.timeline
    private val selectedPlan = MutableStateFlow<String?>(null)
    private val expanded = MutableStateFlow(INITIAL_DAYS to INITIAL_DAYS)
    private val status = MutableStateFlow(RefreshStatus())
    private val filter = MutableStateFlow(Filter())
    private val toasts = Channel<String>(Channel.BUFFERED)
    private val undoOffers = Channel<UndoOffer>(Channel.BUFFERED)

    val messages: Flow<String> = toasts.receiveAsFlow()
    val undos: Flow<UndoOffer> = undoOffers.receiveAsFlow()

    private val pendingSessionEdits = mutableMapOf<String, PatchPlansDaysByDayIdRequest>()
    private val sessionSaves = mutableMapOf<String, Job>()

    private val _recovery = MutableStateFlow<RecoveryState?>(null)
    val recovery: StateFlow<RecoveryState?> = _recovery

    private val extras = combine(
        session.annotations.annotations,
        session.analytics.records(AnalyticsRange.All),
        session.account.user,
        session.reviews.dismissedPrompt,
    ) { annotations, records, user, dismissed ->
        Extras(annotations.orEmpty(), records.orEmpty(), user?.isAutoCoaching == true, dismissed)
    }

    private val fuellingDays = session.nutrition.fuelling.days.map { range ->
        range?.days.orEmpty().mapNotNull(DayFuelling::of).associateBy { it.date }
    }

    val state: StateFlow<TimelineUiState> = combine(
        combine(timeline.entries, extras, fuellingDays, ::Triple),
        combine(timeline.plans, timeline.weekSummary, ::Pair),
        session.preferences.preferences,
        combine(selectedPlan, expanded, filter, timeline.olderCursor, ::Shown),
        status,
    ) { (entries, more, fuelling), (plans, summary), prefs, shown, refresh ->
        val today = todayIn(prefs?.userTimezone)
        TimelineUiState(
            loaded = true,
            today = today,
            rows = buildTimelineRows(
                entries,
                today,
                TimelineFilter(planId = shown.planId, status = shown.filter.status),
                pastDays = shown.days.first,
                upcomingDays = shown.days.second,
            ).withAnnotations(more.annotations, today),
            week = weekSummary(entries, plans.orEmpty(), shown.planId, summary, today),
            records = more.records,
            coachReviewing = more.coachReviewing,
            reviewPrompt = reviewPrompt(today, hourIn(prefs?.userTimezone))?.takeIf { it.weekStart != more.dismissedPrompt },
            plans = plans.orEmpty().filter { it.retiredOn == null || it.id == shown.planId },
            selectedPlanId = shown.planId,
            summary = summary,
            refreshing = refresh.refreshing,
            loadFailed = refresh.failed && entries.isEmpty(),
            hasAnyEntries = entries.isNotEmpty(),
            statusFilter = shown.filter.status,
            hasOlder = shown.olderCursor != null,
            loadingOlder = shown.filter.loadingOlder,
            fuelling = fuelling,
            bodyweightKg = prefs?.bodyweightKg,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), TimelineUiState())

    init {
        refresh()
        watchCoach()
    }

    fun refresh() {
        if (status.value.refreshing) return
        viewModelScope.launch {
            status.value = RefreshStatus(refreshing = true)
            val ok = attempt { timeline.refresh() }
            attempt { timeline.refreshPlans() }
            attempt { timeline.refreshSummary() }
            attempt { session.annotations.refresh() }
            attempt { session.analytics.refreshRecords(AnalyticsRange.All, state.value.today.ifEmpty { todayIn(null) }) }
            attempt { session.account.refreshUser() }
            status.value = RefreshStatus(refreshing = false, failed = !ok)
        }
    }

    /**
     * While the auto-coach reviews a workout (it can take a few minutes),
     * asks again every few seconds, as the web does, and shows the changed
     * sessions once it's done.
     */
    private fun watchCoach() {
        viewModelScope.launch {
            session.account.user.map { it?.isAutoCoaching == true }.distinctUntilChanged().collectLatest { reviewing ->
                if (!reviewing) return@collectLatest
                repeat(MAX_COACH_POLLS) {
                    delay(COACH_POLL_MS)
                    attempt { session.account.refreshUser() }
                }
            }
        }
        viewModelScope.launch {
            var wasReviewing = false
            session.account.user.map { it?.isAutoCoaching == true }.distinctUntilChanged().collect { reviewing ->
                if (wasReviewing && !reviewing) attempt { timeline.refresh() }
                wasReviewing = reviewing
            }
        }
    }

    /** Hides the weekly review prompt for [weekStart]'s window; it returns for the next week. */
    fun dismissReviewPrompt(weekStart: String) {
        viewModelScope.launch { attempt { session.reviews.dismissPrompt(weekStart) } }
    }

    /** Adds a training note, or (with [id]) changes one. */
    fun saveAnnotation(id: String?, draft: AnnotationDraft) = act("Couldn't save that note") {
        session.annotations.save(id, draft)
        toasts.send(if (id == null) "Note added" else "Note updated")
    }

    fun deleteAnnotation(id: String) = act("Couldn't delete that note") {
        session.annotations.delete(id)
        toasts.send("Note deleted")
    }

    /** Links a Strava recording to a session on its day ("Was this your …?"). */
    fun linkRecording(entry: TimelineEntry, target: DeviceLinkOption) = act("Couldn't link that activity") {
        session.workouts.linkDevice(requireNotNull(entry.workoutLogId), target.planDayId, target.workoutLogId)
        timeline.refresh()
        toasts.send("Linked to ${target.label}")
    }

    /** Splits a linked recording back into its own workout. */
    fun unlinkRecording(entry: TimelineEntry) = act("Couldn't unlink that activity") {
        session.workouts.unlinkDevice(requireNotNull(entry.workoutLogId))
        timeline.refresh()
        toasts.send("Strava activity unlinked")
    }

    /** "Not this one": drops the suggested match for good. */
    fun dismissSuggestion(entry: TimelineEntry) = act("Couldn't dismiss that suggestion") {
        session.workouts.dismissDeviceSuggestion(requireNotNull(entry.workoutLogId))
        timeline.refresh()
    }

    fun selectPlan(planId: String?) {
        selectedPlan.value = planId
    }

    fun showMorePast() = expanded.update { (past, upcoming) -> past + INITIAL_DAYS to upcoming }

    fun showMoreUpcoming() = expanded.update { (past, upcoming) -> past to upcoming + INITIAL_DAYS }

    fun filterBy(status: TimelineEntry.Status?) = filter.update { it.copy(status = status) }

    /** Loads the next page of older history and shows it. */
    fun loadOlder() {
        if (filter.value.loadingOlder) return
        filter.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val added = timeline.loadOlder()
                if (added.isEmpty()) {
                    toasts.send("No older workouts")
                } else {
                    val dates = added.map { it.date }.distinct().size
                    expanded.update { (past, upcoming) -> past + dates to upcoming }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't load older workouts"))
            } finally {
                filter.update { it.copy(loadingOlder = false) }
            }
        }
    }

    /** Moves a session to [date]: a quick move from its card, a picked date, or "move instead" of skipping. */
    fun move(entry: TimelineEntry, date: String) = act("Couldn't move workout") {
        val today = state.value.today
        if (!canMoveTo(entry, date, addDaysToIsoDate(today, 1))) return@act
        timeline.move(entry, date, today)
        toasts.send("Workout moved")
    }

    /** Removes a skipped plan day from its plan; the toast can undo it. */
    fun deletePlanDay(entry: TimelineEntry) = act("Couldn't delete that workout") {
        val binId = timeline.deletePlanDay(requireNotNull(entry.planDayId))
        undoOffers.send(UndoOffer("Workout removed from plan") { timeline.restore(binId) })
    }

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

    /**
     * Fetches the fuelling chips for [window], the days on screen. A failure
     * (offline, nutrition off) keeps what's on the device, or shows no chips.
     */
    fun showFuelling(window: DateRange) {
        viewModelScope.launch { attempt { session.nutrition.fuelling.refreshDays(window.from, window.to) } }
    }

    /** The server's duration and effort for a planned session, for its fuelling panel. */
    suspend fun plannedEstimate(planDayId: String): EstimateResult = try {
        EstimateResult.Ready(session.nutrition.fuelling.plannedEstimate(planDayId))
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiException) {
        if (e.status == NOT_FOUND) EstimateResult.NotFound else EstimateResult.Failed
    } catch (_: Exception) {
        EstimateResult.Failed
    }

    /**
     * Saves a planned session's expected duration, effort or start time, half
     * a second after the last change, so a run of stepper taps (and changes
     * to different fields) go out as one edit. A save waiting when the sheet
     * closes still goes.
     */
    fun saveExpectedSession(entry: TimelineEntry, edit: PatchPlansDaysByDayIdRequest) {
        pendingSessionEdits[entry.id] = pendingSessionEdits[entry.id]?.then(edit) ?: edit
        sessionSaves[entry.id]?.cancel()
        sessionSaves[entry.id] = viewModelScope.launch {
            delay(SESSION_SAVE_DEBOUNCE_MS)
            val pending = pendingSessionEdits.remove(entry.id) ?: return@launch
            // Once it's sent, a newer change waits for it rather than cutting it off.
            withContext(NonCancellable) {
                try {
                    timeline.editPlanDay(entry, pending)
                } catch (e: Exception) {
                    toasts.send(e.userMessage("Couldn't save your expected session details"))
                }
            }
        }
    }

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

    private data class Filter(val status: TimelineEntry.Status? = null, val loadingOlder: Boolean = false)

    private data class Extras(
        val annotations: List<TimelineAnnotation>,
        val records: Map<String, PersonalRecord>,
        val coachReviewing: Boolean,
        val dismissedPrompt: String?,
    )

    /** What the list shows: the plan, how many days each way, the filter, and where older history starts. */
    private data class Shown(val planId: String?, val days: Pair<Int, Int>, val filter: Filter, val olderCursor: String?)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L

        /** Every 3 seconds for up to 5 minutes, the longest a review takes. */
        const val COACH_POLL_MS = 3_000L
        const val MAX_COACH_POLLS = 100

        /** How long a planned session's expected values wait for another change before saving. */
        const val SESSION_SAVE_DEBOUNCE_MS = 500L

        const val NOT_FOUND = 404
    }
}
