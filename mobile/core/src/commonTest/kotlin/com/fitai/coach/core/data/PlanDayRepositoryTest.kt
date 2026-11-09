package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdSetsBySetIdRequest
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

private const val DAY = "/api/v1/plans/days/d1"

class PlanDayRepositoryTest {
    private val server = FakeServer()
    private val planDays = PlanDayRepository(server.api)

    @Test
    fun aDaysSetsComeInTheirOrder() = runTest {
        server.on("GET", "$DAY/sets", 200, "[${Samples.setRow("s2", 1)},${Samples.setRow("s1", 1)}]")

        assertEquals(listOf("s2", "s1"), planDays.sets("d1").map { it.id })
    }

    @Test
    fun anEditIsMadeAgainstTheVersionTheDeviceSaw() = runTest {
        server.on("PATCH", "$DAY/sets/s1", 200, Samples.setRow("s1", 4, reps = 8))

        val saved = planDays.updateSet("d1", "s1", version = 3, PatchPlansDaysByDayIdSetsBySetIdRequest(reps = Patch.of(8)))

        assertEquals(8, saved.reps)
        val body = ApiJson.parseToJsonElement(server.sentTo("PATCH", "$DAY/sets/s1").single().body!!).jsonObject
        assertEquals(3L, body["expectedVersion"]!!.jsonPrimitive.long)
    }

    @Test
    fun aSetAlreadyGoneCountsAsDeletedButOtherRefusalsDoNot() = runTest {
        server.on("DELETE", "$DAY/sets/s1", 404, """{"error":"Exercise set not found","code":"NOT_FOUND"}""")
        planDays.deleteSet("d1", "s1")

        server.on("DELETE", "$DAY/sets/s2", 403, """{"error":"Forbidden","code":"FORBIDDEN"}""")
        assertFailsWith<ApiException> { planDays.deleteSet("d1", "s2") }
    }

    @Test
    fun readingTheTextSendsTheTextTheDeviceHas() = runTest {
        server.on("POST", "$DAY/reparse", 200, """{"exercises":[],"saved":true,"setCount":4,"rejectedCount":0,"rejectionReasons":[]}""")

        val result = planDays.reparse("d1", mainWorkout = "4 x 1 km", accessory = null)

        assertEquals(4L, result.setCount)
        val body = ApiJson.parseToJsonElement(server.sentTo("POST", "$DAY/reparse").single().body!!).jsonObject
        assertEquals(setOf("mainWorkout"), body.keys)
    }
}
