package com.fitai.coach.ui.planday

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PlanDayReparseResponse
import com.fitai.coach.core.api.generated.PostPlansDaysByDayIdSetsRequest
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.data.EncodedImage
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.ui.format.userMessage
import com.fitai.coach.ui.workout.CUSTOM_EXERCISE
import com.fitai.coach.ui.workout.ExerciseGroup
import com.fitai.coach.ui.workout.SetEdit
import com.fitai.coach.ui.workout.reorderedSetIds
import com.fitai.coach.ui.workout.toDoublePatch
import com.fitai.coach.ui.workout.toIntPatch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PlanDayState(
    /** The session as the timeline has it; null once it is gone (deleted elsewhere). */
    val entry: TimelineEntry? = null,
    val loaded: Boolean = false,
    /** Its prescribed sets, from the server. */
    val sets: List<ExerciseSetRow> = emptyList(),
    val loadingSets: Boolean = true,
    val setsFailed: Boolean = false,
    /** A change to the sets is on its way to the server. */
    val busy: Boolean = false,
    /** The coach's text or a photo is being read into sets. */
    val parsing: Boolean = false,
)

/**
 * The session's own words, as the editor holds them: its title, the main
 * workout, accessory work and the coach's notes. Blank accessory and notes
 * clear them.
 */
data class PlanDayText(val title: String, val mainWorkout: String, val accessory: String, val notes: String) {
    val isValid: Boolean get() = title.isNotBlank()

    /** Only what changed from [entry]; null when nothing did. */
    fun changesFrom(entry: TimelineEntry): PatchPlansDaysByDayIdRequest? {
        val title = title.trim()
        val main = mainWorkout.trim()
        val request = PatchPlansDaysByDayIdRequest(
            focus = title.takeIf { it != entry.focus },
            mainWorkout = main.takeIf { it != entry.mainWorkout },
            accessory = accessory.trim().changeFrom(entry.accessory),
            notes = notes.trim().changeFrom(entry.notes),
        )
        return request.takeIf { it != PatchPlansDaysByDayIdRequest() }
    }

    companion object {
        fun of(entry: TimelineEntry) = PlanDayText(entry.focus, entry.mainWorkout, entry.accessory.orEmpty(), entry.notes.orEmpty())

        private fun String.changeFrom(current: String?): Patch<String> = when {
            this == current.orEmpty() -> Patch.Absent
            isEmpty() -> Patch.clear()
            else -> Patch.of(this)
        }
    }
}

/** Session priority: what the recovery sheet and the coach protect (SessionPriorityControl's tiers). */
enum class PriorityTier(val label: String, val help: String, val wire: PatchPlansDaysByDayIdRequest.Priority) {
    Key("Key", "The plan is built on it. If it's missed, it's worth fitting back in.", PatchPlansDaysByDayIdRequest.Priority.Key),
    Supporting(
        "Supporting",
        "Volume around the key sessions. If it's missed, fit it in when there's room.",
        PatchPlansDaysByDayIdRequest.Priority.Supporting,
    ),
    Optional("Optional", "Nice to have. If it's missed, the plan doesn't need it back.", PatchPlansDaysByDayIdRequest.Priority.Optional),
    ;

    companion object {
        fun of(priority: TimelineEntry.Priority?): PriorityTier? = entries.firstOrNull { it.wire.wireValue == priority?.wireValue }

        /**
         * Whether the session's priority can change: a plan day with a tier,
         * not set by a race, and still to do.
         */
        fun editable(entry: TimelineEntry): Boolean = entry.planDayId != null &&
            of(entry.priority) != null &&
            entry.raceDerived != true &&
            entry.status != TimelineEntry.Status.Completed &&
            entry.status != TimelineEntry.Status.Skipped
    }
}

/**
 * A planned session, edited as the web's log and preview sheets allow: its
 * title, text and priority, its prescribed sets, and reading the text or a
 * photo into sets.
 */
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class PlanDayViewModel(private val session: UserSession, private val entryId: String) : ViewModel() {
    private val sets = MutableStateFlow(SetsState())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<PlanDayState> = combine(session.timeline.entries, sets) { entries, current ->
        PlanDayState(
            entry = entries.firstOrNull { it.id == entryId },
            loaded = true,
            sets = current.rows,
            loadingSets = current.loading,
            setsFailed = current.failed,
            busy = current.busy,
            parsing = current.parsing,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), PlanDayState())

    /** The plan day being edited, once the timeline entry is read. */
    private var planDayId: String? = null

    init {
        loadSets()
    }

    fun loadSets() {
        viewModelScope.launch {
            sets.update { it.copy(loading = true, failed = false) }
            val id = planDayId ?: session.timeline.entries.first().firstOrNull { it.id == entryId }?.planDayId
            planDayId = id
            val rows = id?.let {
                try {
                    session.planDays.sets(it)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
            }
            sets.update { it.copy(rows = rows ?: it.rows, loading = false, failed = rows == null) }
        }
    }

    /** Saves the title and text; works offline. */
    fun saveText(text: PlanDayText) {
        val entry = state.value.entry ?: return
        val changes = text.changesFrom(entry) ?: return
        launchSafely("Couldn't save the session") {
            session.timeline.editPlanDay(entry, changes)
            toasts.send("Session saved")
        }
    }

    fun setPriority(tier: PriorityTier) {
        val entry = state.value.entry ?: return
        if (PriorityTier.of(entry.priority) == tier) return
        launchSafely("Couldn't change the priority") {
            session.timeline.editPlanDay(entry, PatchPlansDaysByDayIdRequest(priority = Patch.of(tier.wire)))
        }
    }

    fun saveSet(set: ExerciseSetRow, edit: SetEdit) = online("Couldn't save that set") { id ->
        val saved = try {
            session.planDays.updateSet(
                id,
                set.id,
                set.version,
                PatchPlansDaysByDayIdSetsBySetIdRequest(
                    reps = edit.reps.toIntPatch(),
                    weight = edit.weight.toDoublePatch(),
                    distance = edit.distance.toDoublePatch(),
                    time = edit.time.toDoublePatch(),
                ),
            )
        } catch (e: ApiException) {
            if (e.status != CONFLICT) throw e
            toasts.send("That set was changed on another device. Showing the latest.")
            reload(id)
            return@online
        }
        sets.update { current -> current.copy(rows = current.rows.map { if (it.id == saved.id) saved else it }) }
    }

    /** Adds a set to an exercise, copying its last set's values. */
    fun addSet(group: List<ExerciseSetRow>) {
        val last = group.maxByOrNull { it.setNumber } ?: return
        online("Couldn't add a set") { id ->
            session.planDays.addSet(
                id,
                PostPlansDaysByDayIdSetsRequest(
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
            reload(id)
        }
    }

    fun deleteSet(setId: String) = online("Couldn't remove that set") { id ->
        session.planDays.deleteSet(id, setId)
        sets.update { current -> current.copy(rows = current.rows.filterNot { it.id == setId }) }
    }

    /** Adds an exercise from the library (or a custom one) as one set to fill in; one already here gets another set. */
    fun addExercise(exerciseName: String, customLabel: String?) {
        val existing = state.value.sets.filter { it.exerciseName == exerciseName && it.customLabel == customLabel }
        if (existing.isNotEmpty()) return addSet(existing)
        val definition = EXERCISE_DEFINITIONS[exerciseName]
        online("Couldn't add that exercise") { id ->
            session.planDays.addSet(
                id,
                PostPlansDaysByDayIdSetsRequest(
                    exerciseName = if (definition != null) exerciseName else CUSTOM_EXERCISE,
                    customLabel = customLabel?.let { Patch.of(it) } ?: Patch.Absent,
                    category = definition?.category ?: CUSTOM_CATEGORY,
                    setNumber = 1,
                ),
            )
            reload(id)
        }
    }

    fun moveExercise(groups: List<ExerciseGroup>, index: Int, offset: Int) {
        val order = reorderedSetIds(groups, index, offset) ?: return
        online("Couldn't move that exercise") { id ->
            val rows = session.planDays.reorder(id, order)
            sets.update { it.copy(rows = rows) }
        }
    }

    /** Reads the session's text into sets, replacing the ones it has. */
    fun parseText() {
        val entry = state.value.entry ?: return
        parse { id -> session.planDays.reparse(id, mainWorkout = entry.mainWorkout, accessory = entry.accessory) }
    }

    /** Reads a photo of the session into sets, replacing the ones it has. */
    fun parsePhoto(photo: EncodedImage) = parse { id -> session.planDays.reparseFromImage(id, photo) }

    private fun parse(read: suspend (planDayId: String) -> PlanDayReparseResponse) {
        val id = planDayId ?: return
        if (sets.value.parsing) return
        sets.update { it.copy(parsing = true) }
        viewModelScope.launch {
            try {
                val result = read(id)
                reload(id)
                toasts.send(parseResult(result))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't read that into sets"))
            } finally {
                sets.update { it.copy(parsing = false) }
            }
        }
    }

    private suspend fun reload(planDayId: String) {
        val rows = session.planDays.sets(planDayId)
        sets.update { it.copy(rows = rows, failed = false) }
    }

    /** A change to the sets that must reach the server; one at a time. */
    private fun online(failure: String, block: suspend (planDayId: String) -> Unit) {
        val id = planDayId ?: return
        if (sets.value.busy) return
        sets.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                block(id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage(failure))
            } finally {
                sets.update { it.copy(busy = false) }
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

    private data class SetsState(
        val rows: List<ExerciseSetRow> = emptyList(),
        val loading: Boolean = true,
        val failed: Boolean = false,
        val busy: Boolean = false,
        val parsing: Boolean = false,
    )

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
        const val CONFLICT = 409
        const val CUSTOM_CATEGORY = "conditioning"
    }
}

/** What reading text or a photo into sets found: "Found 6 sets", or that it found none. */
fun parseResult(result: PlanDayReparseResponse): String = parseResult(result.saved, result.setCount)

/** The same for any read: a plan day's or a logged workout's. */
fun parseResult(saved: Boolean, setCount: Long): String = when {
    !saved || setCount == 0L -> "No sets found in that"
    setCount == 1L -> "Found 1 set"
    else -> "Found $setCount sets"
}
