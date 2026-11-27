package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.CoachNoteInputs
import com.fitai.coach.core.api.generated.TimelineEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MissedSessionNotesTest {
    /** A Wednesday. Tuesday's squats (the 24th) are the session that never happened. */
    private val today = "2026-11-25"
    private val missedOn = "2026-11-24"
    private val utc = "UTC"

    // Sessions still ahead, and what the hold reads as on them.
    private val saturday = "2026-11-28"
    private val nextTuesday = "2026-12-01"
    private val tuesdayAfter = "2026-12-08"
    private val strength = "Lower Strength"
    private val squatHeld = "Back Squat: 102.5 → 100 kg"

    /** The source of a note the coach wrote without changing the session. */
    private val reviewNote = "review"

    private fun entry(
        id: String,
        date: String,
        status: TimelineEntry.Status = TimelineEntry.Status.Planned,
        focus: String = strength,
        priority: TimelineEntry.Priority? = TimelineEntry.Priority.Key,
    ) = TimelineEntry(
        id = id,
        date = date,
        type = TimelineEntry.Type.Planned,
        status = status,
        focus = focus,
        mainWorkout = "",
        planDayId = "pd-$id",
        priority = priority,
    )

    private fun squat(from: Double = 102.5, to: Double = 100.0) = CoachNoteInputs.MissedSessionHold.ChangesItem(
        exercise = "back_squat",
        kind = CoachNoteInputs.MissedSessionHold.ChangesItem.Kind.Hold,
        from = from,
        to = to,
        unit = "kg",
    )

    private fun hold(
        kind: CoachNoteInputs.MissedSessionHold.Kind = CoachNoteInputs.MissedSessionHold.Kind.Missed,
        date: String = missedOn,
        changes: List<CoachNoteInputs.MissedSessionHold.ChangesItem> = listOf(squat()),
    ) = CoachNoteInputs.MissedSessionHold(kind, date, changes)

    /** What the server leaves on a session whose loads it holds. */
    private fun held(record: CoachNoteInputs.MissedSessionHold = hold()) = CoachNoteInputs(missedSessionHold = record)

    /** An upcoming session the coach wrote on at [updatedAt], as [source]. */
    private fun coached(id: String, date: String, source: String, updatedAt: String) =
        entry(id, date).copy(aiSource = source, aiNoteUpdatedAt = updatedAt)

    private val afterTheMiss = "2026-11-25T06:00:00.000Z"

    // --- The held session's line ---

    @Test
    fun aHeldSessionSaysWhichSessionItFollowsAndWhatMoved() {
        val session = entry("next", nextTuesday).copy(aiInputsUsed = held())

        assertEquals(
            HoldLine("Adjusted after the session you missed on Tue Nov 24", squatHeld),
            holdLine(session),
        )
    }

    @Test
    fun aSkipAndADeclaredAbsenceAreNotCalledAMiss() {
        val skipped = hold(CoachNoteInputs.MissedSessionHold.Kind.Skipped)
        val excused = hold(CoachNoteInputs.MissedSessionHold.Kind.Excused)

        assertEquals("Adjusted after the session you skipped on Tue Nov 24", holdReason(skipped))
        assertEquals("Adjusted for the session not done on Tue Nov 24", holdReason(excused))
    }

    @Test
    fun aDateThatIsNotOneIsLeftOutOfTheReason() {
        assertEquals("Adjusted after the session you missed", holdReason(hold(date = "soon")))
    }

    @Test
    fun aLongListNamesTheFirstFewChanges() {
        val changes = listOf(squat(102.5, 100.0), squat(60.0, 57.5), squat(40.0, 37.5), squat(30.0, 27.5), squat(20.0, 17.5))
        val session = entry("next", nextTuesday).copy(aiInputsUsed = held(hold(changes = changes)))

        assertEquals(
            "Back Squat: 102.5 → 100 kg · Back Squat: 60 → 57.5 kg · Back Squat: 40 → 37.5 kg · and 2 more",
            holdLine(session)?.changes,
        )
    }

    @Test
    fun onlyASessionStillToComeCarriesTheLine() {
        val done = entry("done", "2026-11-25", status = TimelineEntry.Status.Completed).copy(aiInputsUsed = held())
        val nothingMoved = entry("same", nextTuesday).copy(aiInputsUsed = held(hold(changes = emptyList())))

        assertNull(holdLine(done))
        assertNull(holdLine(nothingMoved))
        assertNull(holdLine(entry("plain", nextTuesday)))
    }

    // --- The missed session's own card ---

    @Test
    fun aMissedCardListsTheSessionsHeldForItSoonestFirst() {
        val miss = entry("miss", missedOn, status = TimelineEntry.Status.Missed)
        val later = entry("later", tuesdayAfter).copy(aiInputsUsed = held(hold(changes = listOf(squat(105.0, 102.5)))))
        val next = entry("next", nextTuesday).copy(aiInputsUsed = held())
        // Held for another day's miss: that miss lists it.
        val other = entry("other", saturday).copy(aiInputsUsed = held(hold(date = "2026-11-21")))

        val aftermath = missedAftermath(listOf(later, miss, other, next), today, utc)

        assertEquals(setOf("miss"), aftermath.keys)
        assertEquals(
            listOf(
                HeldSession("next", nextTuesday, strength, listOf(squatHeld)),
                HeldSession("later", tuesdayAfter, strength, listOf("Back Squat: 105 → 102.5 kg")),
            ),
            aftermath["miss"]?.held,
        )
        assertNull(aftermath["miss"]?.reviewed)
    }

    @Test
    fun theLatestMissSaysWhatElseTheCoachWentOver() {
        val earlier = entry("earlier", "2026-11-21", status = TimelineEntry.Status.Skipped)
        val miss = entry("miss", missedOn, status = TimelineEntry.Status.Missed)
        val entries = listOf(
            earlier,
            miss,
            coached("kept", "2026-11-26", reviewNote, afterTheMiss),
            coached("changed", "2026-11-27", "rag", afterTheMiss),
            // Written before the miss: the coach had not seen the plan without it.
            coached("stale", saturday, reviewNote, "2026-11-23T06:00:00.000Z"),
            // Further out than the coach looks.
            coached("far", tuesdayAfter, reviewNote, afterTheMiss),
            // Held for the miss: listed as that, not counted again.
            coached("held", nextTuesday, "progression", afterTheMiss).copy(aiInputsUsed = held()),
        )

        val aftermath = missedAftermath(entries, today, utc)

        assertEquals(CoachReview(adjusted = 1, kept = 1), aftermath["miss"]?.reviewed)
        assertEquals(listOf("held"), aftermath["miss"]?.held?.map { it.id })
        // Two misses in a week do not each claim the same reviews.
        assertNull(aftermath["earlier"])
    }

    @Test
    fun aNoteIsDatedByTheAthletesOwnDayNotUtcs() {
        val miss = entry("miss", missedOn, status = TimelineEntry.Status.Missed)
        // 5 pm on the 24th in Los Angeles, the day of the miss, though already the 25th in UTC.
        val thatEvening = coached("evening", "2026-11-26", reviewNote, "2026-11-25T01:00:00.000Z")
        // 1 am on the 25th in Los Angeles: the coach has seen the plan without the session.
        val nextMorning = coached("morning", "2026-11-27", reviewNote, "2026-11-25T09:00:00.000Z")

        val entries = listOf(miss, thatEvening, nextMorning)

        assertEquals(CoachReview(adjusted = 0, kept = 1), missedAftermath(entries, today, "America/Los_Angeles")["miss"]?.reviewed)
        // Read in UTC, both fall on the 25th.
        assertEquals(CoachReview(adjusted = 0, kept = 2), missedAftermath(entries, today, utc)["miss"]?.reviewed)
    }

    @Test
    fun aMissThePlanDoesNotFollowHasNoAftermath() {
        val next = entry("next", nextTuesday).copy(aiInputsUsed = held())
        fun aftermathOf(miss: TimelineEntry) = missedAftermath(listOf(miss, next), today, utc)
        val miss = entry("miss", missedOn, status = TimelineEntry.Status.Missed)

        assertEquals(setOf("miss"), aftermathOf(miss).keys)
        assertEquals(emptySet(), aftermathOf(miss.copy(priority = TimelineEntry.Priority.Optional)).keys)
        assertEquals(emptySet(), aftermathOf(miss.copy(priority = null)).keys)
        assertEquals(emptySet(), aftermathOf(miss.copy(excused = true)).keys)
        assertEquals(emptySet(), aftermathOf(miss.copy(planDayId = null)).keys)
        assertEquals(emptySet(), aftermathOf(miss.copy(status = TimelineEntry.Status.Completed)).keys)
        // More than a week back, its weekday no longer names it.
        val old = entry("miss", "2026-11-18", status = TimelineEntry.Status.Missed)
        val heldForOld = entry("next", nextTuesday).copy(aiInputsUsed = held(hold(date = "2026-11-18")))
        assertEquals(emptySet(), missedAftermath(listOf(old, heldForOld), today, utc).keys)
    }

    @Test
    fun theMissedCardNamesEachHeldSessionByItsDay() {
        val aftermath = MissedAftermath(
            held = listOf(
                HeldSession("a", nextTuesday, strength, listOf(squatHeld, "Deadlift: 140 → 137.5 kg")),
                // Named for its one exercise: it is said once.
                HeldSession("b", saturday, "Long run", listOf("Long Run: 10 → 9 km")),
            ),
            reviewed = null,
        )

        assertEquals(
            AftermathText(
                lines = listOf(
                    AftermathLine("Tue Dec 1 · Lower Strength", " — Back Squat: 102.5 → 100 kg, Deadlift: 140 → 137.5 kg"),
                    AftermathLine("Sat Nov 28", " · Long Run: 10 → 9 km"),
                ),
                more = null,
                reviewed = null,
            ),
            aftermathText(aftermath),
        )
    }

    @Test
    fun aLongListOfHeldSessionsIsCutShort() {
        val held = (1..5).map { HeldSession("s$it", "2026-12-0$it", strength, listOf(squatHeld)) }

        val text = aftermathText(MissedAftermath(held, reviewed = null))

        assertEquals(3, text.lines.size)
        assertEquals("and 2 more sessions", text.more)
        assertEquals("and 1 more session", aftermathText(MissedAftermath(held.take(4), reviewed = null)).more)
    }

    @Test
    fun whatElseTheCoachWentOverIsOneSentence() {
        val session = HeldSession("a", nextTuesday, strength, listOf(squatHeld))

        assertEquals(
            "Your coach also went over 3 more upcoming sessions: 1 adjusted, 2 kept as planned.",
            aftermathText(MissedAftermath(listOf(session), CoachReview(adjusted = 1, kept = 2))).reviewed,
        )
        // With nothing held, it is the whole answer; a part that is zero is left out.
        assertEquals(
            "Since then your coach has gone over 1 upcoming session: 1 kept as planned.",
            aftermathText(MissedAftermath(emptyList(), CoachReview(adjusted = 0, kept = 1))).reviewed,
        )
    }
}
