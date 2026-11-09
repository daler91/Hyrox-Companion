package com.fitai.coach.ui.workout

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.SessionGrade
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.ui.coach.CoachThread
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.RpeSelector
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

/**
 * A logged workout. [onAskCoach] opens its own coach thread; [onDeleted]
 * gets the recycle-bin item once it is deleted, for the shell's undo toast.
 */
@Composable
fun WorkoutDetailScreen(
    workoutId: String,
    onBack: () -> Unit,
    onAskCoach: (CoachThread) -> Unit,
    onDeleted: (recycleBinItemId: String) -> Unit,
) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "workout-$workoutId") { WorkoutDetailViewModel(session, workoutId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    var sheet by remember { mutableStateOf<DetailSheet?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }

    Box(Modifier.fillMaxSize()) {
        val workout = state.workout
        when {
            workout != null -> WorkoutContent(
                workout = workout,
                state = state,
                actions = object : WorkoutActions {
                    override fun back() = onBack()

                    override fun askCoach() = onAskCoach(CoachThread.of(workout))

                    override fun editDetails() {
                        sheet = DetailSheet.Details
                    }

                    override fun editSet(set: ExerciseSetRow) {
                        sheet = DetailSheet.EditSet(set)
                    }

                    override fun addSet(sets: List<ExerciseSetRow>) = vm.addSet(sets)

                    override fun addExercise() {
                        sheet = DetailSheet.AddExercise
                    }

                    override fun useNext(sets: List<ExerciseSetRow>, target: NextTarget) = vm.useNext(sets, target)

                    override fun reopen() {
                        confirm = Confirm.Reopen
                    }

                    override fun delete() {
                        confirm = Confirm.Delete
                    }
                },
            )
            state.loadFailed -> ErrorState("Couldn't load this workout", Modifier.fillMaxSize(), onRetry = vm::refresh)
            else -> LoadingState(Modifier.fillMaxSize())
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }

    val close = { sheet = null }
    when (val open = sheet) {
        is DetailSheet.EditSet -> SetEditor(
            set = open.set,
            onSave = {
                vm.saveSet(open.set.id, it)
                close()
            },
            onDelete = {
                vm.deleteSet(open.set.id)
                close()
            },
            onDismiss = close,
        )
        DetailSheet.Details -> state.workout?.let { workout ->
            DetailsEditor(
                workout,
                onSave = {
                    vm.saveDetails(it)
                    close()
                },
                onDismiss = close,
            )
        }
        DetailSheet.AddExercise -> ExercisePickerSheet(
            onPick = { name, label ->
                vm.addExercise(name, label)
                close()
            },
            onDismiss = close,
        )
        null -> Unit
    }

    when (confirm) {
        Confirm.Reopen -> FitaiDialog(
            title = "Reopen this workout?",
            text = "The plan day goes back to planned and this logged workout is deleted.",
            confirmLabel = "Reopen",
            onConfirm = {
                confirm = null
                vm.reopen(onBack)
            },
            onDismiss = { confirm = null },
            destructive = true,
        )
        Confirm.Delete -> FitaiDialog(
            title = "Delete this workout?",
            text = "It moves to the recycle bin. You can undo straight after.",
            confirmLabel = "Delete",
            onConfirm = {
                confirm = null
                vm.delete(onDeleted)
            },
            onDismiss = { confirm = null },
            destructive = true,
        )
        null -> Unit
    }
}

private sealed interface DetailSheet {
    data object Details : DetailSheet

    data object AddExercise : DetailSheet

    data class EditSet(val set: ExerciseSetRow) : DetailSheet
}

private enum class Confirm { Reopen, Delete }

/** What the workout's controls do. */
private interface WorkoutActions {
    fun back()

    fun askCoach()

    fun editDetails()

    fun editSet(set: ExerciseSetRow)

    fun addSet(sets: List<ExerciseSetRow>)

    fun addExercise()

    fun useNext(sets: List<ExerciseSetRow>, target: NextTarget)

    fun reopen()

    fun delete()
}

@Composable
private fun WorkoutContent(workout: WorkoutLogDetail, state: WorkoutDetailState, actions: WorkoutActions) {
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
                IconButton(onClick = actions::back) { Icon(LucideIcons.ArrowLeft, contentDescription = "back", tint = colors.text) }
                Text(shortDate(workout.date), style = type.label, color = colors.textMuted)
            }
            Text(workout.focus, style = type.h1, color = colors.text, modifier = Modifier.semantics { heading() })
        }
        item { Stats(workout) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    "Ask coach",
                    onClick = actions::askCoach,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    leadingIcon = LucideIcons.MessageSquare,
                )
                FitaiButton("Edit details", onClick = actions::editDetails, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
        state.grade?.let { grade -> item { GradeCard(grade) } }
        if (workout.mainWorkout.isNotBlank()) item { Text(workout.mainWorkout, style = type.body, color = colors.text) }
        workout.notes?.takeIf { it.isNotBlank() }?.let { notes -> item { Text(notes, style = type.body, color = colors.textMuted) } }
        if (groups.isEmpty()) {
            item { Text("No structured sets for this workout.", style = type.body, color = colors.textMuted) }
        }
        items(groups, key = { "${it.first.first}|${it.first.second}" }) { (key, sets) ->
            ExerciseCard(
                label = exerciseLabel(key.first, key.second),
                sets = sets,
                history = state.histories[key.first].takeIf { key.first != CUSTOM_EXERCISE },
                busy = state.busy,
                actions = actions,
            )
        }
        item {
            FitaiButton(
                "Add exercise",
                onClick = actions::addExercise,
                variant = ButtonVariant.Secondary,
                enabled = !state.busy,
                leadingIcon = LucideIcons.Plus,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                if (state.planEntry != null) FitaiButton("Reopen", onClick = actions::reopen, variant = ButtonVariant.Secondary)
                FitaiButton(
                    "Delete workout",
                    onClick = actions::delete,
                    variant = ButtonVariant.Danger,
                    enabled = !state.busy,
                    leadingIcon = LucideIcons.Trash,
                )
            }
        }
    }
}

@Composable
private fun ExerciseCard(
    label: String,
    sets: List<ExerciseSetRow>,
    history: ExerciseHistory?,
    busy: Boolean,
    actions: WorkoutActions,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard {
        Text(label, style = type.h3, color = colors.text)
        history?.lastTime?.let { Text("Last time · $it", style = type.bodySm, color = colors.textMuted) }
        history?.next?.let { next ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Next · ${nextTargetLabel(next, history.weightUnit)}",
                    style = type.bodySm,
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                FitaiButton("Use", onClick = { actions.useNext(sets, next) }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
        sets.forEach { set ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClickLabel = "edit set ${set.setNumber}") { actions.editSet(set) }
                    .padding(vertical = Spacing.Sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Set ${set.setNumber}", style = type.label, color = colors.textMuted, modifier = Modifier.weight(SET_LABEL_WEIGHT))
                Text(setSummary(set), style = type.body, color = colors.text, modifier = Modifier.weight(1f))
            }
        }
        FitaiButton(
            "Add set",
            onClick = { actions.addSet(sets) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = !busy,
            leadingIcon = LucideIcons.Plus,
        )
    }
}

/** "Did the session do its job": the verdict, its headline and the evidence (SessionGradeCard). */
@Composable
private fun GradeCard(grade: SessionGrade) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiBadge(gradeLabel(grade.intent, grade.verdict), tone = gradeTone(grade.verdict))
            Text(grade.headline, style = type.body, color = colors.text)
            grade.evidence.forEach { Text("• $it", style = type.bodySm, color = colors.textMuted) }
        }
    }
}

@Composable
private fun Stats(workout: WorkoutLogDetail) {
    val parts = buildList {
        workout.timeOfDayMin?.let { add(formatTimeOfDay(it)) }
        workout.duration?.let { add("$it min") }
        workout.rpe?.let { add("RPE $it") }
        workout.distanceMeters?.takeIf { it > 0 }?.let { add("${formatNumber(it / METERS_PER_KM)} km") }
        workout.avgHeartrate?.let { add("avg $it bpm") }
        if (!workout.countsAsTraining) add("not counted as training")
    }
    if (parts.isNotEmpty()) Text(parts.joinToString(" · "), style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
}

private const val METERS_PER_KM = 1000.0
private const val SET_LABEL_WEIGHT = 0.3f

/** "10 reps · 80 kg · 400 m · 1:30", from the values a set has. */
fun setSummary(set: ExerciseSetRow): String = buildList {
    set.reps?.let { add("$it reps") }
    set.weight?.let { add(formatWeight(it, set.weightUnit)) }
    set.distance?.let { add(formatSetDistance(it, set.distanceUnit)) }
    set.time?.let { add(formatClock(it)) }
}.ifEmpty { listOf("—") }.joinToString(" · ")

@Composable
private fun DetailsEditor(workout: WorkoutLogDetail, onSave: (DetailsEdit) -> Unit, onDismiss: () -> Unit) {
    var edit by remember(workout.id) { mutableStateOf(DetailsEdit.of(workout)) }
    val number = KeyboardOptions(keyboardType = KeyboardType.Number)
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text("Workout details", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
            FitaiTextField(edit.title, { edit = edit.copy(title = it) }, "Title")
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                FitaiTextField(edit.duration, {
                    edit = edit.copy(duration = it)
                }, "Duration (min)", Modifier.weight(1f), keyboardOptions = number)
                FitaiTextField(edit.timeOfDay, {
                    edit = edit.copy(timeOfDay = it)
                }, "Time of day", Modifier.weight(1f), placeholder = "07:30")
            }
            Text("How hard was it?", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            RpeSelector(edit.rpe, { edit = edit.copy(rpe = it) })
            FitaiTextField(edit.notes, { edit = edit.copy(notes = it) }, "Notes", singleLine = false)
            FitaiSwitchRow("Counts as training", edit.countsAsTraining, { edit = edit.copy(countsAsTraining = it) })
            FitaiButton("Save", onClick = { onSave(edit) }, enabled = edit.isValid(), modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun SetEditor(set: ExerciseSetRow, onSave: (SetEdit) -> Unit, onDelete: () -> Unit, onDismiss: () -> Unit) {
    var edit by remember(set.id) {
        mutableStateOf(
            SetEdit(
                reps = set.reps?.toString().orEmpty(),
                weight = editableNumber(set.weight),
                distance = editableNumber(set.distance),
                time = editableNumber(set.time),
            ),
        )
    }
    // The fields the exercise logs, plus any the set already has a value for.
    val logged = EXERCISE_DEFINITIONS[set.exerciseName]?.fields
    val shows = { field: String, value: String -> logged == null || field in logged || value.isNotBlank() }
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Text(
                "${exerciseLabel(set.exerciseName, set.customLabel)} · set ${set.setNumber}",
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
            )
            if (shows("reps", edit.reps)) {
                FitaiTextField(edit.reps, {
                    edit = edit.copy(reps = it)
                }, "Reps", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            if (shows("weight", edit.weight)) {
                FitaiTextField(edit.weight, {
                    edit = edit.copy(weight = it)
                }, "Weight (${set.weightUnit ?: "kg"})", keyboardOptions = number)
            }
            if (shows("distance", edit.distance)) {
                FitaiTextField(edit.distance, {
                    edit = edit.copy(distance = it)
                }, "Distance (${if (set.distanceUnit == "ft") "ft" else "m"})", keyboardOptions = number)
            }
            if (shows("time", edit.time)) {
                FitaiTextField(edit.time, { edit = edit.copy(time = it) }, "Time (min)", keyboardOptions = number)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm), verticalAlignment = Alignment.CenterVertically) {
                FitaiButton("Delete set", onClick = onDelete, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.Trash)
                FitaiButton("Save", onClick = { onSave(edit) }, enabled = edit.isValid(), modifier = Modifier.weight(1f))
            }
        }
    }
}
