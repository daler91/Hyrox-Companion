package com.fitai.coach.ui.onboarding

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PostPlansGenerateRequest
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OnboardingModelTest {
    @Test
    fun goalsReadAsSentencesWithTheirRace() {
        assertEquals("Complete HYROX Pro feeling strong on every station", describeOnboardingGoal("functional", "pro", null))
        assertEquals("Complete HYROX Open feeling strong on every station", describeOnboardingGoal("functional", null, ""))
        assertEquals(
            "Build my running endurance for HYROX's eight 1 km runs, racing on 2027-03-14",
            describeOnboardingGoal("endurance", "open", "2027-03-14"),
        )
    }

    @Test
    fun aRaceDateMustBeRealAndNotPast() {
        assertNull(raceDateError("", "2026-11-08"))
        assertNull(raceDateError("2026-11-08", "2026-11-08"))
        assertEquals("That date has passed. Pick today or later, or leave it blank.", raceDateError("2026-11-07", "2026-11-08"))
        assertEquals("That isn't a real date. Check the year, or leave it blank.", raceDateError("2026-02-30", "2026-01-01"))
    }

    @Test
    fun ageIsOptionalButMustBeAWholeNumberTheServerTakes() {
        assertNull(ageError(""))
        assertNull(ageError("34"))
        assertNotNull(ageError("12"))
        assertNotNull(ageError("101"))
        assertNotNull(ageError("34.5"))
    }

    @Test
    fun theAiFormStartsOnTheNextMondayForEightWeeksOrToTheRace() {
        // 2026-11-08 is a Sunday.
        val plain = PlanForm.initial("Goal", "2026-11-08", raceDate = "")
        assertEquals("2026-11-09", plain.startDate)
        assertEquals("2027-01-04", plain.endDate)
        assertFalse(plain.endDateIsRaceDate)
        assertEquals(listOf("Saturday", "Sunday"), plain.restDays)
        assertTrue(plain.canGenerate)

        val race = PlanForm.initial("Goal", "2026-11-08", raceDate = "2027-02-20")
        assertEquals("2027-02-20", race.endDate)
        assertTrue(race.endDateIsRaceDate)
    }

    @Test
    fun restDaysFollowTheTrainingDayCount() {
        val form = PlanForm.initial("Goal", "2026-11-08", null).withDaysPerWeek(4)
        assertEquals(listOf("Wednesday", "Saturday", "Sunday"), form.restDays)

        val fewer = form.toggleRestDay("Wednesday")
        assertFalse(fewer.canGenerate)
        val swapped = fewer.toggleRestDay("Monday")
        assertEquals(listOf("Monday", "Saturday", "Sunday"), swapped.restDays)
        assertTrue(swapped.canGenerate)
        assertEquals(swapped, swapped.toggleRestDay("Tuesday"))

        assertEquals(7, form.withDaysPerWeek(9).daysPerWeek)
        assertEquals(2, form.withDaysPerWeek(1).daysPerWeek)
    }

    @Test
    fun theRequestAlwaysSaysWhetherItEndsOnRaceDayAndSendsInjuriesOnlyWhenFilledIn() {
        val form = PlanForm.initial(" Goal ", "2026-11-08", null)
        val json = ApiJson.encodeToJsonElement(PostPlansGenerateRequest.serializer(), form.toRequest()).jsonObject
        assertEquals("false", json["endDateIsRaceDate"].toString())
        assertEquals("\"Goal\"", json["goal"].toString())
        assertNull(json["injuries"])
        assertNull(json["focusAreas"])
        assertEquals("""["Saturday","Sunday"]""", json["restDays"].toString())

        val everyDay = form.withDaysPerWeek(7).toggleFocus("running").copy(injuries = " sore knee ").toRequest()
        assertNull(everyDay.restDays)
        assertEquals(listOf("running"), everyDay.focusAreas)
        assertEquals("sore knee", everyDay.injuries)
    }

    @Test
    fun planDatesMustSpanOneToTwentyFourWeeks() {
        assertNull(planDateError("2026-11-09", "2027-01-04", false))
        assertEquals("End date must be after the start date.", planDateError("2026-11-09", "2026-11-09", false))
        assertEquals(
            "Plan length must be between 1 and 24 weeks (your dates span 26 weeks).",
            planDateError("2026-11-09", "2027-05-10", false),
        )
    }

    @Test
    fun aMidweekStartSaysWhatWeekOneLoses() {
        assertNull(weekOneStartNote("2026-11-09"))
        assertEquals(
            "Plans run Monday to Sunday, so starting on a Wednesday leaves week 1's Monday and Tuesday sessions off your calendar. " +
                "Pick a Monday to keep them.",
            weekOneStartNote("2026-11-11"),
        )
        assertEquals(
            "Week 1 starts on a Thursday, so the plan keeps Monday to Wednesday of that week as rest.",
            aiWeekOneStartNote("2026-11-12"),
        )
    }

    @Test
    fun setupSendsOnlyWhatTheAthleteChanged() {
        val prefs = PreferencesResponse(userTimezone = "Europe/London", onboardingCompleted = false, weightUnit = "lbs", age = 40)
        val saved = SetupProfile.from(prefs)
        assertEquals(SetupProfile(weightUnit = "lbs", age = "40"), saved)
        assertNull(unitsPatch(saved, saved))

        val patch = unitsPatch(saved.copy(division = "pro", age = ""), saved)
        assertEquals(UpdateUserPreferences(division = UpdateUserPreferences.Division.Pro, age = Patch.of(null)), patch)
    }

    @Test
    fun theTemplatesDateAndTheAiFormCountAsThePlanStep() {
        assertEquals(1, stepNumber(SetupStep.Welcome))
        assertEquals(5, stepNumber(SetupStep.Plan))
        assertEquals(5, stepNumber(SetupStep.Schedule))
        assertEquals(5, stepNumber(SetupStep.Generating))
    }

    @Test
    fun onlyLivePlansWithTrainingLeftOverlap() {
        val plans = listOf(
            plan("live", "2026-11-02", "2026-12-27"),
            plan("ended", "2026-09-01", "2026-11-07"),
            plan("archived", "2026-11-02", "2026-12-27", retiredOn = "2026-11-05"),
            plan("unscheduled", null, null),
            plan("later", "2027-03-01", "2027-04-25"),
        )

        val overlapping = findOverlappingPlans(plans, "2026-11-09", "2027-01-04", today = "2026-11-08")

        assertEquals(listOf("live"), overlapping.map { it.id })
        assertTrue(findOverlappingPlans(plans, "", "2027-01-04", today = "2026-11-08").isEmpty())
    }

    @Test
    fun overlappingPlansAreArchivedUnlessKept() {
        val overlapping = listOf(plan("a", "2026-11-02", "2026-12-27"), plan("b", "2026-11-02", "2026-12-27"))
        val form = PlanForm.initial("Goal", "2026-11-08", null)

        assertEquals(listOf("a", "b"), form.supersedeIds(overlapping))
        val keepB = form.toggleSupersede("b")
        assertEquals(listOf("a"), keepB.supersedeIds(overlapping))
        assertEquals(listOf("a", "b"), keepB.toggleSupersede("b").supersedeIds(overlapping))

        assertEquals(listOf("a"), keepB.toRequest(keepB.supersedeIds(overlapping)).supersedePlanIds)
        // None to archive sends none, as an older client would.
        assertNull(form.toRequest(emptyList()).supersedePlanIds)
    }

    @Test
    fun theOlderNoteIsPrefilledAndAClearedBoxStillDropsIt() {
        val form = PlanForm.initial("Goal", "2026-11-08", null)
        assertEquals(form, form.withRememberedNote(" "))

        val remembered = form.withRememberedNote(" Sore left knee ")
        assertEquals("Sore left knee", remembered.injuries)
        assertEquals("Sore left knee", remembered.toRequest().injuries)
        // Cleared, it is still sent, empty, so the server forgets the note.
        assertEquals("", remembered.copy(injuries = "  ").toRequest().injuries)
    }

    private fun plan(id: String, start: String?, end: String?, retiredOn: String? = null) = TrainingPlan(
        id = id,
        userId = "u1",
        name = id,
        totalWeeks = 8,
        startDate = start,
        endDate = end,
        retiredOn = retiredOn,
        generationStatus = TrainingPlan.GenerationStatus.Ready,
    )
}
