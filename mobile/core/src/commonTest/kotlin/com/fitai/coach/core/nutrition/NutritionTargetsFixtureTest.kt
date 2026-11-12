package com.fitai.coach.core.nutrition

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test

class NutritionTargetsFixtureTest {
    @Test
    fun calculateNutritionTargetSuite() = assertFixtureSuite("nutritionTargets.calculateNutritionTarget") { input ->
        val o = input.jsonObject
        val result = calculateNutritionTarget(
            NutritionTargetInput(
                bodyweightKg = o.jsDouble("bodyweightKg"),
                heightCm = o.jsDouble("heightCm"),
                ageYears = o.jsDouble("ageYears"),
                sex = BmrSex.fromWire(o.string("sex")),
                activityLevel = ActivityLevel.fromWire(o.string("activityLevel"))!!,
                goalDirection = WeightGoalDirection.fromWire(o.string("goalDirection"))!!,
                goalRateKgPerWeek = o.jsDouble("goalRateKgPerWeek"),
                proteinGPerKg = o.jsDoubleOrNull("proteinGPerKg"),
                fatGPerKg = o.jsDoubleOrNull("fatGPerKg"),
            ),
        )
        buildJsonObject {
            put("bmr", jsNumber(result.bmr))
            put("tdee", jsNumber(result.tdee))
            put("calories", jsNumber(result.calories))
            put("proteinG", jsNumber(result.proteinG))
            put("carbG", jsNumber(result.carbG))
            put("fatG", jsNumber(result.fatG))
            put("goalCalorieDelta", jsNumber(result.goalCalorieDelta))
            put("reasonCodes", JsonArray(result.reasonCodes.map(::JsonPrimitive)))
            put("warning", JsonPrimitive(result.warning))
            put("explanation", JsonPrimitive(result.explanation))
        }
    }

    @Test
    fun defaultPeriodizationConfigSuite() = assertFixtureSuite("nutritionTargets.defaultPeriodizationConfig") { input ->
        val o = input.jsonObject
        val cfg = defaultPeriodizationConfig(o.jsDouble("baselineCarbG"), o.jsDoubleOrNull("recentAvgDailyUtss"))
        buildJsonObject {
            put("referenceUtss", jsNumber(cfg.referenceUtss))
            put("carbGramsPerUtss", jsNumber(cfg.carbGramsPerUtss))
            put("recoveryEnabled", JsonPrimitive(cfg.recoveryEnabled))
            put("recoveryProteinBumpFrac", jsNumber(cfg.recoveryProteinBumpFrac))
            put("preloadCarbGramsPerUtss", jsNumber(cfg.preloadCarbGramsPerUtss))
            put("preloadDaysAhead", JsonPrimitive(cfg.preloadDaysAhead))
            put("phaseAware", JsonPrimitive(cfg.phaseAware))
            put("maxCarbDeltaG", jsNumber(cfg.maxCarbDeltaG))
            put("referenceBasis", JsonPrimitive(if (cfg.referenceMeasured) "measured" else "assumed"))
        }
    }

    @Test
    fun nextPeriodizationSettingsSuite() = assertFixtureSuite("nutritionTargets.nextPeriodizationSettings") { input ->
        val o = input.jsonObject
        val choice = o.getValue("choice").jsonObject
        nextPeriodizationSettings(
            current = (o["current"] as? JsonObject)?.let {
                StoredPeriodization(it.jsDoubleOrNull("carbG"), it.settings())
            },
            choice = PeriodizationChoice(
                carbG = choice.jsDoubleOrNull("carbG"),
                periodize = choice.getValue("periodize").jsonPrimitive.boolean,
                recoveryEnabled = choice.getValue("recoveryEnabled").jsonPrimitive.boolean,
                phaseAware = choice.getValue("phaseAware").jsonPrimitive.boolean,
            ),
            recentAvgDailyUtss = o.jsDoubleOrNull("recentAvgDailyUtss"),
        ).toJson()
    }
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.settings() = PeriodizationSettings(
    periodizationEnabled = getValue("periodizationEnabled").jsonPrimitive.boolean,
    referenceUtss = jsDoubleOrNull("referenceUtss"),
    carbGramsPerUtss = jsDoubleOrNull("carbGramsPerUtss"),
    recoveryEnabled = getValue("recoveryEnabled").jsonPrimitive.boolean,
    recoveryProteinBumpFrac = jsDoubleOrNull("recoveryProteinBumpFrac"),
    preloadCarbGramsPerUtss = jsDoubleOrNull("preloadCarbGramsPerUtss"),
    preloadDaysAhead = jsDoubleOrNull("preloadDaysAhead")?.toInt(),
    phaseAware = getValue("phaseAware").jsonPrimitive.boolean,
    maxCarbDeltaG = jsDoubleOrNull("maxCarbDeltaG"),
)

private fun Double?.orNull(): JsonElement = this?.let(::jsNumber) ?: JsonNull

private fun PeriodizationSettings.toJson() = buildJsonObject {
    put("periodizationEnabled", JsonPrimitive(periodizationEnabled))
    put("referenceUtss", referenceUtss.orNull())
    put("carbGramsPerUtss", carbGramsPerUtss.orNull())
    put("recoveryEnabled", JsonPrimitive(recoveryEnabled))
    put("recoveryProteinBumpFrac", recoveryProteinBumpFrac.orNull())
    put("preloadCarbGramsPerUtss", preloadCarbGramsPerUtss.orNull())
    put("preloadDaysAhead", preloadDaysAhead?.let(::JsonPrimitive) ?: JsonNull)
    put("phaseAware", JsonPrimitive(phaseAware))
    put("maxCarbDeltaG", maxCarbDeltaG.orNull())
}
