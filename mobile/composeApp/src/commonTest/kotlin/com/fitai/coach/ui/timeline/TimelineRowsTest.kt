package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.format.dayLabel
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.shortDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TimelineRowsTest {
    private val today = "2026-11-08"

    private fun entry(
        id: String,
        date: String,
        status: TimelineEntry.Status = TimelineEntry.Status.Planned,
        planDayId: String? = "d-$id",
        workoutLogId: String? = null,
        planId: String? = "p1",
    ) = TimelineEntry(
        id = id,
        date = date,
        type = if (workoutLogId != null) TimelineEntry.Type.Logged else TimelineEntry.Type.Planned,
        status = status,
        focus = "Run",
        mainWorkout = "",
        planDayId = planDayId,
        workoutLogId = workoutLogId,
        planId = planId,
    )

    @Test
    fun todayAlwaysHasARowAndDaysRunOldestFirst() {
        val rows = buildTimelineRows(listOf(entry("a", "2026-11-10"), entry("b", "2026-11-06")), today)

        assertEquals(listOf("2026-11-06", "2026-11-08", "2026-11-10"), rows.days.map { it.date })
        assertTrue(rows.days[1].isToday)
        assertTrue(rows.days[1].entries.isEmpty())
        assertEquals(1, rows.todayIndex)
    }

    @Test
    fun onlySevenDaysEachWayShowAtFirst() {
        val past = (1..10).map { entry("p$it", "2026-10-${(20 + it).toString().padStart(2, '0')}") }
        val upcoming = (9..20).map { entry("u$it", "2026-11-${it.toString().padStart(2, '0')}") }

        val rows = buildTimelineRows(past + upcoming, today)

        assertEquals("2026-10-24", rows.days.first().date)
        assertEquals(3, rows.hiddenPast)
        assertEquals(6, rows.hiddenUpcoming)
        assertEquals(1 + 7 + 6, rows.days.size)
        assertEquals(0, buildTimelineRows(past + upcoming, today, pastDays = 100, upcomingDays = 100).hiddenPast)
    }

    @Test
    fun aPlanFilterKeepsOnlyThatPlansEntries() {
        val rows =
            buildTimelineRows(
                listOf(entry("a", today, planId = "p1"), entry("b", today, planId = "p2")),
                today,
                TimelineFilter(planId = "p2"),
            )

        assertEquals(listOf("b"), rows.days.single().entries.map { it.id })
    }

    @Test
    fun tappingAnEntryOpensTheSurfaceItsStateCallsFor() {
        assertEquals(EntrySurface.Preview, surfaceFor(entry("a", "2026-11-09"), today))
        assertEquals(EntrySurface.Log, surfaceFor(entry("a", today), today))
        assertEquals(EntrySurface.Log, surfaceFor(entry("a", "2026-11-01", TimelineEntry.Status.Missed), today))
        assertEquals(EntrySurface.WorkoutDetail, surfaceFor(entry("a", today, TimelineEntry.Status.Completed, workoutLogId = "w1"), today))
        assertEquals(EntrySurface.Skipped, surfaceFor(entry("a", today, TimelineEntry.Status.Skipped), today))
        assertEquals(
            EntrySurface.WorkoutDetail,
            surfaceFor(entry("a", today, TimelineEntry.Status.Completed, planDayId = null, workoutLogId = "w1"), today),
        )
    }

    @Test
    fun theDoneCircleIsForPlanDaysUpToTomorrow() {
        val tomorrow = "2026-11-09"
        assertTrue(canQuickComplete(entry("a", tomorrow), tomorrow))
        assertFalse(canQuickComplete(entry("a", "2026-11-10"), tomorrow))
        assertFalse(canQuickComplete(entry("a", today, TimelineEntry.Status.Completed, workoutLogId = "w"), tomorrow))
        assertFalse(canQuickComplete(entry("a", today, planDayId = null), tomorrow))
    }

    @Test
    fun formattersMatchTheWeb() {
        assertEquals("Today", dayLabel(today, today))
        assertEquals("Tomorrow", dayLabel("2026-11-09", today))
        assertEquals("Yesterday", dayLabel("2026-11-07", today))
        assertEquals("Monday, Nov 2", dayLabel("2026-11-02", today))
        assertEquals("Nov 3", shortDate("2026-11-03"))
        assertEquals("1:30", formatClock(1.5))
        assertEquals("1:02:05", formatClock(62 + 5 / 60.0))
        assertEquals("My move", exerciseLabel("custom:my_move"))
        assertEquals("My burpees", exerciseLabel("burpee_broad_jump", "My burpees"))
        assertEquals("Not in catalogue", exerciseLabel("not_in_catalogue", customLabel = "2x"))
    }

    @Test
    fun aStatusFilterKeepsOnlyThoseEntriesAndAddsNoEmptyToday() {
        val entries = listOf(
            entry("a", "2026-11-06", TimelineEntry.Status.Skipped),
            entry("b", "2026-11-07", TimelineEntry.Status.Completed, workoutLogId = "w"),
            entry("c", "2026-11-10"),
        )

        val skipped = buildTimelineRows(entries, today, TimelineFilter(status = TimelineEntry.Status.Skipped))

        assertEquals(listOf("2026-11-06"), skipped.days.map { it.date })
        assertEquals(-1, skipped.todayIndex)
        assertTrue(buildTimelineRows(entries, today, TimelineFilter(status = TimelineEntry.Status.Missed)).days.isEmpty())
    }

    @Test
    fun quickMovesOfferOnlyDaysTheSessionCanGo() {
        assertEquals(
            listOf("Move to today", "Move to tomorrow", "Move to next week"),
            quickMoves(entry("a", "2026-11-12"), today).map { it.label },
        )
        // Already today: no "today".
        assertEquals(listOf("2026-11-09", "2026-11-15"), quickMoves(entry("a", today), today).map { it.date })
        // A logged workout goes no later than tomorrow.
        assertEquals(
            listOf("Move to today", "Move to tomorrow"),
            quickMoves(entry("a", "2026-11-01", TimelineEntry.Status.Completed, workoutLogId = "w"), today).map { it.label },
        )
    }

    @Test
    fun aMoveNeedsAnotherDayInsideTheWindow() {
        val planned = entry("a", "2026-11-10")
        val logged = entry("b", "2026-11-01", TimelineEntry.Status.Completed, planDayId = null, workoutLogId = "w")
        val tomorrow = "2026-11-09"

        assertTrue(canMoveTo(planned, "2027-03-01", tomorrow))
        assertFalse(canMoveTo(planned, "2026-11-10", tomorrow), "the day it is already on")
        assertFalse(canMoveTo(planned, "0202-11-10", tomorrow), "a half-typed year")
        assertFalse(canMoveTo(planned, "", tomorrow))
        assertTrue(canMoveTo(logged, tomorrow, tomorrow))
        assertFalse(canMoveTo(logged, "2026-11-10", tomorrow), "a workout logged after tomorrow")
        assertFalse(canMove(entry("c", today, planDayId = null)))
        assertEquals(listOf("2026-11-09", "2026-11-15"), skipMoves(today).map { it.date })
    }
}
