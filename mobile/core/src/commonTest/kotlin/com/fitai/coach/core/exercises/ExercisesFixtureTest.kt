package com.fitai.coach.core.exercises

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class ExercisesFixtureTest {
    @Test
    fun normalizeExerciseName() = assertFixtureSuite("exercises.normalizeExerciseName") { input ->
        JsonPrimitive(normalizeExerciseName(input.jsonPrimitive.content))
    }

    @Test
    fun isRunningExerciseName() = assertFixtureSuite("exercises.isRunningExerciseName") { input ->
        JsonPrimitive(isRunningExerciseName(input.jsonPrimitive.content))
    }

    @Test
    fun knownExerciseLabel() = assertFixtureSuite("exercises.knownExerciseLabel") { input ->
        JsonPrimitive(knownExerciseLabel(input.jsonPrimitive.content))
    }

    @Test
    fun implementFor() = assertFixtureSuite("exercises.implementFor") { input ->
        JsonPrimitive(implementFor(input.jsonPrimitive.content)?.wireValue)
    }

    @Test
    fun loadIncrement() = assertFixtureSuite("exercises.loadIncrement") { input ->
        val (name, unit) = input.jsonArray.map { it.jsonPrimitive.content }
        JsonPrimitive(loadIncrement(name, unit))
    }

    /**
     * The slug keeps only a–z, 0–9 and drops ' and ’, so Kotlin's `lowercase()`
     * must turn exactly the same characters into those as JS `toLowerCase()`
     * does. In Node 22 that is "İ" (to "i" + U+0307) and the Kelvin sign (to
     * "k"), besides ’ itself; the fixtures run both through the TypeScript.
     * This checks every other code point on the Kotlin side.
     */
    @Test
    fun lowercaseMakesSlugCharactersFromTheSameNonAsciiCharactersAsJs() {
        val found = mutableListOf<Int>()
        for (codePoint in 0x80..0x10FFFF) {
            if (codePoint in 0xD800..0xDFFF) continue
            val lowered = codePointString(codePoint).lowercase()
            if (lowered.any { it in 'a'..'z' || it in '0'..'9' || it == '\'' || it == '’' }) found += codePoint
        }
        assertEquals(listOf(0x130, 0x2019, 0x212A), found)
    }

    private fun codePointString(codePoint: Int): String {
        if (codePoint < 0x10000) return codePoint.toChar().toString()
        val offset = codePoint - 0x10000
        return charArrayOf((0xD800 + (offset shr 10)).toChar(), (0xDC00 + (offset and 0x3FF)).toChar()).concatToString()
    }
}
