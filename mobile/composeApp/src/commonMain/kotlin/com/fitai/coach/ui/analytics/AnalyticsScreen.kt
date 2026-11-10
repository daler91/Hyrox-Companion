package com.fitai.coach.ui.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsResponseValueItem
import com.fitai.coach.core.api.generated.PersonalRecordValue
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.data.AnalyticsRange
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.core.units.metersToUserDistance
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** Units for labels: the server sends values already in the athlete's units. */
private data class Units(val weight: String, val distance: String?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(navigation: AnalyticsNavigation) {
    val onLogWorkout = navigation.logWorkout
    val session = LocalUserSession.current
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
    val vm = viewModel(key = "analytics-${session.userId}") { AnalyticsViewModel(session.analytics, todayIn(prefs?.userTimezone)) }
    val state by vm.state.collectAsStateWithLifecycle()
    val units = Units(weight = prefs?.weightUnit ?: "kg", distance = prefs?.distanceUnit)
    val today = todayIn(prefs?.userTimezone)
    val analysisVm = viewModel(key = "overview-analysis-${session.userId}") {
        OverviewAnalysisViewModel(session.analytics, session.account.user, session.annotations, state.range)
    }
    val analysis by analysisVm.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.range) { analysisVm.select(state.range) }
    val charts = OverviewContext(
        analysis = analysis,
        onGenerate = analysisVm::generate,
        today = today,
        rangeStart = state.range.bounds(today)?.first,
        timeZone = prefs?.userTimezone,
        openSettings = navigation.openSettings,
    )

    PullToRefreshBox(isRefreshing = state.loading, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            item {
                Text(
                    "analytics",
                    style = FitaiTheme.typography.h1,
                    color = FitaiTheme.colors.text,
                    modifier = Modifier.semantics {
                        heading()
                    },
                )
            }
            // A link rather than a tab: the review is one Monday-to-Sunday week, this page the range below (Analytics.tsx).
            item { FitaiButton("Weekly review", onClick = navigation.openReview, variant = ButtonVariant.Secondary, size = ButtonSize.Sm) }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    items(AnalyticsTab.entries) { tab ->
                        FitaiChip(tab.label, selected = state.tab == tab, onClick = { vm.selectTab(tab) })
                    }
                }
            }
            if (state.tab.usesRange) {
                item {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                        items(AnalyticsRange.entries) { range ->
                            FitaiChip(range.label, selected = state.range == range, onClick = { vm.selectRange(range) })
                        }
                    }
                }
            }
            when {
                state.failed -> item { ErrorState("Couldn't load your analytics", onRetry = vm::refresh) }
                state.loading -> item { LoadingState() }
                else -> when (state.tab) {
                    AnalyticsTab.Overview -> state.overview?.let { overview(it, units, charts, onLogWorkout) }
                    AnalyticsTab.Breakdown -> state.overview?.let { breakdown(it, onLogWorkout) }
                    AnalyticsTab.Records -> records(state, vm, units, today, onLogWorkout)
                    AnalyticsTab.Progression -> progression(state, vm, units, onLogWorkout)
                    AnalyticsTab.Sessions -> item { SessionGradesPanel(navigation.openWorkout) }
                    AnalyticsTab.Insights -> item { CoachInsightsPanel(prefs?.userTimezone, navigation.openSettings) }
                    AnalyticsTab.Predictor -> item { RacePredictorPanel(prefs?.userTimezone, navigation.openSettings) }
                }
            }
        }
    }
}

/** What the Overview's charts need beyond the overview itself: the AI's reading, the day, the range. */
private data class OverviewContext(
    val analysis: OverviewAnalysisState,
    val onGenerate: () -> Unit,
    val today: String,
    /** The range's first day; null for all time. */
    val rangeStart: String?,
    val timeZone: String?,
    val openSettings: () -> Unit,
)

/** The Overview tab, in the web's order (TrainingOverviewTab), each chart with the AI's reading under it. */
private fun LazyListScope.overview(overview: TrainingOverview, units: Units, charts: OverviewContext, onLogWorkout: () -> Unit) {
    val load = overview.trainingLoad
    if (overview.weeklySummaries.isEmpty() && load.trend.none { it.utss > 0 }) {
        item {
            EmptyState(
                title = "No workout data yet",
                message = "Log some workouts to see your training overview.",
                actionLabel = "Log a workout",
                onAction = onLogWorkout,
            )
        }
        return
    }
    val sections = charts.analysis.sections
    item { OverviewAnalysisHeader(charts.analysis, charts.onGenerate, charts.timeZone, charts.openSettings) }
    item { StatGrid(overview, units) }
    item { GovernorCard(load, sections?.trainingLoad) }
    overview.bodySystemLoad?.takeIf(::hasBodySystemLoad)?.let { item { BodySystemLoadCard(it, sections?.bodySystems) } }
    item { FormMonotonyCard(load.trend, sections?.formMonotony) }
    item { ObjectiveLoadCard(load, sections?.objectiveLoad) }
    item { WeeklyWorkoutsCard(overview, charts.analysis.annotations, sections?.weeklyWorkouts) }
    item { WeeklyTrendsCard(overview.weeklySummaries, units.distance, sections?.rpeDuration) }
    item { ConsistencyCard(overview.workoutDates, charts.today, charts.rangeStart, sections?.consistency) }
}

@Composable
private fun StatGrid(overview: TrainingOverview, units: Units) {
    val now = overview.currentStats
    val before = overview.previousStats
    val distanceLabel = if (units.distance == "miles") "mi" else "km"
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Stat("Per week", formatNumber(now.avgPerWeek), delta(now.avgPerWeek, before?.avgPerWeek), Modifier.weight(1f))
            Stat(
                "Workouts",
                now.totalWorkouts.toString(),
                delta(now.totalWorkouts.toDouble(), before?.totalWorkouts?.toDouble()),
                Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Stat(
                "Running",
                "${formatNumber(metersToUserDistance(now.totalRunningMeters, units.distance))} $distanceLabel",
                delta(now.totalRunningMeters, before?.totalRunningMeters),
                Modifier.weight(1f),
            )
            Stat("Avg duration", "${formatNumber(now.avgDuration)} min", delta(now.avgDuration, before?.avgDuration), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Stat(
                "Avg RPE",
                now.avgRpe?.let(::formatNumber) ?: "—",
                delta(now.avgRpe, before?.avgRpe, lowerIsBetter = true),
                Modifier.weight(1f),
            )
            Stat(
                "Adherence",
                now.avgCompliancePct?.let { "${formatNumber(it)}%" } ?: "—",
                delta(now.avgCompliancePct, before?.avgCompliancePct),
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun Stat(label: String, value: String, change: Delta?, modifier: Modifier) {
    FitaiCard(modifier) {
        Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        Text(value, style = FitaiTheme.typography.metric, color = FitaiTheme.colors.text)
        when (change) {
            is Delta.Change -> FitaiBadge(
                "${if (change.percent > 0) "+" else ""}${formatNumber(change.percent)}%",
                tone = if (change.better) BadgeTone.Success else BadgeTone.Warning,
            )
            Delta.New -> FitaiBadge("new", tone = BadgeTone.Accent)
            Delta.Same -> FitaiBadge("=")
            null -> Unit
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
private fun LazyListScope.records(state: AnalyticsUiState, vm: AnalyticsViewModel, units: Units, today: String, onLogWorkout: () -> Unit) {
    val all = state.records.orEmpty()
    if (all.isEmpty()) {
        item {
            EmptyState(
                title = "No personal records yet",
                message = "Log workouts with structured exercise data to see your PRs here.",
                actionLabel = "Log a workout",
                onAction = onLogWorkout,
            )
        }
        return
    }
    item {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            RECORD_CATEGORIES.forEach { category ->
                FitaiChip(category, selected = state.category == category, onClick = { vm.selectCategory(category) })
            }
        }
    }
    val rows = recordRows(all, state.category)
    val recent = recentRecords(rows, today)
    if (recent.isNotEmpty()) {
        item { Text("Recent PRs (last 30 days)", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text) }
        items(recent, key = { "recent-${it.key}" }) { RecordCard(it, units) }
        item { Text("All records", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text) }
    }
    items(rows, key = { it.key }) { RecordCard(it, units) }
    item {
        Text(
            "e1RM uses the Epley formula, from strength sets of 2–10 reps.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
    }
}

@Composable
private fun RecordCard(row: RecordRow, units: Units) {
    val distanceUnit = if (units.distance == "miles") "ft" else "m"
    FitaiCard {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(row.label, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
            FitaiBadge(row.record.category.replaceFirstChar { it.uppercase() })
        }
        row.record.maxWeight?.let { Metric("Max weight", "${formatNumber(it.value)} ${units.weight}", it) }
        row.record.maxDistance?.let { Metric("Max distance", "${formatNumber(it.value)} $distanceUnit", it) }
        row.record.bestTime?.let { Metric("Best time", formatClock(it.value), it) }
        row.record.estimated1RM?.let { Metric("Estimated 1RM", "${formatNumber(it.value)} ${units.weight} e1RM", it) }
    }
}

@Composable
private fun Metric(label: String, value: String, record: PersonalRecordValue) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, modifier = Modifier.weight(1f))
        Text("$value · ${shortDate(record.date)}", style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
    }
}

@OptIn(ExperimentalLayoutApi::class)
private fun LazyListScope.progression(state: AnalyticsUiState, vm: AnalyticsViewModel, units: Units, onLogWorkout: () -> Unit) {
    val choices = recordRows(state.records.orEmpty())
    if (choices.isEmpty()) {
        item {
            EmptyState(
                title = "No exercise history yet",
                message = "Your exercise progression appears here once you've logged a few structured workouts.",
                actionLabel = "Log a workout",
                onAction = onLogWorkout,
            )
        }
        return
    }
    item {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            choices.forEach { row -> FitaiChip(row.label, selected = state.exercise == row.key, onClick = { vm.selectExercise(row.key) }) }
        }
    }
    val key = state.exercise
    val days = key?.let { state.exercises?.get(it) }.orEmpty()
    when {
        key == null -> item {
            Text("Select an exercise to see its progression.", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
        }
        days.isEmpty() -> item { Text("No data yet.", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted) }
        else -> {
            item { ProgressionSummary(days) }
            item { ProgressionChart("Volume (reps × ${units.weight})", days) { it.totalVolume } }
            item { ProgressionChart("Max weight (${units.weight})", days) { it.maxWeight } }
            item { ProgressionChart("Total reps", days) { it.totalReps } }
            item { ProgressionChart("Total distance (${if (units.distance == "miles") "ft" else "m"})", days) { it.totalDistance } }
        }
    }
}

@Composable
private fun ProgressionSummary(days: List<GetExerciseAnalyticsResponseValueItem>) {
    val sets = days.sumOf { it.totalSets }
    val reps = days.sumOf { it.totalReps }
    val volume = days.sumOf { it.totalVolume }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Summary("Sessions", days.size.toString(), null, Modifier.weight(1f))
        Summary("Sets", sets.toString(), null, Modifier.weight(1f))
        Summary("Reps", formatNumber(reps), trend(days.map { it.totalReps }), Modifier.weight(1f))
        Summary("Volume", formatNumber(volume), trend(days.map { it.totalVolume }), Modifier.weight(1f))
    }
}

@Composable
private fun Summary(label: String, value: String, trend: Trend?, modifier: Modifier) {
    FitaiCard(modifier) {
        Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        Text(value, style = FitaiTheme.typography.metric, color = FitaiTheme.colors.text)
        when (trend) {
            Trend.Up -> Text("↑", color = FitaiTheme.colors.success)
            Trend.Down -> Text("↓", color = FitaiTheme.colors.warning)
            else -> Unit
        }
    }
}

@Composable
private fun ProgressionChart(
    title: String,
    days: List<GetExerciseAnalyticsResponseValueItem>,
    value: (GetExerciseAnalyticsResponseValueItem) -> Double,
) {
    if (days.none { value(it) > 0 }) return
    FitaiCard {
        Text(title, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
        BarChart(days.map { Bar(it.date, value(it)) }, label = title)
    }
}
