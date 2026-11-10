package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TrainingOverview.BodySystemLoad
import com.fitai.coach.core.api.generated.TrainingOverview.BodySystemLoad.SystemsItem
import com.fitai.coach.core.api.generated.TrainingOverview.BodySystemLoad.SystemsItem.Status
import com.fitai.coach.core.api.generated.TrainingOverview.BodySystemLoad.SystemsItem.System
import com.fitai.coach.core.api.generated.TrainingOverview.TrainingLoad.MonotonyZone
import com.fitai.coach.core.api.generated.TrainingOverview.TrainingLoad.TrendItem
import com.fitai.coach.core.api.generated.TrainingOverview.WeeklySummariesItem
import com.fitai.coach.core.api.generated.TrainingOverviewAcwrZone
import com.fitai.coach.ui.components.BadgeTone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OverviewChartsModelTest {
    private fun day(date: String, utss: Double = 50.0, acwr: Double? = null, hrTss: Double? = null, tss: Double? = null) =
        TrendItem(date, utss, acwr = acwr, zone = TrainingOverviewAcwrZone.SweetSpot, hrTss = hrTss, tss = tss)

    private fun week(start: String, workouts: Long, minutes: Double, timed: Long, rpe: Double? = null, meters: Double = 0.0) =
        WeeklySummariesItem(start, workouts, minutes, rpe, emptyMap(), timed, if (rpe == null) 0 else 1, meters)

    private fun system(
        system: System,
        status: Status,
        ratio: Double? = null,
        baseline: Double? = null,
        high: Boolean = false,
        peak: Double? = null,
        weekly: List<Double?> = listOf(0.0, 0.0, 0.0, 0.0, 0.0, 100.0),
    ) = SystemsItem(system, weekly.last() ?: 0.0, baseline, ratio, status, high, peak, weekly)

    private fun load(vararg systems: SystemsItem, estimated: Long = 0, unattributed: Long = 0, unscored: Long = 0) = BodySystemLoad(
        asOf = "2026-11-10",
        weeks = emptyList(),
        systems = systems.toList(),
        sessionCount = 6,
        estimatedSessions = estimated,
        unattributedSessions = unattributed,
        unscoredSessions = unscored,
    )

    @Test
    fun theGovernorNamesTheZoneAndFormatsItsNumbersAsTheWebDoes() {
        assertEquals("Sweet spot", acwrZoneLabel(TrainingOverviewAcwrZone.SweetSpot))
        assertEquals("Under-training", acwrZoneLabel(TrainingOverviewAcwrZone.Undertraining))
        assertEquals(BadgeTone.Danger, acwrZoneTone(TrainingOverviewAcwrZone.Danger))
        assertEquals("1.20", formatRatio(1.2))
        assertEquals("1.13", formatRatio(1.125))
        assertEquals("N/A", formatRatio(null))
        assertEquals("+12", formatForm(11.6))
        assertEquals("-8", formatForm(-8.2))
        assertEquals("N/A", formatForm(null))
        assertEquals("1 active restriction", restrictionsLabel(1))
        assertEquals("0 active restrictions", restrictionsLabel(0))
    }

    @Test
    fun formAndMonotonyAreColouredByHowFreshOrRepetitiveTheTrainingIs() {
        assertEquals(StatTone.Good, tsbTone(5.0))
        assertEquals(StatTone.Plain, tsbTone(2.0))
        assertEquals(StatTone.Caution, tsbTone(-3.0))
        assertEquals(StatTone.Bad, tsbTone(-25.0))
        assertEquals(StatTone.Plain, tsbTone(null))
        assertEquals(StatTone.Caution, monotonyTone(MonotonyZone.Elevated))
        assertEquals(StatTone.Bad, monotonyTone(MonotonyZone.HighRisk))
        // No load that week: absent, not healthy.
        assertEquals(StatTone.Muted, monotonyTone(MonotonyZone.UnknownValue))
    }

    @Test
    fun theAcwrAxisStopsAtTwoUnlessARatioRunsHigher() {
        assertEquals(2.0, acwrTop(listOf(Point("2026-11-01", 1.1))))
        assertEquals(2.4, acwrTop(listOf(Point("2026-11-01", 2.4))))
        val bands = acwrBands(2.0)
        assertEquals(listOf(0.0 to 0.8, 0.8 to 1.3, 1.3 to 1.5, 1.5 to 2.0), bands.map { it.from to it.to })
        assertEquals(listOf(SeriesColor.Blue, SeriesColor.Green, SeriesColor.Amber, SeriesColor.Red), bands.map { it.color })
    }

    @Test
    fun objectiveLoadAddsHrAndPowerOnlyOnceEachHasTwoDays() {
        val trend = listOf(day("2026-11-01", hrTss = 40.0, tss = 30.0), day("2026-11-02", hrTss = 45.0), day("2026-11-03"))
        val series = objectiveLoadSeries(trend)
        assertEquals(listOf("UTSS (subjective)", "hrTSS (HR)"), series.map { it.label })
        assertEquals(listOf(Point("2026-11-01", 40.0), Point("2026-11-02", 45.0)), series[1].points)
        assertEquals(1, objectiveLoadSeries(listOf(day("2026-11-01"), day("2026-11-02"))).size)
        assertEquals(listOf(Point("2026-11-02", 1.1)), trendPoints(listOf(day("2026-11-01"), day("2026-11-02", acwr = 1.1))) { it.acwr })
    }

    @Test
    fun weeklyTrendsAverageOverTimedWorkoutsAndConvertRunning() {
        val weeks = listOf(
            week("2026-10-26", workouts = 3, minutes = 100.0, timed = 2, rpe = 7.0, meters = 10_000.0),
            week("2026-11-02", workouts = 2, minutes = 0.0, timed = 0),
        )
        assertEquals(listOf(Point("2026-10-26", 7.0)), avgRpePoints(weeks))
        // Divides by the two workouts with a duration, not all three.
        assertEquals(listOf(Point("2026-10-26", 50.0)), avgDurationPoints(weeks))
        assertEquals(listOf(10.0, 0.0), runningPoints(weeks, "km").map { it.value })
        assertEquals(emptyList(), runningPoints(listOf(week("2026-11-02", 1, 30.0, 1)), "km"))
    }

    @Test
    fun anAnnotationShadesEveryWeekItTouches() {
        val weeks = listOf("2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09")
        fun note(start: String, end: String, type: TimelineAnnotation.Type = TimelineAnnotation.Type.Injury) =
            TimelineAnnotation("a", "u1", start, end, type)
        // Sunday Nov 1 is in the week of Oct 26; Monday Nov 2 starts the next.
        assertEquals(
            listOf(WeekBand(1, 2, TimelineAnnotation.Type.Injury)),
            annotationBands(weeks, listOf(note("2026-11-01", "2026-11-02"))),
        )
        assertEquals(
            listOf(WeekBand(3, 3, TimelineAnnotation.Type.Travel)),
            annotationBands(weeks, listOf(note("2026-11-12", "2026-11-12", TimelineAnnotation.Type.Travel))),
        )
        assertEquals(emptyList(), annotationBands(weeks, listOf(note("2026-09-01", "2026-09-10"))))
    }

    @Test
    fun theHeatmapIsSixteenWeeksEndingThisWeekWithUnfetchedDaysMarked() {
        // Tuesday Nov 10, 2026.
        val weeks = consistencyWeeks("2026-11-10", listOf("2026-11-09", "2026-08-03"), rangeStart = "2026-08-12")
        assertEquals(HEATMAP_WEEKS, weeks.size)
        assertEquals("2026-07-27", weeks.first().first().date)
        assertEquals(HeatDay("2026-11-09", DayState.Workout), weeks.last()[0])
        assertEquals(HeatDay("2026-11-10", DayState.Rest), weeks.last()[1])
        assertEquals(DayState.Future, weeks.last()[2].state)
        // Before the range: never fetched, so not a rest day, even with a workout on file.
        assertEquals(HeatDay("2026-08-03", DayState.OutOfRange), weeks[1][0])
        assertEquals(DayState.Rest, consistencyWeeks("2026-11-10", emptyList(), rangeStart = null)[1][0].state)
        val months = monthLabels(weeks)
        // July has one column before August starts: too narrow for its name.
        assertNull(months[0])
        assertEquals("Aug", months[1])
        assertNull(months[2])
        assertEquals("Nov", months[14])
    }

    @Test
    fun aBodySystemSaysHowThisWeekComparesOrWhyItCannot() {
        assertEquals(
            "+31% vs your usual week (1,204)",
            bodySystemDetail(system(System.LegMuscle, Status.High, ratio = 1.31, baseline = 1204.4)),
        )
        assertEquals(
            "-30% vs your usual week (500). Previous peak 900",
            bodySystemDetail(system(System.Aerobic, Status.Low, ratio = 0.7, baseline = 500.0, high = true, peak = 900.0)),
        )
        assertEquals("Needs three weeks of history to compare", bodySystemDetail(system(System.Aerobic, Status.InsufficientData)))
        assertEquals("Almost none in the previous four weeks", bodySystemDetail(system(System.UpperPull, Status.New)))
        assertEquals("New load" to BadgeTone.Warning, bodySystemStatus(Status.New))
        assertEquals("Building baseline" to BadgeTone.Neutral, bodySystemStatus(Status.InsufficientData))
    }

    @Test
    fun theDivergenceSentenceNamesTheSpikeAndTheCalmSystems() {
        val divergence = bodySystemDivergence(
            load(
                system(System.LegMuscle, Status.High, ratio = 1.31, high = true),
                system(System.Aerobic, Status.Normal, ratio = 1.0),
                system(System.RunningImpact, Status.Normal, ratio = 0.95),
                system(System.UpperPull, Status.Low, ratio = 0.6),
            ),
        )
        assertEquals(
            "Leg muscle load is at a six-week high (31% above your usual week), while aerobic and running impact loads are normal " +
                "and upper-body pull load is below usual.",
            divergence?.text,
        )
        assertEquals(false, divergence?.severe)
        val severe = bodySystemDivergence(load(system(System.UpperPull, Status.VeryHigh, ratio = 2.0), system(System.Aerobic, Status.New)))
        assertEquals(
            "Upper-body pull load is 100% above your usual week and aerobic load jumped from almost none in the previous four weeks.",
            severe?.text,
        )
        assertEquals(true, severe?.severe)
        assertNull(bodySystemDivergence(load(system(System.Aerobic, Status.Normal, ratio = 1.0))))
    }

    @Test
    fun theCardShowsOnlyWithLoadAndNotesWhatTheSplitMissed() {
        assertTrue(hasBodySystemLoad(load(system(System.Aerobic, Status.Normal))))
        assertEquals(false, hasBodySystemLoad(load(system(System.Aerobic, Status.Minimal, weekly = listOf(null, 0.0)))))
        assertEquals(false, hasBodySystemLoad(null))
        assertEquals(
            listOf(
                "2 of 6 sessions had no RPE or duration logged, so their load is estimated — rate your sessions to sharpen the split.",
                "1 session couldn't be split because no exercises were logged.",
                "3 sessions have no duration or exercises and aren't counted.",
            ),
            bodySystemNotes(load(estimated = 2, unattributed = 1, unscored = 3)),
        )
    }

    @Test
    fun loadsAreWholeAndGrouped() {
        assertEquals("12,045", formatLoad(12_044.6))
        assertEquals("0", formatLoad(0.2))
        assertEquals("+31%", formatLoadChange(1.31))
        assertEquals("-30%", formatLoadChange(0.7))
        assertEquals("0%", formatLoadChange(1.0))
        assertEquals("-0.50", fixed2(-0.5))
    }
}
