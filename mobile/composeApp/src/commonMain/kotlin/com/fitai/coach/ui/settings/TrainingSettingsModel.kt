package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.api.generated.UpdateUserPreferences.ActivityLevel
import com.fitai.coach.core.api.generated.UpdateUserPreferences.MafCategory
import com.fitai.coach.core.api.generated.UpdateUserPreferences.WeightGoalDirection
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.units.cmToFtIn
import com.fitai.coach.core.units.ftInToCm
import com.fitai.coach.core.units.kgToUserWeight
import com.fitai.coach.core.units.userWeightToKg
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

// Settings → Training (the web's Training tab): the forms' rules, what each
// saves, and the training style with its MAF setup.

/** A numeric preference's allowed range, as the server's schema has it (shared/preferenceBounds.ts). */
data class NumberBound(val min: Double, val max: Double, val minExclusive: Boolean = false, val integer: Boolean = false)

object PreferenceBounds {
    val Age = NumberBound(13.0, 100.0, integer = true)
    val BodyweightKg = NumberBound(0.0, 500.0, minExclusive = true)
    val HeightCm = NumberBound(0.0, 300.0, minExclusive = true)
    val RestingHr = NumberBound(30.0, 120.0, integer = true)
    val MaxHr = NumberBound(120.0, 230.0, integer = true)
    val Ftp = NumberBound(50.0, 600.0, integer = true)
    val WeightRateKg = NumberBound(0.0, 2.0)
    val MafAge = NumberBound(16.0, 99.0, integer = true)
}

/**
 * Why [value] can't be saved as [label], in the units it is shown in
 * (preferencesValidation.ts), or null when it is in range. [show] writes a
 * bound in those units.
 */
fun boundError(value: Double, bound: NumberBound, label: String, show: (Double) -> String = { jsNumberToString(it) }): String? = when {
    bound.integer && value != value.roundToInt().toDouble() -> "$label must be a whole number."
    bound.minExclusive && value <= bound.min -> "$label must be more than ${show(bound.min)}."
    !bound.minExclusive && value < bound.min -> "$label must be at least ${show(bound.min)}."
    value > bound.max -> "$label must be ${show(bound.max)} or less."
    else -> null
}

/** A typed number: blank clears it; anything else must read as a number. */
private fun String.parsed(): Double? = trim().takeIf { it.isNotEmpty() }?.toDoubleOrNull()

/** Why a typed [text] can't be saved; blank is fine (it clears the value). */
fun fieldError(text: String, bound: NumberBound, label: String, unit: String? = null): String? {
    val value = text.parsed()
    return when {
        text.isBlank() -> null
        value == null -> "$label must be a number."
        else -> boundError(value, bound, label) { b -> listOfNotNull(jsNumberToString(b), unit).joinToString(" ") }
    }
}

private fun Double.oneDecimal(): String = jsNumberToString((this * TENTHS).roundToInt() / TENTHS)

private const val TENTHS = 10.0

/** A changed field as a patch value: null when blank. */
private fun String.asInt(): Int? = parsed()?.roundToInt()

/** Race profile (AthleteProfileCard): division, gender and age, for the Race Predictor. */
data class RaceProfileForm(val division: String, val gender: String, val age: String) {
    val ageError: String? get() = fieldError(age, PreferenceBounds.Age, "Age")

    /** Only what changed from [saved]; a cleared age is sent as null. */
    fun patch(saved: RaceProfileForm) = UpdateUserPreferences(
        division = UpdateUserPreferences.Division.entries.firstOrNull { it.wireValue == division }.takeIf { division != saved.division },
        gender = if (gender !=
            saved.gender
        ) {
            Patch.of(UpdateUserPreferences.Gender.entries.firstOrNull { it.wireValue == gender })
        } else {
            Patch.Absent
        },
        age = if (age.trim() != saved.age) Patch.of(age.asInt()) else Patch.Absent,
    )

    companion object {
        fun from(prefs: PreferencesResponse) = RaceProfileForm(
            division = if (prefs.division == "pro") "pro" else "open",
            gender = prefs.gender?.takeIf { g -> UpdateUserPreferences.Gender.entries.any { it.wireValue == g } } ?: "prefer_not_to_say",
            age = prefs.age?.toString().orEmpty(),
        )
    }
}

val DIVISIONS = listOf("open" to "Open", "pro" to "Pro")
val GENDERS = listOf("male" to "Men", "female" to "Women", "prefer_not_to_say" to "Prefer not to say")
val ACTIVITY_LEVELS = listOf(
    ActivityLevel.Sedentary to "Sedentary",
    ActivityLevel.Light to "Light",
    ActivityLevel.Moderate to "Moderate",
    ActivityLevel.Active to "Active",
    ActivityLevel.VeryActive to "Very active",
)
val WEIGHT_GOALS =
    listOf(WeightGoalDirection.Lose to "Lose", WeightGoalDirection.Maintain to "Maintain", WeightGoalDirection.Gain to "Gain")

/**
 * Body composition (BodyCompositionCard), as typed: bodyweight and the
 * weekly rate in the athlete's weight unit, height in centimetres or, in
 * pounds, feet and inches. Saved in kilograms and centimetres.
 */
data class BodyForm(
    val unit: String,
    val weight: String,
    val heightCm: String,
    val heightFt: String,
    val heightIn: String,
    val activity: String,
    val goal: String,
    val rate: String,
) {
    val imperial: Boolean get() = unit == "lbs"

    /** The weekly rate only means something when losing or gaining. */
    val showsRate: Boolean get() = goal == WeightGoalDirection.Lose.wireValue || goal == WeightGoalDirection.Gain.wireValue

    val weightError: String? get() = weightFieldError(weight, PreferenceBounds.BodyweightKg, "Bodyweight")
    val rateError: String? get() = if (showsRate) weightFieldError(rate, PreferenceBounds.WeightRateKg, "Weekly rate") else null
    val heightError: String?
        get() = if (imperial) {
            val parts = listOf(heightFt, heightIn).filter { it.isNotBlank() }
            when {
                parts.isEmpty() -> null
                parts.any { (it.parsed() ?: -1.0) < 0 } -> "Height must be feet and inches."
                else -> heightCmValue()?.let { boundError(it, PreferenceBounds.HeightCm, "Height") { b -> "${jsNumberToString(b)} cm" } }
            }
        } else {
            fieldError(heightCm, PreferenceBounds.HeightCm, "Height", "cm")
        }
    val hasErrors: Boolean get() = listOfNotNull(weightError, rateError, heightError).isNotEmpty()

    private fun weightFieldError(text: String, bound: NumberBound, label: String): String? {
        val shown = text.parsed()
        return when {
            text.isBlank() -> null
            shown == null -> "$label must be a number."
            else -> boundError(userWeightToKg(shown, unit), bound, label) { kg -> "${kgToUserWeight(kg, unit).oneDecimal()} $unit" }
        }
    }

    private fun heightCmValue(): Double? = if (imperial) {
        if (heightFt.isBlank() && heightIn.isBlank()) null else ftInToCm(heightFt.parsed() ?: 0.0, heightIn.parsed() ?: 0.0)
    } else {
        heightCm.parsed()
    }

    /** Only the fields whose text changed from [saved]; a cleared one is sent as null. */
    fun patch(saved: BodyForm) = UpdateUserPreferences(
        bodyweightKg = if (weight.trim() != saved.weight) Patch.of(weight.parsed()?.let { userWeightToKg(it, unit) }) else Patch.Absent,
        heightCm = if (heightChanged(saved)) Patch.of(heightCmValue()) else Patch.Absent,
        activityLevel = if (activity !=
            saved.activity
        ) {
            Patch.of(ActivityLevel.entries.firstOrNull { it.wireValue == activity })
        } else {
            Patch.Absent
        },
        weightGoalDirection = if (goal != saved.goal) {
            Patch.of(WeightGoalDirection.entries.firstOrNull { it.wireValue == goal })
        } else {
            Patch.Absent
        },
        weightGoalRateKgPerWeek = if (rate.trim() !=
            saved.rate
        ) {
            Patch.of(rate.parsed()?.let { userWeightToKg(it, unit) })
        } else {
            Patch.Absent
        },
    )

    private fun heightChanged(saved: BodyForm): Boolean =
        if (imperial) heightFt.trim() != saved.heightFt || heightIn.trim() != saved.heightIn else heightCm.trim() != saved.heightCm

    companion object {
        fun from(prefs: PreferencesResponse): BodyForm {
            val unit = if (prefs.weightUnit == "lbs") "lbs" else "kg"
            val feetInches = prefs.heightCm?.let(::cmToFtIn)
            return BodyForm(
                unit = unit,
                weight = prefs.bodyweightKg?.let { kgToUserWeight(it, unit).oneDecimal() }.orEmpty(),
                heightCm = prefs.heightCm?.oneDecimal().orEmpty(),
                heightFt = feetInches?.feet?.let(::jsNumberToString).orEmpty(),
                heightIn = feetInches?.inches?.let(::jsNumberToString).orEmpty(),
                activity = prefs.activityLevel.orEmpty(),
                goal = prefs.weightGoalDirection.orEmpty(),
                rate = prefs.weightGoalRateKgPerWeek?.let { kgToUserWeight(it, unit).oneDecimal() }.orEmpty(),
            )
        }
    }
}

/** Heart rate and power (HealthMetricsCard): optional baselines that sharpen training load. */
data class HeartForm(val restingHr: String, val maxHr: String, val ftp: String) {
    val restingError: String? get() = fieldError(restingHr, PreferenceBounds.RestingHr, "Resting heart rate", "bpm")
    val maxError: String? get() = fieldError(maxHr, PreferenceBounds.MaxHr, "Max heart rate", "bpm")
    val ftpError: String? get() = fieldError(ftp, PreferenceBounds.Ftp, "Functional threshold power", "W")
    val hasErrors: Boolean get() = listOfNotNull(restingError, maxError, ftpError).isNotEmpty()

    fun patch(saved: HeartForm) = UpdateUserPreferences(
        restingHr = if (restingHr.trim() != saved.restingHr) Patch.of(restingHr.asInt()) else Patch.Absent,
        maxHr = if (maxHr.trim() != saved.maxHr) Patch.of(maxHr.asInt()) else Patch.Absent,
        ftp = if (ftp.trim() != saved.ftp) Patch.of(ftp.asInt()) else Patch.Absent,
    )

    companion object {
        fun from(prefs: PreferencesResponse) = HeartForm(
            restingHr = prefs.restingHr?.toString().orEmpty(),
            maxHr = prefs.maxHr?.toString().orEmpty(),
            ftp = prefs.ftp?.toString().orEmpty(),
        )
    }
}

val MEAL_SCHEDULES = listOf(3, 4, 5)
val WEEKLY_GOALS = (3..7).toList()

const val BALANCED_STYLE = "balanced_default"
const val MAF_STYLE = "maf_method"

/** The coaching style's name (TrainingStyleSection's STYLE_LABELS). */
fun styleLabel(styleId: String?): String = if (styleId == MAF_STYLE) "MAF Method" else "Balanced"

/** What the style holds recommendations to. */
fun styleConstraint(styleId: String?): String = if (styleId == MAF_STYLE) {
    "MAF uses HR ceiling framing (stay at or under your ceiling; it is not a target to chase)."
} else {
    "Balanced style blends aerobic work, quality sessions, and recovery constraints."
}

/** Said once a switch is saved. */
fun transitionNotice(styleId: String): String =
    "Switched to ${styleLabel(styleId)}. Immediate: coaching language and new recommendations update now. " +
        "After re-baseline: future trend analysis and longer-horizon plan adjustments will settle once new baseline data is captured."

/** What a switch to [styleId] sets off (buildRecalculationSummary). */
fun recalculationSummary(styleId: String): List<String> = listOfNotNull(
    "Coach recommendation prompt context switched to the selected style.",
    "Future plan generation uses the updated style constraints.",
    "Saved Coach Insights refresh in the background for the new style.",
    "MAF heart-rate ceiling recomputed and baseline test reminder scheduled.".takeIf { styleId == MAF_STYLE },
)

/** One style change, as the settings audit lists it. Kept on this device, as the web keeps it in the browser. */
@Serializable
data class StyleAuditEntry(val changedAt: String, val fromStyleId: String, val toStyleId: String, val recalculations: List<String>)

/** The audit keeps the last ten changes. */
const val MAX_AUDIT_ENTRIES = 10

/** Maffetone's category question, with the beats a minute each moves the ceiling (shared/maf.ts). */
data class MafCategoryOption(val category: MafCategory, val label: String, val adjustment: Int)

val MAF_CATEGORIES = listOf(
    MafCategoryOption(
        MafCategory.RecoveringOrMedicated,
        "Recovering from major illness or surgery, or on regular medication (−10 bpm)",
        -10,
    ),
    MafCategoryOption(
        MafCategory.TrainingInterrupted,
        "Injured, regressing, frequent colds, allergies/asthma, or new/inconsistent training (−5 bpm)",
        -5,
    ),
    MafCategoryOption(MafCategory.ConsistentUpTo2y, "Training consistently (up to 2 years) without those problems", 0),
    MafCategoryOption(MafCategory.Consistent2yPlusImproving, "Training 2+ years without those problems, and improving (+5 bpm)", 5),
)

private const val MAF_BASE = 180
private const val UNDER_16_CEILING = 165
private const val MAF_MIN_FORMULA_AGE = 16

/** The MAF ceiling: 180 minus age, moved by the category (calculateMafHr's category path; a flat 165 under 16). */
fun mafCeiling(age: Int, category: MafCategory): Int =
    if (age <
        MAF_MIN_FORMULA_AGE
    ) {
        UNDER_16_CEILING
    } else {
        MAF_BASE - age +
            (MAF_CATEGORIES.firstOrNull { it.category == category }?.adjustment ?: 0)
    }

/** The MAF setup dialog's answers, as typed. */
data class MafSetup(val age: String, val category: MafCategory?, val hrDataAvailable: Boolean?) {
    val validAge: Int? get() = age.trim().toIntOrNull()?.takeIf { boundError(it.toDouble(), PreferenceBounds.MafAge, "MAF age") == null }
    val error: String? get() = if (validAge == null || category == null) "Enter a valid age and select your category." else null

    /** The answers and the ceiling they give; null until they are complete. */
    fun patch(): UpdateUserPreferences? {
        val years = validAge
        val chosen = category
        return if (years == null || chosen == null) {
            null
        } else {
            UpdateUserPreferences(
                mafAge = Patch.of(years),
                mafCategory = Patch.of(chosen),
                mafHrDataAvailable = Patch.of(hrDataAvailable),
                mafHr = Patch.of(mafCeiling(years, chosen)),
            )
        }
    }

    companion object {
        fun from(prefs: PreferencesResponse) = MafSetup(
            age = prefs.mafAge?.toString().orEmpty(),
            category = MafCategory.entries.firstOrNull { it.wireValue == prefs.mafCategory && it != MafCategory.Unknown },
            hrDataAvailable = prefs.mafHrDataAvailable,
        )
    }
}

/** Whether a switch to MAF can go straight through: the stored setup has an age and a category. */
fun hasMafSetup(prefs: PreferencesResponse): Boolean = MafSetup.from(prefs).patch() != null

/**
 * A style switch: the new style and what it came from, with a request to
 * refresh what depends on it. A switch to MAF carries its [setup] answers and
 * schedules the baseline test reminder a week out.
 */
fun styleSwitchPatch(from: String, to: String, changedAt: String, inAWeek: String, setup: UpdateUserPreferences?): UpdateUserPreferences {
    val maf = setup ?: UpdateUserPreferences()
    return maf.copy(
        trainingStyleId = Patch.of(to),
        trainingStylePreviousId = Patch.of(from),
        trainingStyleChangedAt = Patch.of(changedAt),
        trainingStyleRecomputeNow = true,
        mafBaselineTestScheduledAt = if (to == MAF_STYLE) Patch.of(inAWeek) else Patch.Absent,
    )
}
