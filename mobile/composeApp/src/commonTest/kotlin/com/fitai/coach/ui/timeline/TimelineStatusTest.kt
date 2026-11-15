package com.fitai.coach.ui.timeline

import androidx.compose.ui.graphics.Color
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.TimelineCoachNotes
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.CardTone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Coach cues, the MAF ceiling, "Pending sync", the empty timeline's plan to start, and the way back to today. */
class TimelineStatusTest {
    private fun set(
        exercise: String,
    ) = ExerciseSetRow(id = "s-$exercise", exerciseName = exercise, category = "running", setNumber = 1, version = 1)

    private fun entry(
        id: String = "a",
        status: TimelineEntry.Status = TimelineEntry.Status.Planned,
        planDayId: String? = "d1",
        workoutLogId: String? = null,
        sets: List<ExerciseSetRow> = listOf(set("easy_run")),
        notes: String? = null,
        coachNotes: TimelineCoachNotes? = null,
        date: String = "2026-11-10",
        dayKind: TimelineEntry.DayKind? = null,
    ) = TimelineEntry(
        id = id,
        date = date,
        type = if (workoutLogId != null) TimelineEntry.Type.Logged else TimelineEntry.Type.Planned,
        status = status,
        focus = "Run",
        mainWorkout = "",
        planDayId = planDayId,
        workoutLogId = workoutLogId,
        exerciseSets = sets,
        notes = notes,
        coachNotes = coachNotes,
        dayKind = dayKind,
    )

    private fun plan(id: String, startDate: String? = null) =
        TrainingPlan(
            id = id,
            userId = "u1",
            name = id,
            totalWeeks = 8,
            startDate = startDate,
            generationStatus = TrainingPlan.GenerationStatus.Ready,
        )

    private fun badge(entry: TimelineEntry) = statusBadge(entry).let { it.label to it.tone }

    @Test
    fun theServerSaysWhichDayIsTheRaceAndWhichMissedDayWasOnlyRest() {
        assertEquals("Race Day" to BadgeTone.Warning, badge(entry(dayKind = TimelineEntry.DayKind.Race)))
        assertEquals(
            "Rest day" to BadgeTone.Neutral,
            badge(entry(status = TimelineEntry.Status.Missed, dayKind = TimelineEntry.DayKind.Rest)),
        )
        // A session still to do is the web's blue, not the accent: the accent marks a key one.
        assertEquals("Planned" to BadgeTone.Info, badge(entry(dayKind = TimelineEntry.DayKind.Rest)))
        assertEquals(
            "Missed" to BadgeTone.Neutral,
            badge(entry(status = TimelineEntry.Status.Missed, dayKind = TimelineEntry.DayKind.Session)),
        )
        // An entry cached before the server said: its status alone.
        assertEquals("Missed" to BadgeTone.Neutral, badge(entry(status = TimelineEntry.Status.Missed)))
    }

    @Test
    fun everyStatusBadgeHasTheWebsIconAheadOfItsWords() {
        val planned = entry()
        val badges = listOf(
            planned,
            planned.copy(status = TimelineEntry.Status.Completed),
            planned.copy(status = TimelineEntry.Status.Skipped),
            planned.copy(status = TimelineEntry.Status.Missed),
            planned.copy(status = TimelineEntry.Status.Missed, recoverable = true),
            planned.copy(status = TimelineEntry.Status.Missed, recovery = TimelineEntry.Recovery.LetGo),
            planned.copy(status = TimelineEntry.Status.Missed, dayKind = TimelineEntry.DayKind.Rest),
            planned.copy(excused = true),
            planned.copy(dayKind = TimelineEntry.DayKind.Race),
        ).map(::statusBadge)
        assertEquals(
            listOf("Planned", "Completed", "Skipped", "Missed", "Missed", "Let go", "Rest day", "Not counted", "Race Day"),
            badges.map { it.label },
        )
        assertTrue(badges.all { it.icon != null })
        // A miss still to decide is amber; one that's history is neutral. Neither is red.
        assertEquals(listOf(BadgeTone.Neutral, BadgeTone.Warning), badges.filter { it.label == "Missed" }.map { it.tone })
    }

    @Test
    fun onlyKeyAndOptionalSessionsStillToDoCarryATier() {
        val day = entry().copy(planDayId = "d1")
        assertEquals("Key" to BadgeTone.Accent, tierBadge(day.copy(priority = TimelineEntry.Priority.Key))?.let { it.label to it.tone })
        assertEquals(
            "Optional" to BadgeTone.Outline,
            tierBadge(day.copy(priority = TimelineEntry.Priority.Optional))?.let { it.label to it.tone },
        )
        // Supporting is the everyday middle, and a done or skipped day is past deciding.
        assertNull(tierBadge(day.copy(priority = TimelineEntry.Priority.Supporting)))
        assertNull(tierBadge(day.copy(priority = TimelineEntry.Priority.Key, status = TimelineEntry.Status.Completed)))
        assertNull(tierBadge(day.copy(priority = TimelineEntry.Priority.Key, status = TimelineEntry.Status.Skipped)))
        assertNull(tierBadge(day.copy(priority = TimelineEntry.Priority.Key, planDayId = null)))
    }

    @Test
    fun theServersSplitNotesShowAndOldCachedNotesShowAsTheAthletesText() {
        val split = TimelineCoachNotes("Legs heavy", listOf(TimelineCoachNotes.CuesItem("Pacing", "hold 5:30/km")))
        assertEquals(split, coachNotesOf(entry(notes = "raw", coachNotes = split)))
        assertEquals(TimelineCoachNotes("Easy day", emptyList()), coachNotesOf(entry(notes = "  Easy day ")))
        assertNull(coachNotesOf(entry(notes = "  ")))
    }

    @Test
    fun aCueReadsItsLabelThenItsText() {
        assertEquals("Pacing: hold 5:30/km", cueText(TimelineCoachNotes.CuesItem("Pacing", "hold 5:30/km"), Color.Black).text)
        assertEquals("Stay easy", cueText(TimelineCoachNotes.CuesItem(null, "Stay easy"), Color.Black).text)
    }

    @Test
    fun theMafCeilingShowsOnPlannedRunsOnly() {
        assertEquals(142, mafCeilingFor(entry(), 142))
        assertNull(mafCeilingFor(entry(), null))
        assertNull(mafCeilingFor(entry(sets = listOf(set("back_squat"))), 142))
        assertNull(mafCeilingFor(entry(sets = emptyList()), 142))
        assertNull(mafCeilingFor(entry(status = TimelineEntry.Status.Completed), 142))
        assertNull(mafCeilingFor(entry(planDayId = null), 142))
        assertEquals(
            "Your MAF aerobic ceiling is 142 bpm. Hold at or under it for this run — it's a ceiling to stay below, not a target to chase.",
            mafCeilingExplanation(142),
        )
    }

    @Test
    fun aCardIsPendingWhileItsPlanDayOrWorkoutHasWritesWaiting() {
        val state = TimelineUiState(pending = setOf("d1", "w9"))
        assertTrue(state.isPending(entry(planDayId = "d1")))
        assertTrue(state.isPending(entry(planDayId = null, workoutLogId = "w9")))
        assertFalse(state.isPending(entry(planDayId = "d2")))
    }

    @Test
    fun theEmptyTimelineStartsThePickedPlanElseTheFirstWithoutDates() {
        val plans = listOf(plan("scheduled", startDate = "2026-11-02"), plan("undated"))
        assertEquals("picked", planToSchedule(plans, "picked"))
        assertEquals("undated", planToSchedule(plans, null))
        assertEquals("scheduled", planToSchedule(listOf(plan("scheduled", startDate = "2026-11-02")), null))
        assertNull(planToSchedule(emptyList(), null))
    }

    @Test
    fun aPlanIsReadyToStartOnlyWhenNothingShows() {
        val empty = TimelineRows(listOf(TimelineDay("2026-11-10", emptyList(), isToday = true)), 0, 0)
        val ready = TimelineUiState(loaded = true, rows = empty, plans = listOf(plan("p1")))
        assertEquals("p1", ready.planReadyToStart())

        assertNull(ready.copy(plans = emptyList()).planReadyToStart())
        assertNull(ready.copy(statusFilter = TimelineEntry.Status.Completed).planReadyToStart())
        assertNull(ready.copy(refreshing = true).planReadyToStart())
        assertNull(ready.copy(hasOlder = true).planReadyToStart())
        assertNull(ready.copy(rows = empty.copy(hiddenUpcoming = 2)).planReadyToStart())
        val withEntry = TimelineRows(listOf(TimelineDay("2026-11-10", listOf(entry()), isToday = true)), 0, 0)
        assertNull(ready.copy(rows = withEntry).planReadyToStart())
    }

    @Test
    fun todayIsAboveOrBelowOnlyOnceItIsOutOfSight() {
        assertNull(todayDirection(todayItem = 5, firstVisible = 3, visible = setOf(3, 4, 5, 6)))
        assertEquals(TodayDirection.Above, todayDirection(todayItem = 2, firstVisible = 6, visible = setOf(6, 7, 8)))
        assertEquals(TodayDirection.Below, todayDirection(todayItem = 9, firstVisible = 0, visible = setOf(0, 1, 2)))
        // The sticky selection bar (item 1) stays on screen, but today above is still above.
        assertEquals(TodayDirection.Above, todayDirection(todayItem = 4, firstVisible = 8, visible = setOf(1, 8, 9)))
        assertNull(todayDirection(todayItem = -1, firstVisible = 0, visible = setOf(0, 1)))
    }

    // --- The card's tint, plan line and recording figures ---

    @Test
    fun aCardIsTintedByItsStatus() {
        assertEquals(CardTone.Success, cardTone(entry(status = TimelineEntry.Status.Completed)))
        assertEquals(CardTone.Warning, cardTone(entry(status = TimelineEntry.Status.Skipped)))
        assertEquals(CardTone.Warning, cardTone(entry(status = TimelineEntry.Status.Missed).copy(recoverable = true)))
        // A miss with nothing left to decide is plain, as a planned session is.
        assertEquals(CardTone.Plain, cardTone(entry(status = TimelineEntry.Status.Missed)))
        assertEquals(CardTone.Plain, cardTone(entry()))
    }

    @Test
    fun aPlannedSessionsTargetsBecomeTilesAndNoneSetLeavesNone() {
        assertEquals(emptyList(), targetStats(entry()))
        val stats = targetStats(entry().copy(expectedDurationMin = 45, expectedRpe = 7, plannedSetCount = 3))
        assertEquals(listOf("Target duration ~45 min", "Target RPE ~7/10", "Sets 3 sets"), stats.map { it.spoken })
        assertEquals(listOf("Sets"), targetStats(entry().copy(expectedDurationMin = 0, plannedSetCount = 3)).map { it.label })
    }

    @Test
    fun theCoachsNoteSaysHowLongAgoItChanged() {
        val today = "2026-11-15"
        assertEquals("today", updatedAgo("2026-11-15T08:00:00.000Z", today))
        assertEquals("yesterday", updatedAgo("2026-11-14T23:30:00.000Z", today))
        assertEquals("4 days ago", updatedAgo("2026-11-11T12:00:00.000Z", today))
        // A month on it's a date, as it is with no today to count from. A clock ahead of the server's reads "today".
        assertEquals("Oct 1", updatedAgo("2026-10-01T12:00:00.000Z", today))
        assertEquals("Nov 11", updatedAgo("2026-11-11T12:00:00.000Z", null))
        assertEquals("today", updatedAgo("2026-11-16T00:10:00.000Z", today))
        assertNull(updatedAgo(null, today))
        assertNull(updatedAgo("soon", today))
    }

    @Test
    fun eachOfTheCoachsWaysOfChangingASessionHasItsOwnBadgeColour() {
        val tones = listOf("rag", "legacy", "review", "load_governor", "progression").map(::coachSourceTone)
        assertEquals(tones.size, tones.toSet().size)
        assertEquals(BadgeTone.Neutral, coachSourceTone(null))
    }

    @Test
    fun aLinkedRecordingsFiguresReadAsOnTheWeb() {
        val recorded = entry(status = TimelineEntry.Status.Completed, workoutLogId = "w1").copy(
            stravaActivityId = "9001",
            calories = 467,
            avgWatts = 338,
            avgCadence = 73.6,
            avgCadenceUnit = TimelineEntry.AvgCadenceUnit.Spm,
            avgSpeed = 2.75,
            sufferScore = 71,
        )
        assertEquals(listOf("467 cal", "338W", "74 spm", "9.9 km/h", "Effort: 71"), deviceStats(recorded, "km").map { it.text })
        assertEquals("6.2 mph", deviceStats(recorded, "miles")[3].text)
        // Zeroes are absent figures, and a session no recording is linked to has none to show.
        assertEquals(
            listOf("467 cal"),
            deviceStats(recorded.copy(avgWatts = 0, avgCadence = null, avgSpeed = -1.0, sufferScore = null), "km").map {
                it.text
            },
        )
        assertEquals(emptyList(), deviceStats(recorded.copy(stravaActivityId = null), "km"))
        assertEquals(listOf("467 cal"), deviceStats(entry().copy(source = "strava", calories = 467), "km").map { it.text })
    }
}
