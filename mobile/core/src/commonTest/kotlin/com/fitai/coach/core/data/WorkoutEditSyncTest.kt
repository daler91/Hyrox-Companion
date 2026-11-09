package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdSetsRequest
import com.fitai.coach.core.api.generated.UpdateWorkoutRequest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val W1 = "/api/v1/workouts/w1"

/** Editing a logged workout: its own fields through the outbox; deletes and new sets online. */
class WorkoutEditSyncTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }

    @AfterTest
    fun closeDatabase() = db.close()

    private suspend fun local() = workouts.workout("w1").first()

    private val hills = UpdateWorkoutRequest(focus = "Hills", rpe = Patch.of(8), notes = Patch.clear())

    @Test
    fun aWorkoutEditShowsAtOnceAndARefreshKeepsItUntilSent() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1"))
        workouts.refresh("w1")

        workouts.updateWorkout("w1", hills)
        assertEquals("Hills", local()?.focus)
        assertEquals(8, local()?.rpe)

        workouts.refresh("w1")
        assertEquals("Hills", local()?.focus)

        server.on("PATCH", W1, 200, Samples.workout("w1"))
        sync.sync()
        val body = ApiJson.parseToJsonElement(server.sentTo("PATCH", W1).single().body!!).jsonObject
        assertEquals("Hills", body["focus"]!!.jsonPrimitive.content)
        assertTrue(body.containsKey("notes"), "a cleared field is sent as null")
    }

    @Test
    fun aWorkoutEditTheServerKeepsRefusingIsDroppedAndTheServersVersionShown() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1"))
        workouts.refresh("w1")
        server.on("PATCH", W1, 400, """{"error":"Bad","code":"VALIDATION_ERROR"}""")

        workouts.updateWorkout("w1", hills)
        repeat(SyncEngine.MAX_ATTEMPTS + 1) { sync.sync() }

        assertTrue(db.outbox().all().isEmpty())
        assertEquals("Strength", local()?.focus)
    }

    @Test
    fun deletingAWorkoutRemovesItAndReturnsItsRecycleBinItem() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("s1", 1)))
        workouts.refresh("w1")
        server.on("DELETE", W1, 200, """{"success":true,"recycleBinItemId":"rb1"}""")

        assertEquals("rb1", workouts.deleteWorkout("w1"))
        assertNull(local())
    }

    @Test
    fun anAddedSetGoesLast() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("s1", 1)))
        workouts.refresh("w1")
        server.on("POST", "$W1/sets", 201, Samples.setRow("s2", 1, reps = 5))

        workouts.addSet("w1", PostWorkoutsByIdSetsRequest(exerciseName = "back_squat", category = "strength", setNumber = 2))

        assertEquals(listOf("s1", "s2"), local()!!.exerciseSets.map { it.id })
    }

    @Test
    fun aDeletedSetTakesItsQueuedEditsWithItEvenIfTheServerHadAlreadyLostIt() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("s1", 1), Samples.setRow("s2", 1)))
        workouts.refresh("w1")
        server.on("DELETE", "$W1/sets/s1", 404, """{"error":"Exercise set not found","code":"NOT_FOUND"}""")
        workouts.updateSet("w1", "s1", PatchWorkoutsByIdSetsBySetIdRequest(reps = Patch.of(5)))

        workouts.deleteSet("w1", "s1")

        assertEquals(listOf("s2"), local()!!.exerciseSets.map { it.id })
        assertTrue(db.outbox().all().isEmpty())
    }

    @Test
    fun aSetTheServerWontDeleteStays() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("s1", 1)))
        workouts.refresh("w1")
        server.on("DELETE", "$W1/sets/s1", 403, """{"error":"Forbidden","code":"FORBIDDEN"}""")

        assertFailsWith<ApiException> { workouts.deleteSet("w1", "s1") }

        assertEquals(listOf("s1"), local()!!.exerciseSets.map { it.id })
    }

    @Test
    fun reorderedSetsTakeTheServersOrder() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("s1", 1), Samples.setRow("s2", 1), Samples.setRow("s3", 1)))
        workouts.refresh("w1")
        server.on("PATCH", "$W1/set-order", 200, "[${Samples.setRow("s3", 2)},${Samples.setRow("s1", 2)},${Samples.setRow("s2", 2)}]")

        workouts.reorderSets("w1", listOf("s3", "s1", "s2"))

        assertEquals(listOf("s3", "s1", "s2"), local()!!.exerciseSets.map { it.id })
        val sent = ApiJson.parseToJsonElement(server.sentTo("PATCH", "$W1/set-order").single().body!!).jsonObject
        assertEquals("[\"s3\",\"s1\",\"s2\"]", sent["setIds"].toString())
    }

    @Test
    fun theLatestWorkoutIsNullBeforeAnyIsLogged() = runTest {
        server.on("GET", "/api/v1/workouts/latest", 404, """{"error":"Workout not found","code":"NOT_FOUND"}""")
        assertNull(workouts.latest())

        server.on("GET", "/api/v1/workouts/latest", 200, Samples.workout("w7"))
        assertEquals("w7", workouts.latest()?.id)
    }

    @Test
    fun linkingAPlanDaySendsItAndShowsTheServersWorkout() = runTest {
        server.on("PATCH", "$W1/plan-day", 200, Samples.workout("w1"))
        server.on("GET", W1, 200, Samples.workout("w1").replace("\"mainWorkout\"", "\"planDayId\":\"d9\",\"mainWorkout\""))

        workouts.linkPlanDay("w1", "d9")

        assertEquals("d9", local()?.planDayId)
        assertEquals("""{"planDayId":"d9"}""", server.sentTo("PATCH", "$W1/plan-day").single().body)
    }

    @Test
    fun aRecordingIsLinkedToTheSessionPicked() = runTest {
        server.on("POST", "$W1/device-link", 200, Samples.workout("w2"))

        workouts.linkDevice("w1", planDayId = "d9")

        assertEquals("""{"planDayId":"d9"}""", server.sentTo("POST", "$W1/device-link").single().body)
    }

    @Test
    fun aRecordingIsUnlinkedAndASuggestionDismissed() = runTest {
        server.on("DELETE", "$W1/device-link", 200, """{"log":null,"standalone":${Samples.workout("w1")}}""")
        server.on("DELETE", "$W1/device-link/suggestion", 200, Samples.workout("w1"))

        workouts.unlinkDevice("w1")
        workouts.dismissDeviceSuggestion("w1")

        assertEquals(1, server.sentTo("DELETE", "$W1/device-link").size)
        assertEquals(1, server.sentTo("DELETE", "$W1/device-link/suggestion").size)
    }
}
