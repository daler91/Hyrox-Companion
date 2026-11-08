package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ParsedExercise
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkoutLoggingTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { "queued-key" })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }

    @AfterTest
    fun closeDatabase() = db.close()

    private val request = CreateWorkoutRequest(date = "2026-11-08", focus = "Strength", mainWorkout = "Squats", rpe = Patch.of(7))

    private val saved = """{"id":"w9","userId":"u1","date":"2026-11-08","focus":"Strength","mainWorkout":"Squats",""" +
        """"countsAsTraining":true,"autoLinkRecordingOnly":false,"deviceActivity":null}"""

    @Test
    fun anAnsweredLogIsSavedLiveWithItsKey() = runTest {
        server.on("POST", "/api/v1/workouts", 201, saved)

        val result = workouts.logWorkout(request)

        assertIs<LogResult.Saved>(result)
        assertEquals("w9", result.workout?.id)
        assertEquals("live-key", server.requests.single().idempotencyKey)
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test
    fun aSavedLogWhoseAnswerDoesNotDecodeIsStillSavedNotQueued() = runTest {
        server.on("POST", "/api/v1/workouts", 201, """{"unexpected":true}""")

        val result = workouts.logWorkout(request)

        assertEquals(LogResult.Saved(null), result)
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test
    fun aRefusedLogThrowsAndIsNotQueued() = runTest {
        server.on("POST", "/api/v1/workouts", 400, """{"error":"Workout date cannot be in the future","code":"VALIDATION_ERROR"}""")

        val error = assertFailsWith<ApiException> { workouts.logWorkout(request) }

        assertEquals("Workout date cannot be in the future", error.message)
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test
    fun aLogWithNoAnswerIsQueuedUnderTheSameKey() = runTest {
        var online = false
        server.on("POST", "/api/v1/workouts") { if (online) Reply.Respond(201, saved) else Reply.NoAnswer }

        val result = workouts.logWorkout(request)
        online = true
        sync.sync()

        assertEquals(LogResult.Queued, result)
        assertEquals(listOf("live-key", "live-key"), server.requests.map { it.idempotencyKey })
    }

    @Test
    fun parsedRowsBecomeTheCreateRequestsExercises() {
        val parsed = ApiJson.decodeFromString(
            ParsedExercise.serializer(),
            """{"exerciseName":"back_squat","category":"strength","confidence":92,"missingFields":["weight"],""" +
                """"sets":[{"setNumber":1,"reps":5,"weight":80},{"setNumber":2,"reps":5}]}""",
        )

        val json = ApiJson.encodeToJsonElement(CreateWorkoutRequest.ExercisesItem.serializer(), parsed.toCreateExercise()).jsonObject

        assertEquals("back_squat", json["exerciseName"]!!.jsonPrimitive.content)
        assertNull(json["missingFields"])
        val sets = json["sets"]!!.jsonArray
        assertEquals(80.0, sets[0].jsonObject["weight"]!!.jsonPrimitive.double)
        assertNull(sets[1].jsonObject["weight"])
    }
}
