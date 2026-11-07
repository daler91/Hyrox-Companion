package com.fitai.coach.core.nutrition

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test

class SessionFuellingTargetsFixtureTest {
    @Test
    fun computeSessionFuellingTargetSuite() =
        assertFixtureSuite("sessionFuellingTargets.computeSessionFuellingTarget") { input ->
            val o = input.jsonObject
            val target = computeSessionFuellingTarget(
                SessionFuellingTargetInput(
                    durationMin = o.jsDoubleOrNull("durationMin"),
                    rpe = o.jsDoubleOrNull("rpe"),
                    bodyweightKg = o.jsDoubleOrNull("bodyweightKg"),
                ),
            )
            buildJsonObject {
                put("preCarbG", jsNumber(target.preCarbG))
                put("postCarbG", jsNumber(target.postCarbG))
                put("postProteinG", jsNumber(target.postProteinG))
                put("reasonCodes", JsonArray(target.reasonCodes.map(::JsonPrimitive)))
                put("explanation", JsonPrimitive(target.explanation))
            }
        }
}
