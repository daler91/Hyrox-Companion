package com.fitai.coach.ui.workout

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.core.exercises.normalizeExerciseName
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The canonical names of the library's exercises matching [query], best
 * first: labels that start with it, then labels or names that contain it,
 * then an alias match ("rdl" finds Romanian Deadlift). A blank query lists
 * the whole library in its own order. "custom" is never listed: it is
 * offered separately.
 */
fun searchExercises(query: String): List<String> {
    val library = EXERCISE_DEFINITIONS.filterKeys { it != CUSTOM_EXERCISE }
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return library.keys.toList()
    val label = { name: String -> library.getValue(name).label.lowercase() }
    val starts = library.keys.filter { label(it).startsWith(needle) }
    val contains = library.keys.filter { it !in starts && (label(it).contains(needle) || it.contains(needle.replace(' ', '_'))) }
    val alias = listOfNotNull(normalizeExerciseName(query)?.takeIf { it in library })
    return (starts + contains + alias).distinct()
}

/**
 * Picks an exercise to add: search the library, or add what was typed as a
 * custom exercise (ExerciseTable's add picker).
 */
@Composable
fun ExercisePickerSheet(onPick: (exerciseName: String, customLabel: String?) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val results = remember(query) { searchExercises(query) }
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Text("Add exercise", style = type.h3, color = colors.text)
            FitaiTextField(query, { query = it }, "Search exercises", placeholder = "e.g. wall balls")
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = PICKER_MAX_HEIGHT.dp)) {
                val typed = query.trim()
                if (typed.isNotEmpty()) {
                    item(key = "custom") {
                        PickerRow("Add \"$typed\" as a custom exercise", "custom") { onPick(CUSTOM_EXERCISE, typed) }
                    }
                }
                items(results, key = { it }) { name ->
                    val definition = EXERCISE_DEFINITIONS.getValue(name)
                    PickerRow(definition.label, definition.category) { onPick(name, null) }
                }
            }
        }
    }
}

@Composable
private fun PickerRow(label: String, detail: String, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = Spacing.Md),
    ) {
        Text(label, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
        Text(detail, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

internal const val CUSTOM_EXERCISE = "custom"
private const val PICKER_MAX_HEIGHT = 420
