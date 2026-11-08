package com.fitai.coach.ui.log

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.fitai.coach.ui.media.rememberPhotoPicker
import com.fitai.coach.ui.media.rememberSpeechInput
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.launch

@Composable
fun LogWorkoutScreen(onSaved: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "log-${session.userId}") { LogWorkoutViewModel(session, ::todayIn) }
    val state by vm.state.collectAsStateWithLifecycle()
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val toast: (String) -> Unit = { message -> scope.launch { toasts.showSnackbar(message) } }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(vm) { vm.saved.collect { onSaved() } }
    val pickPhoto = rememberPhotoPicker(onPicked = vm::parsePhoto, onError = toast)
    val dictate = rememberSpeechInput(onText = vm::appendText, onError = toast)

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
                LogStep.Capture -> Capture(state, vm, pickPhoto, dictate)
                LogStep.Confirm -> Confirm(state, vm, prefs?.weightUnit, prefs?.distanceUnit)
                LogStep.Reflect -> Reflect(state, vm, dictate)
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

@Composable
private fun Capture(state: LogUiState, vm: LogWorkoutViewModel, pickPhoto: (() -> Unit)?, dictate: (() -> Unit)?) {
    val draft = state.draft
    val yesterday = addDaysToIsoDate(state.today, -1)
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
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        pickPhoto?.let { FitaiButton("Photo", onClick = it, variant = ButtonVariant.Secondary, leadingIcon = LucideIcons.Image) }
        dictate?.let { FitaiButton("Dictate", onClick = it, variant = ButtonVariant.Secondary, leadingIcon = LucideIcons.Mic) }
    }
    FitaiButton("Continue to exercises", onClick = vm::continueToConfirm, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Confirm(state: LogUiState, vm: LogWorkoutViewModel, weightUnit: String?, distanceUnit: String?) {
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
    state.draft.exercises.forEachIndexed { index, exercise -> ExerciseCard(index, exercise, vm, weightUnit, distanceUnit) }
    if (state.draft.text.isNotBlank()) {
        Text("Your description: ${state.draft.text}", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiButton("Back", onClick = vm::back, variant = ButtonVariant.Ghost)
        FitaiButton("Continue to RPE & notes", onClick = vm::continueToReflect, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun ExerciseCard(index: Int, exercise: ParsedExercise, vm: LogWorkoutViewModel, weightUnit: String?, distanceUnit: String?) {
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    val distanceLabel = if (distanceUnit == "miles") "ft" else "m"
    FitaiCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                exerciseLabel(exercise.exerciseName, exercise.customLabel),
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
                modifier = Modifier.weight(1f),
            )
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
        TextButton(onClick = { vm.addSet(index) }) { Text("+ Add set", color = FitaiTheme.colors.accent) }
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

@Composable
private fun Reflect(state: LogUiState, vm: LogWorkoutViewModel, dictate: (() -> Unit)?) {
    val draft = state.draft
    Text("How hard was that?", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
    if (!draft.skipRpe) RpeSelector(draft.rpe, { rpe -> vm.edit { it.copy(rpe = rpe) } })
    FitaiChip(
        "Skip RPE for this workout",
        selected = draft.skipRpe,
        onClick = { vm.edit { it.copy(skipRpe = !it.skipRpe, rpe = null) } },
    )
    FitaiTextField(
        draft.duration,
        { duration -> vm.edit { it.copy(duration = duration) } },
        "Total time (minutes)",
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    )
    FitaiTextField(
        draft.notes,
        { notes -> vm.edit { it.copy(notes = notes) } },
        "Notes",
        placeholder = "How did the workout feel? Any observations...",
        singleLine = false,
    )
    dictate?.let { FitaiButton("Dictate a note", onClick = it, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.Mic) }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiButton("Back", onClick = vm::back, variant = ButtonVariant.Ghost)
        FitaiButton("Save workout", onClick = vm::save, loading = state.saving, modifier = Modifier.weight(1f))
    }
}
