package com.fitai.coach.ui.workout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdSetsRequest
import com.fitai.coach.core.api.generated.SessionGrade
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.UpdateWorkoutRequest
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.SyncEvent
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WorkoutDetailState(
    val workout: WorkoutLogDetail? = null,
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    /** The timeline entry this workout completed, when it completed a plan day (for Reopen). */
    val planEntry: TimelineEntry? = null,
    /** Whether the session did its job; plan-linked runs only. */
    val grade: SessionGrade? = null,
    /** "Last time" and the next target, by exercise name. */
    val histories: Map<String, ExerciseHistory> = emptyMap(),
    /** A write that must reach the server first (a delete, a new set) is in flight. */
    val busy: Boolean = false,
)

/** Values typed into the set editor; blank clears a value. */
data class SetEdit(val reps: String, val weight: String, val distance: String, val time: String)

/**
 * The workout's own fields, as the details editor holds them. Blank clears
 * the duration, time of day ("07:30") and notes.
 */
data class DetailsEdit(
    val title: String,
    val duration: String,
    val timeOfDay: String,
    val rpe: Int?,
    val notes: String,
    val countsAsTraining: Boolean,
) {
    companion object {
        fun of(workout: WorkoutLogDetail): DetailsEdit = DetailsEdit(
            title = workout.focus,
            duration = workout.duration?.toString().orEmpty(),
            timeOfDay = workout.timeOfDayMin?.let(::formatTimeOfDay).orEmpty(),
            rpe = workout.rpe,
            notes = workout.notes.orEmpty(),
            countsAsTraining = workout.countsAsTraining,
        )
    }
}

/**
 * A logged workout, its sets and how it went, as the web's ReviewSurface: edit
 * its details and sets, add exercises, see last time and the next target, and
 * delete it (undoable from the recycle bin).
 */
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class WorkoutDetailViewModel(private val session: UserSession, private val workoutId: String) : ViewModel() {
    private val status = MutableStateFlow(Status())
    private val extras = MutableStateFlow(Extras())
    private val toasts = Channel<String>(Channel.BUFFERED)
    private val requestedHistory = mutableSetOf<String>()
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<WorkoutDetailState> = combine(
        session.workouts.workout(workoutId),
        session.timeline.entries,
        status,
        extras,
    ) { workout, entries, current, more ->
        WorkoutDetailState(
            workout = workout,
            loading = workout == null && current.loading,
            loadFailed = workout == null && current.failed,
            planEntry = entries.firstOrNull { it.workoutLogId == workoutId && it.planDayId != null },
            grade = more.grade,
            histories = more.histories,
            busy = more.busy,
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
        // History for each exercise on the workout, fetched once per name (and
        // again for an exercise added here).
        viewModelScope.launch {
            session.workouts.workout(workoutId)
                .map { workout -> workout?.exerciseSets?.map { it.exerciseName }?.distinct().orEmpty() }
                .distinctUntilChanged()
                .collect { names -> names.filter { it != CUSTOM_EXERCISE && requestedHistory.add(it) }.forEach { loadHistory(it) } }
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
            if (!failed) loadGrade()
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
        launchSafely("Couldn't save that set") { session.workouts.updateSet(workoutId, setId, patch) }
    }

    /** Saves the title, duration, RPE, notes and whether it counts as training. */
    fun saveDetails(edit: DetailsEdit) {
        val workout = state.value.workout ?: return
        val patch = UpdateWorkoutRequest(
            focus = edit.title.trim().takeIf { it.isNotEmpty() && it != workout.focus },
            duration = edit.duration.toIntPatch(),
            timeOfDayMin = parseTimeOfDay(edit.timeOfDay)?.let { Patch.of(it) } ?: Patch.clear(),
            rpe = edit.rpe?.let { Patch.of(it) } ?: Patch.clear(),
            notes = edit.notes.trim().let { if (it.isEmpty()) Patch.clear() else Patch.of(it) },
            countsAsTraining = edit.countsAsTraining.takeIf { it != workout.countsAsTraining },
        )
        launchSafely("Couldn't save those changes") { session.workouts.updateWorkout(workoutId, patch) }
    }

    /** Deletes the workout; [onDeleted] gets the recycle-bin item that undoes it. */
    fun delete(onDeleted: (recycleBinItemId: String) -> Unit) = online("Couldn't delete this workout") {
        val binId = session.workouts.deleteWorkout(workoutId)
        session.timeline.forgetWorkout(workoutId)
        runCatching { session.timeline.refresh() }
        onDeleted(binId)
    }

    /** Adds a set to an exercise, copying its last set's values so only what changed needs typing. */
    fun addSet(sets: List<ExerciseSetRow>) {
        val last = sets.maxByOrNull { it.setNumber } ?: return
        online("Couldn't add a set") {
            session.workouts.addSet(
                workoutId,
                PostWorkoutsByIdSetsRequest(
                    exerciseName = last.exerciseName,
                    customLabel = last.customLabel?.let { Patch.of(it) } ?: Patch.Absent,
                    category = last.category,
                    setNumber = last.setNumber + 1,
                    reps = last.reps?.let { Patch.of(it) } ?: Patch.Absent,
                    weight = last.weight?.let { Patch.of(it) } ?: Patch.Absent,
                    distance = last.distance?.let { Patch.of(it) } ?: Patch.Absent,
                    time = last.time?.let { Patch.of(it) } ?: Patch.Absent,
                ),
            )
        }
    }

    fun deleteSet(setId: String) = online("Couldn't remove that set") { session.workouts.deleteSet(workoutId, setId) }

    /**
     * Adds an exercise from the library, as one empty set to fill in; a name
     * the library doesn't know is added as a custom exercise. One the
     * workout already has gets another set instead.
     */
    fun addExercise(exerciseName: String, customLabel: String? = null) {
        val existing = state.value.workout?.exerciseSets?.filter { it.exerciseName == exerciseName && it.customLabel == customLabel }
        if (!existing.isNullOrEmpty()) return addSet(existing)
        val definition = EXERCISE_DEFINITIONS[exerciseName]
        online("Couldn't add that exercise") {
            session.workouts.addSet(
                workoutId,
                PostWorkoutsByIdSetsRequest(
                    exerciseName = if (definition != null) exerciseName else CUSTOM_EXERCISE,
                    customLabel = customLabel?.let { Patch.of(it) } ?: Patch.Absent,
                    category = definition?.category ?: CUSTOM_CATEGORY,
                    setNumber = 1,
                ),
            )
        }
    }

    /** Writes the suggested next target onto every set of the exercise (buildUseNextPatches). */
    fun useNext(sets: List<ExerciseSetRow>, target: NextTarget) {
        sets.forEach { set ->
            launchSafely("Couldn't apply the target") {
                session.workouts.updateSet(
                    workoutId,
                    set.id,
                    PatchWorkoutsByIdSetsBySetIdRequest(reps = Patch.of(target.reps), weight = Patch.of(target.weight)),
                )
            }
        }
    }

    /** Moves an exercise up ([offset] -1) or down (1) the workout. */
    fun moveExercise(groups: List<ExerciseGroup>, index: Int, offset: Int) {
        val order = reorderedSetIds(groups, index, offset) ?: return
        online("Couldn't move that exercise") { session.workouts.reorderSets(workoutId, order) }
    }

    /** Reopens the plan day this workout completed; the server deletes the workout. */
    fun reopen(onDone: () -> Unit) {
        val entry = state.value.planEntry ?: return
        launchSafely("Couldn't reopen that workout") {
            session.timeline.reopen(entry)
            onDone()
        }
    }

    /** Only a workout that completed a plan day is graded. */
    private fun loadGrade() {
        viewModelScope.launch {
            val workout = session.workouts.workout(workoutId).first()
            if (workout?.planDayId == null) return@launch
            val grade = runCatching { session.workouts.sessionGrade(workoutId) }.getOrNull()
            extras.update { it.copy(grade = grade) }
        }
    }

    private fun loadHistory(exerciseName: String) {
        viewModelScope.launch {
            val workout = state.value.workout ?: session.workouts.workout(workoutId).first() ?: return@launch
            val category = workout.exerciseSets.firstOrNull { it.exerciseName == exerciseName }?.category ?: return@launch
            val history = runCatching { session.workouts.exerciseHistory(exerciseName) }.getOrNull() ?: return@launch
            val defaultUnit = session.preferences.preferences.first()?.weightUnit ?: "kg"
            val summary = exerciseHistory(history, workoutId, category, exerciseName, defaultUnit)
            extras.update { it.copy(histories = it.histories + (exerciseName to summary)) }
        }
    }

    /** Runs a write that must reach the server (it answers with ids); one at a time. */
    private fun online(failure: String, block: suspend () -> Unit) {
        if (extras.value.busy) return
        extras.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage(failure))
            } finally {
                extras.update { it.copy(busy = false) }
            }
        }
    }

    private fun launchSafely(failure: String, block: suspend () -> Unit) {
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

    private data class Status(val loading: Boolean = false, val failed: Boolean = false)

    private data class Extras(
        val grade: SessionGrade? = null,
        val histories: Map<String, ExerciseHistory> = emptyMap(),
        val busy: Boolean = false,
    )

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
        const val CUSTOM_CATEGORY = "conditioning"
    }
}

/** Whether every typed value parses (blank is fine: it clears). */
fun SetEdit.isValid(): Boolean = listOf(reps, weight, distance, time).all {
    it.isBlank() ||
        it.trim().toDoubleOrNull()?.let { v -> v >= 0 } == true
}

/** Whether the details can be saved: a title, a whole number of minutes and a clock time, if any. */
fun DetailsEdit.isValid(): Boolean = title.isNotBlank() &&
    (duration.isBlank() || duration.trim().toIntOrNull()?.let { it >= 0 } == true) &&
    (timeOfDay.isBlank() || parseTimeOfDay(timeOfDay) != null)
