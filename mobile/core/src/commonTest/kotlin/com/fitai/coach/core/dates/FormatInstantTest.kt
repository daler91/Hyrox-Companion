package com.fitai.coach.core.dates

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FormatInstantTest {
    @Test
    fun anInstantShowsInTheAthletesZone() {
        assertEquals("Nov 10, 2026 at 4:30 AM", formatInstant("2026-11-10T09:30:00.000Z", "America/New_York"))
        assertEquals("Nov 10, 2026 at 10:30 PM", formatInstant("2026-11-10T09:30:00Z", "Pacific/Auckland")) // NZDT, UTC+13
        assertEquals("Nov 10, 2026 at 9:30 AM", formatInstant("2026-11-10T10:30:00+01:00", "UTC"))
    }

    @Test
    fun somethingThatIsntAnInstantShowsNothing() {
        assertNull(formatInstant("2026-11-10", "UTC"))
        assertNull(formatInstant("yesterday", "UTC"))
    }
}
