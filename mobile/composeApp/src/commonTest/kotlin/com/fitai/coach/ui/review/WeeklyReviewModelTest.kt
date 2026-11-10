package com.fitai.coach.ui.review

import com.fitai.coach.core.api.generated.WeeklyReview
import com.fitai.coach.core.api.generated.WeeklyReviewCounts
import com.fitai.coach.ui.format.formatClock
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WeeklyReviewModelTest {
    private fun counts(
        missed: Long = 0,
        skipped: Long = 0,
        outstanding: Long = 0,
        excused: Long = 0,
        letGo: Long = 0,
    ) = WeeklyReviewCounts(
        sessionsLogged = 3,
        sessionsPlanned = 4,
        plannedCompleted = 3,
        missed = missed,
        skipped = skipped,
        outstanding = outstanding,
        excused = excused,
        letGo = letGo,
        totalDurationMin = 150.0,
    )

    private fun session(added: Double? = null, removed: Double? = null) = WeeklyReview.SessionsItem(
        workoutLogId = "w1",
        date = "2026-11-03",
        focus = "Run",
        source = "manual",
        addedSetCount = added,
        removedSetCount = removed,
    )

    private fun day(
        status: WeeklyReview.PlannedDaysItem.Status,
        excused: Boolean = false,
        recovery: WeeklyReview.PlannedDaysItem.Recovery? = null,
    ) = WeeklyReview.PlannedDaysItem(
        planDayId = "d1",
        date = "2026-11-04",
        focus = "Sled",
        status = status,
        excused = excused,
        recovery = recovery,
    )

    @Test
    fun weeksStartOnMondayAndSundayBelongsToTheWeekBefore() {
        assertEquals("2026-11-02", mondayOf("2026-11-02"))
        assertEquals("2026-11-02", mondayOf("2026-11-05"))
        assertEquals("2026-11-02", mondayOf("2026-11-08"))
        assertEquals("2026-11-02", lastCompletedWeekStart("2026-11-10"))
        assertEquals("2026-10-26", lastCompletedWeekStart("2026-11-08"))
    }

    @Test
    fun thePromptShowsFromSundayEveningToTuesdayForTheWeekJustTrained() {
        // 2026-11-08 is a Sunday.
        assertNull(reviewPrompt("2026-11-08", hour = 16))
        assertEquals(ReviewPrompt("2026-11-02", wrappingUp = true), reviewPrompt("2026-11-08", hour = 17))
        assertEquals(ReviewPrompt("2026-11-02", wrappingUp = false), reviewPrompt("2026-11-09", hour = 8))
        assertEquals(ReviewPrompt("2026-11-02", wrappingUp = false), reviewPrompt("2026-11-10", hour = 23))
        assertNull(reviewPrompt("2026-11-11", hour = 12))
        assertNull(reviewPrompt("2026-11-07", hour = 20))
    }

    @Test
    fun aWeekRangeDropsWhatBothEndsShare() {
        assertEquals("Nov 2–8, 2026", formatWeekRange("2026-11-02", "2026-11-08"))
        assertEquals("Oct 26 – Nov 1, 2026", formatWeekRange("2026-10-26", "2026-11-01"))
        assertEquals("Dec 28, 2026 – Jan 3, 2027", formatWeekRange("2026-12-28", "2027-01-03"))
    }

    @Test
    fun timeReadsInHoursAndMinutes() {
        assertEquals("45m", formatDuration(45.0))
        assertEquals("1h", formatDuration(60.0))
        assertEquals("2h 30m", formatDuration(150.0))
    }

    @Test
    fun thePlanTileSaysWhatHappenedToTheRestInTheTimelinesWords() {
        assertEquals("All sessions done", adherenceDetail(counts()))
        assertEquals(
            "1 missed · 1 let go · 2 skipped · 1 not counted · 3 to go",
            adherenceDetail(counts(missed = 1, letGo = 1, skipped = 2, excused = 1, outstanding = 3)),
        )
    }

    @Test
    fun gradedRunsAreSummedUpInALine() {
        assertEquals("Runs that did their job: 3 of 3", gradeSummaryText(WeeklyReview.GradeSummary(3, 3, 0, 0)))
        assertEquals(
            "Runs that did their job: 2 of 4 · 1 threshold run drifted harder · 2 easy runs not easy",
            gradeSummaryText(WeeklyReview.GradeSummary(4, 2, 1, 2)),
        )
    }

    @Test
    fun aSessionShowsTheSetsAddedAndDropped() {
        assertEquals("+2 / −1 sets", setChanges(session(added = 2.0, removed = 1.0)))
        assertEquals("+1 sets", setChanges(session(added = 1.0, removed = 0.0)))
        assertNull(setChanges(session()))
    }

    @Test
    fun aPlannedDayInADeclaredAbsenceIsNeverMissed() {
        val missed = WeeklyReview.PlannedDaysItem.Status.Missed
        assertEquals("Not counted", plannedDayStatus(day(missed, excused = true)))
        assertEquals("Let go", plannedDayStatus(day(missed, recovery = WeeklyReview.PlannedDaysItem.Recovery.LetGo)))
        assertEquals("Missed", plannedDayStatus(day(missed)))
        assertEquals("Skipped", plannedDayStatus(day(WeeklyReview.PlannedDaysItem.Status.Skipped)))
        assertEquals("Still to do", plannedDayStatus(day(WeeklyReview.PlannedDaysItem.Status.Planned)))
        assertEquals("Low energy", skipReasonLabel(WeeklyReview.PlannedDaysItem.SkipReason.LowEnergy))
    }

    @Test
    fun recordsReadInTheAthletesUnits() {
        fun record(metric: WeeklyReview.PersonalRecordsItem.Metric, value: Double) =
            WeeklyReview.PersonalRecordsItem(
                "back_squat",
                category = "strength",
                metric = metric,
                value = value,
                date = "2026-11-03",
                workoutLogId = "w1",
            )

        assertEquals("120 lbs", recordValue(record(WeeklyReview.PersonalRecordsItem.Metric.MaxWeight, 120.0), "lbs", "miles"))
        assertEquals("1000 m", recordValue(record(WeeklyReview.PersonalRecordsItem.Metric.MaxDistance, 1000.0), "kg", "km"))
        assertEquals("3280 ft", recordValue(record(WeeklyReview.PersonalRecordsItem.Metric.MaxDistance, 3280.0), "kg", "miles"))
        assertEquals(formatClock(4.5), recordValue(record(WeeklyReview.PersonalRecordsItem.Metric.BestTime, 4.5), "kg", "km"))
        assertEquals("Est. 1RM", recordMetricLabel(WeeklyReview.PersonalRecordsItem.Metric.Estimated1Rm))
        assertTrue(contextLabel("injury") == "Injury")
    }
}
