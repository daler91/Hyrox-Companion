package com.fitai.coach.core.dates

import java.time.DateTimeException
import java.time.LocalDate
import java.time.ZoneId

public actual fun todayIn(timeZone: String?): String {
    val zone = timeZone?.let {
        try {
            ZoneId.of(it)
        } catch (_: DateTimeException) {
            null
        }
    } ?: ZoneId.systemDefault()
    return LocalDate.now(zone).toString()
}
