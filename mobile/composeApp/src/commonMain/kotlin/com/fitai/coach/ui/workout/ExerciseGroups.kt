package com.fitai.coach.ui.workout

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** One exercise's sets, as a workout or plan day lists them. */
data class ExerciseGroup(val exerciseName: String, val customLabel: String?, val sets: List<ExerciseSetRow>) {
    val key: String get() = "$exerciseName|$customLabel"
    val label: String get() = exerciseLabel(exerciseName, customLabel)
}

/** The sets grouped by exercise (and custom label), in the order each exercise first appears. */
fun exerciseGroups(sets: List<ExerciseSetRow>): List<ExerciseGroup> =
    sets.groupBy { it.exerciseName to it.customLabel }.map { (key, rows) -> ExerciseGroup(key.first, key.second, rows) }

/**
 * Every set id in the order that moves exercise [index] by [offset] (-1 up,
 * 1 down), for a set-order request; null when it can't move that way.
 */
fun reorderedSetIds(groups: List<ExerciseGroup>, index: Int, offset: Int): List<String>? {
    val target = index + offset
    if (index !in groups.indices || target !in groups.indices) return null
    val reordered = groups.toMutableList().apply { add(target, removeAt(index)) }
    return reordered.flatMap { group -> group.sets.map { it.id } }
}

/** Moving an exercise up or down its list; null where it can't go. */
class GroupMove(val up: (() -> Unit)?, val down: (() -> Unit)?)

/**
 * An exercise and its sets: tap a set to edit it, add another, move the
 * exercise up or down. [header] goes under the name (last time, next target).
 */
@Composable
fun ExerciseGroupCard(
    group: ExerciseGroup,
    busy: Boolean,
    onEditSet: (ExerciseSetRow) -> Unit,
    onAddSet: (List<ExerciseSetRow>) -> Unit,
    move: GroupMove,
    header: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(group.label, style = type.h3, color = colors.text, modifier = Modifier.weight(1f))
            move.up?.let { up ->
                IconButton(onClick = up, enabled = !busy) {
                    Icon(
                        LucideIcons.ChevronRight,
                        contentDescription = "move ${group.label} up",
                        tint = colors.textMuted,
                        modifier = Modifier.rotate(UP),
                    )
                }
            }
            move.down?.let { down ->
                IconButton(onClick = down, enabled = !busy) {
                    Icon(
                        LucideIcons.ChevronRight,
                        contentDescription = "move ${group.label} down",
                        tint = colors.textMuted,
                        modifier = Modifier.rotate(DOWN),
                    )
                }
            }
        }
        header()
        group.sets.forEach { set ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClickLabel = "edit set ${set.setNumber}") { onEditSet(set) }
                    .padding(vertical = Spacing.Sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Set ${set.setNumber}", style = type.label, color = colors.textMuted, modifier = Modifier.weight(SET_LABEL_WEIGHT))
                Text(setSummary(set), style = type.body, color = colors.text, modifier = Modifier.weight(1f))
            }
        }
        FitaiButton(
            "Add set",
            onClick = { onAddSet(group.sets) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = !busy,
            leadingIcon = LucideIcons.Plus,
        )
    }
}

internal fun String.toIntPatch(): Patch<Int> = if (isBlank()) Patch.clear() else Patch.of(trim().toDouble().toInt())

internal fun String.toDoublePatch(): Patch<Double> = if (isBlank()) Patch.clear() else Patch.of(trim().toDouble())

private const val SET_LABEL_WEIGHT = 0.3f
private const val UP = -90f
private const val DOWN = 90f

/** One set's values, with Save and Delete (the workout detail and plan-day editors). */
@Composable
fun SetEditorSheet(set: ExerciseSetRow, onSave: (SetEdit) -> Unit, onDelete: () -> Unit, onDismiss: () -> Unit) {
    var edit by remember(set.id) {
        mutableStateOf(
            SetEdit(
                reps = set.reps?.toString().orEmpty(),
                weight = editableNumber(set.weight),
                distance = editableNumber(set.distance),
                time = editableNumber(set.time),
            ),
        )
    }
    // The fields the exercise logs, plus any the set already has a value for.
    val logged = EXERCISE_DEFINITIONS[set.exerciseName]?.fields
    val shows = { field: String, value: String -> logged == null || field in logged || value.isNotBlank() }
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Text(
                "${exerciseLabel(set.exerciseName, set.customLabel)} · set ${set.setNumber}",
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
            )
            if (shows("reps", edit.reps)) {
                FitaiTextField(edit.reps, {
                    edit = edit.copy(reps = it)
                }, "Reps", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            if (shows("weight", edit.weight)) {
                FitaiTextField(edit.weight, {
                    edit = edit.copy(weight = it)
                }, "Weight (${set.weightUnit ?: "kg"})", keyboardOptions = number)
            }
            if (shows("distance", edit.distance)) {
                FitaiTextField(edit.distance, {
                    edit = edit.copy(distance = it)
                }, "Distance (${if (set.distanceUnit == "ft") "ft" else "m"})", keyboardOptions = number)
            }
            if (shows("time", edit.time)) {
                FitaiTextField(edit.time, { edit = edit.copy(time = it) }, "Time (min)", keyboardOptions = number)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm), verticalAlignment = Alignment.CenterVertically) {
                FitaiButton("Delete set", onClick = onDelete, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.Trash)
                FitaiButton("Save", onClick = { onSave(edit) }, enabled = edit.isValid(), modifier = Modifier.weight(1f))
            }
        }
    }
}
