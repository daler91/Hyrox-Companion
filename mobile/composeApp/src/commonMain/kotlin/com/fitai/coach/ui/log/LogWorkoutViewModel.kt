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
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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

    fun save() {
        val current = _state.value
        current.draft.saveProblem(current.today)?.let { problem ->
            _state.update { it.copy(problem = problem) }
            return
        }
        _state.update { it.copy(saving = true, problem = null) }
        viewModelScope.launch {
            try {
                when (val result = session.workouts.logWorkout(current.draft.toRequest())) {
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
        const val DRAFT_DEBOUNCE_MS = 400L
        const val MIN_CONFIDENCE = 80
        const val FULL_CONFIDENCE = 100
        const val PARTIAL_NOTE = "Couldn't fully structure this workout yet — review and fix."
    }
}

/** The create request for a finished draft (validated by [saveProblem] first). */
fun LogDraft.toRequest(): CreateWorkoutRequest = CreateWorkoutRequest(
    date = date,
    focus = title.trim().ifEmpty { "Workout" },
    mainWorkout = text.trim().ifEmpty { summarize(exercises) },
    notes = notes.trim().takeIf { it.isNotEmpty() }?.let { Patch.of(it) } ?: Patch.Absent,
    rpe = rpe?.let { Patch.of(it) } ?: Patch.Absent,
    duration = duration.trim().toIntOrNull()?.let { Patch.of(it) } ?: Patch.Absent,
    exercises = exercises.takeIf { it.isNotEmpty() }?.map { it.toCreateExercise() },
    structureBlocks = blocks.takeIf { it.isNotEmpty() }?.map { it.toCreateBlock() },
)
