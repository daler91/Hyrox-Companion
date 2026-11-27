package com.fitai.coach.ui.timeline

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest.SkipReason
import com.fitai.coach.core.api.generated.PlanDayRecoveryMoveOption
import com.fitai.coach.core.api.generated.PlanDayRecoveryPreview
import com.fitai.coach.core.api.generated.TimelineCoachNotes
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.data.RecoveryAction
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDateField
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.RpeSelector
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday
import com.fitai.coach.ui.format.weekdayDate
import com.fitai.coach.ui.fuelling.FuellingPlanPanel
import com.fitai.coach.ui.fuelling.PlanFuelling
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.planday.PriorityTier
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.workout.StatTile

@Composable
private fun SheetBody(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.Lg, vertical = Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) { content() }
}

/** A session's sheet, on the page colour so its cards stand off it as they do on the web. */
@Composable
private fun SessionSheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    FitaiBottomSheet(onDismissRequest = onDismiss, containerColor = FitaiTheme.colors.background) { SheetBody(content) }
}

/** What a session's sheet shows of it, and the changes it can make in place. */
data class SheetSession(
    val entry: TimelineEntry,
    /** Its exercises, as the card's chips. */
    val chips: List<ExerciseChip>,
    val fuelling: PlanFuelling,
    val onRename: (String) -> Unit,
    val onSetPriority: (PriorityTier) -> Unit,
)

/**
 * The sheet's heading (the web's sheet title): the session's name with a
 * pencil to rename it, the close button, and under them its date. A [badge]
 * goes ahead of the name (a skipped session's).
 */
@Composable
private fun SheetHeader(session: SheetSession, onDismiss: () -> Unit, badge: CardBadge? = null) {
    val entry = session.entry
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    var renaming by rememberSaveable(entry.id) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        if (renaming) {
            RenameField(entry.focus, onSave = {
                renaming = false
                session.onRename(it)
            }, onCancel = { renaming = false })
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // The name and its pencil keep together; the close button has the far corner.
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    badge?.let {
                        FitaiBadge(it.label, tone = it.tone, icon = it.icon)
                        Spacer(Modifier.width(Spacing.Sm))
                    }
                    Text(
                        entry.focus,
                        style = type.h3,
                        color = colors.text,
                        modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                    )
                    IconButton(onClick = { renaming = true }) {
                        Icon(
                            LucideIcons.Pencil,
                            contentDescription = "Rename workout",
                            tint = colors.textMuted,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(LucideIcons.X, contentDescription = "Close", tint = colors.textMuted, modifier = Modifier.size(18.dp))
                }
            }
        }
        Text(weekdayDate(entry.date), style = type.bodySm, color = colors.textMuted)
    }
}

/** The title as a field, with save and cancel (EditableWorkoutTitle). A blank or unchanged title saves nothing. */
@Composable
private fun RenameField(title: String, onSave: (String) -> Unit, onCancel: () -> Unit) {
    var text by rememberSaveable(title) { mutableStateOf(title) }
    val colors = FitaiTheme.colors
    val trimmed = text.trim()
    Row(verticalAlignment = Alignment.CenterVertically) {
        FitaiTextField(text, { text = it }, "Workout title", Modifier.weight(1f), showLabel = false)
        IconButton(onClick = { if (trimmed == title) onCancel() else onSave(trimmed) }, enabled = trimmed.isNotEmpty()) {
            Icon(LucideIcons.Check, contentDescription = "Save title", tint = colors.accentText)
        }
        IconButton(onClick = onCancel) {
            Icon(LucideIcons.X, contentDescription = "Cancel renaming", tint = colors.textMuted)
        }
    }
}

/**
 * A titled card in a session's sheet (DetailSection): an icon and the title,
 * then the body. [accent] is the coach's voice: an accent-tinted card under
 * an accent title.
 */
@Composable
private fun SheetSection(title: String, icon: ImageVector, accent: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val colors = FitaiTheme.colors
    val tint = colors.accentText
    Column(
        Modifier
            .fillMaxWidth()
            .background(if (accent) tint.copy(alpha = COACH_NOTE_TINT) else colors.card, Radius.Lg)
            .border(1.dp, if (accent) tint.copy(alpha = ACCENT_BORDER) else colors.border, Radius.Lg)
            .padding(Spacing.Lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Icon(icon, contentDescription = null, tint = if (accent) tint else colors.textMuted, modifier = Modifier.size(16.dp))
            Text(
                title,
                style = FitaiTheme.typography.bodySm.copy(fontWeight = FontWeight.SemiBold),
                color = if (accent) tint else colors.text,
                modifier = Modifier.semantics { heading() },
            )
        }
        content()
    }
}

private const val ACCENT_BORDER = 0.3f

/** The session's targets as tiles, when it has any (WorkoutSummaryHeader's preview variant). */
@Composable
private fun TargetTiles(entry: TimelineEntry) {
    val stats = targetStats(entry)
    if (stats.isEmpty()) return
    FitaiCard(Modifier.fillMaxWidth(), contentPadding = Spacing.Lg) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Lg)) {
            stats.forEach { StatTile(it, Modifier.weight(1f)) }
        }
    }
}

/**
 * "Workout" (WorkoutPrescriptionSummary): what was prescribed, as the card's
 * chips with the coach's own text behind "Full prescription", or that text
 * alone for a session with no sets; then the accessory work and the notes.
 */
@Composable
private fun WorkoutSection(session: SheetSession) {
    val entry = session.entry
    val notes = coachNotesOf(entry)
    val accessory = entry.accessory?.takeIf { it.isNotBlank() }
    val prescribed = session.chips.isNotEmpty() || entry.mainWorkout.isNotBlank()
    if (!prescribed && accessory == null && notes == null) return
    SheetSection("Workout", LucideIcons.Dumbbell) {
        if (session.chips.isNotEmpty()) {
            Prescribed {
                ExerciseChipRow(session.chips)
                if (entry.mainWorkout.isNotBlank()) FullPrescription(entry.id, entry.mainWorkout)
            }
        } else if (entry.mainWorkout.isNotBlank()) {
            Prescribed { SectionText(entry.mainWorkout) }
        }
        accessory?.let { Labelled("Accessory") { SectionText(it) } }
        notes?.let { SessionNotes(it) }
    }
}

@Composable
private fun Prescribed(content: @Composable () -> Unit) = Labelled("Prescribed", content)

/** The coach's text for a session shown as chips, behind a disclosure so the chips lead. */
@Composable
private fun FullPrescription(entryId: String, text: String) {
    var open by rememberSaveable(entryId) { mutableStateOf(false) }
    val colors = FitaiTheme.colors
    Row(
        Modifier
            .clickable(role = Role.Button, onClick = { open = !open })
            .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
            .padding(vertical = Spacing.Xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        val chevron = if (open) LucideIcons.ChevronDown else LucideIcons.ChevronRight
        Icon(chevron, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(12.dp))
        Text("Full prescription", style = FitaiTheme.typography.caption, color = colors.textMuted)
    }
    if (open) SectionText(text)
}

@Composable
private fun SessionNotes(notes: TimelineCoachNotes) {
    notes.athleteText.takeIf { it.isNotBlank() }?.let { Labelled("Notes") { SectionText(it) } }
    if (notes.cues.isNotEmpty()) CoachCues(notes.cues)
}

@Composable
private fun SectionText(text: String) {
    Text(text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
}

/** A small capital label over its content, as the web labels the parts of a card. */
@Composable
private fun Labelled(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text(label.uppercase(), style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        content()
    }
}

/** "Why this workout" (CoachRationaleSection): the coach's reason for the session, open, in the coach's colours. */
@Composable
private fun WhyThisWorkout(entry: TimelineEntry) {
    val rationale = entry.aiRationale?.takeIf { it.isNotBlank() } ?: return
    SheetSection("Why this workout", LucideIcons.Sparkles, accent = true) {
        Text(rationale, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.text)
    }
}

/**
 * "How much does this session matter?" (SessionPriorityControl): key,
 * supporting or optional, with what the chosen one means. The tier decides
 * what's offered if the session is missed, and what the coach protects.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PriorityControl(session: SheetSession) {
    if (!PriorityTier.editable(session.entry)) return
    val current = PriorityTier.of(session.entry.priority)
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text("How much does this session matter?", style = type.bodySm.copy(fontWeight = FontWeight.Medium), color = FitaiTheme.colors.text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            PriorityTier.entries.forEach { tier ->
                FitaiChip(tier.label, selected = tier == current, onClick = { session.onSetPriority(tier) }, shape = CircleShape)
            }
        }
        current?.let { Text(it.help, style = type.caption, color = FitaiTheme.colors.textMuted) }
    }
}

/** What an upcoming session's sheet offers (PreviewActions). */
data class PreviewActions(val onAskCoach: () -> Unit, val onMove: () -> Unit, val onSkip: () -> Unit, val onEdit: () -> Unit)

/**
 * A session still to come (PreviewSheet): what it is and why, how much it
 * matters, how to fuel it, then asking the coach, moving, skipping or editing it.
 */
@Composable
fun PreviewSheet(session: SheetSession, actions: PreviewActions, onDismiss: () -> Unit) {
    SessionSheet(onDismiss) {
        SheetHeader(session, onDismiss)
        TargetTiles(session.entry)
        WorkoutSection(session)
        WhyThisWorkout(session.entry)
        PriorityControl(session)
        FuellingPlanPanel(session.entry, session.fuelling)
        SheetAction(ASK_COACH, LucideIcons.MessageSquare, actions.onAskCoach, ButtonVariant.Primary)
        SheetAction("Move to another day", LucideIcons.CalendarClock, actions.onMove, ButtonVariant.Secondary)
        SheetAction("Skip", LucideIcons.SkipForward, actions.onSkip, ButtonVariant.Secondary)
        SheetAction("Edit workout", LucideIcons.Pencil, actions.onEdit, ButtonVariant.Ghost)
    }
}

/** The action every session sheet has. */
private const val ASK_COACH = "Ask coach"

/** One of a sheet's stacked, full-width actions (ReadOnlyWorkoutActionGrid at phone width). */
@Composable
private fun SheetAction(label: String, icon: ImageVector, onClick: () -> Unit, variant: ButtonVariant) {
    FitaiButton(label, onClick = onClick, variant = variant, leadingIcon = icon, modifier = Modifier.fillMaxWidth())
}

/** What the sheet for a session to log can do. */
data class LogActions(
    val onComplete: (rpe: Int?, notes: String) -> Unit,
    val onAskCoach: () -> Unit,
    val onSkip: () -> Unit,
    /** Fit a missed session back in or let it go; null when that isn't on offer. */
    val onRecover: (() -> Unit)?,
    val onEdit: () -> Unit,
)

/**
 * A session to log (LogSheet): what's still to decide about a miss, why the
 * session and how to fuel it (read before training, so above logging it), the
 * workout, then effort and a note, and completing it.
 */
@Composable
fun LogSheet(session: SheetSession, actions: LogActions, onDismiss: () -> Unit) {
    val entry = session.entry
    var rpe by rememberSaveable(entry.id) { mutableStateOf<Int?>(null) }
    var notes by rememberSaveable(entry.id) { mutableStateOf(entry.notes.orEmpty()) }
    SessionSheet(onDismiss) {
        SheetHeader(session, onDismiss)
        actions.onRecover?.let { recover ->
            Text(recoveryPrompt(entry), style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
            FitaiButton("Fit it back in or let it go", onClick = recover, variant = ButtonVariant.Secondary)
        }
        TargetTiles(entry)
        PriorityControl(session)
        WhyThisWorkout(entry)
        FuellingPlanPanel(entry, session.fuelling)
        WorkoutSection(session)
        SheetSection("Effort & notes", LucideIcons.Gauge) {
            RpeSelector(rpe, { rpe = it })
            FitaiTextField(value = notes, onValueChange = { notes = it }, label = "Notes", singleLine = false)
        }
        FitaiButton(
            "Complete workout",
            onClick = { actions.onComplete(rpe, notes) },
            size = ButtonSize.Lg,
            modifier = Modifier.fillMaxWidth(),
        )
        SheetAction(ASK_COACH, LucideIcons.MessageSquare, actions.onAskCoach, ButtonVariant.Secondary)
        SheetAction("Edit workout", LucideIcons.Pencil, actions.onEdit, ButtonVariant.Ghost)
        SheetAction("Skip", LucideIcons.SkipForward, actions.onSkip, ButtonVariant.Ghost)
    }
}

private fun recoveryPrompt(entry: TimelineEntry): String = when {
    entry.recovery == TimelineEntry.Recovery.Folded -> "Missed again after it was moved. What now?"
    entry.priority == TimelineEntry.Priority.Key -> "A key session — worth fitting back in."
    entry.priority == TimelineEntry.Priority.Optional -> "An optional session — fine to let this one go."
    else -> "Fit it back in, or let it go?"
}

/** What a skipped session's sheet offers (SkippedActions). */
data class SkippedActions(val onUndo: () -> Unit, val onAskCoach: () -> Unit, val onDelete: () -> Unit)

/** A skipped session (SkippedSheet): put it back on the plan, ask the coach, or take it off the plan altogether. */
@Composable
fun SkippedSheet(session: SheetSession, actions: SkippedActions, onDismiss: () -> Unit) {
    val entry = session.entry
    var confirmDelete by remember(entry.id) { mutableStateOf(false) }
    SessionSheet(onDismiss) {
        SheetHeader(session, onDismiss, badge = statusBadge(entry))
        TargetTiles(entry)
        WorkoutSection(session)
        WhyThisWorkout(entry)
        SheetAction("Undo skip", LucideIcons.RotateCcw, actions.onUndo, ButtonVariant.Primary)
        SheetAction(ASK_COACH, LucideIcons.MessageSquare, actions.onAskCoach, ButtonVariant.Secondary)
        SheetAction("Delete from plan", LucideIcons.Trash, { confirmDelete = true }, ButtonVariant.Ghost)
    }
    if (confirmDelete) {
        FitaiDialog(
            title = "Remove this workout from your plan?",
            text = "\"${entry.focus}\" is deleted from the plan. You can undo straight after.",
            confirmLabel = "Delete",
            onConfirm = {
                confirmDelete = false
                actions.onDelete()
            },
            onDismiss = { confirmDelete = false },
            destructive = true,
        )
    }
}

/** "Pick a new date" for a session (MoveDateForm): the move waits for Move, so browsing the calendar moves nothing. */
@Composable
fun MoveDateSheet(entry: TimelineEntry, today: String, onMove: (String) -> Unit, onDismiss: () -> Unit) {
    val tomorrow = addDaysToIsoDate(today, 1)
    var date by remember(entry.id) { mutableStateOf(entry.date) }
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        SheetBody {
            Text(
                "Pick a new date",
                style = FitaiTheme.typography.h2,
                color = FitaiTheme.colors.text,
                modifier = Modifier.semantics {
                    heading()
                },
            )
            FitaiDateField(
                value = date,
                onValueChange = { date = it },
                label = "New date for ${entry.focus}",
                minDate = MIN_MOVE_DATE,
                maxDate = latestMoveDate(entry, tomorrow),
                supportingText = if (entry.workoutLogId != null) "A logged workout can move up to tomorrow." else null,
            )
            FitaiButton("Move", onClick = { onMove(date) }, enabled = canMoveTo(entry, date, tomorrow), modifier = Modifier.fillMaxWidth())
            FitaiButton("Cancel", onClick = onDismiss, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
        }
    }
}

private val SKIP_REASONS = listOf(
    SkipReason.Ill to "Ill",
    SkipReason.Injured to "Injured",
    SkipReason.Schedule to "Schedule",
    SkipReason.LowEnergy to "Low energy",
)

/**
 * "Skip this workout?" with an optional reason, and moving it instead: most
 * skips are a scheduling problem (SkipConfirmDialog).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SkipSheet(entry: TimelineEntry, today: String, onConfirm: (SkipReason?) -> Unit, onMove: (String) -> Unit, onDismiss: () -> Unit) {
    var reason by remember(entry.id) { mutableStateOf<SkipReason?>(null) }
    var pickedDate by remember(entry.id) { mutableStateOf("") }
    val tomorrow = addDaysToIsoDate(today, 1)
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        SheetBody {
            Text(
                "Skip this workout?",
                style = FitaiTheme.typography.h2,
                color = FitaiTheme.colors.text,
                modifier = Modifier.semantics {
                    heading()
                },
            )
            Text(
                "This will mark \"${entry.focus}\" as skipped. You can still go back and complete it later if needed.",
                style = FitaiTheme.typography.body,
                color = FitaiTheme.colors.textMuted,
            )
            Text("Why? (optional)", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                SKIP_REASONS.forEach { (value, label) ->
                    FitaiChip(label, selected = reason == value, onClick = { reason = if (reason == value) null else value })
                }
            }
            FitaiButton("Skip workout", onClick = { onConfirm(reason) }, variant = ButtonVariant.Danger, modifier = Modifier.fillMaxWidth())
            if (entry.planDayId != null) {
                HorizontalDivider(color = FitaiTheme.colors.border)
                Text("Instead of skipping", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    skipMoves(today).filter { canMoveTo(entry, it.date, tomorrow) }.forEach { move ->
                        FitaiButton(move.label, onClick = { onMove(move.date) }, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                    }
                }
                FitaiDateField(pickedDate, { pickedDate = it }, "Move to a specific date", minDate = MIN_MOVE_DATE)
                FitaiButton(
                    "Move",
                    onClick = { onMove(pickedDate) },
                    variant = ButtonVariant.Secondary,
                    enabled = canMoveTo(entry, pickedDate, tomorrow),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            FitaiButton("Cancel", onClick = onDismiss, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
        }
    }
}

private enum class RecoveryChoice { Fold, Shorten, LetGo }

/** "Missed: {focus}": fold it into another day, shorten it, or let it go. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RecoverySheet(state: RecoveryState, onAction: (RecoveryAction) -> Unit, onDismiss: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        SheetBody {
            val entry = when (state) {
                is RecoveryState.Loading -> state.entry
                is RecoveryState.Ready -> state.entry
                is RecoveryState.Failed -> state.entry
            }
            Text("Missed: ${entry.focus}", style = type.h2, color = colors.text, modifier = Modifier.semantics { heading() })
            when (state) {
                is RecoveryState.Loading -> LoadingState(message = "Working out what each option does to your plan…")
                is RecoveryState.Failed -> {
                    Text(state.message, style = type.body, color = colors.danger)
                    FitaiButton("Close", onClick = onDismiss, variant = ButtonVariant.Secondary)
                }
                is RecoveryState.Ready -> RecoveryOptions(state.preview, state.saving, onAction)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecoveryOptions(preview: PlanDayRecoveryPreview, saving: Boolean, onAction: (RecoveryAction) -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val recommended = when (preview.recommendation.action) {
        PlanDayRecoveryPreview.Recommendation.Action.Shorten -> RecoveryChoice.Shorten
        PlanDayRecoveryPreview.Recommendation.Action.LetGo -> RecoveryChoice.LetGo
        else -> RecoveryChoice.Fold
    }
    var choice by remember(preview.planDayId) { mutableStateOf(recommended) }
    var targetDate by remember(preview.planDayId) { mutableStateOf(preview.recommendation.targetDate) }

    Text(preview.recommendation.reason, style = type.body, color = colors.textMuted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        OptionChip("Fold into another day", RecoveryChoice.Fold, preview.fold.available, choice == RecoveryChoice.Fold, recommended) {
            choice = RecoveryChoice.Fold
            targetDate = preview.fold.suggestedDate
        }
        OptionChip("Shorten it", RecoveryChoice.Shorten, preview.shorten.available, choice == RecoveryChoice.Shorten, recommended) {
            choice = RecoveryChoice.Shorten
            targetDate = preview.shorten.suggestedDate
        }
        OptionChip("Let it go", RecoveryChoice.LetGo, true, choice == RecoveryChoice.LetGo, recommended) { choice = RecoveryChoice.LetGo }
    }
    val move: PlanDayRecoveryMoveOption? = when (choice) {
        RecoveryChoice.Fold -> preview.fold
        else -> null
    }
    val targets = move?.targets ?: if (choice == RecoveryChoice.Shorten) preview.shorten.targets else emptyList()
    val unavailable = move?.unavailableReason ?: if (choice == RecoveryChoice.Shorten) preview.shorten.unavailableReason else null
    unavailable?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
    if (targets.isNotEmpty()) {
        Text("Which day?", style = type.label, color = colors.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            targets.forEach { target ->
                FitaiChip(
                    "${shortWeekday(target.date)} ${shortDate(target.date)}",
                    selected = targetDate == target.date,
                    onClick = { targetDate = target.date },
                )
            }
        }
        targets.firstOrNull { it.date == targetDate }?.let { Text(it.impact.summary, style = type.bodySm, color = colors.textMuted) }
    } else if (choice == RecoveryChoice.LetGo) {
        Text(preview.letGo.impact.summary, style = type.bodySm, color = colors.textMuted)
        preview.letGo.impact.followOn?.takeIf { it.isNotEmpty() }?.let { FollowOnList(it) }
    }

    val action: RecoveryAction? = when (choice) {
        RecoveryChoice.Fold -> targetDate?.let { RecoveryAction.Fold(it) }
        RecoveryChoice.Shorten -> targetDate?.let { RecoveryAction.Shorten(it) }
        RecoveryChoice.LetGo -> RecoveryAction.LetGo
    }
    val label = when {
        action == null -> "Choose a day"
        choice == RecoveryChoice.Fold -> "Fold into ${shortWeekday(targetDate!!)}"
        choice == RecoveryChoice.Shorten -> "Shorten and move to ${shortWeekday(targetDate!!)}"
        else -> "Let it go"
    }
    FitaiButton(label, onClick = { action?.let(onAction) }, enabled = action != null, loading = saving, modifier = Modifier.fillMaxWidth())
}

/**
 * What staying missed changes in the sessions after it, a line each: "Thursday's
 * Back Squat will repeat 5x5 @ 100 kg instead of climbing to 102.5 kg." The
 * server writes them from the plan adaptation's own rule, so the sheet and the
 * plan cannot disagree.
 */
@Composable
private fun FollowOnList(lines: List<String>) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        lines.forEach { line ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Icon(
                    LucideIcons.CornerDownRight,
                    contentDescription = null,
                    tint = colors.textMuted,
                    modifier = Modifier.padding(top = Spacing.Xxs).size(FOLLOW_ON_ICON),
                )
                Text(line, style = FitaiTheme.typography.bodySm, color = colors.text)
            }
        }
    }
}

private val FOLLOW_ON_ICON = 14.dp

@Composable
private fun OptionChip(
    label: String,
    value: RecoveryChoice,
    available: Boolean,
    selected: Boolean,
    recommended: RecoveryChoice,
    onClick: () -> Unit,
) {
    FitaiChip(if (value == recommended) "$label · Recommended" else label, selected = selected, onClick = onClick, enabled = available)
}
