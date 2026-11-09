package com.fitai.coach.ui.log

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.data.MAX_PARSE_TEXT
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.RpeSelector
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.media.SpeechInput
import com.fitai.coach.ui.media.rememberCamera
import com.fitai.coach.ui.media.rememberPhotoPicker
import com.fitai.coach.ui.media.rememberSpeechInput
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.workout.ExercisePickerSheet
import com.fitai.coach.ui.workout.PlanDayOption
import com.fitai.coach.ui.workout.PlanDayPickerSheet
import kotlinx.coroutines.launch

@Composable
fun LogWorkoutScreen(onSaved: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "log-${session.userId}") { LogWorkoutViewModel(session, ::todayIn) }
    val state by vm.state.collectAsStateWithLifecycle()
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
    val planDays by vm.planDays.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val toast: (String) -> Unit = { message -> scope.launch { toasts.showSnackbar(message) } }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(vm) {
        vm.saved.collect {
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            onSaved()
        }
    }
    val pickPhoto = rememberPhotoPicker(onPicked = vm::parsePhoto, onError = toast)
    val dictate = rememberSpeechInput(onText = vm::appendText, onError = toast)
    val takePhoto = rememberCamera(onPicked = vm::parsePhoto, onError = toast)

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text(
                "log workout",
                style = FitaiTheme.typography.h1,
                color = FitaiTheme.colors.text,
                modifier = Modifier.semantics {
                    heading()
                },
            )
            Steps(state.step)
            if (state.restored && state.step == LogStep.Capture) Restored(state, vm)
            when (state.step) {
                LogStep.Capture -> Capture(state, vm, PhotoSources(pickPhoto, takePhoto), dictate)
                LogStep.Confirm -> Confirm(state, vm, prefs?.weightUnit, prefs?.distanceUnit)
                LogStep.Reflect -> Reflect(state, vm, dictate, prefs?.distanceUnit, planDays)
            }
            state.problem?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.danger) }
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun Steps(step: LogStep) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        listOf("Capture", "Confirm", "Reflect").forEachIndexed { index, label ->
            FitaiBadge("${index + 1}. $label", tone = if (index == step.ordinal) BadgeTone.Accent else BadgeTone.Neutral)
        }
    }
}

@Composable
private fun Restored(state: LogUiState, vm: LogWorkoutViewModel) {
    FitaiCard {
        Text(
            "Restored your unsaved workout, dated ${shortDate(state.draft.date)}.",
            style = FitaiTheme.typography.body,
            color = FitaiTheme.colors.text,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            if (state.draft.date !=
                state.today
            ) {
                FitaiButton("Use today's date", onClick = vm::useTodaysDate, variant = ButtonVariant.Secondary)
            }
            FitaiButton("Discard draft", onClick = vm::discardDraft, variant = ButtonVariant.Ghost)
        }
    }
}

/** Where a workout photo can come from: the camera, the gallery, either or neither. */
private data class PhotoSources(val pick: (() -> Unit)?, val take: (() -> Unit)?)

/** Starts dictation, and stops it while listening. */
@Composable
private fun DictateButton(input: SpeechInput, label: String, variant: ButtonVariant) {
    if (input.listening) {
        FitaiButton("Listening… tap to stop", onClick = input::stop, variant = variant, leadingIcon = LucideIcons.Square)
    } else {
        FitaiButton(label, onClick = input::start, variant = variant, leadingIcon = LucideIcons.Mic)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Capture(state: LogUiState, vm: LogWorkoutViewModel, photos: PhotoSources, dictate: SpeechInput?) {
    val draft = state.draft
    val yesterday = addDaysToIsoDate(state.today, -1)
    FitaiButton(
        "Duplicate last workout",
        onClick = vm::duplicateLast,
        variant = ButtonVariant.Ghost,
        loading = state.duplicating,
        leadingIcon = LucideIcons.RefreshCw,
    )
    FitaiTextField(draft.title, { title -> vm.edit { it.copy(title = title) } }, "Title (optional)", placeholder = "e.g., Morning Push")
    Text("Date", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
        FitaiChip("Today", selected = draft.date == state.today, onClick = { vm.edit { it.copy(date = state.today) } })
        FitaiChip("Yesterday", selected = draft.date == yesterday, onClick = { vm.edit { it.copy(date = yesterday) } })
    }
    FitaiTextField(draft.date, { date -> vm.edit { it.copy(date = date.trim()) } }, "Or a date (YYYY-MM-DD)")
    FitaiTextField(
        draft.text,
        { text -> vm.edit { it.copy(text = text.take(MAX_PARSE_TEXT)) } },
        "Description",
        placeholder = "e.g., 5 rounds: 400 m run, 20 wall balls, 15 burpees",
        supportingText = "${draft.text.length}/$MAX_PARSE_TEXT",
        singleLine = false,
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        photos.take?.let { FitaiButton("Camera", onClick = it, variant = ButtonVariant.Secondary, leadingIcon = LucideIcons.Camera) }
        photos.pick?.let { FitaiButton("Photo", onClick = it, variant = ButtonVariant.Secondary, leadingIcon = LucideIcons.Image) }
        dictate?.let { DictateButton(it, "Dictate", ButtonVariant.Secondary) }
    }
    FitaiButton("Continue to exercises", onClick = vm::continueToConfirm, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Confirm(state: LogUiState, vm: LogWorkoutViewModel, weightUnit: String?, distanceUnit: String?) {
    var picking by remember { mutableStateOf(false) }
    if (picking) {
        ExercisePickerSheet(
            onPick = { name, label ->
                vm.addExercise(name, label)
                picking = false
            },
            onDismiss = { picking = false },
        )
    }
    Text("Confirm exercises", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
    if (state.parsing) {
        LoadingState(message = "Structuring your workout…")
        return
    }
    state.parseNote?.let { Text(it, style = FitaiTheme.typography.body, color = FitaiTheme.colors.warning) }
    if (state.draft.exercises.isEmpty()) {
        Text(
            "No structured exercises yet. Go back and describe your workout, or save it as a description.",
            style = FitaiTheme.typography.body,
            color = FitaiTheme.colors.textMuted,
        )
    }
    val count = state.draft.exercises.size
    state.draft.exercises.forEachIndexed { index, exercise ->
        ExerciseCard(index, exercise, vm, Units(weightUnit, distanceUnit), canMoveUp = index > 0, canMoveDown = index < count - 1)
    }
    FitaiButton(
        "Add exercise",
        onClick = { picking = true },
        variant = ButtonVariant.Secondary,
        leadingIcon = LucideIcons.Plus,
        modifier = Modifier.fillMaxWidth(),
    )
    if (state.draft.text.isNotBlank()) {
        Text("Your description: ${state.draft.text}", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiButton("Back", onClick = vm::back, variant = ButtonVariant.Ghost)
        FitaiButton("Continue to RPE & notes", onClick = vm::continueToReflect, modifier = Modifier.weight(1f))
    }
}

/** The athlete's units, which label the set fields. */
private data class Units(val weight: String?, val distance: String?)

@Composable
private fun ExerciseCard(
    index: Int,
    exercise: ParsedExercise,
    vm: LogWorkoutViewModel,
    units: Units,
    canMoveUp: Boolean,
    canMoveDown: Boolean,
) {
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    val distanceLabel = if (units.distance == "miles") "ft" else "m"
    val weightUnit = units.weight
    val label = exerciseLabel(exercise.exerciseName, exercise.customLabel)
    FitaiCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
            if (canMoveUp) {
                IconButton(onClick = { vm.moveExercise(index, -1) }) {
                    Icon(LucideIcons.ChevronRight, "move $label up", tint = FitaiTheme.colors.textMuted, modifier = Modifier.rotate(UP))
                }
            }
            if (canMoveDown) {
                IconButton(onClick = { vm.moveExercise(index, 1) }) {
                    Icon(LucideIcons.ChevronRight, "move $label down", tint = FitaiTheme.colors.textMuted, modifier = Modifier.rotate(DOWN))
                }
            }
            IconButton(onClick = { vm.removeExercise(index) }) {
                Icon(LucideIcons.Trash, contentDescription = "remove ${exercise.exerciseName}", tint = FitaiTheme.colors.textMuted)
            }
        }
        exercise.sets.forEachIndexed { setIndex, set ->
            Text("Set ${set.setNumber}", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
                SetValue(set.reps?.toString(), "Reps", Modifier.weight(1f)) { vm.editSet(index, setIndex, SetField.Reps, it) }
                SetValue(set.weight?.let(::formatNumber), weightUnit ?: "kg", Modifier.weight(1f), number) {
                    vm.editSet(index, setIndex, SetField.Weight, it)
                }
                SetValue(set.distance?.let(::formatNumber), distanceLabel, Modifier.weight(1f), number) {
                    vm.editSet(index, setIndex, SetField.Distance, it)
                }
                SetValue(set.time?.let(::formatNumber), "min", Modifier.weight(1f), number) {
                    vm.editSet(index, setIndex, SetField.Time, it)
                }
                IconButton(onClick = { vm.removeSet(index, setIndex) }) {
                    Icon(LucideIcons.X, contentDescription = "remove set ${set.setNumber}", tint = FitaiTheme.colors.textMuted)
                }
            }
        }
        TextButton(onClick = { vm.addSet(index) }) { Text("+ Add set", color = FitaiTheme.colors.accentText) }
    }
}

@Composable
private fun SetValue(
    value: String?,
    label: String,
    modifier: Modifier,
    keyboard: KeyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    onChange: (String) -> Unit,
) {
    FitaiTextField(value.orEmpty(), onChange, label, modifier = modifier, keyboardOptions = keyboard)
}

/** "Connect to a plan": which plan day this workout counts towards, if any. */
@Composable
private fun ConnectToPlan(draft: LogDraft, options: List<PlanDayOption>, onPick: (PlanDayOption?) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    FitaiCard {
        Text("Connect to a plan", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
        Text(
            draft.planDayLabel?.let { "Counts towards $it" } ?: "Optionally link this workout to a plan day so it counts toward your plan.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
        FitaiButton(
            if (draft.planDayId ==
                null
            ) {
                "Choose a plan day"
            } else {
                "Change"
            },
            onClick = { picking = true },
            variant = ButtonVariant.Secondary,
        )
    }
    if (picking) {
        PlanDayPickerSheet(
            options = options,
            selected = draft.planDayId,
            onPick = { id ->
                onPick(options.firstOrNull { it.planDayId == id })
                picking = false
            },
            onDismiss = { picking = false },
        )
    }
}

@Composable
private fun Reflect(
    state: LogUiState,
    vm: LogWorkoutViewModel,
    dictate: SpeechInput?,
    distanceUnit: String?,
    planDays: List<PlanDayOption>,
) {
    val draft = state.draft
    Text("How hard was that?", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
    if (!draft.skipRpe) RpeSelector(draft.rpe, { rpe -> vm.edit { it.copy(rpe = rpe) } })
    FitaiChip(
        "Skip RPE for this workout",
        selected = draft.skipRpe,
        onClick = { vm.edit { it.copy(skipRpe = !it.skipRpe, rpe = null) } },
    )
    val wholeNumber = KeyboardOptions(keyboardType = KeyboardType.Number)
    FitaiTextField(draft.duration, { duration ->
        vm.edit { it.copy(duration = duration) }
    }, "Total time (minutes)", keyboardOptions = wholeNumber)
    FitaiTextField(
        draft.timeOfDay,
        { time -> vm.edit { it.copy(timeOfDay = time) } },
        "Time of day",
        placeholder = "07:30",
        supportingText = "When you trained: places your recovery meal at the right time of day.",
    )
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiTextField(
            draft.distance,
            { distance -> vm.edit { it.copy(distance = distance) } },
            "Distance (${if (distanceUnit == "miles") "miles" else "km"})",
            modifier = Modifier.weight(1f),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        )
        FitaiTextField(
            draft.avgHeartrate,
            { hr -> vm.edit { it.copy(avgHeartrate = hr) } },
            "Avg HR",
            modifier = Modifier.weight(1f),
            keyboardOptions = wholeNumber,
        )
        FitaiTextField(
            draft.maxHeartrate,
            { hr -> vm.edit { it.copy(maxHeartrate = hr) } },
            "Max HR",
            modifier = Modifier.weight(1f),
            keyboardOptions = wholeNumber,
        )
    }
    ConnectToPlan(draft, planDays, vm::connectPlanDay)
    FitaiTextField(
        draft.notes,
        { notes -> vm.edit { it.copy(notes = notes) } },
        "Notes",
        placeholder = "How did the workout feel? Any observations...",
        singleLine = false,
    )
    dictate?.let { DictateButton(it, "Dictate a note", ButtonVariant.Ghost) }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiButton("Back", onClick = vm::back, variant = ButtonVariant.Ghost)
        FitaiButton("Save workout", onClick = vm::save, loading = state.saving, modifier = Modifier.weight(1f))
    }
}

private const val UP = -90f
private const val DOWN = 90f
