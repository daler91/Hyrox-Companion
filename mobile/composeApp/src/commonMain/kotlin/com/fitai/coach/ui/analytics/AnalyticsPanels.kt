package com.fitai.coach.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.RacePrediction
import com.fitai.coach.core.api.generated.SessionGrade
import com.fitai.coach.core.api.generated.SessionGradeRollupCounts
import com.fitai.coach.core.api.generated.SessionGradesResponse
import com.fitai.coach.core.dates.formatInstant
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.markdown.MarkdownText
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.workout.gradeLabel
import com.fitai.coach.ui.workout.gradeTone

// --- Race predictor ---

/** The predicted HYROX finish, its splits and how race-ready the athlete is (RacePredictorTab.tsx). */
@Composable
fun RacePredictorPanel(timeZone: String?, openSettings: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "race-predictor-${session.userId}") { RacePredictorViewModel(session.analytics) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    val prediction = state.prediction
    Box {
        when {
            prediction != null && hasNoRaceData(
                prediction,
            ) -> PanelEmpty(LucideIcons.Timer, "Log some runs and HYROX stations to predict your finish time.")
            prediction != null -> Prediction(prediction, state.regenerating, timeZone, vm::regenerate, openSettings)
            state.failed -> ErrorState("Couldn't load your race prediction", onRetry = vm::retry)
            else -> LoadingState(Modifier.fillMaxWidth().padding(vertical = Spacing.Xl))
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun Prediction(
    prediction: RacePrediction,
    regenerating: Boolean,
    timeZone: String?,
    onRegenerate: () -> Unit,
    openSettings: () -> Unit,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        FitaiCard(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                PanelTitle("Predicted finish", LucideIcons.Timer)
                Text(predictionSubtitle(prediction), style = type.bodySm, color = colors.textMuted)
                Text(formatFinishTime(prediction.totalFinishSeconds), style = type.metricXl, color = colors.text)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    val (label, tone) = confidenceBadge(prediction.overallConfidence)
                    FitaiBadge(label, tone = tone)
                    if (prediction.aiUsed) FitaiBadge("AI-refined", tone = BadgeTone.Accent)
                }
                percentileLine(prediction)?.let { Text(it, style = type.body, color = colors.text) }
                if (prediction.genderAssumed) {
                    Text(
                        "Gender not set — using a neutral standard. Set it in Settings for division-correct loads.",
                        style = type.bodySm,
                        color = colors.textMuted,
                    )
                }
                FitaiButton(
                    if (regenerating) "Regenerating…" else "Regenerate",
                    onClick = onRegenerate,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    enabled = !regenerating,
                )
                LastUpdated(prediction.generatedAt, prediction.stale, timeZone)
            }
        }
        prediction.raceReadiness?.let { Readiness(it) }
        if (!prediction.aiUsed) {
            Notice(aiNotice(prediction.aiUnavailableReason)) {
                if (prediction.aiUnavailableReason == RacePrediction.AiUnavailableReason.AiConsentOff) {
                    FitaiButton("Enable AI Coach", onClick = openSettings, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                }
            }
        }
        prediction.narrative?.takeIf { it.isNotBlank() }?.let { FitaiCard(Modifier.fillMaxWidth()) { MarkdownText(it) } }
        Segments(prediction)
    }
}

@Composable
private fun Readiness(readiness: RacePrediction.RaceReadiness) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            PanelTitle("Race readiness", LucideIcons.Gauge)
            Text("Your current training form (TSB) and how to taper into race day.", style = type.bodySm, color = colors.textMuted)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                val (label, tone) = readinessBadge(readiness.status)
                FitaiBadge(label, tone = tone)
                readiness.tsb?.let { Text("Form ${formatTsb(it)}", style = type.body, color = colors.textMuted) }
            }
            Text(readiness.guidance, style = type.body, color = colors.text)
        }
    }
}

@Composable
private fun Segments(prediction: RacePrediction) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            PanelTitle("Segment breakdown")
            Text("8 runs and 8 stations, in race order", style = type.bodySm, color = colors.textMuted)
            prediction.segments.forEach { segment ->
                val run = segment.kind == RacePrediction.SegmentsItem.Kind.Run
                SplitRow(
                    icon = if (run) LucideIcons.Footprints else LucideIcons.Dumbbell,
                    label = segment.label,
                    detail = segmentBasis(segment),
                    split = formatSplit(segment.estimatedSeconds),
                    shaded = run,
                )
            }
            if (prediction.transitionSeconds > 0) {
                SplitRow(LucideIcons.Timer, "Transitions (roxzone)", null, formatSplit(prediction.transitionSeconds), shaded = true)
            }
        }
    }
}

@Composable
private fun SplitRow(icon: ImageVector, label: String, detail: String?, split: String, shaded: Boolean) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (shaded) colors.muted else Color.Transparent, Radius.Md)
            .padding(horizontal = Spacing.Sm, vertical = Spacing.Xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
    ) {
        Icon(icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = type.body, color = colors.text)
            detail?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
        }
        Text(split, style = type.label, color = colors.text)
    }
}

// --- Session quality ---

/** Whether each easy run stayed easy and each threshold run held, across a plan (SessionGradesTab.tsx). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SessionGradesPanel(openWorkout: (String) -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "session-grades-${session.userId}") { SessionGradesViewModel(session.analytics, session.timeline.plans) }
    val state by vm.state.collectAsStateWithLifecycle()
    val grades = state.grades
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        val plan = grades?.plan?.name?.let { " $it, by plan week and training block." }.orEmpty()
        Text("Did each easy run stay easy, and each threshold run stay at threshold?$plan", style = type.body, color = colors.textMuted)
        if (state.plans.size >= 2) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                FitaiChip("Current plan", selected = state.planId == null, onClick = { vm.selectPlan(null) })
                state.plans.forEach { p -> FitaiChip(p.name, selected = state.planId == p.id, onClick = { vm.selectPlan(p.id) }) }
            }
        }
        when {
            state.loading -> LoadingState(Modifier.fillMaxWidth().padding(vertical = Spacing.Xl))
            state.failed || grades == null -> ErrorState("Couldn't load session grades", onRetry = vm::retry)
            grades.plan == null -> PanelEmpty(
                LucideIcons.Gauge,
                "Start a training plan and each easy and threshold run will be graded against what it was for.",
            )
            grades.sessions.isEmpty() -> PanelEmpty(
                LucideIcons.Gauge,
                "No graded runs in ${grades.plan?.name} yet. Easy, recovery, long and threshold runs are graded once they're logged — " +
                    "connect Strava for heart-rate and pace detail.",
            )
            else -> Grades(grades, openWorkout)
        }
    }
}

@Composable
private fun Grades(grades: SessionGradesResponse, openWorkout: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        grades.totals?.let { HeadlineTiles(it) }
        if (grades.weeks.isNotEmpty()) WeeklyGrades(grades.weeks)
        if (grades.blocks.isNotEmpty()) Blocks(grades.blocks)
        FitaiCard(Modifier.fillMaxWidth()) {
            PanelTitle("Recent graded runs")
            grades.sessions.take(RECENT_GRADED_RUNS).forEachIndexed { index, grade ->
                if (index > 0) HorizontalDivider(color = FitaiTheme.colors.border)
                GradedRun(grade, onOpen = { openWorkout(grade.workoutLogId) })
            }
        }
    }
}

@Composable
private fun HeadlineTiles(totals: SessionGradeRollupCounts) {
    val easy = easyShare(totals)
    val threshold = thresholdShare(totals)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Tile(
                formatShare(easy),
                "Easy runs stayed easy",
                if (easy.graded >
                    0
                ) {
                    "${easy.onTarget} of ${easy.graded}"
                } else {
                    "None graded yet"
                },
                Modifier.weight(1f),
            )
            Tile(
                formatShare(threshold),
                "Threshold runs held",
                if (threshold.graded > 0) "${threshold.onTarget} of ${threshold.graded}" else "None graded yet",
                Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Tile(totals.driftedHarder.toString(), "Drifted harder", "Threshold runs run above threshold", Modifier.weight(1f))
            Tile(totals.easyTooHard.toString(), "Easy runs not easy", "Crept up or too hard", Modifier.weight(1f))
        }
    }
}

/**
 * The weekly chart as a stacked bar per plan week (WeeklyGradesChart): did
 * its job, crept up or under, too hard or drifted harder, can't tell. Each
 * row also reads out its counts, so colour is never the only signal.
 */
@Composable
private fun WeeklyGrades(weeks: List<SessionGradesResponse.WeeksItem>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val stackColors = listOf(colors.success, colors.warning, colors.danger, colors.textMuted)
    val stackLabels = listOf("Did its job", "Crept up / under", "Too hard / drifted harder", "Can't tell")
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            PanelTitle("Week by week")
            weeks.forEach { week ->
                val stack = gradeStack(week.counts)
                val parts = listOf(stack.onTarget, stack.partial, stack.missed, stack.unclear)
                val spoken = parts.zip(stackLabels).filter { it.first > 0 }.joinToString(", ") { "${it.first} ${it.second.lowercase()}" }
                Row(
                    Modifier.fillMaxWidth().semantics(mergeDescendants = true) {
                        contentDescription =
                            "Week ${week.weekNumber}${if (week.deload) ", deload" else ""}: ${spoken.ifEmpty { "no graded runs" }}"
                    },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
                ) {
                    Text(
                        "W${week.weekNumber}${if (week.deload) "·D" else ""}",
                        style = type.bodySm,
                        color = colors.textMuted,
                        modifier = Modifier.width(44.dp),
                    )
                    Row(Modifier.weight(1f).height(14.dp).background(colors.muted, Radius.Sm)) {
                        if (stack.total >
                            0
                        ) {
                            parts.forEachIndexed { i, n ->
                                if (n >
                                    0
                                ) {
                                    Box(Modifier.weight(n.toFloat()).height(14.dp).background(stackColors[i]))
                                }
                            }
                        }
                    }
                    Text(stack.total.toString(), style = type.bodySm, color = colors.text, modifier = Modifier.width(24.dp))
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Md), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                stackLabels.forEachIndexed { i, label ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                        Box(Modifier.size(10.dp).background(stackColors[i], Radius.Sm))
                        Text(label, style = type.bodySm, color = colors.textMuted)
                    }
                }
            }
        }
    }
}

/** The plan's training blocks side by side (BlockGradesTable), as one card per block. */
@Composable
private fun Blocks(blocks: List<SessionGradesResponse.BlocksItem>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            PanelTitle("By training block")
            blocks.forEachIndexed { index, block ->
                if (index > 0) HorizontalDivider(color = colors.border)
                Text("Block ${block.block} · ${blockSpan(block)}", style = type.label, color = colors.text)
                block.phases.mapNotNull(::phaseLabel).takeIf { it.isNotEmpty() }?.let {
                    Text(it.joinToString(", "), style = type.bodySm, color = colors.textMuted)
                }
                Stat("Easy stayed easy", shareCell(easyShare(block.counts)))
                Stat("Threshold held", shareCell(thresholdShare(block.counts)))
                Stat("Drifted harder", block.counts.driftedHarder.toString())
                Stat("Easy too hard", block.counts.easyTooHard.toString())
            }
        }
    }
}

@Composable
private fun GradedRun(grade: SessionGrade, onOpen: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpen).padding(vertical = Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        val week = grade.weekNumber?.let { " · Week $it" }.orEmpty()
        Text("${shortWeekday(grade.date)}, ${shortDate(grade.date)}$week", style = type.bodySm, color = colors.textMuted)
        Text(grade.title, style = type.h3, color = colors.text)
        Text(grade.evidence.firstOrNull() ?: grade.headline, style = type.bodySm, color = colors.textMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiBadge(purposeLabel(grade.purpose))
            FitaiBadge(gradeLabel(grade.intent, grade.verdict), tone = gradeTone(grade.verdict))
        }
    }
}

// --- Coach insights ---

/** The AI's analysis of training so far against the goal (CoachInsightsTab.tsx). */
@Composable
fun CoachInsightsPanel(timeZone: String?, openSettings: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "coach-insights-${session.userId}") { CoachInsightsViewModel(session.analytics, session.account.user) }
    val state by vm.state.collectAsStateWithLifecycle()
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            PanelTitle("Coach Insights", LucideIcons.Sparkles)
            Text(
                "AI-generated analysis of your training so far and how you're tracking against your goal.",
                style = type.bodySm,
                color = colors.textMuted,
            )
            FitaiButton(
                when {
                    state.generating -> "Analyzing…"
                    state.hasInsights -> "Regenerate"
                    else -> "Generate insights"
                },
                onClick = vm::generate,
                variant = if (state.hasInsights) ButtonVariant.Secondary else ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = !state.generating && !state.aiCoachOff,
            )
            LastUpdated(state.insights?.generatedAt, state.insights?.stale, timeZone)
            if (state.aiCoachOff) {
                Notice("The AI Coach is turned off. Enable it in Settings to get personalized coach insights.") {
                    FitaiButton("Enable AI Coach", onClick = openSettings, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                }
            }
            state.error?.let { Text(it, style = type.body, color = colors.danger) }
            when {
                state.hasInsights -> MarkdownText(state.insights?.insights.orEmpty())
                state.generating || state.loading -> LoadingState(
                    Modifier.fillMaxWidth(),
                    message = "Reviewing your workouts, plan progress, and goal…",
                )
                !state.aiCoachOff && state.error == null -> Text(
                    "Generate a personalized analysis of your progress toward your goal, what's working, and what to focus on next.",
                    style = type.body,
                    color = colors.textMuted,
                )
            }
        }
    }
}

// --- Shared pieces ---

@Composable
private fun PanelTitle(text: String, icon: ImageVector? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        icon?.let { Icon(it, contentDescription = null, tint = FitaiTheme.colors.accentText, modifier = Modifier.size(18.dp)) }
        Text(text, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun LastUpdated(generatedAt: String?, stale: Boolean?, timeZone: String?) {
    lastUpdatedNote(generatedAt?.let { formatInstant(it, timeZone) }, stale)?.let {
        Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

@Composable
private fun Notice(text: String, action: @Composable () -> Unit = {}) {
    val colors = FitaiTheme.colors
    Row(
        Modifier.fillMaxWidth().background(colors.muted, Radius.Md).padding(Spacing.Md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
    ) {
        Icon(LucideIcons.Info, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text(text, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            action()
        }
    }
}

@Composable
private fun PanelEmpty(icon: ImageVector, text: String) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Icon(icon, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(36.dp))
            Text(text, style = FitaiTheme.typography.body, color = colors.textMuted)
        }
    }
}

@Composable
private fun Tile(value: String, label: String, detail: String, modifier: Modifier) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(modifier) {
        Text(value, style = type.metric, color = colors.text)
        Text(label, style = type.label, color = colors.textMuted)
        Text(detail, style = type.bodySm, color = colors.textMuted)
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, modifier = Modifier.weight(1f))
        Text(value, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
    }
}
