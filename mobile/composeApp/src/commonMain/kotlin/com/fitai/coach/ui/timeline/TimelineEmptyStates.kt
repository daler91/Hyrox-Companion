package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The plan to give a start date from the empty timeline (TimelineEmptyState):
 * the one picked, else the first without dates, else the first.
 */
fun planToSchedule(plans: List<TrainingPlan>, selectedPlanId: String?): String? =
    selectedPlanId ?: plans.firstOrNull { it.startDate == null }?.id ?: plans.firstOrNull()?.id

/**
 * The plan to start when the timeline shows nothing at all but there is a
 * plan (ReadyEmptyState): nothing on any day or beyond the days shown, and no
 * status filter, which has its own empty state. Null otherwise.
 */
fun TimelineUiState.planReadyToStart(): String? {
    val nothingShown = rows.days.all { it.entries.isEmpty() && it.annotations.isEmpty() } &&
        rows.hiddenPast == 0 && rows.hiddenUpcoming == 0 && !hasOlder
    val ready = nothingShown && statusFilter == null && plans.isNotEmpty() && !refreshing
    return if (ready) planToSchedule(plans, selectedPlanId) else null
}

/** A plan with nothing on the calendar yet (ReadyEmptyState): set its start date, or log a note. */
@Composable
fun ReadyToStart(onSetStartDate: () -> Unit, onLogNote: () -> Unit) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = Spacing.Md),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(LucideIcons.CalendarDays, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(40.dp))
            Text(
                "Ready to start training",
                style = FitaiTheme.typography.h3,
                color = colors.text,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                "Set a start date for your plan to schedule workouts on your calendar.",
                style = FitaiTheme.typography.body,
                color = colors.textMuted,
                textAlign = TextAlign.Center,
            )
            FitaiButton("Set start date", onClick = onSetStartDate, leadingIcon = LucideIcons.CalendarDays)
            FitaiButton("Log a note", onClick = onLogNote, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.StickyNote)
        }
    }
}

/** Where today's row is, once it has scrolled out of sight. */
enum class TodayDirection { Above, Below }

/**
 * Where today's row [todayItem] lies from what the list shows: null while any
 * of it is in sight ([visible], every item on screen) or when there is no
 * today row; else above or below [firstVisible], the first item scrolled to.
 */
fun todayDirection(todayItem: Int, firstVisible: Int, visible: Set<Int>): TodayDirection? = when {
    todayItem < 0 || visible.isEmpty() || todayItem in visible -> null
    todayItem < firstVisible -> TodayDirection.Above
    else -> TodayDirection.Below
}

/**
 * The pill back to today (TimelineTodayIndicator), shown once today's row is
 * scrolled away: an arrow towards it, and "Today".
 */
@Composable
fun TodayPill(direction: TodayDirection, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = FitaiTheme.colors
    val label = if (direction == TodayDirection.Above) "Today is above" else "Today is below"
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = colors.primary,
        contentColor = colors.onPrimary,
        shadowElevation = 6.dp,
        modifier = modifier.semantics { contentDescription = "$label — jump to today" },
    ) {
        Row(
            Modifier.padding(horizontal = Spacing.Lg, vertical = Spacing.Sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val arrow = if (direction == TodayDirection.Above) LucideIcons.ArrowUp else LucideIcons.ArrowDown
            Icon(arrow, contentDescription = null, modifier = Modifier.size(16.dp))
            Icon(LucideIcons.CalendarCheck, contentDescription = null, modifier = Modifier.size(16.dp))
            Text("Today", style = FitaiTheme.typography.label, modifier = Modifier.clearAndSetSemantics { })
        }
    }
}
