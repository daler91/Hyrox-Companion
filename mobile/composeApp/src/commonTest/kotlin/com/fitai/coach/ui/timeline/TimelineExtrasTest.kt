package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.CoachNoteInputs
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.PersonalRecordValue
import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingOverviewStationCoverage
import com.fitai.coach.core.api.generated.TrainingOverviewSummary
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.data.AnnotationDraft
import com.fitai.coach.core.exercises.knownExerciseLabel
import com.fitai.coach.core.plans.TrainingPhase
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.shortDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TimelineExtrasTest {
    private val today = "2026-11-08"

    private fun entry(
        id: String,
        date: String = today,
        status: TimelineEntry.Status = TimelineEntry.Status.Planned,
        focus: String = "Run",
        planDayId: String? = null,
        workoutLogId: String? = null,
        sets: List<ExerciseSetRow>? = null,
    ) = TimelineEntry(
        id = id,
        date = date,
        type = if (workoutLogId != null) TimelineEntry.Type.Logged else TimelineEntry.Type.Planned,
        status = status,
        focus = focus,
        mainWorkout = "",
        planDayId = planDayId,
        workoutLogId = workoutLogId,
        exerciseSets = sets,
    )

    private fun plan(id: String = "p1", start: String? = "2026-10-12", end: String? = "2026-12-06", retiredOn: String? = null) =
        TrainingPlan(
            id = id,
            userId = "u1",
            name = "Hyrox block",
            totalWeeks = 8,
            startDate = start,
            endDate = end,
            raceDate = end,
            retiredOn = retiredOn,
            generationStatus = TrainingPlan.GenerationStatus.Ready,
        )

    private fun summary(vararg coverage: TrainingOverviewStationCoverage) = TrainingOverviewSummary(
        currentStreak = 3,
        weeklyCompletedWorkouts = 2,
        weeklyGoal = 4,
        stationCoverage = coverage.toList(),
        coverageLookbackDays = 28,
    )

    /** Only whether a station was ever trained matters, not when. */
    private fun station(name: String, daysSince: Long?) =
        TrainingOverviewStationCoverage(name, lastTrained = daysSince?.let { "2026-11-01" }, daysSince = daysSince)

    private fun set(
        id: String,
        name: String,
        reps: Int? = null,
        weight: Double? = null,
        time: Double? = null,
        customLabel: String? = null,
    ) = ExerciseSetRow(
        id = id,
        exerciseName = name,
        customLabel = customLabel,
        category = "strength",
        setNumber = 1,
        reps = reps,
        weight = weight,
        time = time,
        weightUnit = "kg",
        version = 1,
    )

    // --- This week ---

    @Test
    fun theWeekShowsTodaysSessionTheGoalThePlanWeekAndTheRace() {
        val week = assertNotNull(
            weekSummary(listOf(entry("a", focus = "Sled intervals")), listOf(plan()), null, summary(), today),
        )

        assertEquals("Sled intervals", week.todayValue)
        assertEquals(2, week.weeklyCompleted)
        assertEquals(4, week.weeklyGoal)
        assertEquals(3, week.streak)
        assertEquals(4, week.phase?.currentWeek)
        assertEquals(TrainingPhase.Build, week.phase?.phaseLabel)
        assertEquals("Race day in 28 days", week.raceValue)
    }

    @Test
    fun aNewAccountHasNoWeekCard() {
        assertNull(weekSummary(emptyList(), emptyList(), null, null, today))
    }

    @Test
    fun withNoSessionTodayThePlanNameShows() {
        val week = assertNotNull(weekSummary(listOf(entry("a", date = "2026-11-09")), listOf(plan()), null, null, today))

        assertEquals("No planned session today", week.todayValue)
        assertEquals("Hyrox block", week.todayDetail)
        assertEquals(1, week.weeklyGoal, "a missing goal reads as one, never zero")
    }

    @Test
    fun aPlannedSessionTodayComesBeforeACompletedOne() {
        val done = entry("a", status = TimelineEntry.Status.Completed, focus = "Done")
        val next = entry("b", focus = "Next")

        assertEquals("b", todayEntry(listOf(done, next), today)?.id)
        assertEquals("a", todayEntry(listOf(done), today)?.id)
    }

    @Test
    fun theCardDescribesThePlanRunningTodayUnlessOneIsPicked() {
        val retired = plan("old", start = "2026-10-01", end = "2026-12-31", retiredOn = "2026-11-01")
        val running = plan("now")
        val future = plan("next", start = "2027-01-04", end = "2027-03-01")

        assertEquals("now", choosePlan(listOf(retired, future, running), null, today)?.id)
        assertEquals("next", choosePlan(listOf(retired, future, running), "next", today)?.id)
        assertEquals("next", choosePlan(listOf(retired, future), null, today)?.id, "else any unretired plan with an end")
    }

    @Test
    fun theRaceCountdownCountsBothWays() {
        assertEquals("Race day today", raceCountdown(today, today))
        assertEquals("Race day in 1 day", raceCountdown("2026-11-09", today))
        assertEquals("Race day was 3 days ago", raceCountdown("2026-11-05", today))
        assertEquals("No race date set", raceCountdown(null, today))
    }

    // --- Station radar ---

    @Test
    fun eachStationIsColouredByHowLongSinceItWasTrainedAndTheColdestNamed() {
        val radar = assertNotNull(
            stationRadar(
                listOf(station("skierg", 2), station("sled_push", 19), station("running", 9), station("wall_balls", null)),
                lookbackDays = 28,
            ),
        )

        assertEquals(listOf("2d ago", "19d ago", "9d ago", "Not in 28d"), radar.chips.map { it.freshness })
        assertEquals(listOf(BadgeTone.Success, BadgeTone.Danger, BadgeTone.Warning, BadgeTone.Danger), radar.chips.map { it.tone })
        assertEquals("Running", radar.chips[2].label)
        assertEquals("${radar.chips[3].label} has not been covered in the last 28 days.", radar.headline)
    }

    @Test
    fun aFreshWeekSaysSo() {
        val radar = assertNotNull(stationRadar(listOf(station("skierg", 1), station("running", 0)), lookbackDays = 28))

        assertEquals(listOf("Yesterday", "Today"), radar.chips.map { it.freshness })
        assertEquals("Every station covered in the last 7 days.", radar.headline)
    }

    @Test
    fun noRadarBeforeAnyStationIsTrained() {
        assertNull(stationRadar(emptyList(), 28))
        assertNull(stationRadar(listOf(station("skierg", null)), 28))
    }

    // --- Annotations ---

    private fun note(id: String, start: String, end: String = start) =
        TimelineAnnotation(id = id, userId = "u1", startDate = start, endDate = end, type = TimelineAnnotation.Type.Injury)

    @Test
    fun aNoteShowsOnTheDayItStartsWithARowOfItsOwnIfNeeded() {
        val rows = buildTimelineRows(listOf(entry("a", "2026-11-06"), entry("b", "2026-11-10")), today)
            .withAnnotations(listOf(note("x", "2026-11-07"), note("y", "2026-11-10"), note("z", "2026-10-01")), today)

        assertEquals(listOf("2026-11-06", "2026-11-07", "2026-11-08", "2026-11-10"), rows.days.map { it.date })
        assertEquals(listOf("x"), rows.days[1].annotations.map { it.id })
        assertTrue(rows.days[1].entries.isEmpty())
        assertEquals(listOf("y"), rows.days[3].annotations.map { it.id })
        assertEquals(listOf("b"), rows.days[3].entries.map { it.id })
        assertEquals(2, rows.todayIndex, "today stays found after a row is added before it")
    }

    @Test
    fun aNoteSpansItsDaysBothEndsCounted() {
        assertEquals("${shortDate("2026-11-02")} · 1 day", annotationRange(note("x", "2026-11-02")))
        assertEquals(
            "${shortDate("2026-11-02")} → ${shortDate("2026-11-05")} · 4 days",
            annotationRange(note("x", "2026-11-02", "2026-11-05")),
        )
    }

    @Test
    fun aNoteNeedsBothDatesInOrder() {
        val type = TimelineAnnotation.Type.Travel
        assertNull(annotationProblem(AnnotationDraft(type, "2026-11-02", "2026-11-02", "")))
        assertNotNull(annotationProblem(AnnotationDraft(type, "2026-11-05", "2026-11-02", "")))
        assertNotNull(annotationProblem(AnnotationDraft(type, "", "2026-11-02", "")))
    }

    // --- Exercise chips and records ---

    private val squats =
        listOf(set("s1", "back_squat", reps = 5, weight = 100.0), set("s2", "back_squat", 5, 100.0), set("s3", "back_squat", 5, 100.0))

    @Test
    fun eachExerciseIsSummedUpOnOneChip() {
        val logged = entry("a", workoutLogId = "w1", sets = squats + set("s4", "skierg", time = 4.0))

        val chips = exerciseChips(logged, emptyMap())

        assertEquals(
            listOf("${exerciseLabel("back_squat")} 3x5 100kg", "${exerciseLabel("skierg")} ${formatClock(4.0)}"),
            chips.map {
                it.text
            },
        )
    }

    @Test
    fun aTrophyMarksTheWorkoutThatHoldsTheRecord() {
        val records = mapOf(
            "back_squat" to PersonalRecord(category = "strength", maxWeight = PersonalRecordValue(100.0, "2026-11-06", "w1")),
            "custom:Sandbag carry" to PersonalRecord(category = "strength", bestTime = PersonalRecordValue(2.0, "2026-11-06", "w1")),
        )
        val sets = squats + set("s4", "skierg", time = 4.0) + set("s5", "custom", time = 2.0, customLabel = "Sandbag carry")

        assertEquals(
            listOf(true, false, true),
            exerciseChips(entry("a", workoutLogId = "w1", sets = sets), records).map {
                it.personalRecord
            },
        )
        assertTrue(exerciseChips(entry("b", workoutLogId = "w2", sets = squats), records).none { it.personalRecord })
    }

    // --- Coach note ---

    @Test
    fun theCoachNoteSaysWhatItWasBasedOn() {
        val inputs = CoachNoteInputs(
            lastModification = CoachNoteInputs.LastModification(CoachNoteInputs.LastModification.Kind.AutoProgression),
            planGoalPresent = true,
            planPhase = CoachNoteInputs.PlanPhase.Build,
            rpeTrend = CoachNoteInputs.RpeTrend.Rising,
            stationGaps = listOf("sled_push", "wall_balls", "rowing"),
            recentWorkoutCount = 5,
            ragUsed = true,
        )

        assertEquals(
            listOf(
                "Your logged sessions",
                "Plan goal",
                "Build phase",
                "Next: Peak → Taper → Race week",
                "RPE rising",
                "Gaps: sled_push, wall_balls…",
                "5 recent workouts",
                "Coaching docs",
            ),
            basedOnChips(inputs),
        )
        assertEquals(emptyList(), basedOnChips(null))
    }

    @Test
    fun aFatigueFlagReplacesTheRpeTrend() {
        val inputs = CoachNoteInputs(rpeTrend = CoachNoteInputs.RpeTrend.Rising, fatigueFlag = true)
        assertEquals(listOf("Fatigue flag"), basedOnChips(inputs))
    }

    @Test
    fun anAutoProgressionListsWhatItMoved() {
        val inputs = CoachNoteInputs(
            progressionChanges = listOf(
                CoachNoteInputs.ProgressionChangesItem("front_squat", CoachNoteInputs.ProgressionChangesItem.Kind.Raise, 85.0, 90.0, "kg"),
                CoachNoteInputs.ProgressionChangesItem("running", CoachNoteInputs.ProgressionChangesItem.Kind.Pace, 45.0, 46.5, "vdot"),
            ),
        )

        assertEquals(
            listOf("${knownExerciseLabel("front_squat")}: 85 → 90 kg", "Run paces: fitness 45 → 46.5 (VDOT)"),
            progressionChanges(inputs),
        )
    }

    @Test
    fun theNotesSourceIsNamed() {
        assertEquals("Load governor", coachSourceLabel("load_governor"))
        assertNull(coachSourceLabel(null))
    }

    // --- Strava link ---

    private fun stravaImport(linked: Boolean = false) = entry("s", workoutLogId = "w9", focus = "Morning Run").copy(
        source = "strava",
        stravaActivityId = "123",
        deviceLinkSource = if (linked) TimelineEntry.DeviceLinkSource.Manual else null,
        suggestedPlanDayId = "d1",
    )

    @Test
    fun anImportCanBeLinkedToAnOpenSessionOrAHandLoggedWorkoutThatDay() {
        val day = listOf(
            stravaImport(),
            entry("p", focus = "Easy Run", planDayId = "d1"),
            entry("m", focus = "Strength", workoutLogId = "w2"),
            entry("c", focus = "Done", planDayId = "d2", status = TimelineEntry.Status.Completed),
            entry("g", focus = "Other ride", workoutLogId = "w3").copy(stravaActivityId = "456"),
            entry("t", date = "2026-11-09", focus = "Tomorrow", planDayId = "d3"),
        )

        val options = deviceLinkOptions(day.first(), day)

        assertEquals(
            listOf(DeviceLinkOption("Easy Run", planDayId = "d1"), DeviceLinkOption("Strength", workoutLogId = "w2")),
            options.candidates,
        )
        assertEquals(DeviceLinkOption("Easy Run", planDayId = "d1"), options.suggestion)
    }

    @Test
    fun onlyAStandaloneImportOffersLinksAndOnlyARecordingGetsControls() {
        assertTrue(isStandaloneStravaImport(stravaImport()))
        assertFalse(isStandaloneStravaImport(stravaImport(linked = true)))

        val linked = assertNotNull(stravaControls(stravaImport(linked = true), emptyList(), {}, {}, {}))
        assertNull(linked.options.suggestion)
        assertTrue(linked.options.candidates.isEmpty())
        assertNull(stravaControls(entry("p", planDayId = "d1"), emptyList(), {}, {}, {}))
    }
}
