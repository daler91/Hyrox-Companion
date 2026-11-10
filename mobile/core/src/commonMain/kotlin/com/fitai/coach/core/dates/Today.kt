package com.fitai.coach.core.dates

/**
 * Today's date (YYYY-MM-DD) in [timeZone], an IANA zone such as the
 * athlete's `userTimezone` preference; the device's zone when it is null or
 * unknown. The timeline and nutrition day pick "today" with it, as the server
 * does with the same preference.
 */
public expect fun todayIn(timeZone: String?): String

/** The current hour (0–23) in [timeZone], the device's zone when it is null or unknown. */
public expect fun currentHourIn(timeZone: String?): Int

/**
 * The `loggedAt` timestamp for an entry on [date]: now when it is [today],
 * otherwise noon that day, both in [timeZone], as the web's nutrition log
 * stamps them (pages/nutrition/utils.ts).
 */
public expect fun loggedAtFor(date: String, today: String, timeZone: String?): String

/**
 * "Nov 10, 2026 at 9:30 AM" for an ISO-8601 instant (with its offset or Z),
 * shown in [timeZone] (the device's when null or unknown); null when it
 * doesn't parse. The analytics "Last updated" lines use it.
 */
public expect fun formatInstant(iso: String, timeZone: String?): String?
