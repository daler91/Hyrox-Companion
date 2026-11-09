package com.fitai.coach.ui.planday

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.longDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.media.rememberPhotoPicker
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.workout.ExerciseGroupCard
import com.fitai.coach.ui.workout.ExercisePickerSheet
import com.fitai.coach.ui.workout.GroupMove
import com.fitai.coach.ui.workout.SetEditorSheet
import com.fitai.coach.ui.workout.exerciseGroups
import kotlinx.coroutines.launch

/**
 * Editing a planned session (the web's log and preview sheets in edit
 * mode): its title and text, its priority, and its prescribed sets.
 */
@Composable
fun PlanDayScreen(entryId: String, onBack: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "plan-day-$entryId") { PlanDayViewModel(session, entryId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    val pickPhoto = rememberPhotoPicker(onPicked = vm::parsePhoto, onError = { scope.launch { toasts.showSnackbar(it) } })
    var editing by remember { mutableStateOf<ExerciseSetRow?>(null) }
    var picking by remember { mutableStateOf(false) }
    var replacing by remember { mutableStateOf<(() -> Unit)?>(null) }

    Box(Modifier.fillMaxSize()) {
        val entry = state.entry
        when {
            entry != null -> PlanDayContent(
                entry = entry,
                state = state,
                vm = vm,
                onBack = onBack,
                onEditSet = { editing = it },
                onAddExercise = { picking = true },
                // Reading text or a photo replaces the sets, so ask first when there are some.
                onParse = { parse -> if (state.sets.isEmpty()) parse() else replacing = parse },
                pickPhoto = pickPhoto,
            )
            !state.loaded -> LoadingState(Modifier.fillMaxSize())
            else -> ErrorState("This session is no longer on your plan", Modifier.fillMaxSize(), onRetry = onBack, retryLabel = "Back")
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }

    editing?.let { set ->
        SetEditorSheet(
            set = set,
            onSave = {
                vm.saveSet(set, it)
                editing = null
            },
            onDelete = {
                vm.deleteSet(set.id)
                editing = null
            },
            onDismiss = { editing = null },
        )
    }
    if (picking) {
        ExercisePickerSheet(
            onPick = { name, label ->
                vm.addExercise(name, label)
                picking = false
            },
            onDismiss = { picking = false },
        )
    }
    replacing?.let { parse ->
        FitaiDialog(
            title = "Replace the sets?",
            text = "The session's ${state.sets.size} sets are replaced with the ones read in.",
            confirmLabel = "Replace",
            onConfirm = {
                replacing = null
                parse()
            },
            onDismiss = { replacing = null },
            destructive = true,
        )
    }
}

@Composable
private fun PlanDayContent(
    entry: TimelineEntry,
    state: PlanDayState,
    vm: PlanDayViewModel,
    onBack: () -> Unit,
    onEditSet: (ExerciseSetRow) -> Unit,
    onAddExercise: () -> Unit,
    onParse: (parse: () -> Unit) -> Unit,
    pickPhoto: (() -> Unit)?,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val groups = exerciseGroups(state.sets)
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.Lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        item(key = "header") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(LucideIcons.ArrowLeft, contentDescription = "back", tint = colors.text) }
                Text(longDate(entry.date), style = type.label, color = colors.textMuted)
            }
            Text("edit session", style = type.h1, color = colors.text, modifier = Modifier.semantics { heading() })
        }
        item(key = "text") { TextEditor(entry, onSave = vm::saveText) }
        if (PriorityTier.editable(entry)) item(key = "priority") { PriorityPicker(entry, vm::setPriority) }
        item(key = "sets-heading") {
            Text("Sets", style = type.h2, color = colors.text, modifier = Modifier.semantics { heading() })
            Text(
                "Read the session's text, or a photo of it, into sets you can edit.",
                style = type.bodySm,
                color = colors.textMuted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    "Read the text",
                    onClick = { onParse(vm::parseText) },
                    variant = ButtonVariant.Secondary,
                    enabled = entry.mainWorkout.isNotBlank() && !state.parsing,
                    loading = state.parsing,
                )
                pickPhoto?.let { pick ->
                    FitaiButton("From a photo", onClick = { onParse(pick) }, variant = ButtonVariant.Ghost, enabled = !state.parsing)
                }
            }
        }
        when {
            state.loadingSets && state.sets.isEmpty() -> item(key = "sets-loading") { LoadingState(message = "Loading the sets…") }
            state.setsFailed && state.sets.isEmpty() -> item(key = "sets-failed") {
                ErrorState("Couldn't load the sets", onRetry = vm::loadSets)
            }
            groups.isEmpty() -> item(key = "no-sets") {
                Text("No sets yet: add an exercise, or read them from the text.", style = type.body, color = colors.textMuted)
            }
            else -> itemsIndexed(groups, key = { _, group -> group.key }) { index, group ->
                ExerciseGroupCard(
                    group = group,
                    busy = state.busy,
                    onEditSet = onEditSet,
                    onAddSet = vm::addSet,
                    move = GroupMove(
                        up = if (index > 0) ({ vm.moveExercise(groups, index, -1) }) else null,
                        down = if (index < groups.lastIndex) ({ vm.moveExercise(groups, index, 1) }) else null,
                    ),
                )
            }
        }
        item(key = "add-exercise") {
            FitaiButton(
                "Add exercise",
                onClick = onAddExercise,
                variant = ButtonVariant.Secondary,
                enabled = !state.busy && !state.setsFailed,
                leadingIcon = LucideIcons.Plus,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The session's title and text, saved together. */
@Composable
private fun TextEditor(entry: TimelineEntry, onSave: (PlanDayText) -> Unit) {
    var text by remember(entry.id) { mutableStateOf(PlanDayText.of(entry)) }
    val changed = text.changesFrom(entry) != null
    FitaiCard {
        FitaiTextField(text.title, { text = text.copy(title = it) }, "Title", error = if (text.isValid) null else "A session needs a title")
        FitaiTextField(text.mainWorkout, { text = text.copy(mainWorkout = it) }, "Workout", singleLine = false)
        FitaiTextField(text.accessory, { text = text.copy(accessory = it) }, "Accessory", singleLine = false)
        FitaiTextField(text.notes, { text = text.copy(notes = it) }, "Coach's notes", singleLine = false)
        FitaiButton("Save", onClick = { onSave(text) }, enabled = changed && text.isValid, modifier = Modifier.fillMaxWidth())
    }
}

/** Key, supporting or optional (SessionPriorityControl). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PriorityPicker(entry: TimelineEntry, onPick: (PriorityTier) -> Unit) {
    val current = PriorityTier.of(entry.priority)
    FitaiCard {
        Text("Priority", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            PriorityTier.entries.forEach { tier -> FitaiChip(tier.label, selected = tier == current, onClick = { onPick(tier) }) }
        }
        current?.let { Text(it.help, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
    }
}
