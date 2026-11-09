package com.fitai.coach.ui.log

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ParseWorkoutStructureResponse
import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.data.EncodedImage
import com.fitai.coach.core.data.LogResult
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.data.toCreateBlock
import com.fitai.coach.core.data.toCreateExercise
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.core.units.userDistanceToMeters
import com.fitai.coach.ui.format.userMessage
import com.fitai.coach.ui.workout.CUSTOM_EXERCISE
import com.fitai.coach.ui.workout.PlanDayOption
import com.fitai.coach.ui.workout.parseTimeOfDay
import com.fitai.coach.ui.workout.planDayOptions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.math.roundToLong

enum class LogStep { Capture, Confirm, Reflect }

data class LogUiState(
    val step: LogStep = LogStep.Capture,
    val draft: LogDraft = LogDraft(),
    val today: String = "",
    val parsing: Boolean = false,
    /** Shown on the confirm step when the parse was partial or failed. */
    val parseNote: String? = null,
    val saving: Boolean = false,
    val restored: Boolean = false,
    val problem: String? = null,
    /** "Duplicate last workout" is fetching it. */
    val duplicating: Boolean = false,
)

/** A set field the confirm step edits. */
enum class SetField { Reps, Weight, Distance, Time }

/**
 * Logging a workout in three steps, as /log does on the web: capture a
 * description (typed, spoken or photographed), confirm the parsed rows,
 * then rate the effort and save.
 */
@OptIn(FlowPreview::class)
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class LogWorkoutViewModel(private val session: UserSession, todayIn: (String?) -> String) : ViewModel() {
    private val _state = MutableStateFlow(LogUiState())
    val state: StateFlow<LogUiState> = _state.asStateFlow()

    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    private val done = Channel<Unit>(Channel.CONFLATED)

    /** Plan days near the workout's date it could count towards. */
    val planDays: StateFlow<List<PlanDayOption>> = combine(session.timeline.entries, _state) { entries, state ->
        planDayOptions(entries, state.draft.date, linked = state.draft.planDayId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyList())

    /** Fires when the workout is saved (or queued): leave the screen. */
    val saved: Flow<Unit> = done.receiveAsFlow()

    init {
        viewModelScope.launch {
            val today = todayIn(session.preferences.preferences.first()?.userTimezone)
            val stored = session.cache.get(DRAFT_KEY, LogDraft.serializer())?.takeUnless { it.isEmpty }
            _state.value = LogUiState(draft = stored ?: LogDraft(date = today), today = today, restored = stored != null)
            // Keep the draft as it changes; debounced as the web's 400 ms localStorage write is.
            _state.map { it.draft }.drop(1).debounce(DRAFT_DEBOUNCE_MS).collect { saveDraft(it) }
        }
    }

    fun edit(change: (LogDraft) -> LogDraft) = _state.update { it.copy(draft = change(it.draft), problem = null) }

    fun appendText(spoken: String) = edit {
        it.copy(text = listOf(it.text.trimEnd(), spoken.trim()).filter(String::isNotEmpty).joinToString(" "))
    }

    fun discardDraft() {
        _state.update { LogUiState(draft = LogDraft(date = it.today), today = it.today) }
    }

    fun useTodaysDate() = edit { it.copy(date = _state.value.today) }

    fun back() = _state.update { it.copy(step = LogStep.entries[(it.step.ordinal - 1).coerceAtLeast(0)], problem = null) }

    /** Capture → confirm: parses the description first when it changed since the last parse. */
    fun continueToConfirm() {
        val draft = _state.value.draft
        if (draft.text.isBlank() && draft.exercises.isEmpty()) {
            _state.update { it.copy(problem = "Add your workout above — type it, dictate it, or snap a photo — to continue.") }
            return
        }
        _state.update { it.copy(step = LogStep.Confirm, problem = null) }
        if (draft.text.isNotBlank() && draft.text != draft.parsedText) parse { session.parser.parseText(draft.text) to draft.text }
    }

    fun parsePhoto(image: EncodedImage) {
        _state.update { it.copy(step = LogStep.Confirm) }
        parse { session.parser.parseImage(image) to _state.value.draft.parsedText }
    }

    fun continueToReflect() = _state.update { it.copy(step = LogStep.Reflect, problem = null) }

    fun editSet(exercise: Int, set: Int, field: SetField, value: String) = edit { draft ->
        val number = value.trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull()
        draft.copy(
            exercises = draft.exercises.mapIndexed { i, ex ->
                if (i != exercise) {
                    ex
                } else {
                    ex.copy(
                        sets = ex.sets.mapIndexed { j, row ->
                            if (j != set) {
                                row
                            } else {
                                when (field) {
                                    SetField.Reps -> row.copy(reps = number?.toLong())
                                    SetField.Weight -> row.copy(weight = number)
                                    SetField.Distance -> row.copy(distance = number)
                                    SetField.Time -> row.copy(time = number)
                                }
                            }
                        },
                    )
                }
            },
        )
    }

    fun addSet(exercise: Int) = edit { draft ->
        draft.copy(
            exercises = draft.exercises.mapIndexed { i, ex ->
                val last = ex.sets.lastOrNull()
                if (i != exercise || last == null) ex else ex.copy(sets = ex.sets + last.copy(setNumber = last.setNumber + 1))
            },
        )
    }

    fun removeSet(exercise: Int, set: Int) = edit { draft ->
        draft.copy(
            exercises = draft.exercises.mapIndexedNotNull { i, ex ->
                when {
                    i != exercise -> ex
                    ex.sets.size <= 1 -> null
                    else -> ex.copy(sets = ex.sets.filterIndexed { j, _ -> j != set }.mapIndexed { n, row -> row.copy(setNumber = n + 1L) })
                }
            },
        )
    }

    fun removeExercise(exercise: Int) = edit { draft -> draft.copy(exercises = draft.exercises.filterIndexed { i, _ -> i != exercise }) }

    /** Adds an exercise by hand, from the library or as a custom one, with one set to fill in. */
    fun addExercise(exerciseName: String, customLabel: String?) = edit { draft ->
        val definition = EXERCISE_DEFINITIONS[exerciseName]
        val added = ParsedExercise(
            exerciseName = if (definition != null) exerciseName else CUSTOM_EXERCISE,
            category = definition?.category ?: CUSTOM_CATEGORY,
            customLabel = customLabel,
            sets = listOf(ParsedExercise.SetsItem(setNumber = 1)),
        )
        draft.copy(exercises = draft.exercises + added)
    }

    /** Moves an exercise up ([offset] -1) or down (1) the list. */
    fun moveExercise(exercise: Int, offset: Int) = edit { draft ->
        val target = exercise + offset
        if (exercise !in draft.exercises.indices || target !in draft.exercises.indices) {
            draft
        } else {
            draft.copy(exercises = draft.exercises.toMutableList().apply { add(target, removeAt(exercise)) })
        }
    }

    /** Counts the workout towards a plan day, or (null) not. */
    fun connectPlanDay(option: PlanDayOption?) = edit { it.copy(planDayId = option?.planDayId, planDayLabel = option?.label) }

    /** Starts from the last workout logged: its exercises, title and notes, dated today. */
    fun duplicateLast() {
        if (_state.value.duplicating) return
        _state.update { it.copy(duplicating = true) }
        viewModelScope.launch {
            try {
                val latest = session.workouts.latest()
                if (latest == null) {
                    toasts.send("No previous workout. Log your first workout to enable quick duplication.")
                } else {
                    val draft = draftFrom(latest, _state.value.today, session.preferences.preferences.first()?.weightUnit)
                    _state.update {
                        it.copy(
                            draft = draft,
                            step = if (draft.exercises.isEmpty()) LogStep.Capture else LogStep.Confirm,
                            restored = false,
                            problem = null,
                            parseNote = null,
                        )
                    }
                    toasts.send("Duplicated ${latest.focus.ifBlank { "workout" }}, dated today")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't duplicate workout"))
            } finally {
                _state.update { it.copy(duplicating = false) }
            }
        }
    }

    fun save() {
        val current = _state.value
        current.draft.saveProblem(current.today)?.let { problem ->
            _state.update { it.copy(problem = problem) }
            return
        }
        _state.update { it.copy(saving = true, problem = null) }
        viewModelScope.launch {
            try {
                val distanceUnit = session.preferences.preferences.first()?.distanceUnit
                when (val result = session.workouts.logWorkout(current.draft.toRequest(distanceUnit))) {
                    is LogResult.Saved -> {
                        val prs = result.workout?.newPersonalRecords.orEmpty().size
                        toasts.send(if (prs > 0) "Workout logged — ${if (prs == 1) "new PR!" else "$prs new PRs!"}" else "Workout logged")
                        launch { runCatching { session.timeline.refresh() } }
                    }
                    LogResult.Queued -> toasts.send("Workout queued — it'll sync when you're back online")
                }
                session.cache.delete(DRAFT_KEY)
                _state.update { LogUiState(draft = LogDraft(date = it.today), today = it.today) }
                done.send(Unit)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(saving = false, problem = e.userMessage("Failed to save workout. Please try again.")) }
            }
        }
    }

    private fun parse(call: suspend () -> Pair<ParseWorkoutStructureResponse, String?>) {
        _state.update { it.copy(parsing = true, parseNote = null) }
        viewModelScope.launch {
            try {
                val (result, source) = call()
                val partial = result.exercises.isEmpty() || result.exercises.any { (it.confidence ?: FULL_CONFIDENCE) < MIN_CONFIDENCE }
                edit {
                    it.copy(
                        exercises = result.exercises.map(ParsedExercise::withSetRows),
                        blocks = result.structureBlocks,
                        parsedText = source,
                    )
                }
                _state.update { it.copy(parsing = false, parseNote = if (partial) PARTIAL_NOTE else null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(parsing = false, parseNote = e.userMessage(PARTIAL_NOTE)) }
            }
        }
    }

    private suspend fun saveDraft(draft: LogDraft) {
        try {
            if (draft.isEmpty) session.cache.delete(DRAFT_KEY) else session.cache.put(DRAFT_KEY, LogDraft.serializer(), draft)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The draft is a convenience; losing a write of it loses nothing saved.
        }
    }

    private companion object {
        const val DRAFT_KEY = "log-draft"
        const val STOP_TIMEOUT_MS = 5_000L
        const val CUSTOM_CATEGORY = "conditioning"
        const val DRAFT_DEBOUNCE_MS = 400L
        const val MIN_CONFIDENCE = 80
        const val FULL_CONFIDENCE = 100
        const val PARTIAL_NOTE = "Couldn't fully structure this workout yet — review and fix."
    }
}

/**
 * The create request for a finished draft (validated by [saveProblem] first).
 * The distance is in [distanceUnit] and goes to the server in metres.
 */
fun LogDraft.toRequest(distanceUnit: String? = null): CreateWorkoutRequest = CreateWorkoutRequest(
    date = date,
    focus = title.trim().ifEmpty { "Workout" },
    mainWorkout = text.trim().ifEmpty { summarize(exercises) },
    notes = notes.trim().ifEmpty { null }.sent(),
    rpe = rpe.sent(),
    duration = duration.trim().toIntOrNull().sent(),
    timeOfDayMin = parseTimeOfDay(timeOfDay).sent(),
    distanceMeters = distance.trim().toDoubleOrNull()?.let { userDistanceToMeters(it, distanceUnit).roundToLong().toDouble() }.sent(),
    avgHeartrate = avgHeartrate.trim().toIntOrNull().sent(),
    maxHeartrate = maxHeartrate.trim().toIntOrNull().sent(),
    planDayId = planDayId.sent(),
    exercises = exercises.takeIf { it.isNotEmpty() }?.map { it.toCreateExercise() },
    structureBlocks = blocks.takeIf { it.isNotEmpty() }?.map { it.toCreateBlock() },
)

/** A value to send, or left out of the request when there is none. */
private fun <T : Any> T?.sent(): Patch<T> = this?.let { Patch.of(it) } ?: Patch.Absent
