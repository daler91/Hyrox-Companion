package com.fitai.coach.ui.review

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.WeeklyReview
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.analytics.Delta
import com.fitai.coach.ui.analytics.delta
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.workout.gradeLabel
import com.fitai.coach.ui.workout.gradeTone

/**
 * The weekly review (Review.tsx): one Monday-to-Sunday week, what was
 * planned and done against the week before, its records and context, and
 * the one line to carry into next week.
 */
@Composable
fun WeeklyReviewScreen(week: String?, onBack: () -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "weekly-review-${session.userId}-$week") { WeeklyReviewViewModel(session.reviews, week, todayIn(null)) }
    val state by vm.state.collectAsStateWithLifecycle()
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    val units = ReviewUnits(weight = if (prefs?.weightUnit == "lbs") "lbs" else "kg", distance = prefs?.distanceUnit)

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = Spacing.Lg, vertical = Spacing.Md),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            item(key = "header") { Header(state, onBack, vm::previousWeek, vm::nextWeek) }
            val review = state.review
            when {
                review != null -> {
                    item(key = "summary") { Summary(review) }
                    item(key = "highlights") { Highlights(review, units) }
                    item(key = "intent-${review.weekStart}") { NextWeek(review, state.savingIntent, vm::saveIntent) }
                    if (isEmptyWeek(review)) {
                        item(key = "empty") { EmptyWeek(review.isCurrentWeek) }
                    } else {
                        item(key = "sessions") { Sessions(review) }
                        if (review.plannedDays.isNotEmpty()) item(key = "planned") { PlannedDays(review) }
                    }
                }
                state.failed -> item(key = "error") { ErrorState("Couldn't load this week", onRetry = vm::retry) }
                else -> item(key = "loading") { LoadingState(Modifier.fillMaxWidth().padding(vertical = Spacing.Xl)) }
            }
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }
}

private data class ReviewUnits(val weight: String, val distance: String?)

@Composable
private fun Header(state: WeeklyReviewUiState, onBack: () -> Unit, onPrevious: () -> Unit, onNext: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val review = state.review
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(LucideIcons.ArrowLeft, contentDescription = "back", tint = colors.text) }
            Text("weekly review", style = type.h1, color = colors.text, modifier = Modifier.weight(1f).semantics { heading() })
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(
                review?.let { formatWeekRange(it.weekStart, it.weekEnd) }.orEmpty(),
                style = type.body,
                color = colors.textMuted,
                modifier = Modifier.weight(1f),
            )
            if (review?.isCurrentWeek == true) FitaiBadge("In progress")
            IconButton(onClick = onPrevious) { Icon(LucideIcons.ChevronLeft, contentDescription = "Previous week", tint = colors.text) }
            // The running week is the last one worth opening: a week that hasn't started has nothing to review.
            IconButton(onClick = onNext, enabled = !state.atCurrentWeek) {
                Icon(
                    LucideIcons.ChevronRight,
                    contentDescription = if (state.atCurrentWeek) "Next week (none yet)" else "Next week",
                    tint = if (state.atCurrentWeek) colors.border else colors.text,
                )
            }
        }
    }
}

/**
 * The week's headline numbers (WeeklyReviewSummary). Sessions logged and
 * plan adherence stay two tiles, never one rate: off-plan training would
 * push a single rate past 100%. No plan, no plan tile.
 */
@Composable
private fun Summary(review: WeeklyReview) {
    val current = review.current
    val previous = review.previous
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Stat(
                if (review.isCurrentWeek) "Sessions so far" else "Sessions",
                current.sessionsLogged.toString(),
                "Goal ${review.weeklyGoal}/week",
                delta(current.sessionsLogged.toDouble(), previous.sessionsLogged.toDouble()),
                Modifier.weight(1f),
            )
            if (review.hasPlan) {
                Stat("Plan", "${current.plannedCompleted}/${current.sessionsPlanned}", adherenceDetail(current), null, Modifier.weight(1f))
            } else {
                TimeStat(review, Modifier.weight(1f))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            if (review.hasPlan) TimeStat(review, Modifier.weight(1f))
            Stat(
                "Avg RPE",
                current.avgRpe?.let { formatNumber(it) } ?: "—",
                "No effort logged".takeIf { current.avgRpe == null },
                // Only against a week that also logged effort: a gap would read as a collapse.
                delta(current.avgRpe, previous.avgRpe),
                Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun TimeStat(review: WeeklyReview, modifier: Modifier) = Stat(
    "Time",
    formatDuration(review.current.totalDurationMin),
    null,
    delta(review.current.totalDurationMin, review.previous.totalDurationMin),
    modifier,
)

@Composable
private fun Stat(label: String, value: String, sub: String?, change: Delta?, modifier: Modifier) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(modifier) {
        Text(label, style = type.label, color = colors.textMuted)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(value, style = type.metric, color = colors.text)
            DeltaBadge(change)
        }
        sub?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
    }
}

@Composable
private fun DeltaBadge(change: Delta?) {
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

/**
 * Context and records (WeeklyReviewHighlights). Context comes first: a
 * light week inside a logged injury is the plan working, and the page says
 * so before anything about volume.
 */
@Composable
private fun Highlights(review: WeeklyReview, units: ReviewUnits) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        if (review.annotations.isNotEmpty()) {
            FitaiCard(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                    CardTitle("Context")
                    review.annotations.forEach { note ->
                        Text(
                            contextLabel(note.type) + note.note?.takeIf { it.isNotBlank() }?.let { " — $it" }.orEmpty(),
                            style = type.body,
                            color = colors.text,
                        )
                    }
                    Text(
                        "Sessions during this range aren't a shortfall — the week was meant to look different.",
                        style = type.bodySm,
                        color = colors.textMuted,
                    )
                }
            }
        }
        if (review.personalRecords.isNotEmpty()) {
            FitaiCard(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                    CardTitle("Records this week", LucideIcons.Trophy)
                    review.personalRecords.forEach { record ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                            Text(
                                exerciseLabel(record.exerciseName, record.customLabel),
                                style = type.body,
                                color = colors.text,
                                modifier = Modifier.weight(1f),
                            )
                            FitaiBadge(recordMetricLabel(record.metric))
                            Text(recordValue(record, units.weight, units.distance), style = type.body, color = colors.text)
                        }
                    }
                }
            }
        }
    }
}

/**
 * The one line for next week, with last week's shown back (WeeklyReviewIntent).
 * Nothing grades the week against it: the value is the reminder.
 */
@Composable
private fun NextWeek(review: WeeklyReview, saving: Boolean, onSave: (String) -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    var draft by rememberSaveable(review.weekStart) { mutableStateOf(review.intent.orEmpty()) }
    val dirty = draft.trim() != review.intent.orEmpty()
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            CardTitle("Next week")
            review.previousIntent?.takeIf { it.isNotBlank() }?.let { previous ->
                Column(Modifier.fillMaxWidth().background(colors.muted, Radius.Md).padding(Spacing.Md)) {
                    Text("LAST WEEK YOU SAID", style = type.label, color = colors.textMuted)
                    Text(previous, style = type.body, color = colors.text)
                }
            }
            FitaiTextField(
                draft,
                { if (it.length <= INTENT_MAX_LENGTH) draft = it },
                "One thing to carry into next week",
                placeholder = "e.g. get three runs in, and actually take the rest day",
                supportingText = "${draft.length}/$INTENT_MAX_LENGTH",
                singleLine = false,
            )
            // Clearing a saved line is a real edit, so an emptied box can still be saved.
            FitaiButton(if (saving) "Saving…" else "Save", onClick = { onSave(draft) }, size = ButtonSize.Sm, enabled = dirty && !saving)
        }
    }
}

/** What was done, one row per logged session (WeeklyReviewSessions). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Sessions(review: WeeklyReview) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        CardTitle("What you did", LucideIcons.Check)
        review.gradeSummary?.let { Text(gradeSummaryText(it), style = type.bodySm, color = colors.textMuted) }
        if (review.sessions.isEmpty()) {
            Text(
                if (review.isCurrentWeek) "Nothing logged yet this week." else "No sessions logged this week.",
                style = type.body,
                color = colors.textMuted,
                modifier = Modifier.padding(vertical = Spacing.Md),
            )
        }
        review.sessions.forEachIndexed { index, session ->
            if (index > 0) HorizontalDivider(color = colors.border)
            Column(Modifier.padding(vertical = Spacing.Sm), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text(dayText(session.date), style = type.bodySm, color = colors.textMuted)
                Text(session.focus, style = type.h3, color = colors.text)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    session.durationMin?.let { FitaiBadge("${formatNumber(it)} min") }
                    session.rpe?.let { FitaiBadge("RPE ${formatNumber(it)}") }
                    session.compliancePct?.let { FitaiBadge("${formatNumber(it)}% to plan") }
                    setChanges(session)?.let { FitaiBadge(it) }
                    session.grade?.let { FitaiBadge(gradeLabel(it.intent, it.verdict), tone = gradeTone(it.verdict)) }
                    if (session.planDayId == null) FitaiBadge("Off plan", tone = BadgeTone.Accent)
                }
            }
        }
    }
}

/** The plan's days that weren't done: still to come in a running week, else what didn't happen. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlannedDays(review: WeeklyReview) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        CardTitle(if (review.isCurrentWeek) "Still on the plan" else "What didn't happen", LucideIcons.CalendarRange)
        review.plannedDays.forEachIndexed { index, day ->
            if (index > 0) HorizontalDivider(color = colors.border)
            Column(Modifier.padding(vertical = Spacing.Sm), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text(dayText(day.date), style = type.bodySm, color = colors.textMuted)
                Text(day.focus, style = type.h3, color = colors.textMuted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    FitaiBadge(plannedDayStatus(day))
                    if (day.priority == WeeklyReview.PlannedDaysItem.Priority.Key) FitaiBadge("Key", tone = BadgeTone.Accent)
                    skipReasonLabel(day.skipReason)?.let { FitaiBadge(it) }
                }
            }
        }
    }
}

/**
 * A week with nothing in it: no red, no 0%, no "you missed". It's a start
 * for a new athlete and old news for anyone else (Review.tsx EmptyWeek).
 */
@Composable
private fun EmptyWeek(currentWeek: Boolean) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Icon(LucideIcons.CalendarRange, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(40.dp))
            Text(if (currentWeek) "Nothing logged yet this week" else "Nothing logged this week", style = type.h3, color = colors.text)
            Text(
                if (currentWeek) {
                    "Sessions you log will show up here, alongside how the week compares to the last one."
                } else {
                    "Page back to a week you trained, or start logging — reviews build up from here."
                },
                style = type.body,
                color = colors.textMuted,
            )
        }
    }
}

@Composable
private fun CardTitle(text: String, icon: ImageVector? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        icon?.let { Icon(it, contentDescription = null, tint = FitaiTheme.colors.textMuted, modifier = Modifier.size(16.dp)) }
        Text(text, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
    }
}

/** "Mon, Nov 3". */
private fun dayText(date: String): String = "${shortWeekday(date)}, ${shortDate(date)}"
