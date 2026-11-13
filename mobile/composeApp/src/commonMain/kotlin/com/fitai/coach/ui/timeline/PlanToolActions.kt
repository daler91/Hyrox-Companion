package com.fitai.coach.ui.timeline

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.data.PlanTools
import com.fitai.coach.core.dates.nextPlanStartDate
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiDateField
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.onboarding.weekOneStartNote
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** What the plan tools do (the timeline's view model). */
class PlanToolActions(
    val rename: (planId: String, name: String) -> Unit,
    val setGoal: (planId: String, goal: String) -> Unit,
    val schedule: (planId: String, startDate: String) -> Unit,
    val setArchived: (plan: TrainingPlan, archived: Boolean) -> Unit,
    val delete: (planId: String) -> Unit,
)

private enum class PlanTool { Menu, Rename, Goal, Schedule, Archive, Delete }

/**
 * Under the selected plan (PlanGoalRow and PlanToolsMenu): its goal, which
 * opens for editing, and the plan's tools. Rename, goal and reschedule each
 * open a sheet; archive, restore and delete ask first.
 */
@Composable
fun PlanToolsRow(plan: TrainingPlan, today: String, actions: PlanToolActions) {
    val colors = FitaiTheme.colors
    var open by remember(plan.id) { mutableStateOf<PlanTool?>(null) }
    val close = { open = null }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Icon(LucideIcons.Target, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
        val goal = plan.goal?.takeIf { it.isNotBlank() }
        Text(
            goal ?: "No plan goal set",
            style = FitaiTheme.typography.bodySm.copy(fontStyle = if (goal == null) FontStyle.Italic else FontStyle.Normal),
            color = colors.textMuted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .clickable(role = Role.Button, onClickLabel = "Edit plan goal") { open = PlanTool.Goal }
                .padding(vertical = Spacing.Xs),
        )
        IconButton(onClick = { open = PlanTool.Menu }) {
            Icon(LucideIcons.Ellipsis, contentDescription = "Plan tools", tint = colors.text)
        }
    }
    when (open) {
        PlanTool.Menu -> PlanToolsSheet(plan, onPick = { open = it }, onDismiss = close)
        PlanTool.Rename -> RenameSheet(plan, onSave = { name ->
            actions.rename(plan.id, name)
            close()
        }, onDismiss = close)
        PlanTool.Goal -> GoalSheet(plan, onSave = { goal ->
            actions.setGoal(plan.id, goal)
            close()
        }, onDismiss = close)
        PlanTool.Schedule -> ScheduleSheet(plan, today, onSchedule = { date ->
            actions.schedule(plan.id, date)
            close()
        }, onDismiss = close)
        PlanTool.Archive -> ArchiveDialog(plan, onConfirm = {
            actions.setArchived(plan, plan.retiredOn == null)
            close()
        }, onDismiss = close)
        PlanTool.Delete -> FitaiDialog(
            title = "Delete training plan?",
            text = "\"${plan.name}\" and all of its workout days are deleted. You can undo straight after.",
            confirmLabel = "Delete",
            onConfirm = {
                actions.delete(plan.id)
                close()
            },
            onDismiss = close,
            destructive = true,
        )
        null -> Unit
    }
}

@Composable
private fun PlanToolsSheet(plan: TrainingPlan, onPick: (PlanTool) -> Unit, onDismiss: () -> Unit) {
    val archived = plan.retiredOn != null
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg)) {
            Text(
                plan.name,
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
                modifier = Modifier.padding(bottom = Spacing.Sm).semantics { heading() },
            )
            ToolRow("Rename plan", LucideIcons.Pencil) { onPick(PlanTool.Rename) }
            ToolRow(if (plan.goal.isNullOrBlank()) "Set goal" else "Edit goal", LucideIcons.Target) { onPick(PlanTool.Goal) }
            ToolRow("Reschedule", LucideIcons.CalendarDays) { onPick(PlanTool.Schedule) }
            ToolRow(if (archived) "Restore plan" else "Archive plan", if (archived) LucideIcons.ArchiveRestore else LucideIcons.Archive) {
                onPick(PlanTool.Archive)
            }
            ToolRow("Delete plan", LucideIcons.Trash, danger = true) { onPick(PlanTool.Delete) }
        }
    }
}

@Composable
private fun ToolRow(label: String, icon: ImageVector, danger: Boolean = false, onClick: () -> Unit) {
    val color = if (danger) FitaiTheme.colors.danger else FitaiTheme.colors.text
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(vertical = Spacing.Md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
        Text(label, style = FitaiTheme.typography.body, color = color)
    }
}

@Composable
private fun RenameSheet(plan: TrainingPlan, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var name by remember(plan.id) { mutableStateOf(plan.name) }
    val trimmed = name.trim()
    ToolSheet("Rename training plan", onDismiss) {
        FitaiTextField(name, { name = it.take(PlanTools.MAX_NAME) }, "Plan name")
        FitaiButton(
            "Save",
            onClick = { onSave(trimmed) },
            enabled = trimmed.isNotEmpty() && trimmed != plan.name,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun GoalSheet(plan: TrainingPlan, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var goal by remember(plan.id) { mutableStateOf(plan.goal.orEmpty()) }
    ToolSheet("Plan goal", onDismiss) {
        FitaiTextField(
            goal,
            { goal = it.take(PlanTools.MAX_GOAL) },
            "What are you training towards?",
            placeholder = "e.g. complete Hyrox in under 90 minutes",
            supportingText = "${goal.length}/${PlanTools.MAX_GOAL}",
            singleLine = false,
        )
        FitaiButton("Save goal", onClick = { onSave(goal) }, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun ScheduleSheet(plan: TrainingPlan, today: String, onSchedule: (String) -> Unit, onDismiss: () -> Unit) {
    var startDate by remember(plan.id) { mutableStateOf(plan.startDate ?: nextPlanStartDate(today)) }
    ToolSheet("Schedule your training plan", onDismiss) {
        Text(
            "Choose when the plan should start. No session is scheduled before this date.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
        FitaiDateField(startDate, { startDate = it }, "Start date", supportingText = weekOneStartNote(startDate))
        FitaiButton(
            "Schedule plan",
            onClick = { onSchedule(startDate) },
            enabled = startDate.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun ArchiveDialog(plan: TrainingPlan, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    if (plan.retiredOn == null) {
        FitaiDialog(
            title = "Archive this plan?",
            text = "Its remaining sessions stop counting towards your adherence from today, and drop off the all-plans timeline. " +
                "Everything you have already logged is kept.",
            confirmLabel = "Archive",
            onConfirm = onConfirm,
            onDismiss = onDismiss,
        )
    } else {
        FitaiDialog(
            title = "Restore this plan?",
            text = "Its past sessions will count towards your adherence again, and any that have already gone by will be marked missed.",
            confirmLabel = "Restore",
            onConfirm = onConfirm,
            onDismiss = onDismiss,
        )
    }
}

@Composable
private fun ToolSheet(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text(title, style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
            content()
        }
    }
}

/** A plan's chip: its name and length, and "archived" once it's been put away. */
fun planChipLabel(plan: TrainingPlan): String = "${plan.name} (${plan.totalWeeks} wk)" + if (plan.retiredOn != null) " · archived" else ""
