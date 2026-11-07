package com.fitai.coach.core.structure

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStructureRequest
import com.fitai.coach.core.api.generated.UpdateWorkoutRequest
import com.fitai.coach.core.fixtures.FixtureJson
import com.fitai.coach.core.fixtures.assertFixtureSuite
import com.fitai.coach.core.fixtures.fixtureCases
import com.fitai.coach.core.fixtures.jsonEquals
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

private const val SUITE = "structureLint.lintWorkoutStructure"

/** A fixture input: `{ case, blocks?, exercises? }`. The inputs carry API fields the linter does not read. */
@Serializable
private class LintCase(
    val blocks: List<StructureLintBlock>? = null,
    val exercises: List<StructureLintExercise>? = null,
)

private val lenient = Json { ignoreUnknownKeys = true }

private fun encode(result: StructureLintResult): JsonElement =
    FixtureJson.encodeToJsonElement(StructureLintResult.serializer(), result)

class StructureLintFixtureTest {
    @Test
    fun lintWorkoutStructure() = assertFixtureSuite(SUITE) { input ->
        val case = lenient.decodeFromJsonElement(LintCase.serializer(), input)
        encode(lintWorkoutStructure(case.blocks, case.exercises))
    }

    /**
     * The same cases read through the generated request models and the
     * adapters, for every input those models carry without loss: it decodes,
     * and no enum the linter reads decodes as Unknown ("AMRAP", "REST" and
     * "PER_SIDE" do).
     */
    @Test
    fun lintWorkoutStructureFromRequestModels() {
        val cases = fixtureCases(SUITE)
        var checked = 0
        val failures = mutableListOf<String>()
        cases.forEachIndexed { index, case ->
            val input = case.input.jsonObject
            val blocks = decodeOrNull(input["blocks"], PatchPlansDaysByDayIdStructureRequest.StructureBlocksItem.serializer())
            val created = decodeOrNull(input["exercises"], CreateWorkoutRequest.ExercisesItem.serializer())
            val updated = decodeOrNull(input["exercises"], UpdateWorkoutRequest.ExercisesItem.serializer())
            if (blocks == null || created == null || updated == null) return@forEachIndexed
            if (blocks.value.orEmpty().any(::hasUnknownEnum) || created.value.orEmpty().any(::hasUnknownEnum)) return@forEachIndexed
            checked++
            val lintBlocks = blocks.value?.map { it.toStructureLintBlock() }
            val fromCreate = encode(lintWorkoutStructure(lintBlocks, created.value?.map { it.toStructureLintExercise() }))
            val fromUpdate = encode(lintWorkoutStructure(lintBlocks, updated.value?.map { it.toStructureLintExercise() }))
            if (!jsonEquals(case.output, fromCreate)) failures += "#$index create: expected ${case.output}, got $fromCreate"
            if (!jsonEquals(case.output, fromUpdate)) failures += "#$index update: expected ${case.output}, got $fromUpdate"
        }
        if (failures.isNotEmpty()) fail("${failures.size} differ\n" + failures.take(20).joinToString("\n"))
        // Most inputs are on-contract; this catches the decoding silently skipping them all.
        assertTrue(checked >= cases.size * 3 / 4, "only $checked of ${cases.size} cases decoded into the request models")
    }
}

/** A decoded list (null for an absent or null key), or null when the models cannot read it. */
private class Decoded<T>(val value: List<T>?)

private fun <T> decodeOrNull(element: JsonElement?, item: KSerializer<T>): Decoded<T>? {
    if (element == null || element is JsonNull) return Decoded(null)
    return try {
        Decoded(ApiJson.decodeFromJsonElement(ListSerializer(item), element))
    } catch (_: SerializationException) {
        null
    }
}

private fun hasUnknownEnum(block: PatchPlansDaysByDayIdStructureRequest.StructureBlocksItem): Boolean =
    block.formatType == PatchPlansDaysByDayIdStructureRequest.StructureBlocksItem.FormatType.Unknown ||
        block.steps.any { it.stepType == PatchPlansDaysByDayIdStructureRequest.StructureBlocksItem.StepsItem.StepType.Unknown }

private fun hasUnknownEnum(exercise: CreateWorkoutRequest.ExercisesItem): Boolean =
    (exercise.repMode as? Patch.Value)?.value == CreateWorkoutRequest.ExercisesItem.RepMode.Unknown
