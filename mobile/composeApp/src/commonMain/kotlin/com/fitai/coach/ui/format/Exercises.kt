package com.fitai.coach.ui.format

import com.fitai.coach.core.exercises.knownExerciseLabel

private const val CUSTOM_PREFIX = "custom:"

// A "label" that is really a set count the parser left behind ("2x", "3 x").
private val JUNK_LABEL = Regex("^\\s*\\d+\\s*x?\\s*$", RegexOption.IGNORE_CASE)

/**
 * The name to show for an exercise, as the web's getExerciseLabel picks it:
 * the athlete's own label unless it is junk, then the catalogue's label, then
 * the stored name made readable (`sled_push` → "Sled push").
 */
fun exerciseLabel(exerciseName: String, customLabel: String? = null): String {
    customLabel?.trim()?.takeIf { it.isNotEmpty() && !JUNK_LABEL.matches(it) }?.let { return it }
    val name = exerciseName.removePrefix(CUSTOM_PREFIX)
    return knownExerciseLabel(name) ?: name.replace('_', ' ').replaceFirstChar { it.uppercase() }
}
