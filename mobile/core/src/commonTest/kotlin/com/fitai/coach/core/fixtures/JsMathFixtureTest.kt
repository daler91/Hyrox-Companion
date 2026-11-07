package com.fitai.coach.core.fixtures

import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.js.jsToFixed
import com.fitai.coach.core.js.jsTrim
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class JsMathFixtureTest {
    @Test
    fun mathRound() = assertFixtureSuite("js.mathRound") { input ->
        JsonPrimitive(jsRound(input.jsonPrimitive.double))
    }

    @Test
    fun numberToString() = assertFixtureSuite("js.numberToString") { input ->
        JsonPrimitive(jsNumberToString(input.jsonPrimitive.double))
    }

    @Test
    fun trim() = assertFixtureSuite("js.trim") { input ->
        JsonPrimitive(jsTrim(input.jsonPrimitive.content))
    }

    /** JSON writes -0 as 0, so the fixtures cannot pin the sign of a zero; this does. */
    @Test
    fun mathRoundKeepsTheSignOfZero() {
        for (x in listOf(-0.0, -0.4, -0.5, -0.49999999999999994)) {
            assertEquals(Double.NEGATIVE_INFINITY, 1.0 / jsRound(x), "Math.round($x) is -0")
        }
        for (x in listOf(0.0, 0.4, 0.49999999999999994)) {
            assertEquals(Double.POSITIVE_INFINITY, 1.0 / jsRound(x), "Math.round($x) is +0")
        }
    }

    @Test
    fun toFixed() = assertFixtureSuite("js.toFixed") { input ->
        val (x, digits) = input.jsonArray
        JsonPrimitive(jsToFixed(x.jsonPrimitive.double, digits.jsonPrimitive.int))
    }
}
