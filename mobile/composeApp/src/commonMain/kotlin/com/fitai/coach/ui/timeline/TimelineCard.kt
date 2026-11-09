package com.fitai.coach.ui.timeline

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val RACE_FOCUS = "race"

/** The status badge, checked in the web's order (timeline-workout-card/utils.tsx). */
fun statusBadge(entry: TimelineEntry): Pair<String, BadgeTone> = when {
    entry.focus.trim().lowercase() == RACE_FOCUS -> "Race day" to BadgeTone.Accent
    entry.excused == true -> "Not counted" to BadgeTone.Neutral
    entry.status == TimelineEntry.Status.Missed && entry.recovery == TimelineEntry.Recovery.LetGo -> "Let go" to BadgeTone.Neutral
    entry.status == TimelineEntry.Status.Completed -> "Completed" to BadgeTone.Success
    entry.status == TimelineEntry.Status.Planned -> "Planned" to BadgeTone.Accent
    entry.status == TimelineEntry.Status.Skipped -> "Skipped" to BadgeTone.Warning
    entry.status == TimelineEntry.Status.Missed -> "Missed" to if (entry.recoverable == true) BadgeTone.Warning else BadgeTone.Neutral
    else -> "—" to BadgeTone.Neutral
}

/** What a card can do besides opening: complete, undo a recovery, and move. */
class CardActions(
    val onComplete: () -> Unit,
    val onUndoRecovery: () -> Unit,
    /** Where the card's menu can move it; empty with no menu. */
    val moves: List<QuickMove>,
    val onMove: (date: String) -> Unit,
    /** "Pick date…"; null when the session can't move. */
    val onPickDate: (() -> Unit)?,
)

@Composable
fun TimelineCard(entry: TimelineEntry, quickComplete: Boolean, onOpen: () -> Unit, actions: CardActions) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(onClick = onOpen) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
                    val (label, tone) = statusBadge(entry)
                    FitaiBadge(label, tone = tone)
                    tierBadge(entry)?.let { FitaiBadge(it, tone = BadgeTone.Neutral) }
                }
                Text(entry.focus, style = type.h3, color = colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (entry.mainWorkout.isNotBlank()) {
                    Text(entry.mainWorkout, style = type.body, color = colors.textMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
                metricsLine(entry)?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
                recoveryNote(entry)?.let { note ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(note, style = type.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
                        if (entry.recoveryUndoable == true || entry.recovery == TimelineEntry.Recovery.LetGo) {
                            TextButton(onClick = actions.onUndoRecovery) { Text("Undo", style = type.label, color = colors.accent) }
                        }
                    }
                }
            }
            actions.onPickDate?.let { pickDate -> MoveMenu(entry.focus, actions.moves, actions.onMove, pickDate) }
            if (quickComplete) CompleteCircle(entry.focus, actions.onComplete)
        }
    }
}

/** The card's "move to another day" menu (MoveEntryMenu): quick moves, then "Pick date…". */
@Composable
private fun MoveMenu(focus: String, moves: List<QuickMove>, onMove: (String) -> Unit, onPickDate: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val colors = FitaiTheme.colors
    Box {
        IconButton(
            onClick = { open = true },
            modifier = Modifier.semantics {
                contentDescription =
                    "Move ${focus.ifBlank { "workout" }} to another day"
            },
        ) {
            Icon(LucideIcons.CalendarRange, contentDescription = null, tint = colors.textMuted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = colors.card) {
            moves.forEach { move ->
                DropdownMenuItem(
                    text = { Text(move.label, style = FitaiTheme.typography.body, color = colors.text) },
                    onClick = {
                        open = false
                        onMove(move.date)
                    },
                )
            }
            if (moves.isNotEmpty()) HorizontalDivider(color = colors.border)
            DropdownMenuItem(
                text = { Text("Pick date…", style = FitaiTheme.typography.body, color = colors.text) },
                onClick = {
                    open = false
                    onPickDate()
                },
            )
        }
    }
}

@Composable
private fun CompleteCircle(focus: String, onComplete: () -> Unit) {
    IconButton(onClick = onComplete, modifier = Modifier.semantics { contentDescription = "Mark $focus as complete" }) {
        Box(Modifier.size(28.dp).border(2.dp, FitaiTheme.colors.borderStrong, CircleShape))
    }
}

private fun tierBadge(entry: TimelineEntry): String? {
    if (entry.planDayId == null || entry.status == TimelineEntry.Status.Completed ||
        entry.status == TimelineEntry.Status.Skipped
    ) {
        return null
    }
    return when (entry.priority) {
        TimelineEntry.Priority.Key -> "Key"
        TimelineEntry.Priority.Optional -> "Optional"
        else -> null
    }
}

private fun metricsLine(entry: TimelineEntry): String? {
    val parts = buildList {
        entry.duration?.let { add("$it min") }
        entry.rpe?.let { add("RPE $it") }
        entry.compliancePct?.let { add("Adherence $it%") }
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

private fun recoveryNote(entry: TimelineEntry): String? = when (entry.recovery) {
    TimelineEntry.Recovery.LetGo -> "You let this one go."
    TimelineEntry.Recovery.Folded -> entry.missedOn?.let { "Moved here from ${shortDate(it)} after you missed it." }
        ?: "Moved here after you missed it."
    TimelineEntry.Recovery.Shortened -> "Shortened after you missed it."
    else -> null
}
