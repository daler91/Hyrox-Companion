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
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.SessionGrade
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.core.units.metersToUserDistance
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
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.formatWeight
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlin.math.roundToInt

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
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
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
                distanceUnit = prefs?.distanceUnit,
                actions = object : WorkoutActions {
                    override fun back() = onBack()

                    override fun askCoach() = onAskCoach(CoachThread.of(workout))

                    override fun open(opened: DetailSheet) {
                        sheet = opened
                    }

                    override fun addSet(sets: List<ExerciseSetRow>) = vm.addSet(sets)

                    override fun useNext(sets: List<ExerciseSetRow>, target: NextTarget) = vm.useNext(sets, target)

                    override fun moveExercise(groups: List<ExerciseGroup>, index: Int, offset: Int) = vm.moveExercise(groups, index, offset)

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
        is DetailSheet.EditSet -> SetEditorSheet(
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
        DetailSheet.PlanDay -> PlanDayPickerSheet(
            options = state.planDayOptions,
            selected = state.workout?.planDayId,
            onPick = {
                vm.linkPlanDay(it)
                close()
            },
            onDismiss = close,
        )
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

    data object PlanDay : DetailSheet

    data object AddExercise : DetailSheet

    data class EditSet(val set: ExerciseSetRow) : DetailSheet
}

private enum class Confirm { Reopen, Delete }

/** What the workout's controls do. */
private interface WorkoutActions {
    fun back()

    fun askCoach()

    /** Opens a sheet: the details editor, the plan-day picker, a set's editor or the exercise library. */
    fun open(opened: DetailSheet)

    fun addSet(sets: List<ExerciseSetRow>)

    fun useNext(sets: List<ExerciseSetRow>, target: NextTarget)

    fun moveExercise(groups: List<ExerciseGroup>, index: Int, offset: Int)

    fun reopen()

    fun delete()
}

@Composable
private fun WorkoutContent(workout: WorkoutLogDetail, state: WorkoutDetailState, distanceUnit: String?, actions: WorkoutActions) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val groups = exerciseGroups(workout.exerciseSets)
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
        item { Stats(workout, distanceUnit) }
        item { PlanDayRow(state.linkedPlanDay, linked = workout.planDayId != null, onChange = { actions.open(DetailSheet.PlanDay) }) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    "Ask coach",
                    onClick = actions::askCoach,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    leadingIcon = LucideIcons.MessageSquare,
                )
                FitaiButton("Edit details", onClick = {
                    actions.open(DetailSheet.Details)
                }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
        state.grade?.let { grade -> item { GradeCard(grade) } }
        if (workout.mainWorkout.isNotBlank()) item { Text(workout.mainWorkout, style = type.body, color = colors.text) }
        workout.notes?.takeIf { it.isNotBlank() }?.let { notes -> item { Text(notes, style = type.body, color = colors.textMuted) } }
        if (groups.isEmpty()) {
            item { Text("No structured sets for this workout.", style = type.body, color = colors.textMuted) }
        }
        itemsIndexed(groups, key = { _, group -> group.key }) { index, group ->
            ExerciseCard(
                group = group,
                history = state.histories[group.exerciseName].takeIf { group.exerciseName != CUSTOM_EXERCISE },
                busy = state.busy,
                actions = actions,
                move = GroupMove(
                    up = if (index > 0) ({ actions.moveExercise(groups, index, -1) }) else null,
                    down = if (index < groups.lastIndex) ({ actions.moveExercise(groups, index, 1) }) else null,
                ),
            )
        }
        item {
            FitaiButton(
                "Add exercise",
                onClick = { actions.open(DetailSheet.AddExercise) },
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
    group: ExerciseGroup,
    history: ExerciseHistory?,
    busy: Boolean,
    actions: WorkoutActions,
    move: GroupMove,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    ExerciseGroupCard(
        group = group,
        busy = busy,
        onEditSet = { actions.open(DetailSheet.EditSet(it)) },
        onAddSet = actions::addSet,
        move = move,
    ) {
        history?.lastTime?.let { Text("Last time · $it", style = type.bodySm, color = colors.textMuted) }
        history?.next?.let { next ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Next · ${nextTargetLabel(next, history.weightUnit)}",
                    style = type.bodySm,
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                FitaiButton("Use", onClick = { actions.useNext(group.sets, next) }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
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
private fun Stats(workout: WorkoutLogDetail, distanceUnit: String?) {
    val parts = buildList {
        workout.timeOfDayMin?.let { add(formatTimeOfDay(it)) }
        workout.duration?.let { add(if (reportsMovingTime(workout.deviceActivity)) "$it min moving" else "$it min") }
        workout.rpe?.let { add("RPE $it") }
        workout.distanceMeters?.takeIf { it > 0 }?.let { add(formatDistance(it, distanceUnit)) }
        workout.avgHeartrate?.let { add("avg $it bpm") }
        workout.maxHeartrate?.let { add("max $it bpm") }
        workout.calories?.takeIf { it > 0 }?.let { add("$it kcal") }
        if (!workout.countsAsTraining) add("not counted as training")
    }
    if (parts.isNotEmpty()) Text(parts.joinToString(" · "), style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
    deviceDetails(workout, distanceUnit).takeIf { it.isNotEmpty() }?.let { details ->
        Text("Recorded: ${details.joinToString(" · ")}", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

/** Which plan day the workout counts towards, and changing it (link or unlink). */
@Composable
private fun PlanDayRow(linkedDay: PlanDayOption?, linked: Boolean, onChange: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            when {
                linkedDay != null -> "Counts towards ${linkedDay.label}"
                linked -> "Counts towards a plan day"
                else -> "Not part of the plan"
            },
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        FitaiButton(if (linked) "Change" else "Link to plan", onClick = onChange, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
    }
}

private const val TENTHS = 10.0

/** "10.2 km" or "6.3 mi" from metres. */
private fun formatDistance(meters: Double, distanceUnit: String?): String {
    val value = (metersToUserDistance(meters, distanceUnit) * TENTHS).roundToInt() / TENTHS
    return "${formatNumber(value)} ${if (distanceUnit == "miles") "mi" else "km"}"
}

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
