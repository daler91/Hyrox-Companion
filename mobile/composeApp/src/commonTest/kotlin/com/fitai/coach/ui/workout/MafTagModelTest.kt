package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.api.generated.MafTestResult
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.data.MafMetrics
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MafTagModelTest {
    private fun prefs(style: String?, mafHr: Int?) = PreferencesResponse(
        userTimezone = "UTC",
        onboardingCompleted = true,
        trainingStyleId = style,
        mafHr = mafHr,
    )

    private val maf = prefs("maf_method", 140)

    private fun tests(json: String) = ApiJson.decodeFromString(GetMafTestsResponse.serializer(), json)

    private fun workout(extra: String) = ApiJson.decodeFromString(
        WorkoutLogDetail.serializer(),
        """{"id":"w1","userId":"u1","date":"2026-11-10","focus":"Easy run","mainWorkout":"","countsAsTraining":true,""" +
            """"autoLinkRecordingOnly":false,"deviceActivity":{},"exerciseSets":[],"structureBlocks":[]$extra}""",
    )

    @Test
    fun theRowShowsForMafAthletesWithACeilingOnly() {
        assertNull(mafTag(prefs("balanced", 140), null, "w1"))
        assertNull(mafTag(prefs("maf_method", null), null, "w1"))
        assertEquals(MafTag(tagged = false), mafTag(maf, null, "w1"))
    }

    @Test
    fun aRunIsTaggedByItsTestOrItsScore() {
        val test = """{"id":"t1","userId":"u1","protocolType":"maf_test","version":1,""" +
            """"conditions":{"source":"workout_tag","workoutLogId":"w1"},"metrics":{"avgHeartRate":138,"mafCeilingUsed":140}}"""
        val byTest = mafTag(maf, tests("""{"tests":[$test],"analysis":[],"workoutDates":{}}"""), "w1")
        assertEquals(true, byTest?.tagged)
        assertEquals(138.0, byTest?.saved?.avgHeartRate)

        // Scored, but its test row missing: still tagged.
        val scoredOnly = tests("""{"tests":[],"analysis":[{"id":"a1","userId":"u1","workoutLogId":"w1","version":1}],"workoutDates":{}}""")
        assertEquals(MafTag(tagged = true), mafTag(maf, scoredOnly, "w1"))
        assertEquals(false, mafTag(maf, tests("""{"tests":[$test],"analysis":[],"workoutDates":{}}"""), "w2")?.tagged)
    }

    @Test
    fun taggingStartsFromTheRunsOwnValuesWithItsMinutesAsSeconds() {
        val run = workout(""","avgHeartrate":138,"maxHeartrate":149,"duration":45,"distanceMeters":7243.5""")

        assertEquals(MafForm(avgHr = "138", maxHr = "149", duration = "45:00", distance = "7.244"), MafForm.forWorkout(run, "km"))
        assertEquals("4.501", MafForm.forWorkout(run, "miles").distance)
        assertEquals(MafForm(), MafForm.forWorkout(workout(""), "km"))
    }

    @Test
    fun correctingStartsFromTheSavedTest() {
        val saved = MafTestResult.Metrics(durationSeconds = 1710.0, distanceMeters = 5000.0, avgHeartRate = 138.0, mafCeilingUsed = 140.0)

        assertEquals(MafForm(avgHr = "138", duration = "28:30", distance = "5"), MafForm.forTest(saved, "km"))
    }

    @Test
    fun whatsTypedIsCheckedAsTheWebChecksIt() {
        assertNull(MafForm().error("km"))
        assertNull(MafForm(avgHr = "138", maxHr = "151", duration = "28:30", distance = "5").error("km"))
        assertEquals("Average heart rate must be a whole number.", MafForm(avgHr = "138.5").error("km"))
        assertEquals("Max heart rate must be a whole number.", MafForm(maxHr = "fast").error("km"))
        assertEquals("Average heart rate must be between 20 and 250 bpm.", MafForm(avgHr = "260").error("km"))
        assertEquals("Max heart rate can't be lower than average heart rate.", MafForm(avgHr = "150", maxHr = "140").error("km"))
        assertEquals("That distance looks too large — please double-check it.", MafForm(distance = "1001").error("km"))
        assertNull(MafForm(distance = "621").error("miles"))
        assertEquals("Enter duration as mm:ss — for example 28:30.", MafForm(duration = "12:75").error("km"))
        assertEquals("Enter duration as mm:ss — for example 28:30.", MafForm(duration = "0").error("km"))
    }

    @Test
    fun blanksAreSavedAsNothingAndDistanceInWholeMetres() {
        assertEquals(MafMetrics(), MafForm().metrics("km"))
        assertEquals(
            MafMetrics(avgHeartRate = 138, maxHeartRate = 151, durationSeconds = 1710, distanceMeters = 8047.0),
            MafForm(avgHr = " 138 ", maxHr = "151", duration = "28:30", distance = "5").metrics("miles"),
        )
    }

    @Test
    fun aDurationReadsAsMinutesOrAClock() {
        assertEquals(2700, parseDurationToSeconds("45"))
        assertEquals(1710, parseDurationToSeconds("28:30"))
        assertEquals(3900, parseDurationToSeconds("1:05:00"))
        assertEquals(90, parseDurationToSeconds("1.5"))
        assertNull(parseDurationToSeconds(""))
        assertNull(parseDurationToSeconds("1:60:00"))
        assertNull(parseDurationToSeconds("1:2:3:4"))
        assertNull(parseDurationToSeconds("28:3o"))
        assertNull(parseDurationToSeconds(":30"))
        assertNull(parseDurationToSeconds("-5"))
    }

    @Test
    fun readableTextIsThePrescriptionElseTheDescription() {
        assertFalse(hasReadableText(workout("")))
        assertTrue(hasReadableText(workout(""","prescribedMainWorkout":"5 km easy"""")))
        assertTrue(hasReadableText(workout(""","accessory":"3 x 10 lunges"""")))
        assertFalse(hasReadableText(workout(""","prescribedMainWorkout":"  """")))
    }
}
