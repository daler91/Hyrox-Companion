package com.fitai.coach.core.exercises

import com.fitai.coach.core.js.jsTrim
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.core.exercises.generated.EXERCISE_NAME_ALIASES

/*
 * The exercise catalogue's lookups, ported from shared/schema/exercises.ts.
 * The tables are generated from the TypeScript (generated/ExerciseCatalogue.kt,
 * script/kotlin-catalogue); exercise names, categories and fields are the
 * same strings the API carries.
 */

/**
 * An entry of `EXERCISE_DEFINITIONS` (shared/schema/exercises.ts), without
 * `muscleGroups`.
 *
 * @property label the display label, e.g. "Back Squat".
 * @property category "functional", "running", "strength" or "conditioning".
 * @property fields what a set of it logs, in display order: "sets", "reps",
 *   "weight", "distance", "time".
 */
public data class ExerciseDefinition(
    val label: String,
    val category: String,
    val fields: List<String>,
)

/**
 * Port of `normalizeExerciseName`: the canonical exercise name a free-text
 * name stands for, directly or through `EXERCISE_NAME_ALIASES`, or null.
 *
 * The text is slugged first ("Farmer's Carry" → "farmers_carry"). Like the
 * TypeScript, a name that slugs to "constructor" returns "constructor",
 * because the original tests membership with the `in` operator, which sees
 * Object.prototype. The TypeScript's memo cache is not ported: it never
 * changes a result.
 */
public fun normalizeExerciseName(raw: String): String? = resolveExerciseSlug(slugifyExerciseName(raw))

/**
 * Port of `isRunningExerciseName`: whether the name resolves to an exercise
 * whose category is "running".
 */
public fun isRunningExerciseName(exerciseName: String): Boolean {
    val normalized = normalizeExerciseName(exerciseName) ?: return false
    return EXERCISE_DEFINITIONS[normalized]?.category == "running"
}

/**
 * Port of `knownExerciseLabel`: a canonical exercise name's display label;
 * null for a custom or unrecognised name. Not normalised: "Back Squat" is null.
 */
public fun knownExerciseLabel(exerciseName: String): String? = EXERCISE_DEFINITIONS[exerciseName]?.label

/** Port of `isAsciiAlphanumeric`: a-z or 0-9 (the text is already lowercased). */
private fun isAsciiAlphanumeric(char: Char): Boolean = char in 'a'..'z' || char in '0'..'9'

/**
 * Port of `slugifyExerciseName`: lowercase ASCII alphanumerics joined by single
 * underscores, apostrophes (' and ’) dropped, no leading or trailing underscore.
 *
 * It walks UTF-16 units where the TypeScript walks code points. That gives the
 * same slug: every unit of a surrogate pair is a non-alphanumeric separator,
 * and consecutive separators collapse to one underscore. `lowercase()` is the
 * same locale-independent full mapping as JS `toLowerCase()` ("İ" becomes "i"
 * plus U+0307, the Kelvin sign becomes "k"); the fixtures pin both.
 */
private fun slugifyExerciseName(raw: String): String {
    val normalized = StringBuilder()
    var previousWasSeparator = false

    for (char in jsTrim(raw).lowercase()) {
        if (isAsciiAlphanumeric(char)) {
            normalized.append(char)
            previousWasSeparator = false
            continue
        }

        if (char == '\'' || char == '’') continue

        if (!previousWasSeparator && normalized.isNotEmpty()) {
            normalized.append('_')
            previousWasSeparator = true
        }
    }

    return if (normalized.endsWith("_")) normalized.substring(0, normalized.length - 1) else normalized.toString()
}

/** Port of `resolveExerciseSlug`. */
private fun resolveExerciseSlug(slug: String): String? {
    if (slug.isEmpty()) return null
    // `slug in EXERCISE_DEFINITIONS` also sees inherited members; "constructor" is the one a slug can spell.
    if (slug in EXERCISE_DEFINITIONS || slug in JS_OBJECT_PROTOTYPE_KEYS) return slug
    return EXERCISE_NAME_ALIASES[slug]
}

