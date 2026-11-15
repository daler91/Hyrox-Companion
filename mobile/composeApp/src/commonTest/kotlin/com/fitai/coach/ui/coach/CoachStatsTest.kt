package com.fitai.coach.ui.coach

import com.fitai.coach.core.api.generated.TimelineEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// 2026-11-18 is a Wednesday: its week runs Monday 16th to Sunday 22nd.
private const val TODAY = "2026-11-18"

class CoachStatsTest {
    private fun entry(
        date: String,
        status: TimelineEntry.Status,
        excused: Boolean? = null,
        recovery: TimelineEntry.Recovery? = null,
    ) = TimelineEntry(
        id = "$date-$status",
        date = date,
        type = TimelineEntry.Type.Planned,
        status = status,
        focus = "Run",
        mainWorkout = "",
        excused = excused,
        recovery = recovery,
    )

    @Test
    fun theWeekRunsMondayToSundayAndUpcomingCountsPlannedSessionsFromToday() {
        val stats = calculateStats(
            listOf(
                entry("2026-11-15", TimelineEntry.Status.Completed), // last Sunday
                entry("2026-11-16", TimelineEntry.Status.Completed),
                entry("2026-11-17", TimelineEntry.Status.Missed),
                entry(TODAY, TimelineEntry.Status.Planned),
                entry("2026-11-22", TimelineEntry.Status.Planned),
                entry("2026-11-23", TimelineEntry.Status.Planned), // next week
            ),
            TODAY,
        )

        assertEquals(4, stats.workoutsThisWeek)
        assertEquals(1, stats.completedThisWeek)
        assertEquals(3, stats.plannedUpcoming)
    }

    @Test
    fun theRateScoresFinishedDaysOfTheLastFourWeeksOnly() {
        val stats = calculateStats(
            listOf(
                entry("2026-10-20", TimelineEntry.Status.Missed), // 29 days back: outside the window
                entry("2026-10-21", TimelineEntry.Status.Completed), // 28 days back: inside
                entry("2026-11-10", TimelineEntry.Status.Missed),
                entry("2026-11-11", TimelineEntry.Status.Missed, excused = true), // a declared absence
                entry("2026-11-12", TimelineEntry.Status.Missed, recovery = TimelineEntry.Recovery.LetGo),
                entry("2026-11-17", TimelineEntry.Status.Completed),
                entry(TODAY, TimelineEntry.Status.Planned), // still to do today
            ),
            TODAY,
        )

        // 2 done of 3 due.
        assertEquals(67, stats.completionRate)
    }

    @Test
    fun withNothingDueThereIsNoRate() {
        assertNull(calculateStats(listOf(entry(TODAY, TimelineEntry.Status.Planned)), TODAY).completionRate)
        assertNull(calculateStats(emptyList(), TODAY).completionRate)
    }
}
