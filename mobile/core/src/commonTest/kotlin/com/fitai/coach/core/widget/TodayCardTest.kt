package com.fitai.coach.core.widget

import com.fitai.coach.core.api.generated.TimelineEntry
import kotlin.test.Test
import kotlin.test.assertEquals

class TodayCardTest {
    private fun entry(
        id: String,
        date: String,
        status: TimelineEntry.Status,
        focus: String = "Run",
        main: String = "5 km easy",
    ) = TimelineEntry(
        id = id,
        date = date,
        type = if (status == TimelineEntry.Status.Planned) TimelineEntry.Type.Planned else TimelineEntry.Type.Logged,
        status = status,
        focus = focus,
        mainWorkout = main,
    )

    private val today = "2026-11-08"

    @Test
    fun aDayWithNothingOnItIsARestDay() {
        val card = todayCard(listOf(entry("a", "2026-11-09", TimelineEntry.Status.Planned)), today)
        assertEquals(TodayCard("Rest day", "Nothing planned today.", TodayCard.State.Rest), card)
    }

    @Test
    fun theSessionStillToDoComesFirst() {
        val card = todayCard(
            listOf(
                entry("a", today, TimelineEntry.Status.Completed, focus = "Strength"),
                entry("b", today, TimelineEntry.Status.Planned, focus = "Intervals", main = "6 × 800 m"),
            ),
            today,
        )
        assertEquals(TodayCard("Intervals", "6 × 800 m", TodayCard.State.Planned, more = 1), card)
    }

    @Test
    fun aFinishedOrSkippedDaySaysSo() {
        assertEquals(TodayCard.State.Done, todayCard(listOf(entry("a", today, TimelineEntry.Status.Completed)), today).state)
        assertEquals("Missed", todayCard(listOf(entry("a", today, TimelineEntry.Status.Missed)), today).detail)
        assertEquals("Skipped", todayCard(listOf(entry("a", today, TimelineEntry.Status.Skipped)), today).detail)
    }
}
