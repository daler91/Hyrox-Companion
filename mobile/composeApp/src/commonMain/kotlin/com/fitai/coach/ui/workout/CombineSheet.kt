package com.fitai.coach.ui.workout

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val PREVIEW_LINES = 3

/**
 * Combining this workout with another logged the same day
 * (CombineWorkoutsDialog): pick the other, then what to keep for the title,
 * description and notes. Duration and calories add up; the sets of both move
 * onto the combined workout, which replaces them.
 */
@Composable
fun CombineSheet(
    workout: WorkoutLogDetail,
    candidates: List<TimelineEntry>,
    busy: Boolean,
    onCombine: (other: TimelineEntry, draft: CombineDraft) -> Unit,
    onDismiss: () -> Unit,
) {
    var otherId by remember { mutableStateOf(candidates.firstOrNull()?.workoutLogId) }
    var draft by remember { mutableStateOf(CombineDraft()) }
    val other = candidates.firstOrNull { it.workoutLogId == otherId } ?: return
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text("Combine workouts", style = type.h3, color = colors.text)
            Text(
                "Choose what to keep from each. Both workouts' sets move onto the combined one, which replaces them.",
                style = type.bodySm,
                color = colors.textMuted,
            )
            Text("Combine with", style = type.label, color = colors.textMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                candidates.forEach { candidate ->
                    FitaiChip(candidate.focus, selected = candidate.workoutLogId == otherId, onClick = { otherId = candidate.workoutLogId })
                }
            }
            FieldChooser("Title", draft.title, draft.title.text(workout.focus, other.focus, TITLE_SEPARATOR)) {
                draft = draft.copy(title = it)
            }
            FieldChooser(
                "Description",
                draft.description,
                draft.description.text(workout.mainWorkout, other.mainWorkout, DESCRIPTION_SEPARATOR),
            ) {
                draft = draft.copy(description = it)
            }
            FieldChooser("Notes", draft.notes, draft.notes.text(workout.notes, other.notes, NOTES_SEPARATOR)) {
                draft = draft.copy(notes = it)
            }
            combinedTotals(workout, other)?.let { Text(it, style = type.body, color = colors.text) }
            val combined = combinedWorkout(workout, other, draft)
            FitaiButton(
                "Combine workouts",
                onClick = { onCombine(other, draft) },
                enabled = !busy && combined.focus.isNotBlank(),
                loading = busy,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** One field: where its text comes from, the text that gives, and a box for custom text. */
@Composable
private fun FieldChooser(label: String, choice: FieldChoice, result: String, onChange: (FieldChoice) -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(label, style = type.label, color = colors.text)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FieldPick.entries.forEach { pick ->
                FitaiChip(pick.label, selected = choice.pick == pick, onClick = { onChange(choice.copy(pick = pick)) })
            }
        }
        if (choice.pick == FieldPick.Custom) {
            FitaiTextField(choice.custom, { onChange(choice.copy(custom = it)) }, "Custom ${label.lowercase()}", singleLine = false)
        } else {
            Text(
                result.ifBlank { "(empty)" },
                style = type.bodySm,
                color = colors.textMuted,
                maxLines = PREVIEW_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
