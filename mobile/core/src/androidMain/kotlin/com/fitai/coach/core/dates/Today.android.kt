package com.fitai.coach.core.dates

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

private val NOON: LocalTime = LocalTime.NOON

private fun zoneOf(timeZone: String?): ZoneId = timeZone?.let {
    try {
        ZoneId.of(it)
    } catch (_: DateTimeException) {
        null
    }
} ?: ZoneId.systemDefault()

public actual fun todayIn(timeZone: String?): String = LocalDate.now(zoneOf(timeZone)).toString()

public actual fun currentHourIn(timeZone: String?): Int = ZonedDateTime.now(zoneOf(timeZone)).hour

public actual fun loggedAtFor(date: String, today: String, timeZone: String?): String = if (date == today) {
    Instant.now().toString()
} else {
    ZonedDateTime.of(LocalDate.parse(date), NOON, zoneOf(timeZone)).toInstant().toString()
}
