package com.fitai.coach.core.exercises

import com.fitai.coach.core.exercises.generated.BARBELL_STEPS
import com.fitai.coach.core.exercises.generated.EXERCISE_EQUIPMENT
import com.fitai.coach.core.exercises.generated.IMPLEMENT_OVERRIDES
import com.fitai.coach.core.exercises.generated.INCREMENTS
import com.fitai.coach.core.exercises.generated.LOADED_IMPLEMENTS

/*
 * What an exercise is loaded with, and the smallest jump that load comes in.
 * Ported from shared/exerciseEquipment.ts; the tables are generated from it.
 */

/** `Implement` (shared/exerciseEquipment.ts). [wireValue] is the TypeScript string. */
public enum class Implement(public val wireValue: String) {
    Barbell("barbell"),
    Dumbbell("dumbbell"),
    Kettlebell("kettlebell"),
    Machine("machine"),
    Bodyweight("bodyweight"),
}

/** `ImplementSteps` (shared/exerciseEquipment.ts): one implement's smallest jump, per unit. */
internal data class ImplementSteps(val kg: Double, val lbs: Double)

/**
 * Port of `implementFor`: how an exercise (a canonical name) is loaded. The
 * override table first, then the first of barbell, dumbbell, kettlebell and
 * machine its equipment lists, else barbell, which is also the answer for an
 * unknown name.
 *
 * Null exactly where the TypeScript returns something that is not an
 * implement: for a name inherited from Object.prototype ("constructor",
 * "toString", "__proto__", …), `IMPLEMENT_OVERRIDES[exercise]` finds the
 * inherited function or object. [loadIncrement] then falls back to barbell
 * steps, and progression treats the exercise as not plate-loaded.
 */
public fun implementFor(exercise: String): Implement? {
    if (exercise in JS_OBJECT_PROTOTYPE_KEYS) return null
    IMPLEMENT_OVERRIDES[exercise]?.let { return it }
    val equipment = EXERCISE_EQUIPMENT[exercise].orEmpty()
    return LOADED_IMPLEMENTS.firstOrNull { it.wireValue in equipment } ?: Implement.Barbell
}

/**
 * Port of `loadIncrement`: the smallest weight jump for the exercise's
 * implement. [unit] "kg" gives kilograms; any other value pounds, as in the
 * TypeScript (`unit === "kg" ? steps.kg : steps.lbs`). Bodyweight work, and
 * anything [implementFor] cannot name, steps like a barbell.
 */
public fun loadIncrement(exercise: String, unit: String): Double {
    val steps = implementFor(exercise)?.let { INCREMENTS[it] } ?: BARBELL_STEPS
    return if (unit == "kg") steps.kg else steps.lbs
}
