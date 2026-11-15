package com.fitai.coach.ui.timeline

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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

/** A card's badge: its words, its colour, and the icon the web puts ahead of them. */
data class CardBadge(val label: String, val tone: BadgeTone, val icon: ImageVector? = null)

/**
 * The status badge, checked in the web's order (timeline-workout-card/utils.tsx).
 * What kind of day it is comes from the server (dayKind): the race, or a rest
 * day, which when it goes by had nothing to miss.
 */
fun statusBadge(entry: TimelineEntry): CardBadge {
    val missed = entry.status == TimelineEntry.Status.Missed
    return when {
        entry.dayKind == TimelineEntry.DayKind.Race -> CardBadge("Race Day", BadgeTone.Warning, LucideIcons.Flag)
        entry.excused == true -> CardBadge("Not counted", BadgeTone.Neutral, LucideIcons.CalendarOff)
        missed && entry.dayKind == TimelineEntry.DayKind.Rest -> CardBadge("Rest day", BadgeTone.Neutral, LucideIcons.Moon)
        missed && entry.recovery == TimelineEntry.Recovery.LetGo -> CardBadge("Let go", BadgeTone.Neutral, LucideIcons.Feather)
        else -> statusOnlyBadge(entry)
    }
}

private fun statusOnlyBadge(entry: TimelineEntry): CardBadge = when (entry.status) {
    TimelineEntry.Status.Completed -> CardBadge("Completed", BadgeTone.Success, LucideIcons.CircleCheck)
    TimelineEntry.Status.Planned -> CardBadge("Planned", BadgeTone.Info, LucideIcons.Clock)
    TimelineEntry.Status.Skipped -> CardBadge("Skipped", BadgeTone.Warning, LucideIcons.SkipForward)
    // Never red: a recent miss is a decision still to make, an older one is history.
    TimelineEntry.Status.Missed ->
        CardBadge("Missed", if (entry.recoverable == true) BadgeTone.Warning else BadgeTone.Neutral, LucideIcons.XCircle)
    else -> CardBadge("—", BadgeTone.Neutral)
}

/**
 * The session's tier (SessionPriorityBadge). Key and optional are marked;
 * supporting, the everyday middle, is not. A done or skipped day is past deciding.
 */
fun tierBadge(entry: TimelineEntry): CardBadge? {
    val decided = entry.status == TimelineEntry.Status.Completed || entry.status == TimelineEntry.Status.Skipped
    if (entry.planDayId == null || decided) return null
    return when (entry.priority) {
        TimelineEntry.Priority.Key -> CardBadge("Key", BadgeTone.Accent, LucideIcons.Star)
        TimelineEntry.Priority.Optional -> CardBadge("Optional", BadgeTone.Outline)
        else -> null
    }
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

/**
 * A session on the timeline, laid out as the web's card: the "done" circle
 * (or a done session's tick) ahead of everything; the status, tier, plan and
 * weekday as badges; the title; then the prescription, notes, targets and the
 * coach's note. The move menu sits in the top corner, over the badge rows.
 */
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
    /** The athlete's date, for how long ago the coach's note changed; null leaves that out. */
    today: String? = null,
) {
    FitaiCard(Modifier.fillMaxWidth(), onClick = onOpen, tone = cardTone(entry), contentPadding = Spacing.Lg) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            LeadingAction(entry, quickComplete, actions.onComplete)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                CardHeader(entry, pending, strava, actions)
                CardBody(entry, chips, fuelling, mafCeiling, distanceUnit)
                strava?.options?.suggestion?.let { suggestion -> LinkSuggestion(suggestion, strava) }
                entry.aiRationale?.takeIf { it.isNotBlank() }?.let { CardCoachNote(entry, it, today) }
                RecoveryNote(entry, actions.onUndoRecovery)
            }
        }
    }
}

/** The "done" circle on a session that can be ticked off, a green tick on one that's done, else nothing. */
@Composable
private fun LeadingAction(entry: TimelineEntry, quickComplete: Boolean, onComplete: () -> Unit) {
    val colors = FitaiTheme.colors
    when {
        quickComplete -> IconButton(
            onClick = onComplete,
            modifier = Modifier.offset(x = -LEADING_INSET, y = -LEADING_INSET).semantics {
                contentDescription = "Mark ${entry.focus} as complete"
            },
        ) {
            Icon(LucideIcons.Circle, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(LEADING_ICON))
        }
        entry.status == TimelineEntry.Status.Completed -> Icon(
            LucideIcons.CircleCheck,
            contentDescription = null,
            tint = colors.success,
            modifier = Modifier.padding(top = Spacing.Xxs).size(LEADING_ICON),
        )
    }
}

private val LEADING_ICON = 20.dp

/** Pulls the 48 dp "done" button toward the card's corner, so its ring sits near where the web's does. */
private val LEADING_INSET = 6.dp

/** The badge rows and the title, with the move menu over their top corner (the web reserves that corner the same way). */
@Composable
private fun CardHeader(entry: TimelineEntry, pending: Boolean, strava: StravaControls?, actions: CardActions) {
    val colors = FitaiTheme.colors
    val pickDate = actions.onPickDate
    Box {
        Column(
            Modifier.fillMaxWidth().padding(end = if (pickDate != null) MOVE_RESERVE else 0.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            CardBadges(entry, pending, strava)
            Text(
                entry.focus,
                style = FitaiTheme.typography.body.copy(fontWeight = FontWeight.SemiBold),
                color = colors.text,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (pickDate != null) {
            MoveMenu(
                entry.focus,
                actions.moves,
                actions.onMove,
                pickDate,
                Modifier.align(Alignment.TopEnd).offset(x = MOVE_INSET, y = -MOVE_INSET),
            )
        }
    }
}

/** The width the badge rows leave clear for the move menu's button. */
private val MOVE_RESERVE = 40.dp

/** Pulls the 48 dp move button into the card's corner, so its icon lines up with the card's padding. */
private val MOVE_INSET = 12.dp

/** What the session is, under its title, in the web card's order. */
@Composable
private fun CardBody(entry: TimelineEntry, chips: List<ExerciseChip>, fuelling: FuellingTarget?, mafCeiling: Int?, distanceUnit: String?) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    if (chips.isNotEmpty()) {
        ExerciseChipRow(chips)
    } else if (entry.mainWorkout.isNotBlank()) {
        Text(entry.mainWorkout, style = type.bodySm, color = colors.textMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
    entry.accessory?.takeIf { it.isNotBlank() }?.let {
        Text(it, style = type.bodySm, color = colors.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    coachNotesOf(entry)?.let { CardNotes(it) }
    metricsLine(entry)?.let { Text(it, style = type.caption, color = colors.textMuted) }
    fuelling?.let { FuellingTargetChip(it) }
    mafCeilingFor(entry, mafCeiling)?.let { MafCeilingChip(it) }
    deviceStats(entry, distanceUnit).takeIf { it.isNotEmpty() }?.let { DeviceStatsRow(it) }
}

/** What became of a session after it was missed, with the way back while there is one. */
@Composable
private fun RecoveryNote(entry: TimelineEntry, onUndo: () -> Unit) {
    val note = recoveryNote(entry) ?: return
    val type = FitaiTheme.typography
    val colors = FitaiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(note, style = type.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
        if (entry.recoveryUndoable == true || entry.recovery == TimelineEntry.Recovery.LetGo) {
            TextButton(onClick = onUndo) { Text("Undo", style = type.label, color = colors.accent) }
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

/**
 * The card's badges (TimelineCardHeader): the status, the session's tier,
 * pending sync, Strava, the plan it belongs to and its day there. They wrap,
 * so a long plan name takes a line of its own and is cut short within it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CardBadges(entry: TimelineEntry, pending: Boolean, strava: StravaControls?) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        val status = statusBadge(entry)
        FitaiBadge(status.label, tone = status.tone, icon = status.icon)
        tierBadge(entry)?.let { tier ->
            FitaiBadge(tier.label, tone = tier.tone, icon = tier.icon, contentColor = tierTextColor(tier))
        }
        if (pending) PendingSyncBadge()
        strava?.let { StravaBadge(entry, it) }
        entry.planName?.takeIf { it.isNotBlank() }?.let { plan ->
            FitaiBadge(plan, tone = BadgeTone.Outline, icon = LucideIcons.BookOpen, contentColor = FitaiTheme.colors.textMuted)
        }
        entry.dayName?.takeIf { it.isNotBlank() }?.let { FitaiBadge(it, tone = BadgeTone.Secondary) }
    }
}

/** An outlined tier ("Optional") is in muted text, as the web's; a filled one keeps its tone's. */
@Composable
private fun tierTextColor(tier: CardBadge): Color = if (tier.tone == BadgeTone.Outline) FitaiTheme.colors.textMuted else Color.Unspecified

/** One figure from a recording, under the icon and in the icon colour the web gives it. */
data class DeviceStat(val icon: ImageVector, val text: String, val tint: Color)

// The web's icon colours (WorkoutStravaStats): Tailwind's orange, yellow, blue, green and purple 500.
private val CaloriesTint = Color(0xFFF97316)
private val PowerTint = Color(0xFFEAB308)
private val CadenceTint = Color(0xFF3B82F6)
private val SpeedTint = Color(0xFF22C55E)
private val EffortTint = Color(0xFFA855F7)

/**
 * What a linked recording measured (WorkoutStravaStats): calories, power,
 * cadence in the server's unit, speed and relative effort. Keyed off the
 * linked activity, not the source: a manual log a recording enriched has them too.
 */
fun deviceStats(entry: TimelineEntry, distanceUnit: String?): List<DeviceStat> {
    if (entry.stravaActivityId == null && entry.source != "strava") return emptyList()
    return buildList {
        entry.calories?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.Flame, "$it cal", CaloriesTint)) }
        entry.avgWatts?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.Zap, "${it}W", PowerTint)) }
        entry.avgCadence?.takeIf { it > 0 }?.let { cadence ->
            val unit = entry.avgCadenceUnit?.wireValue?.takeIf { it.isNotEmpty() }
            add(DeviceStat(LucideIcons.Activity, listOfNotNull("${cadence.roundToInt()}", unit).joinToString(" "), CadenceTint))
        }
        entry.avgSpeed?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.TrendingUp, formatSpeed(it, distanceUnit), SpeedTint)) }
        entry.sufferScore?.takeIf { it > 0 }?.let { add(DeviceStat(LucideIcons.TrendingUp, "Effort: $it", EffortTint)) }
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
                    Icon(stat.icon, contentDescription = null, tint = stat.tint, modifier = Modifier.size(12.dp))
                    Text(stat.text, style = FitaiTheme.typography.caption, color = colors.textMuted)
                }
            }
        }
    }
}

/** The card's "move to another day" menu (MoveEntryMenu): quick moves, then "Pick date…". */
@Composable
private fun MoveMenu(
    focus: String,
    moves: List<QuickMove>,
    onMove: (String) -> Unit,
    onPickDate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    val colors = FitaiTheme.colors
    Box(modifier) {
        IconButton(
            onClick = { open = true },
            modifier = Modifier.semantics {
                contentDescription =
                    "Move ${focus.ifBlank { "workout" }} to another day"
            },
        ) {
            Icon(LucideIcons.CalendarClock, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(MOVE_ICON))
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

private val MOVE_ICON = 18.dp

/**
 * "Duration: 45 min | RPE: 7 | Adherence: 85%" (getWorkoutMetricsText, with
 * the adherence the web shows as a badge). A Strava import's duration is
 * already in its description, so it isn't repeated.
 */
private fun metricsLine(entry: TimelineEntry): String? {
    val parts = buildList {
        entry.duration?.takeIf { entry.source != "strava" }?.let { add("Duration: $it min") }
        entry.rpe?.let { add("RPE: $it") }
        entry.compliancePct?.let { add("Adherence: $it%") }
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" | ")
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
