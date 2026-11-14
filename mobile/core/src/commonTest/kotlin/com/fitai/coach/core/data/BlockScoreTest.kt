package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.structure.BlockScore
import com.fitai.coach.core.structure.blockScoreJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val W1 = "/api/v1/workouts/w1"

private fun block(score: String = "null") =
    """{"id":"b1","sectionType":"main","formatType":"amrap","timeCapMinutes":12,"score":$score,"sequenceOrder":0,"sortOrder":0,""" +
        """"steps":[{"stepNumber":1,"stepType":"work","exerciseName":"burpees","targets":{"targetReps":10}}]}"""

private fun workoutWith(vararg blocks: String) =
    """{"id":"w1","userId":"u1","date":"2026-11-02","focus":"Metcon","mainWorkout":"12 min AMRAP","countsAsTraining":true,""" +
        """"autoLinkRecordingOnly":false,"deviceActivity":null,"exerciseSets":[],"structureBlocks":[${blocks.joinToString(",")}]}"""

/** A block's result: read from and written as the server's tagged JSON, and kept on the workout once saved. */
class BlockScoreTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }
    private val structure = WorkoutStructureRepository(db, server.api, workouts)

    @AfterTest
    fun closeDatabase() = db.close()

    @Test
    fun eachKindReadsBackAsItWasWritten() {
        val scores = listOf(
            BlockScore.Emom(completed = true, completedMinutes = 12, missedReps = 3, notes = "Burpees got slow"),
            BlockScore.Amrap(rounds = 5, reps = 12),
            BlockScore.Rounds(completedRounds = 3, elapsedSeconds = 480),
        )

        scores.forEach { assertEquals(it, BlockScore.of(blockScoreJson(it))) }
        assertEquals(JsonNull, blockScoreJson(null))
    }

    @Test
    fun aMissingOrUnknownScoreReadsAsNone() {
        assertNull(BlockScore.of(null))
        assertNull(BlockScore.of(JsonNull))
        assertNull(BlockScore.of(ApiJson.parseToJsonElement("""{"type":"for_time","seconds":300}""")))
        // Fields this build doesn't expect fall back rather than fail.
        assertEquals(BlockScore.Amrap(rounds = 0), BlockScore.of(ApiJson.parseToJsonElement("""{"type":"amrap","rounds":"five"}""")))
    }

    @Test
    fun aSavedScoreIsSentAndKeptOnTheWorkout() = runTest {
        server.on("GET", W1, 200, workoutWith(block()))
        workouts.refresh("w1")
        val scored = """{"type":"amrap","rounds":5,"reps":12,"notes":null}"""
        server.on("PATCH", "$W1/structure-blocks/b1/score", 200, """{"structureBlocks":[${block(scored)}]}""")

        structure.scoreBlock("w1", "b1", BlockScore.Amrap(rounds = 5, reps = 12))

        assertEquals("""{"score":$scored}""", server.sentTo("PATCH", "$W1/structure-blocks/b1/score").single().body)
        val kept = workouts.workout("w1").first()?.structureBlocks?.single()
        assertEquals(BlockScore.Amrap(rounds = 5, reps = 12), BlockScore.of(kept?.score))
        assertEquals("Metcon", workouts.workout("w1").first()?.focus)
    }

    @Test
    fun clearingSendsANullScore() = runTest {
        server.on("PATCH", "$W1/structure-blocks/b1/score", 200, """{"structureBlocks":[${block()}]}""")

        structure.scoreBlock("w1", "b1", null)

        assertEquals("""{"score":null}""", server.sentTo("PATCH", "$W1/structure-blocks/b1/score").single().body)
    }
}
