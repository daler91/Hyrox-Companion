package com.fitai.coach.core.dates

/**
 * Today's date (YYYY-MM-DD) in [timeZone], an IANA zone such as the
 * athlete's `userTimezone` preference; the device's zone when it is null or
 * unknown. The timeline and nutrition day pick "today" with it, as the server
 * does with the same preference.
 */
public expect fun todayIn(timeZone: String?): String
