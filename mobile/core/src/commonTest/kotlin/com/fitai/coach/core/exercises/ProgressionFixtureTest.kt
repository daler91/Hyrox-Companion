package com.fitai.coach.core.exercises

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test

class ProgressionFixtureTest {
    @Test
    fun suggestNextTarget() = assertFixtureSuite("progression.suggestNextTarget") { input ->
        val args = input.jsonObject.getValue("args").jsonObject
        suggestNextTarget(
            lastSets = input.jsonObject.getValue("lastSets").toSets(),
            category = args.getValue("category").jsonPrimitive.content,
            weightUnit = args.getValue("weightUnit").jsonPrimitive.content,
            previousSets = args["previousSets"]?.toSets(),
            exerciseName = args["exerciseName"]?.jsonPrimitive?.content,
        ).toJson()
    }

    @Test
    fun unmetPrescription() = assertFixtureSuite("progression.unmetPrescription") { input ->
        val prescription = unmetPrescription(input.toSets()) ?: return@assertFixtureSuite JsonNull
        buildJsonObject {
            put("reps", prescription.reps)
            put("weight", prescription.weight)
        }
    }

    @Test
    fun epley() = assertFixtureSuite("progression.epley") { input ->
        val (weight, reps) = input.jsonArray.map { it.jsonPrimitive.double }
        JsonPrimitive(epley(weight, reps))
    }
}

/** A JSON array of sets; a missing key and null both read as null. */
private fun JsonElement.toSets(): List<ProgressionSet> = jsonArray.map { element ->
    val set = element.jsonObject
    ProgressionSet(
        reps = set.number("reps")?.intOrNull,
        weight = set.number("weight")?.doubleOrNull,
        plannedReps = set.number("plannedReps")?.intOrNull,
        plannedWeight = set.number("plannedWeight")?.doubleOrNull,
    )
}

private fun JsonObject.number(key: String): JsonPrimitive? = this[key]?.takeUnless { it is JsonNull }?.jsonPrimitive

/** The TypeScript's NextTarget shape. */
private fun NextTarget?.toJson(): JsonElement {
    val target = this ?: return JsonNull
    return buildJsonObject {
        put("setCount", target.setCount)
        put("reps", target.reps)
        put("weight", target.weight)
        put(
            "step",
            buildJsonObject {
                when (val step = target.step) {
                    is NextTargetStep.Reps -> {
                        put("field", "reps")
                        put("amount", step.amount)
                    }
                    is NextTargetStep.Weight -> {
                        put("field", "weight")
                        put("amount", step.amount)
                    }
                    is NextTargetStep.Repeat -> put("field", "repeat")
                    is NextTargetStep.Deload -> {
                        put("field", "deload")
                        put("amount", step.amount)
                    }
                }
            },
        )
    }
}
