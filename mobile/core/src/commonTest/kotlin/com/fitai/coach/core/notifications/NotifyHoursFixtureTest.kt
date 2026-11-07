package com.fitai.coach.core.notifications

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.test.Test

/** Pins NotifyHours.kt to shared/notifyHours.ts (script/mobile-fixtures/suites/notifyHours.ts). */
class NotifyHoursFixtureTest {
    @Test
    fun constants() = assertFixtureSuite("notifyHours.constants") {
        buildJsonObject {
            put("DEFAULT_NOTIFY_HOUR", DEFAULT_NOTIFY_HOUR)
            put("BRIEF_TOMORROW_FROM_HOUR", BRIEF_TOMORROW_FROM_HOUR)
            put("WEEKLY_REVIEW_SUNDAY_EVENING_HOUR", WEEKLY_REVIEW_SUNDAY_EVENING_HOUR)
            putJsonArray("EMAIL_NOTIFY_KINDS") { EMAIL_NOTIFY_KINDS.forEach { add(JsonPrimitive(it.wireValue)) } }
            putJsonObject("NOTIFY_HOUR_FIELD") { NOTIFY_HOUR_FIELD.forEach { (kind, field) -> put(kind.wireValue, field) } }
        }
    }

    @Test
    fun isValidNotifyHourCases() = assertFixtureSuite("notifyHours.isValidNotifyHour") { input ->
        JsonPrimitive(isValidNotifyHour(input.toKotlinValue()))
    }

    @Test
    fun fallbackNotifyHourCases() = assertFixtureSuite("notifyHours.fallbackNotifyHour") { input ->
        val args = input.jsonObject
        JsonPrimitive(fallbackNotifyHour(args.kind(), args["notifyHour"].toKotlinValue() as Number?))
    }

    @Test
    fun resolveNotifyHourCases() = assertFixtureSuite("notifyHours.resolveNotifyHour") { input ->
        val args = input.jsonObject
        val prefs = args.getValue("prefs").jsonObject
        fun hour(field: String) = prefs[field].toKotlinValue() as Number?
        val preferences = NotifyHourPreferences(
            notifyHour = hour("notifyHour"),
            notifyHourWeeklySummary = hour("notifyHourWeeklySummary"),
            notifyHourMissedReminder = hour("notifyHourMissedReminder"),
            notifyHourWeeklyReviewReminder = hour("notifyHourWeeklyReviewReminder"),
            notifyHourTodaySession = hour("notifyHourTodaySession"),
            notifyHourAnalysisDigest = hour("notifyHourAnalysisDigest"),
        )
        JsonPrimitive(resolveNotifyHour(preferences, args.kind()))
    }
}

private fun JsonObject.kind(): EmailNotifyKind {
    val wire = getValue("kind").jsonPrimitive.content
    return EmailNotifyKind.fromWireValue(wire) ?: error("Unknown email kind $wire")
}

/**
 * A fixture value as a Kotlin caller would pass it: absent or null as null,
 * whole numbers as Int and others as Double, the harness's "NaN" and
 * "Infinity" strings as those Doubles, other strings, booleans, arrays and
 * objects as themselves.
 */
private fun JsonElement?.toKotlinValue(): Any? = when (this) {
    null, JsonNull -> null
    is JsonPrimitive -> when {
        isString -> when (content) {
            "NaN" -> Double.NaN
            "Infinity" -> Double.POSITIVE_INFINITY
            "-Infinity" -> Double.NEGATIVE_INFINITY
            else -> content
        }
        else -> booleanOrNull ?: intOrNull ?: double
    }
    else -> this
}
