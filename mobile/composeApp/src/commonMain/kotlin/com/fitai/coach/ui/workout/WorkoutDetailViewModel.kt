package com.fitai.coach.ui.workout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.SyncEvent
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class WorkoutDetailState(
    val workout: WorkoutLogDetail? = null,
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    /** The timeline entry this workout completed, when it completed a plan day (for Reopen). */
    val planEntry: TimelineEntry? = null,
)

/** Values typed into the set editor; blank clears a value. */
data class SetEdit(val reps: String, val weight: String, val distance: String, val time: String)

/** A logged workout and its sets; set edits go through the version-locked outbox. */
@Suppress("TooGenericExceptionCaught")
class WorkoutDetailViewModel(private val session: UserSession, private val workoutId: String) : ViewModel() {
    private val status = MutableStateFlow(Status())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<WorkoutDetailState> = combine(
        session.workouts.workout(workoutId),
        session.timeline.entries,
        status,
    ) { workout, entries, current ->
        WorkoutDetailState(
            workout = workout,
            loading = workout == null && current.loading,
            loadFailed = workout == null && current.failed,
            planEntry = entries.firstOrNull { it.workoutLogId == workoutId && it.planDayId != null },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), WorkoutDetailState())

    init {
        refresh()
        viewModelScope.launch {
            session.sync.events.filterIsInstance<SyncEvent.Conflict>().collect { conflict ->
                val setIds = state.value.workout?.exerciseSets?.map { "set:${it.id}" }.orEmpty()
                if (conflict.target in setIds) toasts.send("That set was changed on another device. Showing the latest.")
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            status.value = Status(loading = true)
            val failed = try {
                session.workouts.refresh(workoutId)
                false
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                true
            }
            status.value = Status(loading = false, failed = failed)
        }
    }

    /** Saves [edit] to a set: at once on the device, then on the server. */
    fun saveSet(setId: String, edit: SetEdit) {
        val patch = PatchWorkoutsByIdSetsBySetIdRequest(
            reps = edit.reps.toIntPatch(),
            weight = edit.weight.toDoublePatch(),
            distance = edit.distance.toDoublePatch(),
            time = edit.time.toDoublePatch(),
        )
        viewModelScope.launch {
            try {
                session.workouts.updateSet(workoutId, setId, patch)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't save that set"))
            }
        }
    }

    /** Reopens the plan day this workout completed; the server deletes the workout. */
    fun reopen(onDone: () -> Unit) {
        val entry = state.value.planEntry ?: return
        viewModelScope.launch {
            try {
                session.timeline.reopen(entry)
                onDone()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't reopen that workout"))
            }
        }
    }

    private data class Status(val loading: Boolean = false, val failed: Boolean = false)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L

        fun String.toIntPatch(): Patch<Int> = if (isBlank()) Patch.clear() else Patch.of(trim().toDouble().toInt())

        fun String.toDoublePatch(): Patch<Double> = if (isBlank()) Patch.clear() else Patch.of(trim().toDouble())
    }
}

/** Whether every typed value parses (blank is fine: it clears). */
fun SetEdit.isValid(): Boolean = listOf(reps, weight, distance, time).all {
    it.isBlank() ||
        it.trim().toDoubleOrNull()?.let { v -> v >= 0 } == true
}
