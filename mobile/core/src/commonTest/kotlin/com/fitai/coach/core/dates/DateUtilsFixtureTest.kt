package com.fitai.coach.core.dates

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test

/** Pins DateUtils.kt to shared/dateUtils.ts (script/mobile-fixtures/suites/dateUtils.ts). */
class DateUtilsFixtureTest {
    @Test
    fun constants() = assertFixtureSuite("dateUtils.constants") {
        buildJsonObject {
            put("MIN_PLAN_WEEKS", MIN_PLAN_WEEKS)
            put("MAX_PLAN_WEEKS", MAX_PLAN_WEEKS)
            put("PLAN_WEEKDAYS", strings(PLAN_WEEKDAYS))
        }
    }

    @Test
    fun dayDiffCases() = assertFixtureSuite("dateUtils.dayDiff") { input ->
        val (start, end) = input.jsonArray.map { it.jsonPrimitive.content }
        jsNumber(dayDiff(start, end))
    }

    @Test
    fun planSpanWeeksCases() = assertFixtureSuite("dateUtils.planSpanWeeks") { input ->
        val (start, end, race) = spanInput(input)
        jsNumber(planSpanWeeks(start, end, endDateIsRaceDate = race))
    }

    @Test
    fun computePlanWeeksCases() = assertFixtureSuite("dateUtils.computePlanWeeks") { input ->
        val (start, end, race) = spanInput(input)
        jsNumber(computePlanWeeks(start, end, endDateIsRaceDate = race))
    }

    @Test
    fun isIsoCalendarDateCases() = assertFixtureSuite("dateUtils.isIsoCalendarDate") { input ->
        JsonPrimitive(isIsoCalendarDate(input.jsonPrimitive.content))
    }

    @Test
    fun addDaysToIsoDateCases() = assertFixtureSuite("dateUtils.addDaysToISODate") { input ->
        val (date, days) = input.jsonArray
        JsonPrimitive(addDaysToIsoDate(date.jsonPrimitive.content, days.jsonPrimitive.int))
    }

    @Test
    fun weekdayIndexCases() = assertFixtureSuite("dateUtils.weekdayIndex") { input ->
        jsNumber(weekdayIndex(input.jsonPrimitive.content))
    }

    @Test
    fun weekdayNameCases() = assertFixtureSuite("dateUtils.weekdayName") { input ->
        JsonPrimitive(weekdayName(input.jsonPrimitive.content))
    }

    @Test
    fun planWeekOneMondayCases() = assertFixtureSuite("dateUtils.planWeekOneMonday") { input ->
        JsonPrimitive(planWeekOneMonday(input.jsonPrimitive.content))
    }

    @Test
    fun weekOneDaysBeforeStartCases() = assertFixtureSuite("dateUtils.weekOneDaysBeforeStart") { input ->
        strings(weekOneDaysBeforeStart(input.jsonPrimitive.content))
    }

    @Test
    fun nextPlanStartDateCases() = assertFixtureSuite("dateUtils.nextPlanStartDate") { input ->
        JsonPrimitive(nextPlanStartDate(input.jsonPrimitive.content))
    }
}

/** `[start, end]` or `[start, end, { endDateIsRaceDate? }]`. */
private fun spanInput(input: JsonElement): Triple<String, String, Boolean> {
    val args = input.jsonArray
    val race = args.getOrNull(2)?.jsonObject?.get("endDateIsRaceDate")?.jsonPrimitive?.boolean ?: false
    return Triple(args[0].jsonPrimitive.content, args[1].jsonPrimitive.content, race)
}

/** The port's Int? as the fixture writes the TypeScript's number: null stands for NaN, written "NaN". */
private fun jsNumber(value: Int?): JsonPrimitive = value?.let(::JsonPrimitive) ?: JsonPrimitive("NaN")

private fun strings(values: List<String>): JsonArray = JsonArray(values.map(::JsonPrimitive))
