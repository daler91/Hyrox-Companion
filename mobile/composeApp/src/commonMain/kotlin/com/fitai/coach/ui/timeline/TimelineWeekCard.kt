package com.fitai.coach.ui.timeline

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/**
 * The "This week" card (TimelineSummaryCard): today's session, the weekly
 * goal and streak, where the plan is, the race countdown, and how fresh
 * each station is.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WeekCard(week: WeekSummary) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Text("This week", style = type.label, color = colors.textMuted, modifier = Modifier.semantics { heading() })
            WeekStat("Today", week.todayValue, week.todayDetail)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                WeekStat("Weekly goal", "${week.weeklyCompleted} of ${week.weeklyGoal}", "sessions done", Modifier.weight(1f))
                WeekStat("Streak", "${week.streak} ${if (week.streak == 1) "day" else "days"}", null, Modifier.weight(1f))
            }
            week.phase?.let { phase ->
                WeekStat("Plan", "Week ${phase.currentWeek} of ${phase.totalWeeks}", "${phaseName(phase.phaseLabel)} phase")
            }
            WeekStat("Race", week.raceValue, week.raceDetail)
            week.radar?.let { radar ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Text("Stations", style = type.label, color = colors.textMuted)
                    Text(radar.headline, style = type.bodySm, color = colors.text)
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
                        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
                    ) {
                        radar.chips.forEach { chip -> FitaiBadge("${chip.label} · ${chip.freshness}", tone = chip.tone) }
                    }
                }
            }
        }
    }
}

@Composable
private fun WeekStat(label: String, value: String, detail: String?, modifier: Modifier = Modifier) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = type.bodySm, color = colors.textMuted)
        Text(value, style = type.h3, color = colors.text)
        detail?.let { Text(it, style = type.bodySm, color = colors.textMuted, maxLines = 2) }
    }
}

/**
 * "Coach is reviewing your workout" (CoachReviewingIndicator): shown while
 * the auto-coach may still change upcoming sessions.
 */
@Composable
fun CoachReviewingBanner() {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(
        Modifier
            .fillMaxWidth()
            .border(1.dp, colors.accent, Radius.Lg)
            .padding(Spacing.Md)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(Spacing.Md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(LucideIcons.Sparkles, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f)) {
            Text("Coach is reviewing your workout", style = type.label, color = colors.text)
            Text("Your upcoming sessions may be adjusted. You'll see updates here shortly.", style = type.bodySm, color = colors.textMuted)
        }
    }
}
