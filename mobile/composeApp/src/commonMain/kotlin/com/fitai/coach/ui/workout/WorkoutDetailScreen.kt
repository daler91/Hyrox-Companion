package com.fitai.coach.ui.workout

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.formatWeight
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

@Composable
fun WorkoutDetailScreen(workoutId: String, onBack: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "workout-$workoutId") { WorkoutDetailViewModel(session, workoutId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    var editing by remember { mutableStateOf<ExerciseSetRow?>(null) }
    var confirmReopen by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        val workout = state.workout
        when {
            workout != null -> WorkoutContent(workout, state.planEntry != null, onBack, onEditSet = { editing = it }, onReopen = {
                confirmReopen =
                    true
            })
            state.loadFailed -> ErrorState("Couldn't load this workout", Modifier.fillMaxSize(), onRetry = vm::refresh)
            else -> LoadingState(Modifier.fillMaxSize())
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }
    editing?.let { set ->
        SetEditor(set, onSave = {
            vm.saveSet(set.id, it)
            editing = null
        }, onDismiss = { editing = null })
    }
    if (confirmReopen) {
        com.fitai.coach.ui.components.FitaiDialog(
            title = "Reopen this workout?",
            text = "The plan day goes back to planned and this logged workout is deleted.",
            confirmLabel = "Reopen",
            onConfirm = {
                confirmReopen = false
                vm.reopen(onBack)
            },
            onDismiss = { confirmReopen = false },
            destructive = true,
        )
    }
}

@Composable
private fun WorkoutContent(
    workout: WorkoutLogDetail,
    canReopen: Boolean,
    onBack: () -> Unit,
    onEditSet: (ExerciseSetRow) -> Unit,
    onReopen: () -> Unit,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val groups = workout.exerciseSets.groupBy { it.exerciseName to it.customLabel }.toList()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.Lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(LucideIcons.ArrowLeft, contentDescription = "back", tint = colors.text) }
                Text(shortDate(workout.date), style = type.label, color = colors.textMuted)
            }
            Text(workout.focus, style = type.h1, color = colors.text, modifier = Modifier.semantics { heading() })
        }
        item { Stats(workout) }
        if (workout.mainWorkout.isNotBlank()) item { Text(workout.mainWorkout, style = type.body, color = colors.text) }
        workout.notes?.takeIf { it.isNotBlank() }?.let { notes -> item { Text(notes, style = type.body, color = colors.textMuted) } }
        if (groups.isEmpty()) {
            item { Text("No structured sets for this workout.", style = type.body, color = colors.textMuted) }
        }
        items(groups, key = { "${it.first.first}|${it.first.second}" }) { (key, sets) ->
            FitaiCard {
                Text(exerciseLabel(key.first, key.second), style = type.h3, color = colors.text)
                sets.forEach { set ->
                    Row(Modifier.fillMaxWidth().padding(vertical = Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
                        Text("Set ${set.setNumber}", style = type.label, color = colors.textMuted, modifier = Modifier.weight(0.3f))
                        Text(setSummary(set), style = type.body, color = colors.text, modifier = Modifier.weight(1f))
                        FitaiButton("Edit", onClick = { onEditSet(set) }, variant = ButtonVariant.Ghost)
                    }
                }
            }
        }
        if (canReopen) item { FitaiButton("Reopen", onClick = onReopen, variant = ButtonVariant.Secondary) }
    }
}

@Composable
private fun Stats(workout: WorkoutLogDetail) {
    val parts = buildList {
        workout.duration?.let { add("$it min") }
        workout.rpe?.let { add("RPE $it") }
        workout.distanceMeters?.takeIf { it > 0 }?.let { add("${formatNumber(it / METERS_PER_KM)} km") }
        workout.avgHeartrate?.let { add("avg $it bpm") }
    }
    if (parts.isNotEmpty()) Text(parts.joinToString(" · "), style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
}

private const val METERS_PER_KM = 1000.0

/** "10 reps · 80 kg · 400 m · 1:30", from the values a set has. */
fun setSummary(set: ExerciseSetRow): String = buildList {
    set.reps?.let { add("$it reps") }
    set.weight?.let { add(formatWeight(it, set.weightUnit)) }
    set.distance?.let { add(formatSetDistance(it, set.distanceUnit)) }
    set.time?.let { add(formatClock(it)) }
}.ifEmpty { listOf("—") }.joinToString(" · ")

@Composable
private fun SetEditor(set: ExerciseSetRow, onSave: (SetEdit) -> Unit, onDismiss: () -> Unit) {
    var edit by remember(set.id) {
        mutableStateOf(
            SetEdit(
                reps = set.reps?.toString().orEmpty(),
                weight = set.weight?.let(::formatNumber).orEmpty(),
                distance = set.distance?.let(::formatNumber).orEmpty(),
                time = set.time?.let(::formatNumber).orEmpty(),
            ),
        )
    }
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Text(
                "${exerciseLabel(set.exerciseName, set.customLabel)} · set ${set.setNumber}",
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
            )
            FitaiTextField(edit.reps, {
                edit = edit.copy(reps = it)
            }, "Reps", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            FitaiTextField(edit.weight, { edit = edit.copy(weight = it) }, "Weight (${set.weightUnit ?: "kg"})", keyboardOptions = number)
            FitaiTextField(edit.distance, {
                edit = edit.copy(distance = it)
            }, "Distance (${if (set.distanceUnit == "ft") "ft" else "m"})", keyboardOptions = number)
            FitaiTextField(edit.time, { edit = edit.copy(time = it) }, "Time (min)", keyboardOptions = number)
            FitaiButton("Save", onClick = { onSave(edit) }, enabled = edit.isValid(), modifier = Modifier.fillMaxWidth())
        }
    }
}
