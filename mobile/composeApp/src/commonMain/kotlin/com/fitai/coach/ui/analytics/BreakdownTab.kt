package com.fitai.coach.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem.Muscle
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/** The Breakdown tab (CategoryBreakdownTab): training mix, muscle heat map and movement pattern coverage. */
fun LazyListScope.breakdown(overview: TrainingOverview, onLogWorkout: () -> Unit) {
    if (!hasBreakdown(overview)) {
        item {
            EmptyState(
                title = "No training mix yet",
                message = "Your training mix and coverage insights appear here once you've logged a handful of workouts " +
                    "across different categories.",
                actionLabel = "Log a workout",
                onAction = onLogWorkout,
            )
        }
        return
    }
    val slices = categorySlices(overview.categoryTotals)
    if (slices.isNotEmpty()) item(key = "mix") { TrainingMix(slices) }
    if (overview.muscleGroupCoverage.isNotEmpty()) item(key = "muscles") { MuscleHeatMap(overview.muscleGroupCoverage) }
    if (overview.movementPatternCoverage.isNotEmpty()) item(key = "patterns") { MovementPatterns(overview.movementPatternCoverage) }
}

/** The web's category colours (categoryColors.ts). */
@Suppress("MagicNumber") // The palette itself.
private fun categoryColor(category: String): Color = when (category) {
    "functional" -> Color(0xFFF97316)
    "running" -> Color(0xFF3B82F6)
    "strength" -> Color(0xFFA855F7)
    "conditioning" -> Color(0xFFEF4444)
    else -> Color(0xFF64748B)
}

/** The five set-volume fills, light to dark (HEAT_TONES): none, sky, amber, orange, red. */
@Suppress("MagicNumber") // The palette itself.
@Composable
private fun heatColors(): List<Color> {
    val colors = FitaiTheme.colors
    val alpha = if (colors.isDark) DARK_HEAT_ALPHA else 1f
    return listOf(colors.muted, Color(0xFF7DD3FC), Color(0xFFFCD34D), Color(0xFFFB923C), Color(0xFFEF4444)).mapIndexed { i, c ->
        if (i == 0) c else c.copy(alpha = alpha)
    }
}

private const val DARK_HEAT_ALPHA = 0.7f
private const val SLICE_GAP_DEGREES = 2f
private const val FULL_TURN = 360f
private const val TOP_DEGREES = -90f

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrainingMix(slices: List<CategorySlice>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val total = slices.sumOf { it.sessions }.toFloat()
    val summary = slices.joinToString(", ") { "${it.label} ${it.sessions}" }
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            CardHeading("Training distribution", "Workout sessions by exercise category")
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(180.dp).semantics { contentDescription = "Training sessions by category: $summary" }) {
                    val ring = size.minDimension * RING_FRACTION
                    val inset = ring / 2
                    var start = TOP_DEGREES
                    slices.forEach { slice ->
                        val sweep = slice.sessions / total * FULL_TURN
                        drawArc(
                            categoryColor(slice.category),
                            startAngle = start,
                            sweepAngle = (sweep - if (slices.size > 1) SLICE_GAP_DEGREES else 0f).coerceAtLeast(1f),
                            useCenter = false,
                            topLeft = Offset(inset, inset),
                            size = Size(size.width - ring, size.height - ring),
                            style = Stroke(ring),
                        )
                        start += sweep
                    }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Md), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                slices.forEach { slice ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                        Box(Modifier.size(10.dp).background(categoryColor(slice.category), Radius.Sm))
                        Text(
                            "${slice.label} ${slice.percent}% · ${countOf(slice.sessions, "session", "sessions")}",
                            style = type.bodySm,
                            color = colors.text,
                        )
                    }
                }
            }
        }
    }
}

private const val RING_FRACTION = 0.22f

@Composable
private fun MuscleHeatMap(muscles: List<TrainingOverview.MuscleGroupCoverageItem>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val heat = heatColors()
    val maxSets = muscles.maxOf { it.totalSets }.coerceAtLeast(1)
    val byMuscle = muscles.associateBy { it.muscle }
    val level = { m: Muscle -> heatLevel(byMuscle[m]?.totalSets ?: 0, maxSets) }
    val spoken = muscles.filter { it.totalSets > 0 }.sortedByDescending { it.totalSets }
        .joinToString(", ") { "${it.label} ${HEAT_LEVEL_LABELS[heatLevel(it.totalSets, maxSets)].lowercase()}" }
        .ifEmpty { "no set volume yet" }
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            CardHeading("Muscle heat map", "Set-volume coverage by trained muscle group")
            AnalysisPanel(muscleAnalysis(muscles), "muscle assignment", "muscle assignments")
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                listOf(false to "Front", true to "Back").forEach { (back, title) ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(title.uppercase(), style = type.label, color = colors.textMuted)
                        MuscleFigure(
                            back = back,
                            heat = { heat[level(it)] },
                            outline = colors.border,
                            guide = colors.muted.copy(alpha = GUIDE_ALPHA),
                            description = "$title muscle heat map: $spoken",
                            modifier = Modifier.fillMaxWidth().padding(top = Spacing.Xs),
                        )
                    }
                }
            }
            HeatLegend(heat)
            BODY_REGIONS.forEach { region ->
                val inRegion = muscles.filter { it.bodyRegion == region }
                if (inRegion.isNotEmpty()) {
                    Text(
                        regionLabel(region).uppercase(),
                        style = type.label,
                        color = colors.textMuted,
                        modifier = Modifier.semantics {
                            heading()
                        },
                    )
                    inRegion.forEach { muscle -> MuscleRow(muscle, heatLevel(muscle.totalSets, maxSets), heat) }
                }
            }
        }
    }
}

private const val GUIDE_ALPHA = 0.4f

@Composable
private fun MuscleRow(muscle: TrainingOverview.MuscleGroupCoverageItem, level: Int, heat: List<Color>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Box(Modifier.size(12.dp).background(heat[level], Radius.Sm).border(1.dp, colors.border, Radius.Sm))
        Column(Modifier.weight(1f)) {
            Text(muscle.label, style = type.body, color = colors.text)
            Text(
                "${HEAT_LEVEL_LABELS[level]} · ${countOf(
                    muscle.totalSets,
                    "set",
                    "sets",
                )} · ${countOf(muscle.sessionCount, "session", "sessions")}",
                style = type.bodySm,
                color = colors.textMuted,
            )
        }
        FitaiBadge(freshnessLabel(muscle.daysSince), tone = freshnessTone(muscle.daysSince).badge())
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeatLegend(heat: List<Color>) {
    val type = FitaiTheme.typography
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text("Less", style = type.bodySm, color = FitaiTheme.colors.textMuted)
        HEAT_LEVEL_LABELS.forEachIndexed { i, label ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
                Box(Modifier.size(10.dp).background(heat[i], Radius.Sm).border(1.dp, FitaiTheme.colors.border, Radius.Sm))
                Text(label, style = type.bodySm, color = FitaiTheme.colors.textMuted)
            }
        }
        Text("More", style = type.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

@Composable
private fun MovementPatterns(patterns: List<TrainingOverview.MovementPatternCoverageItem>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val maxSessions = patterns.maxOf { it.sessionCount }.coerceAtLeast(1)
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            CardHeading("Movement pattern coverage", "Session coverage, set volume, and recency by strength movement pattern")
            AnalysisPanel(movementPatternAnalysis(patterns), "pattern assignment", "pattern assignments")
            patterns.forEachIndexed { index, pattern ->
                if (index > 0) HorizontalDivider(color = colors.border)
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(pattern.label, style = type.body, color = colors.text, modifier = Modifier.weight(1f))
                        FitaiBadge(freshnessLabel(pattern.daysSince), tone = freshnessTone(pattern.daysSince).badge())
                    }
                    Text(
                        "${countOf(pattern.sessionCount, "session", "sessions")} · ${countOf(pattern.totalSets, "set", "sets")}",
                        style = type.bodySm,
                        color = colors.textMuted,
                    )
                    // A trained pattern's bar never shrinks below 8%, so it stays visible beside a heavy one.
                    val share = if (pattern.sessionCount > 0) (pattern.sessionCount.toFloat() / maxSessions).coerceAtLeast(MIN_BAR) else 0f
                    Box(Modifier.fillMaxWidth().height(6.dp).background(colors.muted, Radius.Sm)) {
                        if (share > 0) Box(Modifier.fillMaxWidth(share).height(6.dp).background(colors.accent, Radius.Sm))
                    }
                }
            }
        }
    }
}

private const val MIN_BAR = 0.08f

/** The readings, balances and next focus above a coverage card (CoverageAnalysisPanel). */
@Composable
private fun AnalysisPanel(analysis: CoverageAnalysis, unit: String, units: String) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        analysis.metrics.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                pair.forEach { metric -> Reading(metric.label, metric.value, metric.detail, metric.tone, Modifier.weight(1f)) }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }
        analysis.balances.forEach { balance ->
            Reading(balance.label, balance.value, balance.detail, balance.tone, Modifier.fillMaxWidth())
        }
        Column(Modifier.fillMaxWidth().background(colors.muted, Radius.Md).padding(Spacing.Md)) {
            Text("${countOf(analysis.totalSets, unit, units)} analyzed.", style = type.label, color = colors.text)
            Text(analysis.nextFocus, style = type.bodySm, color = colors.textMuted)
        }
    }
}

@Composable
private fun Reading(label: String, value: String, detail: String, tone: CoverageTone, modifier: Modifier) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val edge = when (tone) {
        CoverageTone.Good -> colors.success
        CoverageTone.Watch -> colors.warning
        CoverageTone.Gap -> colors.danger
    }
    Column(modifier.border(1.dp, edge, Radius.Md).padding(Spacing.Sm), verticalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
        Text(label.uppercase(), style = type.label, color = edge)
        Text(value, style = type.body, color = colors.text)
        Text(detail, style = type.bodySm, color = colors.textMuted)
    }
}

@Composable
private fun CardHeading(title: String, subtitle: String) {
    Column {
        Text(title, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
        Text(subtitle, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

private fun CoverageTone.badge(): BadgeTone = when (this) {
    CoverageTone.Good -> BadgeTone.Success
    CoverageTone.Watch -> BadgeTone.Warning
    CoverageTone.Gap -> BadgeTone.Danger
}
