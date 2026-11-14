package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.offerUndo
import com.fitai.coach.ui.format.dayLabel
import com.fitai.coach.ui.fuelling.FuellingDayChip
import com.fitai.coach.ui.fuelling.FuellingTarget
import com.fitai.coach.ui.fuelling.PlanFuelling
import com.fitai.coach.ui.fuelling.timelineFuellingWindow
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.plans.GeneratePlanSheet
import com.fitai.coach.ui.plans.GeneratePlanViewModel
import com.fitai.coach.ui.review.ReviewPrompt
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.launch

/** Which sheet is open, by entry id (so it survives the entry being refreshed). */
private sealed interface OpenSheet {
    val entryId: String

    data class Surface(override val entryId: String) : OpenSheet

    data class Skip(override val entryId: String) : OpenSheet

    data class PickDate(override val entryId: String) : OpenSheet
}

/** The training-note editor: a new note from [startDate], or the note [editingId]. */
private data class NoteSheet(val startDate: String, val editingId: String? = null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimelineScreen(navigation: TimelineNavigation, openPlanDayId: String? = null, onPlanDayOpened: () -> Unit = {}) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "timeline-${session.userId}") { TimelineViewModel(session, ::todayIn) }
    val state by vm.state.collectAsStateWithLifecycle()
    val recovery by vm.recovery.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(vm) { vm.undos.collect { offerUndo(toasts, it) } }
    val generator = viewModel(key = "generate-plan-${session.userId}") { GeneratePlanViewModel(session, ::todayIn) }
    val generatorState by generator.state.collectAsStateWithLifecycle()
    LaunchedEffect(generator) { generator.messages.collect { toasts.showSnackbar(it) } }

    var sheet by remember { mutableStateOf<OpenSheet?>(null) }
    var noteSheet by remember { mutableStateOf<NoteSheet?>(null) }
    var confirmingDelete by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val allEntries = state.rows.days.flatMap { it.entries }
    // The fuelling chips cover the days on screen; asked for again each time the timeline shows.
    val fuellingWindow = remember(state.rows, state.today) {
        timelineFuellingWindow(state.rows.days.filter { it.entries.isNotEmpty() || it.isToday }.map { it.date }, state.today)
    }
    LaunchedEffect(fuellingWindow) { fuellingWindow?.let(vm::showFuelling) }
    val planFuelling = PlanFuelling(state.bodyweightKg, vm::plannedEstimate, vm::saveExpectedSession)
    val sheetEntry = sheet?.let { open -> allEntries.firstOrNull { it.id == open.entryId } }
    // A link to a plan day (an email's "Open the session") opens that day once it is on the timeline.
    LaunchedEffect(openPlanDayId, state.loaded) {
        if (openPlanDayId == null || !state.loaded) return@LaunchedEffect
        allEntries.firstOrNull { it.planDayId == openPlanDayId }?.let { sheet = OpenSheet.Surface(it.id) }
        onPlanDayOpened()
    }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
            when {
                !state.loaded -> LoadingState(Modifier.fillMaxSize())
                state.loadFailed -> ErrorState("Couldn't load your timeline", Modifier.fillMaxSize(), onRetry = vm::refresh)
                !state.hasAnyEntries && state.plans.isEmpty() && !state.refreshing -> Welcome(
                    WelcomeActions(
                        generatePlan = generator::open,
                        useTemplate = vm::useSamplePlan,
                        logWorkout = navigation.logWorkout,
                        logNote = { noteSheet = NoteSheet(state.today) },
                    ),
                    creatingTemplate = state.planStart.creatingSample,
                )
                else -> TimelineList(
                    state,
                    vm,
                    onOpen = { sheet = OpenSheet.Surface(it.id) },
                    onPickDate = { sheet = OpenSheet.PickDate(it.id) },
                    onNote = { date, id -> noteSheet = NoteSheet(date, id) },
                    onNewAiPlan = generator::open,
                    navigation = navigation,
                    onDeleteSelected = { confirmingDelete = true },
                )
            }
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }
    GeneratePlanSheet(generatorState, generator)
    state.planStart.schedulingPlanId?.let { id -> state.plans.firstOrNull { it.id == id } }?.let { plan ->
        ScheduleSheet(plan, state.today, onSchedule = { date -> vm.schedulePlan(plan.id, date) }, onDismiss = vm::stopScheduling)
    }
    state.selection?.takeIf { confirmingDelete }?.let { picked ->
        FitaiDialog(
            title = "Delete selected workouts?",
            text = deleteSelectedText(picked.count),
            confirmLabel = "Delete",
            onConfirm = {
                confirmingDelete = false
                vm.deleteSelected()
            },
            onDismiss = { confirmingDelete = false },
            destructive = true,
        )
    }

    val today = state.today
    when (val open = sheet) {
        null -> Unit
        is OpenSheet.Skip -> sheetEntry?.let { entry ->
            SkipSheet(
                entry,
                today,
                onConfirm = { reason ->
                    vm.skip(entry, reason)
                    sheet = null
                },
                onMove = { date ->
                    vm.move(entry, date)
                    sheet = null
                },
                onDismiss = { sheet = null },
            )
        }
        is OpenSheet.PickDate -> sheetEntry?.let { entry ->
            MoveDateSheet(entry, today, onMove = { date ->
                vm.move(entry, date)
                sheet = null
            }, onDismiss = { sheet = null })
        }
        is OpenSheet.Surface -> sheetEntry?.let { entry ->
            val label = dayLabel(entry.date, today)
            val close = { sheet = null }
            when (surfaceFor(entry, today)) {
                EntrySurface.WorkoutDetail -> LaunchedEffect(open) {
                    close()
                    navigation.openWorkout(requireNotNull(entry.workoutLogId))
                }
                EntrySurface.Preview -> PreviewSheet(
                    entry,
                    label,
                    planFuelling,
                    onSkip = { sheet = OpenSheet.Skip(entry.id) },
                    onAskCoach = {
                        close()
                        navigation.askCoach(entry)
                    },
                    onEdit = {
                        close()
                        navigation.editPlanDay(entry.id)
                    },
                    onDismiss = close,
                )
                EntrySurface.Log -> LogSheet(
                    entry,
                    label,
                    planFuelling,
                    onComplete = { rpe, notes ->
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        vm.markDone(entry, rpe, notes)
                        close()
                    },
                    onSkip = { sheet = OpenSheet.Skip(entry.id) },
                    onRecover = if (offersRecovery(entry)) {
                        {
                            close()
                            vm.openRecovery(entry)
                        }
                    } else {
                        null
                    },
                    onEdit = {
                        close()
                        navigation.editPlanDay(entry.id)
                    },
                    onDismiss = close,
                )
                EntrySurface.Skipped -> SkippedSheet(
                    entry,
                    label,
                    onUndo = {
                        vm.reopen(entry)
                        close()
                    },
                    onAskCoach = {
                        close()
                        navigation.askCoach(entry)
                    },
                    onDelete = {
                        close()
                        vm.deletePlanDay(entry)
                    },
                    onDismiss = close,
                )
                EntrySurface.None -> LaunchedEffect(open) { close() }
            }
        }
    }
    recovery?.let { RecoverySheet(it, onAction = vm::recover, onDismiss = vm::closeRecovery) }
    noteSheet?.let { open ->
        val editing = open.editingId?.let { id -> state.rows.days.flatMap { it.annotations }.firstOrNull { it.id == id } }
        AnnotationSheet(editing, open.startDate, onSave = { draft ->
            vm.saveAnnotation(open.editingId, draft)
            noteSheet = null
        }, onDismiss = { noteSheet = null })
    }
}

@Composable
private fun TimelineList(
    state: TimelineUiState,
    vm: TimelineViewModel,
    onOpen: (TimelineEntry) -> Unit,
    onPickDate: (TimelineEntry) -> Unit,
    onNote: (date: String, editingId: String?) -> Unit,
    onNewAiPlan: () -> Unit,
    navigation: TimelineNavigation,
    onDeleteSelected: () -> Unit,
) {
    val listState = rememberLazyListState()
    var scrolledToToday by rememberSaveable { mutableStateOf(false) }
    val header = 1 + (if (state.rows.hiddenPast > 0 || state.hasOlder) 1 else 0)
    // While a plan waits for its start date, its card stands in for the days: scroll once they come.
    val readyPlan = state.planReadyToStart()
    LaunchedEffect(state.rows.todayIndex, readyPlan) {
        if (!scrolledToToday && state.rows.todayIndex >= 0 && readyPlan == null) {
            listState.scrollToItem(state.rows.todayIndex + header)
            scrolledToToday = true
        }
    }
    val tomorrow = addDaysToIsoDate(state.today, 1)
    // Today's row, counting the items above the days (the sticky selection bar is one).
    val todayItem = if (readyPlan == null && state.rows.todayIndex >= 0) {
        header + (if (state.selection != null) 1 else 0) + state.rows.todayIndex
    } else {
        -1
    }
    val todayAway by remember(todayItem) {
        derivedStateOf {
            todayDirection(todayItem, listState.firstVisibleItemIndex, listState.layoutInfo.visibleItemsInfo.map { it.index }.toSet())
        }
    }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = Spacing.Lg, vertical = Spacing.Md),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            item(key = "header") {
                Header(
                    state,
                    vm::selectPlan,
                    vm::filterBy,
                    PlanToolActions(vm::renamePlan, vm::setPlanGoal, vm::schedulePlan, vm::setPlanArchived, vm::deletePlan),
                    onNewAiPlan,
                    onSelect = if (state.selection == null) vm::startSelecting else vm::stopSelecting,
                )
                state.reviewPrompt?.let { prompt ->
                    ReviewPromptCard(prompt, onOpen = {
                        navigation.openReview(prompt.weekStart)
                    }, onDismiss = { vm.dismissReviewPrompt(prompt.weekStart) })
                }
            }
            state.selection?.let { picked ->
                stickyHeader(key = "selection") {
                    SelectionBar(
                        picked,
                        selectableCount = selectable(state.rows).size,
                        SelectionActions(vm::selectAll, vm::clearSelection, onDeleteSelected, vm::stopSelecting),
                    )
                }
            }
            if (state.rows.hiddenPast > 0) {
                item(key = "more-past") {
                    MoreButton("Show ${state.rows.hiddenPast} more past ${plural(state.rows.hiddenPast)}", vm::showMorePast)
                }
            } else if (state.hasOlder) {
                item(key = "more-past") {
                    MoreButton(if (state.loadingOlder) "Loading older workouts…" else "Load older workouts", vm::loadOlder)
                }
            }
            if (state.rows.days.isEmpty() && state.statusFilter != null) {
                item(key = "no-matches") { NoMatches(state, onShowAll = { vm.filterBy(null) }) }
            }
            readyPlan?.let { planId ->
                item(key = "ready") {
                    ReadyToStart(onSetStartDate = { vm.startScheduling(planId) }, onLogNote = { onNote(state.today, null) })
                }
            }
            items(if (readyPlan == null) state.rows.days else emptyList(), key = { "day-${it.date}" }) { day ->
                DayRow(day, state, vm, tomorrow, navigation, onOpen = onOpen, onPickDate = onPickDate, onNote = onNote)
            }
            if (state.rows.hiddenUpcoming > 0) {
                item(key = "more-upcoming") {
                    MoreButton("Show ${state.rows.hiddenUpcoming} more upcoming ${plural(state.rows.hiddenUpcoming)}", vm::showMoreUpcoming)
                }
            }
            item(key = "log") { MoreButton("Log a workout", navigation.logWorkout) }
        }
        todayAway?.let { direction ->
            TodayPill(
                direction,
                onClick = { scope.launch { listState.animateScrollToItem(todayItem) } },
                modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.Lg),
            )
        }
    }
}

/** One day: its header and fuelling, its training notes, then its sessions, or "Rest day" with none. */
@Composable
private fun DayRow(
    day: TimelineDay,
    state: TimelineUiState,
    vm: TimelineViewModel,
    tomorrow: String,
    navigation: TimelineNavigation,
    onOpen: (TimelineEntry) -> Unit,
    onPickDate: (TimelineEntry) -> Unit,
    onNote: (date: String, editingId: String?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        DayHeader(day, state.today, onAddNote = { onNote(day.date, null) })
        state.fuelling[day.date]?.let { fuelling ->
            FuellingDayChip(fuelling, onClick = { navigation.openNutrition(day.date) })
        }
        day.annotations.forEach { annotation ->
            AnnotationCard(
                annotation,
                onEdit = { onNote(annotation.startDate, annotation.id) },
                onDelete = { vm.deleteAnnotation(annotation.id) },
            )
        }
        if (day.entries.isEmpty() && day.annotations.isEmpty()) {
            Text("Rest day — nothing scheduled.", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
        }
        day.entries.forEach { entry ->
            val picking = state.selection
            if (picking != null) {
                SelectableTimelineCard(entry, picked = picking.picks(entry), enabled = !picking.deleting) {
                    vm.toggleSelected(entry)
                }
                return@forEach
            }
            TimelineCard(
                entry = entry,
                quickComplete = canQuickComplete(entry, tomorrow),
                onOpen = { onOpen(entry) },
                actions = CardActions(
                    onComplete = { vm.markDone(entry) },
                    onUndoRecovery = { vm.undoRecovery(entry) },
                    moves = quickMoves(entry, state.today),
                    onMove = { date -> vm.move(entry, date) },
                    onPickDate = if (canMove(entry)) ({ onPickDate(entry) }) else null,
                ),
                chips = remember(entry, state.records) { exerciseChips(entry, state.records) },
                fuelling = remember(entry, state.bodyweightKg) { FuellingTarget.of(entry, state.bodyweightKg) },
                pending = state.isPending(entry),
                mafCeiling = state.mafCeiling,
                strava = stravaControls(
                    entry,
                    day.entries,
                    onLink = { target -> vm.linkRecording(entry, target) },
                    onUnlink = { vm.unlinkRecording(entry) },
                    onDismissSuggestion = { vm.dismissSuggestion(entry) },
                ),
            )
        }
    }
}

private fun plural(count: Int) = if (count == 1) "workout" else "workouts"

/**
 * Nothing loaded matches the filter (TimelineContent's NoLoadedMatches):
 * older history may, so offer it, and a way back to everything.
 */
@Composable
private fun NoMatches(state: TimelineUiState, onShowAll: () -> Unit) {
    val what = STATUS_FILTERS.firstOrNull { it.first == state.statusFilter }?.second?.lowercase() ?: ""
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        val loaded = if (state.hasOlder) " in the sessions loaded so far. Older sessions may match." else "."
        Text("No $what workouts$loaded", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
        MoreButton("Show all", onShowAll)
    }
}

@Composable
private fun Header(
    state: TimelineUiState,
    onSelectPlan: (String?) -> Unit,
    onFilter: (TimelineEntry.Status?) -> Unit,
    planTools: PlanToolActions,
    onNewAiPlan: () -> Unit,
    onSelect: () -> Unit,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("training", style = type.h1, color = colors.text, modifier = Modifier.weight(1f).semantics { heading() })
            if (state.hasAnyEntries) {
                FitaiButton(
                    if (state.selection ==
                        null
                    ) {
                        "Select"
                    } else {
                        "Done"
                    },
                    onClick = onSelect,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
            FitaiButton(
                "New AI plan",
                onClick = onNewAiPlan,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = LucideIcons.Sparkles,
            )
        }
        if (state.coachReviewing) CoachReviewingBanner()
        state.week?.let { WeekCard(it) }
        if (state.plans.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                item { FitaiChip("All plans", selected = state.selectedPlanId == null, onClick = { onSelectPlan(null) }) }
                items(state.plans, key = { it.id }) { plan ->
                    FitaiChip(planChipLabel(plan), selected = state.selectedPlanId == plan.id, onClick = {
                        onSelectPlan(plan.id)
                    })
                }
            }
            state.plans.firstOrNull { it.id == state.selectedPlanId }?.let { plan -> PlanToolsRow(plan, state.today, planTools) }
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            items(STATUS_FILTERS, key = { it.second }) { (status, label) ->
                FitaiChip(label, selected = state.statusFilter == status, onClick = { onFilter(status) })
            }
        }
    }
}

/**
 * The Sunday-evening-to-Tuesday nudge into the weekly review
 * (WeeklyReviewPrompt): open it, or dismiss it until next week's.
 */
@Composable
private fun ReviewPromptCard(prompt: ReviewPrompt, onOpen: () -> Unit, onDismiss: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth().padding(top = Spacing.Md)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Icon(LucideIcons.CalendarRange, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text(
                    if (prompt.wrappingUp) "Your training week is wrapping up" else "Last week is ready to review",
                    style = type.label,
                    color = colors.text,
                )
                Text(
                    if (prompt.wrappingUp) {
                        "See how it went and what changed against the week before."
                    } else {
                        "What you planned, what you did, and what changed."
                    },
                    style = type.bodySm,
                    color = colors.textMuted,
                )
                FitaiButton("Open review", onClick = onOpen, size = ButtonSize.Sm)
            }
            IconButton(onClick = onDismiss) {
                Icon(LucideIcons.X, contentDescription = "Dismiss weekly review prompt", tint = colors.textMuted)
            }
        }
    }
}

@Composable
private fun DayHeader(day: TimelineDay, today: String, onAddNote: () -> Unit) {
    val label = dayLabel(day.date, today)
    val colors = FitaiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text(
            label,
            style = FitaiTheme.typography.h3,
            color = if (day.isToday) colors.accent else colors.text,
            modifier = Modifier.weight(1f, fill = false).semantics { heading() },
        )
        day.weekNumber?.let { FitaiBadge("Week $it") }
        Spacer(Modifier.weight(1f))
        // Today's row spells it out: it's where new athletes learn notes exist (TimelineDateHeader).
        TextButton(onClick = onAddNote, modifier = Modifier.semantics { contentDescription = "Log a note for $label" }) {
            Icon(LucideIcons.StickyNote, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
            if (day.isToday) Text(" Note", style = FitaiTheme.typography.label, color = colors.textMuted)
        }
    }
}

@Composable
private fun MoreButton(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.accent)
    }
}

/** What the first-run timeline offers (WelcomeEmptyState). */
private class WelcomeActions(
    val generatePlan: () -> Unit,
    val useTemplate: () -> Unit,
    val logWorkout: () -> Unit,
    val logNote: () -> Unit,
)

@Composable
private fun Welcome(actions: WelcomeActions, creatingTemplate: Boolean) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.Lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        EmptyState(
            title = "Welcome to fitai.coach",
            message = "Your plan and logged workouts will show here, day by day. Start with an AI plan built around your goal, " +
                "the 8-week template, or log a workout.",
        )
        FitaiButton("Generate an AI plan", onClick = actions.generatePlan, leadingIcon = LucideIcons.Sparkles)
        FitaiButton(
            "Use 8-week template",
            onClick = actions.useTemplate,
            variant = ButtonVariant.Secondary,
            loading = creatingTemplate,
            enabled = !creatingTemplate,
            leadingIcon = LucideIcons.ClipboardList,
        )
        FitaiButton("Log a workout", onClick = actions.logWorkout, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.Dumbbell)
        FitaiButton("Log a note", onClick = actions.logNote, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.StickyNote)
    }
}
