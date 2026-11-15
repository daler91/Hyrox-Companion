package com.fitai.coach.ui.timeline

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.CardTone
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.fuelling.FuellingTarget
import com.fitai.coach.ui.fuelling.FuellingTargetChip
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.theme.categoryChipColors
import com.fitai.coach.ui.workout.formatSpeed
import kotlin.math.roundToInt

/**
 * The status badge, checked in the web's order (timeline-workout-card/utils.tsx).
 * What kind of day it is comes from the server (dayKind): the race, or a rest
 * day, which when it goes by had nothing to miss.
 */
fun statusBadge(entry: TimelineEntry): Pair<String, BadgeTone> = when {
    entry.dayKind == TimelineEntry.DayKind.Race -> "Race day" to BadgeTone.Accent
    entry.excused == true -> "Not counted" to BadgeTone.Neutral
    entry.status == TimelineEntry.Status.Missed && entry.dayKind == TimelineEntry.DayKind.Rest -> "Rest day" to BadgeTone.Neutral
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
fun TimelineCard(
    entry: TimelineEntry,
    quickComplete: Boolean,
    onOpen: () -> Unit,
    actions: CardActions,
    chips: List<ExerciseChip> = emptyList(),
    strava: StravaControls? = null,
    /** A planned session's fuel plan; null on other cards. */
    fuelling: FuellingTarget? = null,
    /** Changes to it are still waiting to be sent. */
    pending: Boolean = false,
    /** The athlete's MAF ceiling, for a planned run's chip; null for an athlete who doesn't train to one. */
    mafCeiling: Int? = null,
    /** "km" or "miles", for a recording's speed. */
    distanceUnit: String? = null,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth(), onClick = onOpen, tone = cardTone(entry)) {
        // The status and what can be done about it share the top row (the web's card); everything under it has the full width.
        Row(verticalAlignment = Alignment.CenterVertically) {
            CardBadges(entry, pending, strava, Modifier.weight(1f))
            actions.onPickDate?.let { pickDate -> MoveMenu(entry.focus, actions.moves, actions.onMove, pickDate) }
            if (quickComplete) CompleteCircle(entry.focus, actions.onComplete)
        }
        // A card with no buttons in that row still keeps its badges off the title.
        Spacer(Modifier.height(Spacing.Xs))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            planLine(entry)?.let { PlanLine(it) }
            Text(entry.focus, style = type.h3, color = colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (chips.isNotEmpty()) {
                ExerciseChipRow(chips)
            } else if (entry.mainWorkout.isNotBlank()) {
                Text(entry.mainWorkout, style = type.body, color = colors.textMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            metricsLine(entry)?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
            coachNotesOf(entry)?.let { CardNotes(it) }
            deviceStats(entry, distanceUnit).takeIf { it.isNotEmpty() }?.let { DeviceStatsRow(it) }
            fuelling?.let { FuellingTargetChip(it) }
            mafCeilingFor(entry, mafCeiling)?.let { MafCeilingChip(it) }
            recoveryNote(entry)?.let { note ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(note, style = type.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
                    if (entry.recoveryUndoable == true || entry.recovery == TimelineEntry.Recovery.LetGo) {
                        TextButton(onClick = actions.onUndoRecovery) { Text("Undo", style = type.label, color = colors.accent) }
                    }
                }
            }
            strava?.options?.suggestion?.let { suggestion -> LinkSuggestion(suggestion, strava) }
        }
    }
}

/** The tint a card takes from its status (getCardBorderClass): done is green, a miss still to decide and a skip are amber. */
fun cardTone(entry: TimelineEntry): CardTone = when {
    entry.status == TimelineEntry.Status.Completed -> CardTone.Success
    entry.status == TimelineEntry.Status.Missed && entry.recoverable == true -> CardTone.Warning
    entry.status == TimelineEntry.Status.Skipped -> CardTone.Warning
    else -> CardTone.Plain
}

/** The status, the session's tier, and the Strava and pending-sync badges, wrapping when they don't fit a line. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CardBadges(entry: TimelineEntry, pending: Boolean, strava: StravaControls?, modifier: Modifier) {
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        val (label, tone) = statusBadge(entry)
        FitaiBadge(label, tone = tone)
        tierBadge(entry)?.let { FitaiBadge(it, tone = BadgeTone.Neutral) }
        if (pending) PendingSyncBadge()
        strava?.let { StravaBadge(entry, it) }
    }
}

/** "8-Week Plan · Saturday": the plan a session belongs to and its day there (the web card's plan and day badges). */
fun planLine(entry: TimelineEntry): String? =
    listOfNotNull(entry.planName?.takeIf { it.isNotBlank() }, entry.dayName?.takeIf { it.isNotBlank() })
        .joinToString(" · ")
        .takeIf { it.isNotEmpty() }

@Composable
private fun PlanLine(text: String) {
    val colors = FitaiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Icon(LucideIcons.BookOpen, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(12.dp))
        Text(text, style = FitaiTheme.typography.caption, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One figure from a recording, under the icon the web gives it. */
class DeviceStat(val icon: ImageVector, val text: String)

/**
 * What a linked recording measured (WorkoutStravaStats): calories, power,
 * cadence in the server's unit, speed and relative effort. Keyed off the
 * linked activity, not the source: a manual log a recording enriched has them too.
 */
fun deviceStats(entry: TimelineEntry, distanceUnit: String?): List<DeviceStat> {
    if (entry.stravaActivityId == null && entry.source != "strava") return emptyList()
    return buildList {
        entry.calories?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.Flame, "$it cal")) }
        entry.avgWatts?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.Zap, "${it}W")) }
        entry.avgCadence?.takeIf { it > 0 }?.let { cadence ->
            val unit = entry.avgCadenceUnit?.wireValue?.takeIf { it.isNotEmpty() }
            add(DeviceStat(LucideIcons.Activity, listOfNotNull("${cadence.roundToInt()}", unit).joinToString(" ")))
        }
        entry.avgSpeed?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.TrendingUp, formatSpeed(it, distanceUnit))) }
        entry.sufferScore?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.Gauge, "Effort $it")) }
    }
}

/** The recording's figures on one wrapping line, set off from the notes above by a rule. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeviceStatsRow(stats: List<DeviceStat>) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        HorizontalDivider(color = colors.border)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Md), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            stats.forEach { stat ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Icon(stat.icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(12.dp))
                    Text(stat.text, style = FitaiTheme.typography.caption, color = colors.textMuted)
                }
            }
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

/**
 * "45 min · RPE 7 · Adherence 85%" (getWorkoutMeta). A Strava import's
 * duration is already in its description, so it isn't repeated.
 */
private fun metricsLine(entry: TimelineEntry): String? {
    val parts = buildList {
        entry.duration?.takeIf { entry.source != "strava" }?.let { add("$it min") }
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

/**
 * A session's exercises as chips in their category's colour (ExerciseChips),
 * a trophy and a ring on each that set a record.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExerciseChipRow(chips: List<ExerciseChip>) {
    val colors = FitaiTheme.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        chips.forEach { chip ->
            val chipColors = categoryChipColors(chip.category, colors)
            val shape = Radius.Md
            Row(
                Modifier
                    .background(chipColors.container, shape)
                    .then(if (chip.personalRecord) Modifier.border(1.dp, colors.warning, shape) else Modifier)
                    .padding(horizontal = Spacing.Sm, vertical = Spacing.Xs)
                    .semantics(mergeDescendants = true) {
                        if (chip.personalRecord) contentDescription = "${chip.text}, personal record"
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.Xxs),
            ) {
                if (chip.personalRecord) {
                    Icon(
                        LucideIcons.Trophy,
                        contentDescription = null,
                        tint = colors.warning,
                        modifier = Modifier.size(12.dp),
                    )
                }
                Text(
                    chip.text,
                    style = FitaiTheme.typography.caption,
                    color = chipColors.content,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
