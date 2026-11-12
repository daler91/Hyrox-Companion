package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionMealFuelTarget
import com.fitai.coach.core.api.generated.NutritionTarget
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.data.MacroTargets
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.nutrition.ActivityLevel
import com.fitai.coach.core.nutrition.BmrSex
import com.fitai.coach.core.nutrition.MealFuelOverride
import com.fitai.coach.core.nutrition.MealFuelValues
import com.fitai.coach.core.nutrition.MergedMealOverride
import com.fitai.coach.core.nutrition.NutritionTargetInput
import com.fitai.coach.core.nutrition.WeightGoalDirection
import com.fitai.coach.core.nutrition.mergeMealOverride

/** Four typed goals: calories, protein, carbs, fat, as strings (macroTargetForm.tsx). */
data class MacroFields(val calories: String = "", val protein: String = "", val carb: String = "", val fat: String = "") {
    /**
     * The typed goals, or null while one doesn't parse as a number ≥ 0 or
     * [requireOne] and none is set. A blank field is untracked.
     */
    fun parsed(requireOne: Boolean = true): MacroTargets? {
        val texts = listOf(calories, protein, carb, fat).map { it.trim() }
        val values = texts.map { text -> text.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 } }
        val bad = texts.zip(values).any { (text, value) -> text.isNotEmpty() && value == null }
        val (kcal, proteinG, carbG) = values
        return MacroTargets(kcal, proteinG, carbG, values.last()).takeUnless { bad || (requireOne && values.all { it == null }) }
    }
}

/** Goals as the form shows them: blank when unset (targetInputValue). */
fun macroFields(calories: Double?, protein: Double?, carb: Double?, fat: Double?) =
    MacroFields(inputValue(calories), inputValue(protein), inputValue(carb), inputValue(fat))

private fun inputValue(value: Double?): String = value?.let(::jsNumberToString).orEmpty()

/**
 * The daily targets sheet (TargetsDialog.tsx). [current] is the saved version,
 * whose training-load calibration a save carries forward; [profile] is set
 * when the profile has what "Calculate from profile" needs; [typicalLoad] is
 * the athlete's typical daily training load, which load scaling starts from.
 */
data class TargetsSheetState(
    val fields: MacroFields = MacroFields(),
    /** Scale carbs by each day's training load. */
    val periodize: Boolean = false,
    /** Adapt to recent and upcoming training: recovery, pre-loading, taper and race week. */
    val adaptive: Boolean = true,
    val current: NutritionTarget? = null,
    val profile: NutritionTargetInput? = null,
    val typicalLoad: Double? = null,
    /** What "Calculate from profile" worked out, or its warning. */
    val calcNote: String? = null,
    val loading: Boolean = true,
    val saving: Boolean = false,
) {
    /** Load scaling needs a carb goal to scale. */
    val canPeriodize: Boolean get() = fields.parsed(requireOne = false)?.carbG != null

    /** Load scaling is on but starts from a typical load, not the athlete's own. */
    val referenceAssumed: Boolean get() = periodize && (typicalLoad == null || typicalLoad <= 0)
}

/** The sheet on the saved version, or a new one (adaptive on by default). */
fun targetsSheet(current: NutritionTarget?, profile: PreferencesResponse?, typicalLoad: Double?) = TargetsSheetState(
    fields = macroFields(current?.calories, current?.proteinG, current?.carbG, current?.fatG),
    periodize = current?.periodizationEnabled ?: false,
    adaptive = current == null || current.recoveryEnabled || current.phaseAware,
    current = current,
    profile = profile?.targetInput(),
    typicalLoad = typicalLoad,
    loading = false,
)

/** Onboarding's weekly rate for a lose or gain goal with none set (FuellingStep). */
private const val DEFAULT_GOAL_RATE_KG_PER_WEEK = 0.25

/** Bodyweight, height and age. */
private const val BODY_MEASURES = 3

/**
 * The calculator's input from the profile, or null while the profile lacks
 * bodyweight, height, age, activity level or a weight goal. An unset rate on a
 * lose or gain goal takes onboarding's default rather than counting as 0
 * (CL64); maintaining has none.
 */
fun PreferencesResponse.targetInput(): NutritionTargetInput? {
    val activity = ActivityLevel.fromWire(activityLevel)
    val goal = WeightGoalDirection.fromWire(weightGoalDirection)
    val body = listOfNotNull(bodyweightKg, heightCm, age?.toDouble()).takeIf { it.size == BODY_MEASURES }
    if (activity == null || goal == null || body == null) return null
    val (weight, height, years) = body
    val savedRate = weightGoalRateKgPerWeek
    return NutritionTargetInput(
        bodyweightKg = weight,
        heightCm = height,
        ageYears = years,
        sex = BmrSex.fromWire(gender),
        activityLevel = activity,
        goalDirection = goal,
        goalRateKgPerWeek = when {
            goal == WeightGoalDirection.Maintain -> 0.0
            savedRate != null && savedRate > 0 -> savedRate
            else -> DEFAULT_GOAL_RATE_KG_PER_WEEK
        },
    )
}

/**
 * The meal target sheet (MealTargetDialog.tsx): [meal]'s pins. A blank field
 * follows [split], the computed figures the pins replace.
 */
data class MealTargetSheetState(
    val meal: Meal,
    val split: MealFuelValues,
    /** The meal already carries pins, which Reset drops. */
    val overridden: Boolean,
    val fields: MacroFields,
    val saving: Boolean = false,
    val resetting: Boolean = false,
) {
    /** What's typed as pins; null while a field doesn't parse. */
    fun pins(): MealFuelOverride? = fields.parsed()?.let { MealFuelOverride(it.calories, it.carbG, it.proteinG, it.fatG) }

    /** What a save makes the meal read, by the merge the server applies. */
    fun preview(): MergedMealOverride {
        val typed = fields.parsed(requireOne = false)
        return mergeMealOverride(split, MealFuelOverride(typed?.calories, typed?.carbG, typed?.proteinG, typed?.fatG))
    }

    /** All three macros are pinned and set the calories: the calorie field is theirs, not typed. */
    val caloriesLocked: Boolean get() = preview().caloriesFromMacros

    val busy: Boolean get() = saving || resetting
}

/** What [preview] reads, as the fields' placeholders. */
fun MergedMealOverride.placeholders(): MacroFields = macroFields(calories, proteinG, carbG, fatG)

/**
 * The sheet on [meal]'s target. It starts from what is pinned, not from the
 * shown figures, less a calorie pin the pinned macros overrule (C21).
 */
fun mealTargetSheet(meal: Meal, target: NutritionMealFuelTarget): MealTargetSheetState {
    val split = target.suggested?.let { MealFuelValues(it.calories, it.carbG, it.proteinG, it.fatG) }
        ?: MealFuelValues(target.calories, target.carbG, target.proteinG, target.fatG)
    val pins = target.override
    val pinned = pins?.let { MealFuelOverride(it.calories, it.carbG, it.proteinG, it.fatG) }
    val calories = pins?.calories?.takeUnless { pinned != null && mergeMealOverride(split, pinned).caloriesFromMacros }
    return MealTargetSheetState(
        meal = meal,
        split = split,
        overridden = target.isCustom,
        fields = macroFields(calories, pins?.proteinG, pins?.carbG, pins?.fatG),
    )
}

/** The athlete pinned this meal's goals. */
val NutritionMealFuelTarget.isCustom: Boolean get() = USER_OVERRIDE in reasonCodes

/** The meal's caption beside its name (MealSection.tsx): "Custom", or its fuelling role. */
fun NutritionMealFuelTarget.caption(): String? = when {
    isCustom -> "Custom"
    role == NutritionMealFuelTarget.Role.PreWorkoutFastCarbs -> "Pre-workout fuel"
    role == NutritionMealFuelTarget.Role.PostWorkoutRecovery -> "Post-workout refuel"
    role == NutritionMealFuelTarget.Role.FlexRemainder -> "Flexible"
    else -> null
}

private const val USER_OVERRIDE = "user_override"
