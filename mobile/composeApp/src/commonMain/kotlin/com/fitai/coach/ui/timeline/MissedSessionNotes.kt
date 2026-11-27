package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.CoachNoteInputs
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.core.dates.isIsoCalendarDate
import com.fitai.coach.core.exercises.knownExerciseLabel
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

// What the plan did about a session that never happened, on the two cards
// where the athlete looks for it: the upcoming session whose loads were held,
// and the missed session itself. The server decides all of it (the plan
// adaptation's holds, docs/ai-and-rag.md); these only read what it left on the
// timeline's entries.

/** "Front Squat: 85 → 90 kg"; for a pace change, "Run paces: fitness 45 → 46.5 (VDOT)" (describeProgressionChange). */
fun changeText(exercise: String, pace: Boolean, from: Double, to: Double, unit: String): String = if (pace) {
    "Run paces: fitness ${formatNumber(from)} → ${formatNumber(to)} (VDOT)"
} else {
    val label = knownExerciseLabel(exercise) ?: exercise.replace('_', ' ')
    "$label: ${formatNumber(from)} → ${formatNumber(to)} $unit"
}

private fun holdChangeText(change: CoachNoteInputs.MissedSessionHold.ChangesItem): String = changeText(
    change.exercise,
    change.kind == CoachNoteInputs.MissedSessionHold.ChangesItem.Kind.Pace,
    change.from,
    change.to,
    change.unit,
)

/** "Tue Nov 24", as the recovery sheet's day chips write a day; empty for a date that isn't one. */
private fun weekdayAndDate(date: String): String = if (isIsoCalendarDate(date)) "${shortWeekday(date)} ${shortDate(date)}" else ""

// --- The held session's line ---

/** A held session's line: why it reads lighter than the plan first had it, and what moved. */
data class HoldLine(val reason: String, val changes: String)

/**
 * "Adjusted after the session you missed on Tue Nov 24" (describeHoldReason).
 * A day inside an absence the athlete declared is never called a miss.
 */
fun holdReason(hold: CoachNoteInputs.MissedSessionHold): String {
    val on = weekdayAndDate(hold.date).takeIf { it.isNotEmpty() }?.let { " on $it" }.orEmpty()
    return when (hold.kind) {
        CoachNoteInputs.MissedSessionHold.Kind.Skipped -> "Adjusted after the session you skipped$on"
        CoachNoteInputs.MissedSessionHold.Kind.Excused -> "Adjusted for the session not done$on"
        else -> "Adjusted after the session you missed$on"
    }
}

/**
 * The line a session carries while its loads are held for a session before it
 * that never happened (MissedSessionHoldNote.tsx), or null. Only on a session
 * still to come: once it is logged, what was planned for it is history. A long
 * list names the first few lifts; the coach's note has the rest.
 */
fun holdLine(entry: TimelineEntry): HoldLine? = entry.aiInputsUsed?.missedSessionHold
    ?.takeIf { entry.status == TimelineEntry.Status.Planned && it.changes.isNotEmpty() }
    ?.let { hold ->
        val shown = hold.changes.take(MAX_CHANGES_SHOWN).map(::holdChangeText)
        val more = hold.changes.size - shown.size
        HoldLine(holdReason(hold), (shown + listOfNotNull("and $more more".takeIf { more > 0 })).joinToString(" · "))
    }

private const val MAX_CHANGES_SHOWN = 3

/**
 * The held session's line, always visible: the coach's note that explains it
 * is closed by default, and a load that changed without a word is the plan
 * seeming not to have noticed the miss.
 */
@Composable
fun MissedSessionHoldNote(line: HoldLine) {
    val colors = FitaiTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Icon(
            LucideIcons.RotateCcw,
            contentDescription = null,
            tint = colors.textMuted,
            modifier = Modifier.padding(top = Spacing.Xxs).size(NOTE_ICON),
        )
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = colors.text)) { append(line.reason) }
                append(" · ${line.changes}")
            },
            style = FitaiTheme.typography.caption,
            color = colors.textMuted,
        )
    }
}

private val NOTE_ICON = 12.dp

// --- The missed session's own card ---

/** An upcoming session whose loads are held for the missed one, with each change as its sentence. */
data class HeldSession(val id: String, val date: String, val focus: String, val changes: List<String>)

/** The other upcoming sessions the coach has gone over since a miss: how many it changed and how many it kept. */
data class CoachReview(val adjusted: Int, val kept: Int)

/**
 * What the plan did after a session that never happened (missedAftermath.ts):
 * the sessions ahead that repeat a step it never did, soonest first, and what
 * else the coach has gone over since. [reviewed] is only on the latest miss:
 * two misses in a week would otherwise each claim the same reviews.
 */
data class MissedAftermath(val held: List<HeldSession>, val reviewed: CoachReview?)

/**
 * The aftermath of each recent missed or skipped session that has one, by the
 * entry's id, worked out from every entry the timeline holds. A miss with
 * nothing to report is left out.
 */
fun missedAftermath(entries: List<TimelineEntry>, today: String): Map<String, MissedAftermath> {
    val upcoming = entries.filter { isUpcoming(it, today) }.sortedBy { it.date }
    val misses = entries.filter { isFollowedMiss(it, today) }.sortedWith(compareByDescending<TimelineEntry> { it.date }.thenBy { it.id })
    val latestId = misses.firstOrNull()?.id
    return misses.mapNotNull { miss ->
        val held = heldFor(miss, upcoming)
        val reviewed = if (miss.id == latestId) reviewedSince(miss, upcoming, today) else null
        if (held.isEmpty() && reviewed == null) null else miss.id to MissedAftermath(held, reviewed)
    }.toMap()
}

/** A key or supporting session of the last week that was missed or skipped: one the plan adaptation follows. */
private fun isFollowedMiss(entry: TimelineEntry, today: String): Boolean {
    val leanedOn = entry.priority == TimelineEntry.Priority.Key || entry.priority == TimelineEntry.Priority.Supporting
    val notHappening = entry.status == TimelineEntry.Status.Missed || entry.status == TimelineEntry.Status.Skipped
    val recent = dayDiff(entry.date, today)?.let { it in 0..AFTERMATH_DAYS } == true
    val onThePlan = entry.planDayId != null && entry.excused != true
    return onThePlan && leanedOn && notHappening && recent
}

private fun isUpcoming(entry: TimelineEntry, today: String): Boolean =
    entry.status == TimelineEntry.Status.Planned && entry.planDayId != null && entry.date >= today

private fun heldFor(miss: TimelineEntry, upcoming: List<TimelineEntry>): List<HeldSession> = upcoming.mapNotNull { entry ->
    entry.aiInputsUsed?.missedSessionHold
        ?.takeIf { it.date == miss.date && it.changes.isNotEmpty() }
        ?.let { hold -> HeldSession(entry.id, entry.date, entry.focus, hold.changes.map(::holdChangeText)) }
}

/** The day the coach last wrote on a session, as its timestamp's date; null with none. */
private fun noteDay(entry: TimelineEntry): String? = entry.aiNoteUpdatedAt?.take(NOTE_DAY_LENGTH)?.takeIf { it.length == NOTE_DAY_LENGTH }

private fun reviewedSince(miss: TimelineEntry, upcoming: List<TimelineEntry>, today: String): CoachReview? {
    val reviewed = upcoming.filter { entry ->
        // The coach looks a week ahead, so that is where its reviews are.
        val inReach = dayDiff(today, entry.date)?.let { it <= REVIEW_AHEAD_DAYS } == true
        // A session held for a miss, this one or another, is listed under that miss.
        val listedAsHeld = entry.aiInputsUsed?.missedSessionHold != null
        // Written after the day of the miss: the coach has seen the plan without it.
        val writtenSince = noteDay(entry)?.let { it > miss.date } == true
        inReach && !listedAsHeld && writtenSince
    }
    val kept = reviewed.count { it.aiSource == REVIEW_SOURCE }
    val adjusted = reviewed.count { it.aiSource.orEmpty() in CHANGED_SOURCES }
    return CoachReview(adjusted, kept).takeIf { adjusted + kept > 0 }
}

/** How far back a miss still gets a say on its card: within the week, so its weekday names it. */
private const val AFTERMATH_DAYS = 6
private const val REVIEW_AHEAD_DAYS = 7
private const val NOTE_DAY_LENGTH = 10
private const val REVIEW_SOURCE = "review"

/** Sources that mean the coach changed the session, not just read it and left it alone. */
private val CHANGED_SOURCES = setOf("rag", "legacy", "load_governor", "progression")

/** One held session on the missed card: the day (and the session) in emphasis, then what moved. */
data class AftermathLine(val label: String, val detail: String)

/** The aftermath as the missed card prints it (MissedAftermathNote.tsx). */
data class AftermathText(val lines: List<AftermathLine>, val more: String?, val reviewed: String?)

/**
 * A missed card's words: a line for each of the first few held sessions (each
 * says so on its own card too), how many more there are, and what else the
 * coach went over.
 */
fun aftermathText(aftermath: MissedAftermath): AftermathText {
    val shown = aftermath.held.take(MAX_HELD_SHOWN)
    val more = aftermath.held.size - shown.size
    return AftermathText(
        lines = shown.map(::heldLine),
        more = "and ${counted(more, "more session", "more sessions")}".takeIf { more > 0 },
        reviewed = reviewedSentence(aftermath),
    )
}

private const val MAX_HELD_SHOWN = 3

private fun counted(count: Int, one: String, many: String): String = "$count ${if (count == 1) one else many}"

private fun heldLine(session: HeldSession): AftermathLine {
    val day = weekdayAndDate(session.date)
    val changes = session.changes.joinToString(", ")
    // "Long Run — Long Run: 10 → 9 km": a session named for its one exercise says it once.
    val namedForIt = changes.startsWith("${session.focus.trim()}:", ignoreCase = true)
    return if (namedForIt) AftermathLine(day, " · $changes") else AftermathLine("$day · ${session.focus}", " — $changes")
}

/** "Your coach also went over 2 more upcoming sessions: 1 adjusted, 1 kept as planned." A part that is zero is left out. */
private fun reviewedSentence(aftermath: MissedAftermath): String? = aftermath.reviewed?.let { reviewed ->
    val sessions = reviewed.adjusted + reviewed.kept
    val counts = listOfNotNull(
        "${reviewed.adjusted} adjusted".takeIf { reviewed.adjusted > 0 },
        "${reviewed.kept} kept as planned".takeIf { reviewed.kept > 0 },
    ).joinToString(", ")
    if (aftermath.held.isNotEmpty()) {
        "Your coach also went over ${counted(sessions, "more upcoming session", "more upcoming sessions")}: $counts."
    } else {
        "Since then your coach has gone over ${counted(sessions, "upcoming session", "upcoming sessions")}: $counts."
    }
}

/**
 * On a missed or skipped session's card: what the plan did about it. The
 * sessions it changed say so themselves, further down the timeline; this is
 * the answer in the place the athlete is looking when they wonder whether the
 * plan noticed.
 */
@Composable
fun MissedAftermathNote(aftermath: MissedAftermath) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val text = aftermathText(aftermath)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
        if (text.lines.isNotEmpty()) {
            Text("What your plan changed after this", style = type.caption.copy(fontWeight = FontWeight.Medium), color = colors.text)
        }
        text.lines.forEach { line ->
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = colors.text)) { append(line.label) }
                    append(line.detail)
                },
                style = type.caption,
                color = colors.textMuted,
            )
        }
        text.more?.let { Text(it, style = type.caption, color = colors.textMuted) }
        text.reviewed?.let { Text(it, style = type.caption, color = colors.textMuted) }
    }
}
