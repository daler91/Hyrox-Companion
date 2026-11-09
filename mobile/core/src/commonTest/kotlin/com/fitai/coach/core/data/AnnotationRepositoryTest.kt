package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.TimelineAnnotation
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

private const val NOTES = "/api/v1/timeline-annotations"

private fun note(id: String, type: String = "injury", note: String? = "Calf strain") =
    """{"id":"$id","userId":"u1","startDate":"2026-11-02","endDate":"2026-11-05","type":"$type",""" +
        """"note":${note?.let { "\"$it\"" } ?: "null"}}"""

class AnnotationRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val notes = AnnotationRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private fun body(method: String, path: String) =
        ApiJson.parseToJsonElement(server.sentTo(method, path).single().body!!).jsonObject

    @Test
    fun theNotesAreKeptOnTheDevice() = runTest {
        server.on("GET", NOTES, 200, "[${note("a1")},${note("a2", type = "travel", note = null)}]")

        notes.refresh()

        val kept = notes.annotations.first()!!
        assertEquals(listOf("a1", "a2"), kept.map { it.id })
        assertEquals(TimelineAnnotation.Type.Travel, kept[1].type)
    }

    @Test
    fun aNewNoteIsSentTrimmedAndTheListRefreshed() = runTest {
        server.on("POST", NOTES, 201, note("a1"))
        server.on("GET", NOTES, 200, "[${note("a1")}]")

        notes.save(null, AnnotationDraft(TimelineAnnotation.Type.Injury, "2026-11-02", "2026-11-05", "  Calf strain  "))

        val sent = body("POST", NOTES)
        assertEquals("injury", sent["type"]!!.jsonPrimitive.content)
        assertEquals("2026-11-05", sent["endDate"]!!.jsonPrimitive.content)
        assertEquals("Calf strain", sent["note"]!!.jsonPrimitive.content)
        assertEquals(listOf("a1"), notes.annotations.first()!!.map { it.id })
    }

    @Test
    fun aNewNoteWithNoTextSendsNone() = runTest {
        server.on("POST", NOTES, 201, note("a1", note = null))
        server.on("GET", NOTES, 200, "[]")

        notes.save(null, AnnotationDraft(TimelineAnnotation.Type.Rest, "2026-11-02", "2026-11-02", " "))

        assertFalse(body("POST", NOTES).containsKey("note"))
    }

    @Test
    fun anEditClearingTheTextSendsNull() = runTest {
        server.on("PATCH", "$NOTES/a1", 200, note("a1", note = null))
        server.on("GET", NOTES, 200, "[${note("a1", type = "illness", note = null)}]")

        notes.save("a1", AnnotationDraft(TimelineAnnotation.Type.Illness, "2026-11-02", "2026-11-03", ""))

        val sent = body("PATCH", "$NOTES/a1")
        assertEquals("illness", sent["type"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, sent["note"])
        assertEquals(TimelineAnnotation.Type.Illness, notes.annotations.first()!!.single().type)
    }

    @Test
    fun aDeletedNoteLeavesTheList() = runTest {
        server.on("GET", NOTES, 200, "[${note("a1")}]")
        notes.refresh()
        server.on("DELETE", "$NOTES/a1", 200, """{"success":true}""")
        server.on("GET", NOTES, 200, "[]")

        notes.delete("a1")

        assertEquals(emptyList(), notes.annotations.first())
    }

    @Test
    fun aRefusedSaveKeepsTheList() = runTest {
        server.on("GET", NOTES, 200, "[${note("a1")}]")
        notes.refresh()
        server.on("POST", NOTES, 400, """{"error":"endDate must be on or after startDate","code":"VALIDATION_ERROR"}""")

        assertFailsWith<ApiException> {
            notes.save(null, AnnotationDraft(TimelineAnnotation.Type.Injury, "2026-11-05", "2026-11-02", ""))
        }

        assertEquals(listOf("a1"), notes.annotations.first()!!.map { it.id })
    }
}
