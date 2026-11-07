package com.fitai.coach.core.fixtures

import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.js.jsToFixed
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test

class JsMathFixtureTest {
    @Test
    fun mathRound() = assertFixtureSuite("js.mathRound") { input ->
        JsonPrimitive(jsRound(input.jsonPrimitive.double))
    }

    @Test
    fun toFixed() = assertFixtureSuite("js.toFixed") { input ->
        val (x, digits) = input.jsonArray
        JsonPrimitive(jsToFixed(x.jsonPrimitive.double, digits.jsonPrimitive.int))
    }
}
