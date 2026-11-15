package com.fitai.coach.ui.onboarding

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.nutrition.ActivityLevel
import com.fitai.coach.core.nutrition.BmrSex
import com.fitai.coach.core.nutrition.NutritionTargetInput
import com.fitai.coach.core.nutrition.WeightGoalDirection
import com.fitai.coach.core.units.cmToFtIn
import com.fitai.coach.core.units.convertWeight
import com.fitai.coach.core.units.ftInToCm

// Setup's optional fuelling step (FuellingStep.tsx, useOnboardingWizard.ts):
// a body profile, and the daily targets it suggests.

/** A lose or gain goal set here starts at this rate (kg a week); Settings refines it. */
const val DEFAULT_GOAL_RATE_KG_PER_WEEK = 0.25

private const val TENTHS = 10.0
private val BODYWEIGHT_KG = 30.0..300.0
private val HEIGHT_CM = 120.0..250.0
private val AGE_YEARS = 13..100

private fun round1(value: Double): Double = jsRound(value * TENTHS) / TENTHS

val ACTIVITY_OPTIONS: List<Pair<ActivityLevel, String>> = listOf(
    ActivityLevel.Sedentary to "Sedentary — desk job, little other exercise",
    ActivityLevel.Light to "Lightly active — 1–2 sessions a week",
    ActivityLevel.Moderate to "Moderately active — 3–4 sessions a week",
    ActivityLevel.Active to "Active — 5–6 sessions a week",
    ActivityLevel.VeryActive to "Very active — daily hard training",
)

val WEIGHT_GOAL_OPTIONS: List<Pair<WeightGoalDirection, String>> = listOf(
    WeightGoalDirection.Lose to "Lose weight",
    WeightGoalDirection.Maintain to "Maintain",
    WeightGoalDirection.Gain to "Gain muscle",
)

/** What is saved of the body profile, as the step compares and keeps it. */
data class SavedBody(
    val bodyweightKg: Double? = null,
    val heightCm: Double? = null,
    val age: Int? = null,
    val activityLevel: ActivityLevel? = null,
    val goalDirection: WeightGoalDirection? = null,
    val goalRateKgPerWeek: Double? = null,
) {
    companion object {
        fun from(prefs: PreferencesResponse?): SavedBody = SavedBody(
            bodyweightKg = prefs?.bodyweightKg,
            heightCm = prefs?.heightCm,
            age = prefs?.age,
            activityLevel = ActivityLevel.fromWire(prefs?.activityLevel),
            goalDirection = WeightGoalDirection.fromWire(prefs?.weightGoalDirection),
            goalRateKgPerWeek = prefs?.weightGoalRateKgPerWeek,
        )
    }
}

/** A saved bodyweight as the field shows it: in [weightUnit], to one decimal (bodyweightInput). */
fun bodyweightInput(bodyweightKg: Double?, weightUnit: String): String =
    bodyweightKg?.let { jsNumberToString(round1(convertWeight(it, "kg", weightUnit))) }.orEmpty()

/**
 * The step's fields as typed. A height is typed in centimetres, or in feet
 * and inches by an athlete who weighs in pounds. Age and sex are the units
 * step's, so they live on [SetupProfile].
 */
data class FuellingFields(
    val bodyweight: String = "",
    val heightCm: String = "",
    val heightFt: String = "",
    val heightIn: String = "",
    val activityLevel: ActivityLevel? = null,
    val goalDirection: WeightGoalDirection = WeightGoalDirection.Maintain,
) {
    /** The height in centimetres, to one decimal, or null while blank or not a height. */
    fun heightCmValue(imperial: Boolean): Double? = if (imperial) imperialHeightCm() else heightCm.positive()

    /** Feet and inches, either of which may be left blank (as 0), but not both. */
    private fun imperialHeightCm(): Double? {
        if (heightFt.isBlank() && heightIn.isBlank()) return null
        val feet = heightFt.trim().ifEmpty { "0" }.toDoubleOrNull()?.takeIf { it >= 0 }
        val inches = heightIn.trim().ifEmpty { "0" }.toDoubleOrNull()?.takeIf { it >= 0 }
        return if (feet != null && inches != null) round1(ftInToCm(feet, inches)).takeIf { it > 0 } else null
    }

    companion object {
        /**
         * The fields from what is saved: the bodyweight in the unit shown, and
         * a weight goal of "lose" for an athlete who picked "Lose weight" and
         * has none saved.
         */
        fun from(saved: SavedBody, weightUnit: String, goalId: String): FuellingFields {
            val feetInches = saved.heightCm?.let(::cmToFtIn)
            return FuellingFields(
                bodyweight = bodyweightInput(saved.bodyweightKg, weightUnit),
                heightCm = saved.heightCm?.let { jsNumberToString(round1(it)) }.orEmpty(),
                heightFt = feetInches?.let { jsNumberToString(it.feet) }.orEmpty(),
                heightIn = feetInches?.let { jsNumberToString(it.inches) }.orEmpty(),
                activityLevel = saved.activityLevel,
                goalDirection =
                saved.goalDirection ?: if (goalId == "weight_loss") WeightGoalDirection.Lose else WeightGoalDirection.Maintain,
            )
        }
    }
}

private fun String.positive(): Double? = trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }

/**
 * Port of `parseFuellingProfile`: the fields as a target input, or null while
 * any is missing or implausible (a mistyped bodyweight must not suggest an
 * absurd target). The age is a whole number, as the server stores it.
 */
fun parseFuellingProfile(fields: FuellingFields, profile: SetupProfile): NutritionTargetInput? {
    val bodyweightKg = fields.bodyweight.positive()?.let { round1(convertWeight(it, profile.weightUnit, "kg")) }?.takeIf {
        it in
            BODYWEIGHT_KG
    }
    val height = fields.heightCmValue(profile.weightUnit == "lbs")?.takeIf { it in HEIGHT_CM }
    val age = profile.age.positive()?.takeIf { it == jsRound(it) && it.toInt() in AGE_YEARS }
    val body = bodyweightKg?.let { kg -> height?.let { cm -> age?.let { years -> Triple(kg, cm, years) } } }
    val activity = fields.activityLevel
    if (body == null || activity == null) return null
    val (kg, cm, years) = body
    return NutritionTargetInput(
        bodyweightKg = kg,
        heightCm = cm,
        ageYears = years,
        sex = BmrSex.fromWire(profile.gender),
        activityLevel = activity,
        goalDirection = fields.goalDirection,
        goalRateKgPerWeek = if (fields.goalDirection == WeightGoalDirection.Maintain) 0.0 else DEFAULT_GOAL_RATE_KG_PER_WEEK,
    )
}

/**
 * Port of `resolveFuellingProfile`: what the step previews and saves. An
 * untouched bodyweight keeps its exact saved kilograms (not the rounded figure
 * shown), and an unchanged lose or gain goal keeps the weekly rate set in
 * Settings, which this step doesn't show.
 */
fun resolveFuellingProfile(fields: FuellingFields, profile: SetupProfile, saved: SavedBody): NutritionTargetInput? {
    val parsed = parseFuellingProfile(fields, profile) ?: return null
    val savedKg = saved.bodyweightKg
    val savedRate = saved.goalRateKgPerWeek
    val keepRate = parsed.goalDirection != WeightGoalDirection.Maintain && parsed.goalDirection == saved.goalDirection &&
        savedRate != null && savedRate > 0
    return parsed.copy(
        bodyweightKg = if (savedKg != null &&
            fields.bodyweight == bodyweightInput(savedKg, profile.weightUnit)
        ) {
            savedKg
        } else {
            parsed.bodyweightKg
        },
        goalRateKgPerWeek = if (keepRate && savedRate != null) savedRate else parsed.goalRateKgPerWeek,
    )
}

/** Whether [input] is what is saved, field for field (isSavedFuellingProfile). */
fun isSavedFuellingProfile(input: NutritionTargetInput, saved: SavedBody): Boolean =
    input.bodyweightKg == saved.bodyweightKg &&
        input.heightCm == saved.heightCm &&
        input.ageYears == saved.age?.toDouble() &&
        input.activityLevel == saved.activityLevel &&
        input.goalDirection == saved.goalDirection

/** The profile as a preferences change. */
fun NutritionTargetInput.toPreferences(): UpdateUserPreferences = UpdateUserPreferences(
    bodyweightKg = Patch.of(bodyweightKg),
    heightCm = Patch.of(heightCm),
    age = Patch.of(ageYears.toInt()),
    activityLevel = Patch.of(UpdateUserPreferences.ActivityLevel.entries.firstOrNull { it.wireValue == activityLevel.wireValue }),
    weightGoalDirection = Patch.of(
        UpdateUserPreferences.WeightGoalDirection.entries.firstOrNull {
            it.wireValue == goalDirection.wireValue
        },
    ),
    weightGoalRateKgPerWeek = Patch.of(goalRateKgPerWeek),
)

/**
 * A typed bodyweight in another unit, to one decimal (convertTypedWeight), so
 * switching kilograms and pounds keeps the weight; as typed when blank or not
 * a weight.
 */
fun convertTypedWeight(typed: String, from: String, to: String): String {
    val value = typed.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }
    return if (from == to || value == null) typed else jsNumberToString(round1(convertWeight(value, from, to)))
}

/** The profile, as saved once it is. */
fun NutritionTargetInput.toSavedBody(): SavedBody =
    SavedBody(bodyweightKg, heightCm, ageYears.toInt(), activityLevel, goalDirection, goalRateKgPerWeek)
