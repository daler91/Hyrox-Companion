package com.fitai.coach.core.data

import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class CachedJsonTest {
    @Test
    fun aPatchReplacesTheFieldsItHasAndKeepsTheRest() {
        assertEquals(
            """{"id":"s1","reps":6,"weight":null,"notes":"easy"}""",
            mergePatch("""{"id":"s1","reps":5,"weight":80,"notes":"easy"}""", """{"reps":6,"weight":null}"""),
        )
    }

    @Test
    fun withFieldAddsToAnObjectOrStartsOne() {
        assertEquals("""{"reps":6,"expectedVersion":3}""", withField("""{"reps":6}""", "expectedVersion", JsonPrimitive(3)))
        assertEquals("""{"expectedVersion":3}""", withField(null, "expectedVersion", JsonPrimitive(3)))
    }

    @Test
    fun databaseFileNamesNeverCarryAPath() {
        assertEquals("fitai-user_2abcXYZ.db", databaseFileName("user_2abcXYZ"))
        assertEquals("fitai-x2e2e2f61.db", databaseFileName("../a"))
    }
}
