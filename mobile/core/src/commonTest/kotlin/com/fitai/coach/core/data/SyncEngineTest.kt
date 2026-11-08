package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val WORKOUTS = "/api/v1/workouts"

@OptIn(ExperimentalCoroutinesApi::class)
class SyncEngineTest {
    private val server = FakeServer()
    private val store = testDatabaseStore()
    private val db = store.open("u1")
    private var clock = 1_000L
    private var keys = 0
    private val sync = SyncEngine(db, server.api, now = { clock }, newKey = { "key-${++keys}" })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }

    @AfterTest
    fun closeDatabase() = db.close()

    private fun workout(name: String) = CreateWorkoutRequest(date = "2026-11-02", focus = name, mainWorkout = name)

    private suspend fun queued() = db.outbox().all()

    private fun TestScope.collectEvents(): List<SyncEvent> {
        val events = mutableListOf<SyncEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { sync.events.collect { events += it } }
        return events
    }

    @Test
    fun sendsQueuedWritesInOrderEachWithItsOwnIdempotencyKey() = runTest {
        server.on("POST", WORKOUTS, 201)
        workouts.createWorkout(workout("first"))
        workouts.createWorkout(workout("second"))

        val result = sync.sync()

        assertEquals(SyncResult(sent = 2, dropped = 0, conflicts = 0, halted = false), result)
        val sent = server.sentTo("POST", WORKOUTS)
        val focuses = sent.map { ApiJson.parseToJsonElement(it.body!!).jsonObject["focus"]!!.jsonPrimitive.content }
        assertEquals(listOf("first", "second"), focuses)
        assertEquals(listOf("key-1", "key-2"), sent.map { it.idempotencyKey })
        assertTrue(queued().isEmpty())
    }

    @Test
    fun aWriteWithNoAnswerStaysQueuedAndIsResentUnderTheSameKey() = runTest {
        var online = false
        server.on("POST", WORKOUTS) { if (online) Reply.Respond(201) else Reply.NoAnswer }
        workouts.createWorkout(workout("run"))

        val offline = sync.sync()
        online = true
        val back = sync.sync()

        assertTrue(offline.halted)
        assertEquals(1, back.sent)
        assertEquals(listOf("key-1", "key-1"), server.sentTo("POST", WORKOUTS).map { it.idempotencyKey })
    }

    @Test
    fun answersThatSayNothingAboutTheWriteSpendNoRetryBudget() = runTest {
        val answers = ArrayDeque(
            listOf(
                Reply.Respond(401, """{"error":"Unauthorized","code":"UNAUTHORIZED"}"""),
                Reply.Respond(408),
                Reply.Respond(429),
                Reply.Respond(503),
                Reply.Respond(409, """{"error":"Busy","code":"IDEMPOTENT_REQUEST_IN_PROGRESS"}"""),
            ),
        )
        server.on("POST", WORKOUTS) { answers.removeFirst() }
        workouts.createWorkout(workout("run"))

        repeat(5) { assertTrue(sync.sync().halted) }

        val entry = queued().single()
        assertEquals(0, entry.attempts)
        assertEquals(0, entry.serverErrors)
    }

    @Test
    fun aPlain500CountsAsAServerErrorNotAnAttempt() = runTest {
        server.on("POST", WORKOUTS, 500)
        workouts.createWorkout(workout("run"))

        sync.sync()

        val entry = queued().single()
        assertEquals(0, entry.attempts)
        assertEquals(1, entry.serverErrors)
    }

    @Test
    fun aRefusedWriteHoldsTheQueueThenIsDroppedAfterFiveAttempts() = runTest {
        val events = collectEvents()
        server.on("POST", WORKOUTS) { sent ->
            if (sent.idempotencyKey == "key-1") Reply.Respond(400, """{"error":"Bad","code":"VALIDATION_ERROR"}""") else Reply.Respond(201)
        }
        workouts.createWorkout(workout("bad"))
        workouts.createWorkout(workout("good"))

        repeat(SyncEngine.MAX_ATTEMPTS) { assertTrue(sync.sync().halted) }
        assertEquals(listOf("key-1"), server.requests.map { it.idempotencyKey }.distinct())

        val result = sync.sync()

        assertEquals(SyncResult(sent = 1, dropped = 1, conflicts = 0, halted = false), result)
        assertEquals("key-2", server.requests.last().idempotencyKey)
        assertEquals(SyncEvent.Dropped("PostWorkouts", DropReason.MaxRetries), events.first())
        assertEquals(SyncEvent.Synced(1), events.last())
    }

    @Test
    fun aWriteOlderThanSevenDaysIsDroppedUnsent() = runTest {
        workouts.createWorkout(workout("old"))
        clock += SyncEngine.MAX_AGE_MS + 1

        val result = sync.sync()

        assertEquals(1, result.dropped)
        assertTrue(server.requests.isEmpty())
    }

    @Test
    fun theOutboxOutlivesTheDatabaseConnection() = runTest {
        workouts.createWorkout(workout("run"))
        db.close()

        val reopened = store.open("u1")

        assertEquals(1, reopened.outbox().all().size)
        reopened.close()
    }

    @Test
    fun retryDelayDoublesFromFiveSecondsUpToFiveMinutes() {
        assertEquals(
            listOf(5_000L, 10_000L, 20_000L, 40_000L, 80_000L, 160_000L, 300_000L, 300_000L),
            (0..7).map { SyncEngine.retryDelay(it) },
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ExerciseSetSyncTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }

    @AfterTest
    fun closeDatabase() = db.close()

    private fun reps(value: Int) = PatchWorkoutsByIdSetsBySetIdRequest(reps = Patch.Value(value))

    private fun expectedVersionOf(sent: Sent): Long? =
        ApiJson.parseToJsonElement(sent.body!!).jsonObject["expectedVersion"]?.jsonPrimitive?.long

    /** The server's PATCH: bumps the version by one and echoes the reps. */
    private fun acceptPatches(setId: String) = server.on("PATCH", "$WORKOUTS/w1/sets/$setId") { sent ->
        val body = ApiJson.parseToJsonElement(sent.body!!).jsonObject
        val version = body["expectedVersion"]!!.jsonPrimitive.long + 1
        Reply.Respond(200, Samples.setRow(setId, version, reps = body["reps"]?.jsonPrimitive?.int))
    }

    private suspend fun localSet(id: String) = workouts.workout("w1").first()!!.exerciseSets.single { it.id == id }

    @Test
    fun anEditShowsAtOnceAndEachPatchSendsTheVersionTheLastAnswerReported() = runTest {
        server.on("GET", "$WORKOUTS/w1", 200, Samples.workout("w1", Samples.setRow("s1", version = 3)))
        workouts.refresh("w1")
        acceptPatches("s1")

        workouts.updateSet("w1", "s1", reps(5))
        workouts.updateSet("w1", "s1", reps(6))
        assertEquals(6, localSet("s1").reps)

        sync.sync()

        assertEquals(listOf(3L, 4L), server.sentTo("PATCH", "$WORKOUTS/w1/sets/s1").map(::expectedVersionOf))
        val synced = localSet("s1")
        assertEquals(6, synced.reps)
        assertEquals(5L, synced.version)
    }

    @Test
    fun aConflictDropsTheQueuedEditsToThatSetAndShowsTheOtherDevicesRow() = runTest {
        server.on("GET", "$WORKOUTS/w1", 200, Samples.workout("w1", Samples.setRow("s1", 3, reps = 1), Samples.setRow("s2", 1, reps = 1)))
        workouts.refresh("w1")
        server.on("PATCH", "$WORKOUTS/w1/sets/s1", 409, """{"error":"Exercise set was modified elsewhere","code":"CONFLICT"}""")
        acceptPatches("s2")
        val events = mutableListOf<SyncEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { sync.events.collect { events += it } }

        workouts.updateSet("w1", "s1", reps(5))
        workouts.updateSet("w1", "s1", reps(6))
        workouts.updateSet("w1", "s2", reps(9))
        // Meanwhile another device saved s1.
        server.on("GET", "$WORKOUTS/w1", 200, Samples.workout("w1", Samples.setRow("s1", 7, reps = 10), Samples.setRow("s2", 1, reps = 1)))

        val result = sync.sync()

        assertEquals(SyncResult(sent = 1, dropped = 0, conflicts = 1, halted = false), result)
        assertEquals(1, server.sentTo("PATCH", "$WORKOUTS/w1/sets/s1").size)
        val s1 = localSet("s1")
        assertEquals(10, s1.reps)
        assertEquals(7L, s1.version)
        assertEquals(9, localSet("s2").reps)
        assertEquals(SyncEvent.Conflict("set:s1"), events.first())
    }

    @Test
    fun aRefreshKeepsASetWithAnUnsentEditAndTheVersionItWasMadeAgainst() = runTest {
        server.on("GET", "$WORKOUTS/w1", 200, Samples.workout("w1", Samples.setRow("s1", 3, reps = 1), Samples.setRow("s2", 1, reps = 1)))
        workouts.refresh("w1")
        workouts.updateSet("w1", "s1", reps(5))

        server.on("GET", "$WORKOUTS/w1", 200, Samples.workout("w1", Samples.setRow("s1", 4, reps = 8), Samples.setRow("s2", 2, reps = 2)))
        workouts.refresh("w1")

        val s1 = localSet("s1")
        assertEquals(5, s1.reps)
        assertEquals(3L, s1.version)
        assertEquals(2, localSet("s2").reps)
    }

    @Test
    fun anEditToASetNotOnTheDeviceIsSentWithoutAVersion() = runTest {
        server.on("PATCH", "$WORKOUTS/w1/sets/s9", 200, Samples.setRow("s9", 2))

        workouts.updateSet("w1", "s9", reps(5))
        sync.sync()

        assertNull(expectedVersionOf(server.requests.single()))
    }
}
