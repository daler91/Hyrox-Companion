package com.fitai.coach.core.dates

/** Midnight UTC of an ISO date (YYYY-MM-DD) in epoch milliseconds, as date pickers hold it; null when it doesn't parse. */
public fun isoDateToUtcMillis(date: String): Long? = toUtcEpoch(date).takeUnless { it.isNaN() }?.toLong()

/** The UTC calendar date (YYYY-MM-DD) of an epoch-millisecond instant, such as a date picker's selection. */
public fun utcMillisToIsoDate(millis: Long): String = isoDateUtc(millis.toDouble())
