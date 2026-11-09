package com.fitai.coach.ui.workout

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.format.shortWeekday
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlin.math.abs

/** A plan day a workout can count towards: "Tue Nov 10 · Tempo". */
data class PlanDayOption(val planDayId: String, val date: String, val label: String)

/**
 * The plan days a workout dated [date] could be for (WorkoutPlanDayPicker,
 * narrowed to the ones that matter): days still to do or missed, with no
 * workout yet, within a week either side, nearest first. [linked], the day
 * it already counts towards, is always offered.
 */
fun planDayOptions(entries: List<TimelineEntry>, date: String, linked: String? = null): List<PlanDayOption> = entries
    .filter { entry ->
        val planDayId = entry.planDayId ?: return@filter false
        planDayId == linked || (
            entry.workoutLogId == null &&
                (entry.status == TimelineEntry.Status.Planned || entry.status == TimelineEntry.Status.Missed) &&
                dayDiff(date, entry.date)?.let { abs(it) <= LINK_WINDOW_DAYS } == true
            )
    }
    .distinctBy { it.planDayId }
    .sortedWith(compareBy({ dayDiff(date, it.date)?.let(::abs) ?: Int.MAX_VALUE }, { it.date }))
    .take(MAX_OPTIONS)
    .map { PlanDayOption(it.planDayId!!, it.date, "${shortWeekday(it.date)} ${shortDate(it.date)} · ${it.focus}") }

private const val LINK_WINDOW_DAYS = 7
private const val MAX_OPTIONS = 8

/** Choosing the plan day a workout counts towards, or none. */
@Composable
fun PlanDayPickerSheet(options: List<PlanDayOption>, selected: String?, onPick: (String?) -> Unit, onDismiss: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text("Count it towards a plan day", style = type.h3, color = colors.text)
            Text(
                "Sessions from a week either side that don't have a workout yet.",
                style = type.bodySm,
                color = colors.textMuted,
            )
            if (options.isEmpty()) Text("No plan days near this date.", style = type.body, color = colors.textMuted)
            options.forEach { option -> PickRow(option.label, option.planDayId == selected) { onPick(option.planDayId) } }
            PickRow("Not part of the plan", selected == null) { onPick(null) }
        }
    }
}

@Composable
private fun PickRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        (if (selected) "✓ " else "") + label,
        style = FitaiTheme.typography.body,
        color = if (selected) FitaiTheme.colors.accentText else FitaiTheme.colors.text,
        modifier = Modifier
            .fillMaxWidth()
            .semantics { this.selected = selected }
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = Spacing.Md),
    )
}
