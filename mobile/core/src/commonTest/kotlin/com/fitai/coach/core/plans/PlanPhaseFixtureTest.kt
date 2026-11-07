package com.fitai.coach.core.plans

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test

/** Pins PlanPhase.kt to shared/planPhase.ts (script/mobile-fixtures/suites/planPhase.ts). */
class PlanPhaseFixtureTest {
    @Test
    fun constants() = assertFixtureSuite("planPhase.constants") {
        buildJsonObject { put("PLAN_PHASE_ORDER", phases(PLAN_PHASE_ORDER)) }
    }

    @Test
    fun computeCurrentWeekCases() = assertFixtureSuite("planPhase.computeCurrentWeek") { input ->
        val (planStartDate, totalWeeks, today) = input.jsonArray
        val week = computeCurrentWeek(planStartDate.jsonPrimitive.contentOrNull, totalWeeks.jsonPrimitive.int, today.jsonPrimitive.content)
        // Null stands for the TypeScript's NaN, which the fixture writes as "NaN".
        week?.let(::JsonPrimitive) ?: JsonPrimitive("NaN")
    }

    @Test
    fun computePlanPhaseCases() = assertFixtureSuite("planPhase.computePlanPhase") { input ->
        val (totalWeeks, currentWeek) = input.jsonArray.map { it.jsonPrimitive.int }
        computePlanPhase(totalWeeks, currentWeek)?.toJson() ?: JsonNull
    }
}

private fun PlanPhase.toJson(): JsonElement = buildJsonObject {
    put("currentWeek", currentWeek)
    put("totalWeeks", totalWeeks)
    put("phaseLabel", phaseLabel.wireValue)
    put("progressPct", progressPct)
    put("remainingPhases", phases(remainingPhases))
}

private fun phases(values: List<TrainingPhase>): JsonArray = JsonArray(values.map { JsonPrimitive(it.wireValue) })
