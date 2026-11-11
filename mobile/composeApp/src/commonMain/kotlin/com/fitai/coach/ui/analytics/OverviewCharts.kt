package com.fitai.coach.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.markdown.MarkdownText
import com.fitai.coach.ui.theme.DataColors
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.timeline.ANNOTATION_TYPES
import com.fitai.coach.ui.timeline.annotationLabel
import kotlin.math.roundToInt

private const val SHADE_ALPHA = 0.18f
private const val FUTURE_ALPHA = 0.4f
private const val HALF_TURN = 180f
private const val FORM_TITLE = "Form (TSB)"
private const val STRAIN_TITLE = "Strain (Foster)"
private const val MONOTONY_TITLE = "Monotony"

/** The AI header above the charts (OverviewAnalysisHeader): generate, when, and why not. */
@Composable
fun OverviewAnalysisHeader(state: OverviewAnalysisState, onGenerate: () -> Unit, timeZone: String?, openSettings: () -> Unit) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            PanelTitle("AI Chart Analysis", LucideIcons.Sparkles)
            Text(
                if (state.hasAnalysis) {
                    "A plain-language read of your numbers shows under each chart below."
                } else {
                    "Get a plain-language read of what each chart below is telling you."
                },
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
            )
            FitaiButton(
                when {
                    state.generating -> "Analyzing…"
                    state.hasAnalysis -> "Regenerate"
                    else -> "Generate analysis"
                },
                onClick = onGenerate,
                variant = if (state.hasAnalysis) ButtonVariant.Secondary else ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = !state.generating && !state.aiCoachOff,
            )
            LastUpdated(state.analysis?.generatedAt, state.analysis?.stale, timeZone)
            if (state.aiCoachOff) {
                Notice("The AI Coach is turned off. Enable it in Settings to get a plain-language read of your charts.") {
                    FitaiButton("Enable AI Coach", onClick = openSettings, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                }
            }
            state.error?.let { Text(it, style = FitaiTheme.typography.body, color = colors.danger) }
        }
    }
}

/** "What this means for you": the AI's reading of one chart, open at first and collapsible. */
@Composable
fun ChartExplanation(explanation: String?) {
    if (explanation.isNullOrBlank()) return
    val colors = FitaiTheme.colors
    var open by rememberSaveable(explanation) { mutableStateOf(true) }
    Column(
        Modifier.fillMaxWidth().background(colors.muted, Radius.Md).padding(Spacing.Md),
        verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = if (open) "Hide" else "Show") { open = !open }
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
        ) {
            Icon(LucideIcons.Sparkles, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(16.dp))
            Text("What this means for you", style = FitaiTheme.typography.label, color = colors.text, modifier = Modifier.weight(1f))
            Icon(
                LucideIcons.ChevronDown,
                contentDescription = null,
                tint = colors.textMuted,
                modifier = Modifier.size(16.dp).rotate(if (open) HALF_TURN else 0f),
            )
        }
        if (open) MarkdownText(explanation)
    }
}

/** A chart card's heading. */
@Composable
internal fun ChartTitle(text: String) {
    Text(text, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
}

/** A smaller heading for one chart among several in a card. */
@Composable
private fun ChartLabel(text: String) {
    Text(text, style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
}

@Composable
private fun ChartCard(content: @Composable ColumnScope.() -> Unit) {
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md), content = content)
    }
}

// --- Training Load Governor (AcwrTrendChart) ---

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GovernorCard(load: TrainingOverview.TrainingLoad, explanation: String?) {
    val colors = FitaiTheme.colors
    val points = remember(load.trend) { trendPoints(load.trend) { it.acwr } }
    ChartCard {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Column(Modifier.weight(1f)) {
                ChartTitle("Training Load Governor")
                Text(governorSubtitle(load), style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            }
            FitaiBadge(acwrZoneLabel(load.zone), tone = acwrZoneTone(load.zone))
        }
        if (points.isLine()) {
            val top = acwrTop(points)
            LineChart(
                listOf(LineSeries("ACWR", points, SeriesColor.Primary)),
                label = "Acute-to-chronic workload ratio over ${points.size} days; current zone ${acwrZoneLabel(load.zone)}, " +
                    "ACWR ${formatRatio(load.acwr)}",
                bands = acwrBands(top),
                references = ACWR_REFERENCES,
                top = top,
                format = ::formatNumber,
            )
        } else {
            Text(
                "More logged history is needed before the ACWR trend is meaningful.",
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
            )
        }
        FlowRow(
            Modifier.fillMaxWidth(),
            maxItemsInEachRow = 2,
            verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
        ) {
            Figure(load.acuteAvg.roundToInt().toString(), "acute UTSS", StatTone.Plain, Modifier.weight(1f))
            Figure(load.chronicAvg.roundToInt().toString(), "chronic UTSS", StatTone.Plain, Modifier.weight(1f))
            Figure(formatForm(load.tsb), "form (TSB)", tsbTone(load.tsb), Modifier.weight(1f))
            Figure(formatRatio(load.monotony), "monotony", monotonyTone(load.monotonyZone), Modifier.weight(1f))
            load.hrTss?.let { Figure(it.roundToInt().toString(), "hrTSS", StatTone.Plain, Modifier.weight(1f)) }
            val restrictions = load.activeRestrictions.size
            Figure(restrictions.toString(), restrictionsLabel(restrictions).substringAfter(' '), StatTone.Plain, Modifier.weight(1f))
        }
        load.downshiftRationale?.let { Text(it, style = FitaiTheme.typography.bodySm, color = colors.textMuted) }
        ChartExplanation(explanation)
    }
}

/** "412 acute UTSS": a number, in its tone, and what it is. */
@Composable
private fun Figure(value: String, label: String, tone: StatTone, modifier: Modifier) {
    val colors = FitaiTheme.colors
    val color = when (tone) {
        StatTone.Plain -> colors.text
        StatTone.Muted -> colors.textMuted
        StatTone.Good -> colors.success
        StatTone.Caution -> colors.warning
        StatTone.Bad -> colors.danger
    }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(value, style = FitaiTheme.typography.bodySm.copy(fontWeight = FontWeight.SemiBold), color = color)
        Text(label, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
    }
}

// --- Form & monotony (FormMonotonyTrendCharts) ---

/** Form (TSB) and monotony over the range; nothing when neither has two days. */
@Composable
fun FormMonotonyCard(trend: List<TrainingOverview.TrainingLoad.TrendItem>, explanation: String?) {
    val form = remember(trend) { trendPoints(trend) { it.tsb } }
    val monotony = remember(trend) { trendPoints(trend) { it.monotony } }
    if (!form.isLine() && !monotony.isLine()) return
    ChartCard {
        if (form.isLine()) {
            ChartLabel(FORM_TITLE)
            LineChart(listOf(LineSeries(FORM_TITLE, form, SeriesColor.Purple)), FORM_TITLE, references = listOf(FORM_REFERENCE))
        }
        if (monotony.isLine()) {
            ChartLabel(MONOTONY_TITLE)
            LineChart(
                listOf(LineSeries(MONOTONY_TITLE, monotony, SeriesColor.Amber)),
                MONOTONY_TITLE,
                references = listOf(MONOTONY_REFERENCE),
                format = ::fixed2,
            )
        }
        ChartExplanation(explanation)
    }
}

// --- Objective load (ObjectiveLoadTrendCharts) ---

/**
 * UTSS against hrTSS and power TSS (or how to unlock them), the heart-rate
 * zones, fitness and fatigue, and strain; nothing until there's history.
 */
@Composable
fun ObjectiveLoadCard(load: TrainingOverview.TrainingLoad, explanation: String?) {
    val objective = remember(load.trend) { objectiveLoadSeries(load.trend) }
    val fitness = remember(load.trend) { fitnessFatigueSeries(load.trend) }
    val strain = remember(load.trend) { trendPoints(load.trend) { it.strain } }
    val showObjective = objective.size > 1
    val showFitness = fitness.first().points.isLine()
    if (!showObjective && !showFitness && !strain.isLine()) return
    val hasHrTss = objective.any { it.color == SeriesColor.Purple }
    ChartCard {
        if (showObjective) {
            ChartLabel("Objective vs Subjective Load")
            LineChart(objective, "Objective vs Subjective Load")
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                ChartLabel("Objective load needs HR or power")
                Text(
                    "Add your resting/max HR and FTP in Settings → Training → Heart rate & power, and log workouts with heart-rate " +
                        "or power, to see objective load (hrTSS and Power TSS) next to your subjective UTSS.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
            }
        }
        if (hasHrTss && load.hrZones.isNotEmpty()) HeartRateZones(load)
        if (showFitness) {
            ChartLabel("Fitness & Fatigue")
            LineChart(fitness, "Fitness & Fatigue")
        }
        if (strain.isLine()) {
            ChartLabel(STRAIN_TITLE)
            LineChart(listOf(LineSeries(STRAIN_TITLE, strain, SeriesColor.Red)), STRAIN_TITLE)
        }
        ChartExplanation(explanation)
    }
}

@Composable
private fun HeartRateZones(load: TrainingOverview.TrainingLoad) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        ChartLabel("Heart-rate zones (Karvonen %HRR)")
        load.estimatedLthr?.let {
            Text("Est. LTHR ~${formatNumber(it)} bpm", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        }
        load.hrZones.forEach { zone ->
            val current = zone.zone == load.hrZone
            Row(
                Modifier.fillMaxWidth().background(if (current) colors.accentSoft else Color.Transparent, Radius.Sm)
                    .padding(horizontal = Spacing.Sm, vertical = Spacing.Xs),
            ) {
                Text(
                    hrZoneRange(zone),
                    style = FitaiTheme.typography.bodySm.copy(fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (current) colors.text else colors.textMuted,
                    modifier = Modifier.weight(1f),
                )
                Text(hrZoneLabel(zone.zone), style = FitaiTheme.typography.bodySm, color = if (current) colors.text else colors.textMuted)
            }
        }
        load.hrZone?.let {
            Text(
                "Most intense session today: ${it.wireValue.uppercase()}",
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
            )
        }
    }
}

// --- Weekly workouts (WeeklyWorkoutsChart) ---

/** An annotation's shade (ANNOTATION_FILL: red, amber, sky, green). */
@Suppress("MagicNumber")
private fun annotationColor(type: TimelineAnnotation.Type): Color = when (type) {
    TimelineAnnotation.Type.Injury -> DataColors[3]
    TimelineAnnotation.Type.Illness -> DataColors[2]
    TimelineAnnotation.Type.Travel -> DataColors[0]
    TimelineAnnotation.Type.Rest -> DataColors[1]
    TimelineAnnotation.Type.Unknown -> DataColors[4]
}

/** Workouts per week against the goal, with the weeks an injury, illness, trip or rest block touched shaded. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WeeklyWorkoutsCard(overview: TrainingOverview, annotations: List<TimelineAnnotation>, explanation: String?) {
    val weeks = overview.weeklySummaries
    val bands = remember(weeks, annotations) { annotationBands(weeks.map { it.weekStart }, annotations) }
    val goal = overview.weeklyGoal.takeIf { it > 0 }
    ChartCard {
        ChartTitle("Weekly Workouts")
        BarChart(
            weeks.map { Bar(it.weekStart, it.workoutCount.toDouble()) },
            label = "Workouts per week over ${weeks.size} weeks" + goal?.let { ", against a goal of $it per week" }.orEmpty(),
            goal = goal?.toDouble(),
            shading = bands.map { Shade(it.from, it.to, annotationColor(it.type).copy(alpha = SHADE_ALPHA)) },
        )
        val marked = ANNOTATION_TYPES.filter { type -> bands.any { it.type == type } }
        if (marked.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                marked.forEach { Swatch(annotationColor(it).copy(alpha = SHADE_ALPHA * 2), annotationLabel(it)) }
            }
        }
        ChartExplanation(explanation)
    }
}

@Composable
internal fun Swatch(color: Color, label: String, outlined: Boolean = false) {
    val colors = FitaiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        val box = Modifier.size(10.dp).background(color, Radius.Sm)
        Box(if (outlined) box.border(1.dp, colors.borderStrong, Radius.Sm) else box)
        Text(label, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
    }
}

// --- Weekly trends (OverviewTrendCharts) ---

/** Average RPE, duration and running per week, each once it has two weeks. */
@Composable
fun WeeklyTrendsCard(weeks: List<TrainingOverview.WeeklySummariesItem>, distanceUnit: String?, explanation: String?) {
    val rpe = remember(weeks) { avgRpePoints(weeks) }
    val duration = remember(weeks) { avgDurationPoints(weeks) }
    val running = remember(weeks, distanceUnit) { runningPoints(weeks, distanceUnit) }
    if (listOf(rpe, duration, running).none { it.isLine() } && explanation.isNullOrBlank()) return
    val runningLabel = "Running (${if (distanceUnit == "miles") "mi" else "km"} per week)"
    ChartCard {
        if (rpe.isLine()) {
            ChartLabel("Avg RPE (per week)")
            LineChart(listOf(LineSeries("Avg RPE", rpe, SeriesColor.Red)), "Avg RPE (per week)")
        }
        if (duration.isLine()) {
            ChartLabel("Avg Duration (min)")
            LineChart(listOf(LineSeries("Avg Duration", duration, SeriesColor.Blue)), "Avg Duration (min)")
        }
        if (running.isLine()) {
            ChartLabel(runningLabel)
            LineChart(listOf(LineSeries("Running", running, SeriesColor.Green)), runningLabel)
        }
        ChartExplanation(explanation)
    }
}

// --- Consistency (WorkoutHeatmap) ---

private val DAY_LABELS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

/** Sixteen weeks of days, shaded where a workout was logged. */
@Composable
fun ConsistencyCard(workoutDates: List<String>, today: String, rangeStart: String?, explanation: String?) {
    val colors = FitaiTheme.colors
    val weeks = remember(workoutDates, today, rangeStart) { consistencyWeeks(today, workoutDates, rangeStart) }
    val months = remember(weeks) { monthLabels(weeks) }
    val logged = weeks.sumOf { week -> week.count { it.state == DayState.Workout } }
    val anyOutOfRange = weeks.any { week -> week.any { it.state == DayState.OutOfRange } }
    ChartCard {
        ChartTitle("Workout Consistency")
        Column(
            Modifier.fillMaxWidth().clearAndSetSemantics {
                contentDescription = "Workout activity heatmap: each square is a day, shaded when a workout was logged, " +
                    "arranged by week. $logged workout days in the last $HEATMAP_WEEKS weeks."
            },
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                Box(Modifier.width(DAY_LABEL_WIDTH))
                months.forEach { month ->
                    Text(
                        month.orEmpty(),
                        style = FitaiTheme.typography.bodySm,
                        color = colors.textMuted,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Visible,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            DAY_LABELS.forEachIndexed { day, label ->
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, style = FitaiTheme.typography.bodySm, color = colors.textMuted, modifier = Modifier.width(DAY_LABEL_WIDTH))
                    weeks.forEach { week -> DayCell(week[day].state, Modifier.weight(1f)) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Swatch(colors.muted, "Rest day")
            Swatch(colors.primary, "Workout logged")
            if (anyOutOfRange) Swatch(Color.Transparent, "Outside selected range", outlined = true)
        }
        ChartExplanation(explanation)
    }
}

private val DAY_LABEL_WIDTH = 30.dp

@Composable
private fun DayCell(state: DayState, modifier: Modifier) {
    val colors = FitaiTheme.colors
    val cell = modifier.aspectRatio(1f)
    Box(
        when (state) {
            DayState.Workout -> cell.background(colors.primary, Radius.Sm)
            DayState.Rest -> cell.background(colors.muted, Radius.Sm)
            DayState.Future -> cell.background(colors.muted.copy(alpha = FUTURE_ALPHA), Radius.Sm)
            DayState.OutOfRange -> cell.border(1.dp, colors.border, Radius.Sm)
        },
    )
}
