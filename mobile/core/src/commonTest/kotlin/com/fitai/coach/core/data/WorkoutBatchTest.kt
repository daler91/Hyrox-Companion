package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.TimelineEntry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val BULK = "/api/v1/workouts/bulk-delete"
private const val COMBINE = "/api/v1/workouts/combine"

private fun entry(id: String, status: String, planDayId: String? = null, workoutLogId: String? = null) =
    """{"id":"$id","date":"2026-11-08","type":"${if (workoutLogId != null) "logged" else "planned"}","status":"$status",""" +
        """"focus":"$id","mainWorkout":""""" +
        (planDayId?.let { ""","planDayId":"$it"""" } ?: "") +
        (workoutLogId?.let { ""","workoutLogId":"$it"""" } ?: "") + "}"

/** The combined workout the server answers with. */
private fun combined(focus: String) =
    """{"id":"w9","userId":"u1","date":"2026-11-08","focus":"$focus","mainWorkout":"","countsAsTraining":true,""" +
        """"autoLinkRecordingOnly":false,"deviceActivity":{}}"""

/** Deleting a selection with one undo, and combining workouts into one. */
class WorkoutBatchTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { "key" })
    private val timeline = TimelineRepository(db, server.api, sync, CacheStore(db) { 0L })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }
    private val batches = WorkoutBatchRepository(db, server.api, timeline)

    @AfterTest
    fun closeDatabase() = db.close()

    private suspend fun seed(vararg entries: String) {
        server.on("GET", "/api/v1/timeline", 200, "[" + entries.joinToString(",") + "]")
        timeline.refresh()
    }

    private suspend fun ids() = timeline.entries.first().map { it.id }

    private fun decode(json: String) = ApiJson.decodeFromString(TimelineEntry.serializer(), json)

    @Test
    fun aLoggedEntryDeletesItsWorkoutAndOnlyAnUnloggedOneItsPlanDay() {
        val targets = bulkDeleteTargets(
            listOf(
                decode(entry("done", "completed", planDayId = "d1", workoutLogId = "w1")),
                decode(entry("planned", "planned", planDayId = "d2")),
                decode(entry("extra", "completed", workoutLogId = "w2")),
                decode(entry("again", "completed", workoutLogId = "w2")),
            ),
        )

        assertEquals(BulkDeleteTargets(listOf("w1", "w2"), listOf("d2")), targets)
        assertEquals(3, targets.size)
    }

    @Test
    fun aSelectionGoesInOneCallAndLeavesTheTimeline() = runTest {
        val extra = entry("log-w2", "completed", workoutLogId = "w2")
        val planned = entry("plan-d2", "planned", planDayId = "d2")
        val kept = entry("plan-d3", "planned", planDayId = "d3")
        seed(extra, planned, kept)
        server.on("GET", "/api/v1/workouts/w2", 200, Samples.workout("w2"))
        workouts.refresh("w2")
        server.on(
            "POST",
            BULK,
            200,
            """{"success":true,"deletedWorkoutLogIds":["w2"],"deletedPlanDayIds":["d2"],"deletedCount":2,"batchId":"b1",""" +
                """"recycleBinItemIds":["r1","r2"]}""",
        )

        val result = batches.deleteAll(listOf(decode(extra), decode(planned)))

        assertEquals(BulkDeleteResult(deletedCount = 2, batchId = "b1"), result)
        assertEquals("""{"workoutLogIds":["w2"],"planDayIds":["d2"]}""", server.sentTo("POST", BULK).single().body)
        assertEquals(listOf("plan-d3"), ids())
        assertNull(workouts.workout("w2").first())
    }

    @Test
    fun onlyTheListsWithIdsAreSent() = runTest {
        server.on(
            "POST",
            BULK,
            200,
            """{"success":true,"deletedWorkoutLogIds":["w2"],"deletedPlanDayIds":[],"deletedCount":1,"batchId":"b1",""" +
                """"recycleBinItemIds":["r1"]}""",
        )

        batches.deleteAll(listOf(decode(entry("log-w2", "completed", workoutLogId = "w2"))))

        assertEquals("""{"workoutLogIds":["w2"]}""", server.sentTo("POST", BULK).single().body)
    }

    @Test
    fun undoingPutsTheWholeBatchBackAndSaysWhatDidNotComeBackExactly() = runTest {
        server.on(
            "POST",
            "/api/v1/recycle-bin/batches/b1/restore",
            200,
            """{"ok":true,"batchId":"b1","restored":[{"entityType":"workout_log","entityId":"w2"}],""" +
                """"warnings":["One session's plan day was already replaced."]}""",
        )
        server.on("GET", "/api/v1/timeline", 200, "[${entry("log-w2", "completed", workoutLogId = "w2")}]")

        val warnings = batches.restoreBatch("b1")

        assertEquals(listOf("One session's plan day was already replaced."), warnings)
        assertEquals(listOf("log-w2"), ids())
    }

    @Test
    fun combiningKeepsTheFirstCompletedDayAndSkipsAnyOther() = runTest {
        seed(entry("log-w1", "completed", workoutLogId = "w1"), entry("log-w2", "completed", workoutLogId = "w2"))
        server.on(
            "POST",
            COMBINE,
            201,
            combined("Run + Lift"),
        )

        val id = batches.combine(
            listOf(CombineSource("w1", planDayId = "d1"), CombineSource("w2"), CombineSource("w3", planDayId = "d3")),
            CombinedWorkout(date = "2026-11-08", focus = "Run + Lift", mainWorkout = "5 km\n---\nSquats", duration = 75, calories = 600),
        )

        assertEquals("w9", id)
        assertEquals(
            """{"newWorkout":{"date":"2026-11-08","focus":"Run + Lift","mainWorkout":"5 km\n---\nSquats","duration":75,""" +
                """"planDayId":"d1","calories":600},"deleteWorkoutIds":["w1","w2","w3"],"skipPlanDayIds":["d3"]}""",
            server.sentTo("POST", COMBINE).single().body,
        )
        assertEquals(emptyList(), ids())
    }

    @Test
    fun combiningUnplannedWorkoutsSendsNoPlanDays() = runTest {
        server.on(
            "POST",
            COMBINE,
            201,
            combined("Run"),
        )

        batches.combine(listOf(CombineSource("w1"), CombineSource("w2")), CombinedWorkout("2026-11-08", "Run", "", notes = "Felt good"))

        assertEquals(
            """{"newWorkout":{"date":"2026-11-08","focus":"Run","mainWorkout":"","notes":"Felt good"},"deleteWorkoutIds":["w1","w2"]}""",
            server.sentTo("POST", COMBINE).single().body,
        )
    }
}
