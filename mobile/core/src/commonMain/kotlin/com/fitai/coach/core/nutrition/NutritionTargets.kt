package com.fitai.coach.core.nutrition

import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.js.jsRound
import kotlin.math.abs
import kotlin.math.max

/*
 * Port of shared/nutritionTargets.ts, the parts the targets editor runs on the
 * device: a calorie and macro target from the athlete's profile (Mifflin–St
 * Jeor BMR → TDEE → goal adjustment → g/kg macros), and the periodisation
 * columns a new target version saves. Pinned by the nutritionTargets golden
 * fixtures.
 */

/** `ActivityLevel`, with its Mifflin–St Jeor multiplier (BMR → TDEE). */
public enum class ActivityLevel(public val wireValue: String, public val multiplier: Double) {
    Sedentary("sedentary", SEDENTARY_MULTIPLIER),
    Light("light", LIGHT_MULTIPLIER),
    Moderate("moderate", MODERATE_MULTIPLIER),
    Active("active", ACTIVE_MULTIPLIER),
    VeryActive("very_active", VERY_ACTIVE_MULTIPLIER),
    ;

    public companion object {
        public fun fromWire(value: String?): ActivityLevel? = entries.firstOrNull { it.wireValue == value }
    }
}

private const val SEDENTARY_MULTIPLIER = 1.2
private const val LIGHT_MULTIPLIER = 1.375
private const val MODERATE_MULTIPLIER = 1.55
private const val ACTIVE_MULTIPLIER = 1.725
private const val VERY_ACTIVE_MULTIPLIER = 1.9

/** `WeightGoalDirection`. */
public enum class WeightGoalDirection(public val wireValue: String) {
    Lose("lose"),
    Maintain("maintain"),
    Gain("gain"),
    ;

    public companion object {
        public fun fromWire(value: String?): WeightGoalDirection? = entries.firstOrNull { it.wireValue == value }
    }
}

/** `BmrSex`: BMR needs a binary sex term; a null sex takes the neutral midpoint. */
public enum class BmrSex(public val wireValue: String) {
    Male("male"),
    Female("female"),
    ;

    public companion object {
        public fun fromWire(value: String?): BmrSex? = entries.firstOrNull { it.wireValue == value }
    }
}

/** `DEFAULT_PROTEIN_G_PER_KG`. */
public const val DEFAULT_PROTEIN_G_PER_KG: Double = 1.8

/** `DEFAULT_FAT_G_PER_KG`. */
public const val DEFAULT_FAT_G_PER_KG: Double = 1.0

private const val KCAL_PER_KG_BODYWEIGHT = 7700.0
private const val DAYS_PER_WEEK = 7.0
private const val CALORIE_FLOOR_FEMALE = 1200.0
private const val CALORIE_FLOOR_DEFAULT = 1500.0
private const val MIFFLIN_WEIGHT = 10.0
private const val MIFFLIN_HEIGHT = 6.25
private const val MIFFLIN_AGE = 5.0
private const val MIFFLIN_MALE = 5.0
private const val MIFFLIN_FEMALE = -161.0

private const val TENTHS = 10.0

private fun round1(n: Double): Double = jsRound(n * TENTHS) / TENTHS

/** `NutritionTargetInput`. */
public data class NutritionTargetInput(
    val bodyweightKg: Double,
    val heightCm: Double,
    val ageYears: Double,
    val sex: BmrSex?,
    val activityLevel: ActivityLevel,
    val goalDirection: WeightGoalDirection,
    /** Magnitude of the weekly weight change (kg); ignored when maintaining. */
    val goalRateKgPerWeek: Double,
    val proteinGPerKg: Double? = null,
    val fatGPerKg: Double? = null,
)

/** `NutritionTargetResult`. */
public data class NutritionTargetResult(
    val bmr: Double,
    val tdee: Double,
    val calories: Double,
    val proteinG: Double,
    val carbG: Double,
    val fatG: Double,
    /** Signed kcal/day applied to TDEE for the goal (negative = deficit). */
    val goalCalorieDelta: Double,
    val reasonCodes: List<String>,
    val warning: String?,
    val explanation: String,
)

/** `calculateBmr`: Mifflin–St Jeor, with the midpoint sex term when sex is unknown. */
public fun calculateBmr(bodyweightKg: Double, heightCm: Double, ageYears: Double, sex: BmrSex?): Double {
    val base = MIFFLIN_WEIGHT * bodyweightKg + MIFFLIN_HEIGHT * heightCm - MIFFLIN_AGE * ageYears
    val sexTerm = when (sex) {
        BmrSex.Male -> MIFFLIN_MALE
        BmrSex.Female -> MIFFLIN_FEMALE
        null -> (MIFFLIN_MALE + MIFFLIN_FEMALE) / 2
    }
    return base + sexTerm
}

/**
 * `calculateNutritionTarget`: BMR → TDEE → goal-adjusted calories → g/kg
 * macros, carbs filling the remainder. All rounding happens here.
 */
public fun calculateNutritionTarget(input: NutritionTargetInput): NutritionTargetResult {
    val reasonCodes = mutableListOf<String>()
    var warning: String? = null

    val bmr = calculateBmr(input.bodyweightKg, input.heightCm, input.ageYears, input.sex)
    if (input.sex == null) reasonCodes += "sex_neutral_bmr"

    val tdee = bmr * input.activityLevel.multiplier
    val dailyKcalFromRate = abs(input.goalRateKgPerWeek) * KCAL_PER_KG_BODYWEIGHT / DAYS_PER_WEEK
    val goalCalorieDelta = when (input.goalDirection) {
        WeightGoalDirection.Lose -> -dailyKcalFromRate
        WeightGoalDirection.Gain -> dailyKcalFromRate
        WeightGoalDirection.Maintain -> 0.0
    }
    var calories = tdee + goalCalorieDelta

    val floor = if (input.sex == BmrSex.Female) CALORIE_FLOOR_FEMALE else CALORIE_FLOOR_DEFAULT
    if (calories < floor) {
        calories = floor
        warning = "Calorie target floored at ${jsNumberToString(floor)} kcal for safety."
        reasonCodes += "calorie_floor_applied"
    }

    val proteinG = (input.proteinGPerKg ?: DEFAULT_PROTEIN_G_PER_KG) * input.bodyweightKg
    val fatG = (input.fatGPerKg ?: DEFAULT_FAT_G_PER_KG) * input.bodyweightKg
    val proteinFatKcal = proteinG * KCAL_PER_G_PROTEIN + fatG * KCAL_PER_G_FAT

    // Carbs fill the remainder; when protein and fat alone pass the calories,
    // carbs clamp to 0 and the calories rise to match the macros.
    var carbKcal = calories - proteinFatKcal
    if (carbKcal < 0) {
        carbKcal = 0.0
        warning = warning ?: "Protein and fat alone meet the calorie target; carbs set to 0."
        reasonCodes += "carbs_clamped_zero"
        calories = proteinFatKcal
    }
    val carbG = carbKcal / KCAL_PER_G_CARB

    val deltaSign = if (goalCalorieDelta >= 0) "+" else ""
    fun n(x: Double) = jsNumberToString(x)
    return NutritionTargetResult(
        bmr = jsRound(bmr),
        tdee = jsRound(tdee),
        calories = jsRound(calories),
        proteinG = round1(proteinG),
        carbG = round1(carbG),
        fatG = round1(fatG),
        goalCalorieDelta = jsRound(goalCalorieDelta),
        reasonCodes = reasonCodes,
        warning = warning,
        explanation = "BMR ${n(jsRound(bmr))} kcal (Mifflin–St Jeor), TDEE ${n(jsRound(tdee))} kcal " +
            "(×${n(input.activityLevel.multiplier)}), goal $deltaSign${n(jsRound(goalCalorieDelta))} kcal " +
            "→ ${n(jsRound(calories))} kcal. Protein ${n(round1(proteinG))}g + fat ${n(round1(fatG))}g " +
            "anchored to ${n(input.bodyweightKg)}kg; carbs ${n(round1(carbG))}g fill the remainder.",
    )
}

/** The placeholder reference when the athlete has no training history (audit C6). */
private const val ASSUMED_REFERENCE_UTSS = 50.0

/** A near-zero typical load can't blow up the slope. */
private const val MIN_REFERENCE_UTSS = 25.0
private const val DEFAULT_RECOVERY_PROTEIN_BUMP_FRAC = 0.15
private const val SLOPE_SHARE = 0.5
private const val PRELOAD_SHARE = 0.5
private const val MAX_CARB_DELTA_SHARE = 0.75

/** `DefaultPeriodizationConfig`. */
public data class DefaultPeriodizationConfig(
    val referenceUtss: Double,
    val carbGramsPerUtss: Double,
    val recoveryEnabled: Boolean,
    val recoveryProteinBumpFrac: Double,
    val preloadCarbGramsPerUtss: Double,
    val preloadDaysAhead: Int,
    val phaseAware: Boolean,
    val maxCarbDeltaG: Double,
    /** Whether [referenceUtss] is the athlete's own typical load, or the placeholder. */
    val referenceMeasured: Boolean,
)

/**
 * `defaultPeriodizationConfig`: defaults from a carb baseline and the
 * athlete's typical daily load (the 28-day chronic EWMA). A rest day keeps
 * about half the baseline carbs; the adaptive knobs come on.
 */
public fun defaultPeriodizationConfig(baselineCarbG: Double, recentAvgDailyUtss: Double?): DefaultPeriodizationConfig {
    val hasRealLoad = recentAvgDailyUtss != null && recentAvgDailyUtss > 0
    val rawReference = if (hasRealLoad) recentAvgDailyUtss else ASSUMED_REFERENCE_UTSS
    val referenceUtss = round1(max(MIN_REFERENCE_UTSS, rawReference))
    val carbGramsPerUtss = round1(baselineCarbG / referenceUtss * SLOPE_SHARE)
    return DefaultPeriodizationConfig(
        referenceUtss = referenceUtss,
        carbGramsPerUtss = carbGramsPerUtss,
        recoveryEnabled = true,
        recoveryProteinBumpFrac = DEFAULT_RECOVERY_PROTEIN_BUMP_FRAC,
        preloadCarbGramsPerUtss = round1(carbGramsPerUtss * PRELOAD_SHARE),
        preloadDaysAhead = 1,
        phaseAware = true,
        maxCarbDeltaG = round1(baselineCarbG * MAX_CARB_DELTA_SHARE),
        referenceMeasured = hasRealLoad,
    )
}

/** `PeriodizationSettings`: the periodisation columns a target version stores. */
public data class PeriodizationSettings(
    val periodizationEnabled: Boolean,
    val referenceUtss: Double?,
    val carbGramsPerUtss: Double?,
    val recoveryEnabled: Boolean,
    val recoveryProteinBumpFrac: Double?,
    val preloadCarbGramsPerUtss: Double?,
    val preloadDaysAhead: Int?,
    val phaseAware: Boolean,
    val maxCarbDeltaG: Double?,
)

/** `StoredPeriodization`: a saved version's carb baseline and periodisation columns. */
public data class StoredPeriodization(val carbG: Double?, val settings: PeriodizationSettings)

/** `PeriodizationChoice`: what the new version should do. */
public data class PeriodizationChoice(
    val carbG: Double?,
    val periodize: Boolean,
    val recoveryEnabled: Boolean,
    val phaseAware: Boolean,
)

private val PERIODIZATION_OFF = PeriodizationSettings(
    periodizationEnabled = false,
    referenceUtss = null,
    carbGramsPerUtss = null,
    recoveryEnabled = false,
    recoveryProteinBumpFrac = null,
    preloadCarbGramsPerUtss = null,
    preloadDaysAhead = null,
    phaseAware = false,
    maxCarbDeltaG = null,
)

/** A knob derived from the carb baseline, re-based onto the new one (CL33). */
private fun rebased(stored: Double?, ratio: Double?, fallback: Double): Double = when {
    stored == null || ratio == null -> fallback
    ratio == 1.0 -> stored
    else -> round1(stored * ratio)
}

/**
 * `nextPeriodizationSettings`: the columns for a new target version — the
 * athlete's choice, with the current version's calibration carried forward
 * (re-based onto the new carb baseline) and the baseline's defaults where
 * there is none.
 */
public fun nextPeriodizationSettings(
    current: StoredPeriodization?,
    choice: PeriodizationChoice,
    recentAvgDailyUtss: Double?,
): PeriodizationSettings {
    // Periodisation only makes sense with a carb baseline to scale.
    val baselineCarbG = choice.carbG?.takeIf { choice.periodize } ?: return PERIODIZATION_OFF
    val cfg = defaultPeriodizationConfig(baselineCarbG, recentAvgDailyUtss)
    val ratio = current?.carbG?.takeIf { it > 0 }?.let { baselineCarbG / it }
    val saved = current?.settings
    // The reference and slope are kept only from a version that was periodised.
    val calibrated = saved?.takeIf { it.periodizationEnabled }
    val adaptive = choice.recoveryEnabled || choice.phaseAware
    return PeriodizationSettings(
        periodizationEnabled = true,
        referenceUtss = calibrated?.referenceUtss ?: cfg.referenceUtss,
        carbGramsPerUtss = rebased(calibrated?.carbGramsPerUtss, ratio, cfg.carbGramsPerUtss),
        recoveryEnabled = choice.recoveryEnabled,
        recoveryProteinBumpFrac = if (adaptive) saved?.recoveryProteinBumpFrac ?: cfg.recoveryProteinBumpFrac else null,
        preloadCarbGramsPerUtss = if (adaptive) rebased(saved?.preloadCarbGramsPerUtss, ratio, cfg.preloadCarbGramsPerUtss) else null,
        preloadDaysAhead = if (adaptive) saved?.preloadDaysAhead ?: cfg.preloadDaysAhead else null,
        phaseAware = choice.phaseAware,
        maxCarbDeltaG = if (adaptive) rebased(saved?.maxCarbDeltaG, ratio, cfg.maxCarbDeltaG) else null,
    )
}
