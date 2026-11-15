package com.fitai.coach.ui.workout

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.SessionGrade
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.exercises.NextTarget
import com.fitai.coach.ui.coach.CoachThread
import com.fitai.coach.ui.components.BadgeTone
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
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.formatWeight
import com.fitai.coach.ui.format.weekdayDate
import com.fitai.coach.ui.fuelling.FuellingAroundSessionPanel
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.media.rememberPhotoPicker
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.launch

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
    onOpenNutrition: (date: String, meal: Meal?) -> Unit = { _, _ -> },
    onCombined: (workoutId: String) -> Unit = {},
) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "workout-$workoutId") { WorkoutDetailViewModel(session, workoutId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    // Each time the workout shows, so a recovery meal logged since counts.
    LaunchedEffect(vm) { vm.refreshFuelling() }
    var sheet by remember { mutableStateOf<DetailSheet?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    val scope = rememberCoroutineScope()
    val pickPhoto = rememberPhotoPicker(onPicked = vm::parsePhoto, onError = { scope.launch { toasts.showSnackbar(it) } })
    // Reading text or a photo replaces the sets, so ask first when there are some.
    var replacing by remember { mutableStateOf<(() -> Unit)?>(null) }
    val replaceSets: (read: () -> Unit) -> Unit = { read ->
        if (state.workout?.exerciseSets.isNullOrEmpty()) {
            read()
        } else {
            replacing = read
        }
    }

    Box(Modifier.fillMaxSize()) {
        val workout = state.workout
        when {
            workout != null -> WorkoutContent(
                workout = workout,
                state = state,
                distanceUnit = prefs?.distanceUnit,
                weightUnit = prefs?.weightUnit,
                onSaveRpe = vm::saveRpe,
                actions = object : WorkoutActions {
                    override fun back() = onBack()

                    override fun askCoach() = onAskCoach(CoachThread.of(workout))

                    override fun logRecoveryMeal(date: String) = onOpenNutrition(date, Meal.PostWorkout)

                    override fun open(opened: DetailSheet) {
                        sheet = opened
                    }

                    override fun addSet(sets: List<ExerciseSetRow>) = vm.addSet(sets)

                    override fun fill(sets: List<ExerciseSetRow>, fill: SetFill) = when (fill) {
                        is SetFill.Next -> vm.useNext(sets, fill.target)
                        is SetFill.Last -> vm.useLast(sets, fill.history)
                    }

                    override fun moveExercise(groups: List<ExerciseGroup>, index: Int, offset: Int) = vm.moveExercise(groups, index, offset)

                    override val readsPhotos = pickPhoto != null

                    override fun readText() = replaceSets(vm::parseText)

                    override fun readPhoto() {
                        pickPhoto?.let(replaceSets)
                    }

                    override fun confirm(asked: Confirm) {
                        confirm = asked
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
        DetailSheet.Maf -> state.workout?.let { workout ->
            state.maf?.let { tag ->
                val unit = prefs?.distanceUnit
                MafFormSheet(
                    initial = if (tag.tagged) MafForm.forTest(tag.saved, unit) else MafForm.forWorkout(workout, unit),
                    tagged = tag.tagged,
                    distanceUnit = unit,
                    saving = state.mafSaving,
                    onSave = { form -> vm.saveMaf(form, unit) { if (sheet == DetailSheet.Maf) close() } },
                    onDismiss = close,
                )
            }
        }
        is DetailSheet.BlockResult -> BlockResultSheetFor(
            blocks = state.workout?.structureBlocks.orEmpty(),
            blockId = open.blockId,
            saving = state.scoring,
            onScore = { blockId, score -> vm.scoreBlock(blockId, score) { if (sheet == open) close() } },
            onDismiss = close,
        )
        is DetailSheet.ChangeExercise -> ExercisePickerSheet(
            onPick = { name, label ->
                vm.changeExercise(open.group, name, label)
                close()
            },
            onDismiss = close,
            title = "Change exercise",
            description = "Replace ${open.group.label} with another exercise. Your reps, weight, and other set values stay the same.",
            customRow = { "Use \"$it\" as a custom exercise" },
        )
        DetailSheet.Combine -> state.workout?.let { workout ->
            CombineSheet(
                workout = workout,
                candidates = state.combineCandidates,
                busy = state.busy,
                onCombine = { other, draft -> vm.combine(other, draft, onCombined) },
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

    when (val asked = confirm) {
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
        Confirm.RemoveMaf -> FitaiDialog(
            title = "Remove MAF test?",
            text = "This removes the workout from your MAF trend, including its compliance score. You can tag it again later.",
            confirmLabel = "Remove",
            onConfirm = {
                confirm = null
                vm.untagMaf()
            },
            onDismiss = { confirm = null },
            destructive = true,
        )
        is Confirm.DeleteExercise -> FitaiDialog(
            title = "Delete exercise?",
            text = deleteExerciseText(asked.group, "this workout"),
            confirmLabel = "Delete",
            onConfirm = {
                confirm = null
                vm.deleteExercise(asked.group)
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

    replacing?.let { read ->
        val count = state.workout?.exerciseSets?.size ?: 0
        FitaiDialog(
            title = "Replace the sets?",
            text = "The workout's $count ${if (count == 1) "set is" else "sets are"} replaced with the ones read in. " +
                "Edits you've made to them are lost.",
            confirmLabel = "Replace",
            onConfirm = {
                replacing = null
                read()
            },
            onDismiss = { replacing = null },
            destructive = true,
        )
    }
}

private sealed interface DetailSheet {
    data object Details : DetailSheet

    data object PlanDay : DetailSheet

    data object AddExercise : DetailSheet

    data object Maf : DetailSheet

    data object Combine : DetailSheet

    data class ChangeExercise(val group: ExerciseGroup) : DetailSheet

    data class BlockResult(val blockId: String) : DetailSheet

    data class EditSet(val set: ExerciseSetRow) : DetailSheet
}

private sealed interface Confirm {
    data object Reopen : Confirm

    data object Delete : Confirm

    data object RemoveMaf : Confirm

    data class DeleteExercise(val group: ExerciseGroup) : Confirm
}

/** What fills an exercise's sets. */
private sealed interface SetFill {
    data class Next(val target: NextTarget) : SetFill

    data class Last(val history: ExerciseHistory) : SetFill
}

/** What the workout's controls do. */
private interface WorkoutActions {
    fun back()

    fun askCoach()

    /** Nutrition on [date], adding to the post-workout meal. */
    fun logRecoveryMeal(date: String)

    /** Opens a sheet: the details editor, the plan-day picker, a set's editor, the exercise library, the MAF form or a block's result. */
    fun open(opened: DetailSheet)

    fun addSet(sets: List<ExerciseSetRow>)

    /** Fills an exercise's sets: with the next target, or with last time's values. */
    fun fill(sets: List<ExerciseSetRow>, fill: SetFill)

    fun moveExercise(groups: List<ExerciseGroup>, index: Int, offset: Int)

    /** Whether there's a photo picker to read a photo of the session from. */
    val readsPhotos: Boolean

    /** Reads the workout's text into sets, asking first when it has sets to replace. */
    fun readText()

    /** Picks a photo of the session to read into sets, asking first when it has sets to replace. */
    fun readPhoto()

    /** Asks before reopening the plan day, deleting the workout or taking it out of the MAF trend. */
    fun confirm(asked: Confirm)
}

@Composable
private fun WorkoutContent(
    workout: WorkoutLogDetail,
    state: WorkoutDetailState,
    distanceUnit: String?,
    weightUnit: String?,
    onSaveRpe: (Int) -> Unit,
    actions: WorkoutActions,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val groups = exerciseGroups(workout.exerciseSets)
    LazyColumn(
        Modifier.fillMaxSize(),
        // Room under the last button for the coach button that floats over the page.
        contentPadding = PaddingValues(start = Spacing.Lg, top = Spacing.Lg, end = Spacing.Lg, bottom = END_CLEARANCE.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        item { DetailHeader(workout, onBack = actions::back, onEdit = { actions.open(DetailSheet.Details) }) }
        item { SummaryCard(workout, distanceUnit) }
        item {
            FitaiButton(
                "Ask coach",
                onClick = actions::askCoach,
                leadingIcon = LucideIcons.MessageSquare,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            SessionCard(
                suggestedRpe = workout.suggestedRpe?.takeIf { workout.rpe == null },
                onSaveRpe = onSaveRpe,
                planDay = {
                    PlanDayRow(state.linkedPlanDay, linked = workout.planDayId != null, onChange = { actions.open(DetailSheet.PlanDay) })
                },
                maf = state.maf?.let { tag ->
                    {
                        MafTagRow(tag, state.mafSaving, onOpenForm = {
                            actions.open(DetailSheet.Maf)
                        }, onRemove = { actions.confirm(Confirm.RemoveMaf) })
                    }
                },
            )
        }
        state.grade?.let { grade -> item { GradeCard(grade) } }
        if (state.showsFuelling) {
            item {
                FuellingAroundSessionPanel(state.fuelling) { state.fuelling?.let { actions.logRecoveryMeal(it.date) } }
            }
        }
        item(key = "results-heading") { ResultsHeading(fromStrava = workout.source == "strava") }
        // With no sets the description is the workout, so it leads; with sets it follows them, as on the web.
        if (groups.isEmpty()) {
            item { DescriptionCard(workout) }
            item { Text("No structured sets for this workout.", style = type.body, color = colors.textMuted) }
        }
        item { ReadIntoSets(hasText = hasReadableText(workout), hasSets = groups.isNotEmpty(), state = state, actions = actions) }
        itemsIndexed(groups, key = { _, group -> group.key }) { index, group ->
            ExerciseCard(
                group = group,
                history = state.histories[group.exerciseName].takeIf { group.exerciseName != CUSTOM_EXERCISE },
                busy = state.busy,
                actions = actions,
                showsPlannedDiffs = state.showsPlannedDiffs,
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
        if (groups.isNotEmpty()) item { DescriptionCard(workout) }
        val blocks = orderedBlocks(workout.structureBlocks)
        if (blocks.isNotEmpty()) {
            item(key = "structure-heading") {
                Text("Structure", style = type.h3, color = colors.text, modifier = Modifier.semantics { heading() })
            }
            itemsIndexed(blocks, key = { _, block -> "block-${block.id}" }) { index, block ->
                StructureBlockCard(block, index, weightUnit, busy = state.scoring) { actions.open(DetailSheet.BlockResult(block.id)) }
            }
        }
        if (state.combineCandidates.isNotEmpty()) {
            item {
                FitaiButton(
                    "Combine with another workout",
                    onClick = { actions.open(DetailSheet.Combine) },
                    variant = ButtonVariant.Secondary,
                    enabled = !state.busy,
                    leadingIcon = LucideIcons.CopyPlus,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                if (state.planEntry != null) {
                    FitaiButton("Reopen", onClick = { actions.confirm(Confirm.Reopen) }, variant = ButtonVariant.Secondary)
                }
                FitaiButton(
                    "Delete workout",
                    onClick = { actions.confirm(Confirm.Delete) },
                    variant = ButtonVariant.Danger,
                    enabled = !state.busy,
                    leadingIcon = LucideIcons.Trash,
                )
            }
        }
    }
}

/** Reading the workout's text, or a photo of the session, into sets (PrescriptionEditor's parse). */
@Composable
private fun ReadIntoSets(hasText: Boolean, hasSets: Boolean, state: WorkoutDetailState, actions: WorkoutActions) {
    if (!hasText && !actions.readsPhotos) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        if (!hasSets) {
            Text(
                "Read the workout's text, or a photo of it, into sets you can edit.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            if (hasText) {
                FitaiButton(
                    "Read the text",
                    onClick = actions::readText,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    enabled = !state.busy,
                    loading = state.parsing,
                )
            }
            if (actions.readsPhotos) {
                FitaiButton(
                    "From a photo",
                    onClick = actions::readPhoto,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    enabled = !state.busy,
                    leadingIcon = LucideIcons.Camera,
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
    showsPlannedDiffs: Boolean,
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
        menu = GroupMenu(onChange = { actions.open(DetailSheet.ChangeExercise(group)) }, onDelete = {
            actions.confirm(Confirm.DeleteExercise(group))
        }),
    ) {
        if (showsPlannedDiffs) plannedDiffSummary(group.sets)?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
        history?.lastTime?.let { lastTime ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Last time · $lastTime", style = type.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
                if (history.lastSets.isNotEmpty()) {
                    FitaiButton("Use last", onClick = {
                        actions.fill(group.sets, SetFill.Last(history))
                    }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                }
            }
        }
        history?.next?.let { next ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Next · ${nextTargetLabel(next, history.weightUnit)}",
                    style = type.bodySm,
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                FitaiButton("Use", onClick = {
                    actions.fill(group.sets, SetFill.Next(next))
                }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
    }
}

/** The back arrow and the status over the title and its date (the web's detail header); the pencil's job is "Edit details". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DetailHeader(workout: WorkoutLogDetail, onBack: () -> Unit, onEdit: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The button's own padding is taken back, so the arrow sits on the content's left edge.
            IconButton(onClick = onBack, modifier = Modifier.offset(x = -Spacing.Md)) {
                Icon(LucideIcons.ArrowLeft, contentDescription = "back", tint = colors.text)
            }
            FlowRow(
                Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
                verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
            ) {
                FitaiBadge("Completed", tone = BadgeTone.Success)
                if (!workout.countsAsTraining) FitaiBadge("Not counted as training")
            }
            FitaiButton(
                "Edit details",
                onClick = onEdit,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = LucideIcons.Pencil,
            )
        }
        Text(workout.focus, style = type.h2, color = colors.text, modifier = Modifier.semantics { heading() })
        Text(
            listOfNotNull(weekdayDate(workout.date), workout.timeOfDayMin?.let(::formatTimeOfDay)).joinToString(" · "),
            style = type.bodySm,
            color = colors.textMuted,
        )
    }
}

/**
 * The session's figures as a grid of tiles over what the recording measured
 * (WorkoutSummaryHeader). Each tile is a label, its figure and its unit, so no
 * number has to be picked out of a sentence.
 */
@Composable
private fun SummaryCard(workout: WorkoutLogDetail, distanceUnit: String?) {
    val stats = summaryStats(workout, distanceUnit)
    val details = deviceDetails(workout, distanceUnit)
    if (stats.isEmpty() && details.isEmpty()) return
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Lg)) {
            stats.chunked(STAT_COLUMNS).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Lg)) {
                    row.forEach { StatTile(it, Modifier.weight(1f)) }
                    repeat(STAT_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            stats.firstNotNullOfOrNull { it.status }?.let {
                Text(it.cue, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            }
            if (details.isNotEmpty()) {
                if (stats.isNotEmpty()) HorizontalDivider(color = colors.border)
                RecordingDetails(details)
            }
        }
    }
}

@Composable
private fun StatTile(stat: SummaryStat, modifier: Modifier) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(
        modifier.semantics(mergeDescendants = true) { contentDescription = stat.spoken },
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        Text(stat.label.uppercase(), style = type.label, color = colors.textMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(stat.value, style = type.metricSm, color = colors.text, modifier = Modifier.alignByBaseline())
            stat.unit?.let { Text(it, style = type.bodySm, color = colors.textMuted, modifier = Modifier.alignByBaseline()) }
        }
        stat.status?.let { FitaiBadge(it.label, tone = it.tone) }
    }
}

/** "STRAVA 6:02/km pace · 74 spm cadence": each figure in the text colour, what it measures beside it in the muted one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecordingDetails(details: List<DeviceDetail>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Md), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text("RECORDED", style = type.label, color = colors.textMuted, modifier = Modifier.alignByBaseline())
        details.forEach { detail ->
            Row(
                Modifier.alignByBaseline().semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
            ) {
                Text(detail.value, style = type.bodySm, color = colors.text, modifier = Modifier.alignByBaseline())
                Text(detail.label, style = type.bodySm, color = colors.textMuted, modifier = Modifier.alignByBaseline())
            }
        }
    }
}

/**
 * What the session counts as, one row each under a rule: the effort its heart
 * rate suggests, the plan day it counts towards, and its MAF test.
 */
@Composable
private fun SessionCard(suggestedRpe: Int?, onSaveRpe: (Int) -> Unit, planDay: @Composable () -> Unit, maf: (@Composable () -> Unit)?) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            suggestedRpe?.let { suggested ->
                SuggestedRpeRow(suggested) { onSaveRpe(suggested) }
                HorizontalDivider(color = colors.border)
            }
            planDay()
            maf?.let { row ->
                HorizontalDivider(color = colors.border)
                row()
            }
        }
    }
}

/** "Results", and where they came from when a recording brought them. */
@Composable
private fun ResultsHeading(fromStrava: Boolean) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Icon(LucideIcons.Dumbbell, contentDescription = null, tint = colors.textMuted)
        Text("Results", style = type.h3, color = colors.text, modifier = Modifier.weight(1f).semantics { heading() })
        if (fromStrava) Text("from Strava", style = type.bodySm, color = colors.textMuted)
    }
}

/** What was written for the session and the athlete's notes on it, each under its name. */
@Composable
private fun DescriptionCard(workout: WorkoutLogDetail) {
    val notes = workout.notes?.takeIf { it.isNotBlank() }
    if (workout.mainWorkout.isBlank() && notes == null) return
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            if (workout.mainWorkout.isNotBlank()) {
                Text("DESCRIPTION", style = type.label, color = colors.textMuted)
                Text(workout.mainWorkout, style = type.body, color = colors.text)
            }
            notes?.let {
                Text("NOTES", style = type.label, color = colors.textMuted)
                Text(it, style = type.body, color = colors.text)
            }
        }
    }
}

/** The RPE the recording's heart rate suggests (RpePrompt): saved only when the athlete takes it. */
@Composable
private fun SuggestedRpeRow(suggested: Int, onSave: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Your heart rate suggests RPE $suggested.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        FitaiButton("Save RPE $suggested", onClick = onSave, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
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
        FitaiButton(if (linked) "Change" else "Link to plan", onClick = onChange, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
    }
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
            workout.suggestedRpe?.takeIf { edit.rpe == null }?.let { suggested ->
                Text(
                    "Your heart rate suggests $suggested. Tap it to save, or pick your own.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
            }
            FitaiTextField(edit.notes, { edit = edit.copy(notes = it) }, "Notes", singleLine = false)
            FitaiSwitchRow("Counts as training", edit.countsAsTraining, { edit = edit.copy(countsAsTraining = it) })
            FitaiButton("Save", onClick = { onSave(edit) }, enabled = edit.isValid(), modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Tiles to a row of the summary card. */
private const val STAT_COLUMNS = 2

/** dp under the page's last button: the coach button (56) and its margin sit there. */
private const val END_CLEARANCE = 96
