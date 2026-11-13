package com.fitai.coach.core.dates

/** The id the system reports for the phone's timezone ("Europe/London", "Z", "+02:00"). */
internal expect fun systemZoneId(): String?

/**
 * The phone's timezone, as a name the server accepts ("Europe/London",
 * "UTC"); null when the system reports only a fixed offset, which the server
 * may refuse.
 */
public fun deviceTimeZone(): String? = zoneName(systemZoneId())

/** Whether two timezone names are the same zone, counting UTC's other names ("Etc/UTC", "Z") as UTC. */
public fun sameTimeZone(a: String, b: String): Boolean = canonical(a) == canonical(b)

/** [id] as a zone name: UTC under any of its names becomes "UTC", and a bare offset ("+02:00", "GMT+2") none. */
internal fun zoneName(id: String?): String? = id?.trim()?.takeIf { it.isNotEmpty() }?.let {
    when {
        it in UTC_NAMES -> UTC
        FIXED_OFFSET.matches(it) -> null
        else -> it
    }
}

private fun canonical(name: String): String = if (name in UTC_NAMES) UTC else name

private const val UTC = "UTC"

private val UTC_NAMES = setOf(
    UTC, "Z", "UCT", "GMT", "GMT0", "Greenwich", "Universal", "Zulu",
    "Etc/UTC", "Etc/UCT", "Etc/GMT", "Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "Etc/Greenwich", "Etc/Universal", "Etc/Zulu",
)

private val FIXED_OFFSET = Regex("""^(?:UTC|GMT|UT)?[+-]\d{1,2}(?::?\d{2}){0,2}$""")
