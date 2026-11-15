package com.fitai.coach.ui.coach

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.weekdayIndex
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * How far back the completion rate looks (statsUtils.ts): 4 weeks, which the
 * timeline's first page always holds, so loading older workouts doesn't move it.
 */
const val COMPLETION_RATE_WINDOW_DAYS = 28

private const val DAYS_IN_WEEK = 7
private const val PERCENT = 100.0

/** The rate's window in weeks, for its label. */
const val RATE_WINDOW_WEEKS = COMPLETION_RATE_WINDOW_DAYS / DAYS_IN_WEEK

/** The coach panel's counts over the timeline (statsUtils.ts TrainingStats). */
data class TrainingStats(
    val workoutsThisWeek: Int,
    val completedThisWeek: Int,
    val plannedUpcoming: Int,
    /** Of the sessions due in the last 4 weeks, the whole-percent done; null when none came due. */
    val completionRate: Int?,
)

/**
 * Port of `calculateStats`: this Monday-to-Sunday week's sessions and those
 * done, the planned ones from [today] on, and the completion rate. The rate
 * counts only days that have finished: not today, not days inside a declared
 * absence (excused), and not a missed session the athlete let go.
 */
fun calculateStats(entries: List<TimelineEntry>, today: String): TrainingStats {
    val weekStart = addDaysToIsoDate(today, -(weekdayIndex(today) ?: 0))
    val weekEnd = addDaysToIsoDate(weekStart, DAYS_IN_WEEK - 1)
    val rateStart = addDaysToIsoDate(today, -COMPLETION_RATE_WINDOW_DAYS)
    val thisWeek = entries.filter { it.date in weekStart..weekEnd }
    // Finished days only: before today, from the window's first day.
    val due = entries.filter { it.date >= rateStart && it.date < today && !isExcused(it) }
    return TrainingStats(
        workoutsThisWeek = thisWeek.size,
        completedThisWeek = thisWeek.count(::isDone),
        plannedUpcoming = entries.count { it.date >= today && it.status == TimelineEntry.Status.Planned },
        completionRate = due.takeIf { it.isNotEmpty() }?.let { jsRound(it.count(::isDone) * PERCENT / it.size).toInt() },
    )
}

private fun isDone(entry: TimelineEntry): Boolean = entry.status == TimelineEntry.Status.Completed

/** Not held against the rate: a day inside a declared absence, or a missed session the athlete let go. */
private fun isExcused(entry: TimelineEntry): Boolean = entry.excused == true || entry.recovery == TimelineEntry.Recovery.LetGo

/** One count in the bar, with what a screen reader says for it. */
private class StatBadgeSpec(val icon: ImageVector, val value: String, val label: String, val tint: Color, val description: String)

/**
 * Across the top of the coach panel (CoachPanelStats.tsx): this week's
 * sessions and those done, the planned ones ahead, the 4-week completion rate
 * (a dash before anything has come due: 0% would read as failing) and the
 * server's streak.
 */
@Composable
fun CoachStatsBar(stats: TrainingStats, streak: Int) {
    val colors = FitaiTheme.colors
    val rate = stats.completionRate
    val badges = listOf(
        StatBadgeSpec(
            LucideIcons.Activity,
            "${stats.workoutsThisWeek}",
            "Week",
            colors.primary,
            "${stats.workoutsThisWeek} workouts this week on your timeline",
        ),
        StatBadgeSpec(
            LucideIcons.Target,
            "${stats.completedThisWeek}",
            "Done",
            colors.success,
            "${stats.completedThisWeek} completed this week on your timeline",
        ),
        StatBadgeSpec(
            LucideIcons.Calendar,
            "${stats.plannedUpcoming}",
            "Next",
            colors.accentText,
            "${stats.plannedUpcoming} upcoming planned on your timeline",
        ),
        StatBadgeSpec(
            LucideIcons.TrendingUp,
            rate?.let { "$it%" } ?: "—",
            "${RATE_WINDOW_WEEKS}wk rate",
            colors.warning,
            rate?.let { "$it% completion rate over the last $RATE_WINDOW_WEEKS weeks on your timeline" }
                ?: "No completion rate: nothing came due in the last $RATE_WINDOW_WEEKS weeks on your timeline",
        ),
        StatBadgeSpec(LucideIcons.Flame, "$streak", "Streak", colors.danger, "$streak day streak"),
    )
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.Sm, vertical = Spacing.Xs)
            .semantics { contentDescription = "Training stats" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        badges.forEach { badge -> StatBadge(badge, Modifier.weight(1f)) }
    }
}

@Composable
private fun StatBadge(badge: StatBadgeSpec, modifier: Modifier) {
    Column(
        modifier.clearAndSetSemantics { contentDescription = badge.description },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Icon(badge.icon, contentDescription = null, tint = badge.tint, modifier = Modifier.size(14.dp))
            Text(badge.value, style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
        }
        Text(badge.label, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, maxLines = 1)
    }
}
