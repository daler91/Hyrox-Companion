package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiEndpoint
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.NutritionTarget
import com.fitai.coach.core.api.generated.PostNutritionMealTargetsRequest
import com.fitai.coach.core.api.generated.PostNutritionTargetsRequest
import com.fitai.coach.core.nutrition.MealFuelOverride
import com.fitai.coach.core.nutrition.PeriodizationSettings
import com.fitai.coach.core.nutrition.StoredPeriodization
import kotlinx.serialization.KSerializer

/**
 * The athlete's nutrition targets: the daily goals with their training-load
 * settings (TargetsDialog.tsx), and per-meal overrides (MealTargetDialog.tsx).
 * Every day's summary reads them, so a change refreshes the days through
 * [targetsChanged]. Changes apply from today; the server dates them.
 */
public class TargetSettings internal constructor(
    private val api: ApiClient,
    private val targetsChanged: suspend (date: String) -> Unit,
) {
    public suspend fun current(): NutritionTarget? = api.call(ApiEndpoints.GetNutritionTargets).current

    /**
     * The athlete's typical daily training load, the 28-day chronic EWMA, that
     * periodisation is calibrated from. Zero with no training history.
     */
    public suspend fun typicalDailyLoad(): Double = api.call(ApiEndpoints.GetTrainingOverview).trainingLoad.chronicAvg

    /** Saves the daily goals (a null goal is untracked) with their periodisation columns, as a new version. */
    public suspend fun save(targets: MacroTargets, periodization: PeriodizationSettings, date: String) {
        write(
            ApiEndpoints.PostNutritionTargets,
            PostNutritionTargetsRequest.serializer(),
            PostNutritionTargetsRequest(
                calories = Patch.of(targets.calories),
                proteinG = Patch.of(targets.proteinG),
                carbG = Patch.of(targets.carbG),
                fatG = Patch.of(targets.fatG),
                periodizationEnabled = periodization.periodizationEnabled,
                referenceUtss = Patch.of(periodization.referenceUtss),
                carbGramsPerUtss = Patch.of(periodization.carbGramsPerUtss),
                recoveryEnabled = periodization.recoveryEnabled,
                recoveryProteinBumpFrac = Patch.of(periodization.recoveryProteinBumpFrac),
                preloadCarbGramsPerUtss = Patch.of(periodization.preloadCarbGramsPerUtss),
                preloadDaysAhead = Patch.of(periodization.preloadDaysAhead),
                phaseAware = periodization.phaseAware,
                maxCarbDeltaG = Patch.of(periodization.maxCarbDeltaG),
            ),
        )
        targetsChanged(date)
    }

    /** Pins [meal]'s goals; a null field follows the computed split. */
    public suspend fun setMealTarget(meal: Meal, pins: MealFuelOverride, date: String) {
        write(
            ApiEndpoints.PostNutritionMealTargets,
            PostNutritionMealTargetsRequest.serializer(),
            PostNutritionMealTargetsRequest(
                mealType = PostNutritionMealTargetsRequest.MealType.entries.first { it.wireValue == meal.wireValue },
                calories = Patch.of(pins.calories),
                proteinG = Patch.of(pins.proteinG),
                carbG = Patch.of(pins.carbG),
                fatG = Patch.of(pins.fatG),
            ),
        )
        targetsChanged(date)
    }

    /** Drops [meal]'s pins: it follows the computed split again. */
    public suspend fun clearMealTarget(meal: Meal, date: String) {
        api.send(
            ApiEndpoints.DeleteNutritionMealTargetsByMealType,
            ApiEndpoints.DeleteNutritionMealTargetsByMealType.path(meal.wireValue),
            body = null,
            idempotencyKey = null,
        )
        targetsChanged(date)
    }

    // Writes whose answer isn't read: the days' refresh shows the result.
    private suspend fun <T> write(endpoint: ApiEndpoint<*, *>, serializer: KSerializer<T>, request: T) {
        api.send(endpoint, endpoint.pathTemplate, encode(serializer, request), idempotencyKey = null)
    }
}

/** A saved target's carb baseline and periodisation columns, for [com.fitai.coach.core.nutrition.nextPeriodizationSettings]. */
public fun NutritionTarget.storedPeriodization(): StoredPeriodization = StoredPeriodization(
    carbG = carbG,
    settings = PeriodizationSettings(
        periodizationEnabled = periodizationEnabled,
        referenceUtss = referenceUtss,
        carbGramsPerUtss = carbGramsPerUtss,
        recoveryEnabled = recoveryEnabled,
        recoveryProteinBumpFrac = recoveryProteinBumpFrac,
        preloadCarbGramsPerUtss = preloadCarbGramsPerUtss,
        preloadDaysAhead = preloadDaysAhead?.toInt(),
        phaseAware = phaseAware,
        maxCarbDeltaG = maxCarbDeltaG,
    ),
)
