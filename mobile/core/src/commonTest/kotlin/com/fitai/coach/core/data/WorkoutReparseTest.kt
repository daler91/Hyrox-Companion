package com.fitai.coach.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

private const val W1 = "/api/v1/workouts/w1"
private const val READ_FOUR = """{"exercises":[],"saved":true,"setCount":4,"rejectedCount":0,"rejectionReasons":[]}"""

/** Reading a logged workout's text, or a photo of it, into sets: the sets it had are replaced. */
class WorkoutReparseTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { newIdempotencyKey() })
    private val workouts = WorkoutRepository(db, server.api, sync) { "live-key" }

    @AfterTest
    fun closeDatabase() = db.close()

    private suspend fun setIds() = workouts.workout("w1").first()?.exerciseSets?.map { it.id }

    @Test
    fun readingTheTextLetsTheServerUseTheTextItHasAndShowsTheNewSets() = runTest {
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("old", 1)))
        workouts.refresh("w1")
        server.on("POST", "$W1/reparse", 200, READ_FOUR)
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("n1", 1), Samples.setRow("n2", 1)))

        val result = workouts.reparse("w1")

        assertEquals(4L, result.setCount)
        assertEquals("{}", server.sentTo("POST", "$W1/reparse").single().body)
        assertEquals(listOf("n1", "n2"), setIds())
    }

    @Test
    fun aPhotoIsSentWithItsTypeAndAnUnknownTypeAsJpeg() = runTest {
        server.on("POST", "$W1/reparse-from-image", 200, READ_FOUR)
        server.on("GET", W1, 200, Samples.workout("w1", Samples.setRow("n1", 1)))

        workouts.reparseFromImage("w1", EncodedImage("cG5n", "image/png"))
        workouts.reparseFromImage("w1", EncodedImage("aGVpYw", "image/heic"))

        assertEquals(
            listOf("""{"mimeType":"image/png","imageBase64":"cG5n"}""", """{"mimeType":"image/jpeg","imageBase64":"aGVpYw"}"""),
            server.sentTo("POST", "$W1/reparse-from-image").map { it.body },
        )
        assertEquals(listOf("n1"), setIds())
    }
}
