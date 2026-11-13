package com.fitai.coach.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.PostPlansGenerateRequest.ExperienceLevel
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.dates.PLAN_WEEKDAYS
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDateField
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.format.longDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The AI plan form's fields (the web generator's goal, schedule and details
 * steps on one screen), for setup and for a new plan from the timeline.
 * [overlapping] are the live plans the new one would run over, each with a
 * switch to archive it once the new plan is ready; [cardFacts] is what the
 * athlete card already tells the coach.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AiPlanFields(
    form: PlanForm,
    today: String,
    edit: ((PlanForm) -> PlanForm) -> Unit,
    overlapping: List<TrainingPlan> = emptyList(),
    cardFacts: List<String> = emptyList(),
) {
    FitaiTextField(
        form.goal,
        { v -> edit { it.copy(goal = v.take(MAX_PLAN_TEXT)) } },
        "Goal",
        placeholder = "e.g. complete Hyrox Open in under 90 minutes, or train for my first half marathon",
        supportingText = "${form.goal.length}/$MAX_PLAN_TEXT",
        singleLine = false,
    )
    Label("Training days per week")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        IconButton(onClick = { edit { it.withDaysPerWeek(it.daysPerWeek - 1) } }, enabled = form.daysPerWeek > MIN_DAYS_PER_WEEK) {
            Icon(LucideIcons.ChevronLeft, contentDescription = "fewer days", tint = FitaiTheme.colors.text)
        }
        Text("${form.daysPerWeek} days", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
        IconButton(onClick = { edit { it.withDaysPerWeek(it.daysPerWeek + 1) } }, enabled = form.daysPerWeek < MAX_DAYS_PER_WEEK) {
            Icon(LucideIcons.ChevronRight, contentDescription = "more days", tint = FitaiTheme.colors.text)
        }
    }
    if (form.requiredRestDays > 0) {
        Text(
            "Rest days: pick ${form.requiredRestDays} (${form.restDays.size} chosen)",
            style = FitaiTheme.typography.bodySm,
            color = if (form.hasRestDays) FitaiTheme.colors.textMuted else FitaiTheme.colors.danger,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            PLAN_WEEKDAYS.forEach { day ->
                FitaiChip(day.take(3), selected = day in form.restDays, onClick = { edit { it.toggleRestDay(day) } })
            }
        }
    }
    Label("Experience")
    Options(
        listOf(ExperienceLevel.Beginner, ExperienceLevel.Intermediate, ExperienceLevel.Advanced).map { it.wireValue to it.name },
        form.experience.wireValue,
    ) { v -> edit { f -> f.copy(experience = ExperienceLevel.entries.first { it.wireValue == v }) } }
    FitaiDateField(
        form.startDate,
        { v -> edit { it.copy(startDate = v) } },
        "Start date",
        minDate = today,
        supportingText = aiWeekOneStartNote(form.startDate),
    )
    FitaiDateField(
        form.endDate,
        { v -> edit { it.copy(endDate = v) } },
        if (form.endDateIsRaceDate) "Race date" else "End date",
        minDate = form.startDate,
        error = form.dateError,
    )
    FitaiSwitchRow("The end date is race day", form.endDateIsRaceDate, { on -> edit { it.copy(endDateIsRaceDate = on) } })
    if (overlapping.isNotEmpty()) OverlappingPlans(overlapping, form, edit)
    Label("Focus areas (optional)")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        FOCUS_OPTIONS.forEach { option ->
            FitaiChip(option.label, selected = option.value in form.focusAreas, onClick = { edit { it.toggleFocus(option.value) } })
        }
    }
    if (cardFacts.isNotEmpty()) CardFacts(cardFacts)
    FitaiTextField(
        form.injuries,
        { v -> edit { it.copy(injuries = v.take(MAX_PLAN_TEXT)) } },
        if (cardFacts.isEmpty()) "Injuries or limits (optional)" else "Anything else to program around? (optional)",
        placeholder = "e.g. sore left knee, no running on Tuesdays",
        supportingText = "Each sentence is saved to your athlete card, so the coach remembers it.",
        singleLine = false,
    )
}

/** The plans the new one runs over (the web's "You're already on a plan"), each archived unless kept. */
@Composable
private fun OverlappingPlans(plans: List<TrainingPlan>, form: PlanForm, edit: ((PlanForm) -> PlanForm) -> Unit) {
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(
                if (plans.size == 1) "You're already on a plan" else "You're already on other plans",
                style = FitaiTheme.typography.label,
                color = FitaiTheme.colors.text,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                "Archiving stops the remaining sessions counting towards your adherence. Everything you have already logged is kept.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            plans.forEach { plan ->
                val runsTo = plan.endDate?.let { " (runs to ${longDate(it)})" }.orEmpty()
                FitaiSwitchRow(
                    "Archive ${plan.name}$runsTo",
                    checked = plan.id !in form.keptPlanIds,
                    onCheckedChange = { edit { it.toggleSupersede(plan.id) } },
                )
            }
        }
    }
}

/** What the athlete card already tells the coach, so it isn't typed again. */
@Composable
private fun CardFacts(facts: List<String>) {
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(
                "Your coach already knows",
                style = FitaiTheme.typography.label,
                color = FitaiTheme.colors.text,
                modifier = Modifier.semantics { heading() },
            )
            facts.forEach { Text("• $it", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
            Text("Every plan is written around these.", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        }
    }
}
