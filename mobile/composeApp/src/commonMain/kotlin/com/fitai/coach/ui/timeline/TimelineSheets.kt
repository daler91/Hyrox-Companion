package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest.SkipReason
import com.fitai.coach.core.api.generated.PlanDayRecoveryMoveOption
import com.fitai.coach.core.api.generated.PlanDayRecoveryPreview
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.data.RecoveryAction
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.RpeSelector
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

@Composable
private fun SheetBody(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.Lg, vertical = Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) { content() }
}

@Composable
private fun EntrySummary(entry: TimelineEntry, dayLabel: String) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Text(dayLabel, style = type.label, color = colors.textMuted)
    Text(entry.focus, style = type.h2, color = colors.text, modifier = Modifier.semantics { heading() })
    if (entry.mainWorkout.isNotBlank()) Text(entry.mainWorkout, style = type.body, color = colors.text)
    entry.accessory?.takeIf { it.isNotBlank() }?.let { Labelled("Accessory", it) }
    entry.notes?.takeIf { it.isNotBlank() }?.let { Labelled("Notes", it) }
    entry.aiRationale?.takeIf { it.isNotBlank() }?.let { Labelled("Why this workout", it) }
}

@Composable
private fun Labelled(label: String, text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        Text(text, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
    }
}

/** A session still to come: read only, with skip and ask-the-coach. */
@Composable
fun PreviewSheet(entry: TimelineEntry, dayLabel: String, onSkip: () -> Unit, onAskCoach: () -> Unit, onDismiss: () -> Unit) {
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        SheetBody {
            EntrySummary(entry, dayLabel)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Ask coach", onClick = onAskCoach, variant = ButtonVariant.Secondary)
                FitaiButton("Skip", onClick = onSkip, variant = ButtonVariant.Ghost)
            }
        }
    }
}

/** A session to log: effort and a note, then complete it. */
@Composable
fun LogSheet(
    entry: TimelineEntry,
    dayLabel: String,
    onComplete: (rpe: Int?, notes: String) -> Unit,
    onSkip: () -> Unit,
    onRecover: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    var rpe by rememberSaveable(entry.id) { mutableStateOf<Int?>(null) }
    var notes by rememberSaveable(entry.id) { mutableStateOf(entry.notes.orEmpty()) }
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        SheetBody {
            EntrySummary(entry, dayLabel)
            if (onRecover != null) {
                Text(recoveryPrompt(entry), style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
                FitaiButton("Fit it back in or let it go", onClick = onRecover, variant = ButtonVariant.Secondary)
            }
            Text("Effort & notes", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
            RpeSelector(rpe, { rpe = it })
            FitaiTextField(value = notes, onValueChange = { notes = it }, label = "Notes", singleLine = false)
            FitaiButton("Complete workout", onClick = { onComplete(rpe, notes) }, modifier = Modifier.fillMaxWidth())
            FitaiButton("Skip", onClick = onSkip, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
        }
    }
}

private fun recoveryPrompt(entry: TimelineEntry): String = when {
    entry.recovery == TimelineEntry.Recovery.Folded -> "Missed again after it was moved. What now?"
    entry.priority == TimelineEntry.Priority.Key -> "A key session — worth fitting back in."
    entry.priority == TimelineEntry.Priority.Optional -> "An optional session — fine to let this one go."
    else -> "Fit it back in, or let it go?"
}

/** A skipped session: put it back on the plan. */
@Composable
fun SkippedSheet(entry: TimelineEntry, dayLabel: String, onUndo: () -> Unit, onAskCoach: () -> Unit, onDismiss: () -> Unit) {
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        SheetBody {
            EntrySummary(entry, dayLabel)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Undo skip", onClick = onUndo)
                FitaiButton("Ask coach", onClick = onAskCoach, variant = ButtonVariant.Secondary)
            }
        }
    }
}

private val SKIP_REASONS = listOf(
    SkipReason.Ill to "Ill",
    SkipReason.Injured to "Injured",
    SkipReason.Schedule to "Schedule",
    SkipReason.LowEnergy to "Low energy",
)

/** "Skip this workout?" with an optional reason. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SkipSheet(entry: TimelineEntry, onConfirm: (SkipReason?) -> Unit, onDismiss: () -> Unit) {
    var reason by remember(entry.id) { mutableStateOf<SkipReason?>(null) }
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
