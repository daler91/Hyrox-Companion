package com.fitai.coach.ui.fuelling

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.GetNutritionPlannedSessionEstimateByPlanDayIdResponse
import com.fitai.coach.core.api.generated.GetNutritionSummaryRangeResponse
import com.fitai.coach.core.api.generated.NutritionEffectiveTarget
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TimelineSessionEstimate
import com.fitai.coach.core.nutrition.SessionFuellingTargetInput
import com.fitai.coach.core.nutrition.computeSessionFuellingTarget
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FuellingModelTest {
    @Test
    fun whatsLeftReadsAsGramsToGoUntilItsMet() {
        assertEquals("12g to go", gapText(12.0))
        assertEquals("12.5g to go", gapText(12.5))
        assertEquals("on target", gapText(0.0))
        assertEquals("on target", gapText(-8.0))
        assertEquals("on target", gapText(null))
    }

    @Test
    fun theHintNamesWhatTheTargetsAreMissing() {
        assertEquals(PlanHint.NoBodyweight, planHint(noBodyweight = true, hasDuration = false, usingEstimate = true))
        assertEquals(PlanHint.NoDuration, planHint(noBodyweight = false, hasDuration = false, usingEstimate = false))
        assertEquals(PlanHint.Estimated, planHint(noBodyweight = false, hasDuration = true, usingEstimate = true))
        assertNull(planHint(noBodyweight = false, hasDuration = true, usingEstimate = false))
    }

    @Test
    fun theAdjustRowSaysWhatsSet() {
        assertEquals("60 min · RPE 7 · at 07:30", adjustSummary(60, 7, "07:30"))
        assertEquals("RPE 4", adjustSummary(null, 4, ""))
        assertEquals("", adjustSummary(null, null, null))
    }

    @Test
    fun editsToDifferentFieldsGoOutAsOneAndTheLatestOfEachWins() {
        val first = PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(65), plannedTimeOfDayMin = Patch.Value(420))
        val merged = first
            .then(PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(70)))
            .then(PatchPlansDaysByDayIdRequest(expectedRpe = Patch.Value(null)))

        assertEquals(Patch.Value(70), merged.expectedDurationMin)
        assertEquals(Patch.Value<Int>(null), merged.expectedRpe)
        assertEquals(Patch.Value(420), merged.plannedTimeOfDayMin)
    }

    @Test
    fun aDaysChipShowsCaloriesAndProteinAgainstTheirTargets() {
        val chip = DayFuelling.of(
            day(calories = 2460.4, protein = 120.0, target = target(calories = 2400.0, protein = 150.0), post = true),
        )!!

        assertEquals(2460, chip.calories)
        assertEquals(2400, chip.caloriesTarget)
        // 103% rounds past 100: over.
        assertTrue(chip.caloriesOver)
        assertEquals("Fuelling: 2460 of 2400 kcal, 120 of 150 g protein, post-workout meal logged", chip.description)
    }

    @Test
    fun aDayWithoutTargetsShowsWhatWasLoggedAndAnEmptyDayShowsNothing() {
        val logged = DayFuelling.of(day(calories = 640.0, protein = 30.0, target = null, post = false))!!
        assertNull(logged.caloriesTarget)
        assertNull(logged.protein)
        assertFalse(logged.caloriesOver)
        assertEquals("Fuelling: 640 kcal logged", logged.description)

        assertNull(DayFuelling.of(day(calories = 0.0, protein = 0.0, target = null, post = false)))
        // A target with nothing logged yet still shows: the day's to-do.
        assertEquals(
            0,
            DayFuelling.of(day(calories = 0.0, protein = 0.0, target = target(calories = 2400.0, protein = null), post = false))?.calories,
        )
    }

    @Test
    fun aWindowWithinTheCapIsKeptWhole() {
        assertEquals(DateRange("2026-11-02", "2026-11-29"), fuellingRangeWindow("2026-11-02", "2026-11-29", "2026-11-12"))
    }

    @Test
    fun aWiderWindowNarrowsAroundTodayOrToItsNearerEnd() {
        // Today near the newest end: the window keeps that end.
        assertEquals(DateRange("2024-11-29", "2026-11-29"), fuellingRangeWindow("2024-01-01", "2026-11-29", "2026-11-12"))
        // Today near the oldest end: the window keeps that end.
        assertEquals(DateRange("2024-01-01", "2025-12-31"), fuellingRangeWindow("2024-01-01", "2026-11-29", "2024-02-01"))
    }

    @Test
    fun theTimelineAsksForWholeFourWeekBlocksAroundItsSessions() {
        // Any day in a block asks for the same Monday-to-Sunday four weeks.
        assertEquals(DateRange("2026-11-02", "2026-11-29"), timelineFuellingWindow(listOf("2026-11-12"), "2026-11-12"))
        assertEquals(DateRange("2026-11-02", "2026-11-29"), timelineFuellingWindow(listOf("2026-11-19", "2026-11-05"), "2026-11-12"))
        assertNull(timelineFuellingWindow(emptyList(), "2026-11-12"))
    }

    @Test
    fun savedValuesWinAndTheEstimateFillsOnlyWhatsUntouched() {
        val draft = PlanDraft(entry(expectedDurationMin = null, expectedRpe = null, plannedTimeOfDayMin = 450))
        assertEquals("07:30", draft.timeText)
        // No duration yet: the fields show.
        assertTrue(draft.expanded)

        assertEquals(PatchPlansDaysByDayIdRequest(expectedRpe = Patch.Value(6)), draft.pickRpe(6))
        draft.useEstimate(estimate(durationMin = 55.0, rpe = 8.0))
        assertEquals(55, draft.duration)
        assertEquals(6, draft.rpe)
        // A duration came in: the fields fold away until opened.
        assertFalse(draft.expanded)

        val saved = PlanDraft(entry(expectedDurationMin = 90, expectedRpe = 5, plannedTimeOfDayMin = null))
        saved.useEstimate(estimate(durationMin = 55.0, rpe = 8.0))
        assertEquals(90, saved.duration)
        assertEquals(5, saved.rpe)
    }

    @Test
    fun theDurationStepsAndTypesWithinWhatTheServerTakes() {
        val draft = PlanDraft(entry(expectedDurationMin = null, expectedRpe = null, plannedTimeOfDayMin = null))
        assertEquals(PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(5)), draft.stepDuration(5))
        assertEquals(PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(1)), draft.stepDuration(-5))
        assertEquals(PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(600)), draft.typeDuration("9999"))
        assertEquals("999", draft.durationText)
        assertEquals(PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(null)), draft.typeDuration(""))
        // An estimate that comes in after the athlete typed leaves it alone.
        draft.useEstimate(estimate(durationMin = 55.0, rpe = null))
        assertEquals("", draft.durationText)
    }

    @Test
    fun aStartTimeSavesOnceItReadsAsOneAndClearsWhenEmptied() {
        val draft = PlanDraft(entry(expectedDurationMin = 60, expectedRpe = 7, plannedTimeOfDayMin = null))
        assertNull(draft.typeTime("6:4"))
        assertTrue(draft.timeInvalid)
        assertEquals(PatchPlansDaysByDayIdRequest(plannedTimeOfDayMin = Patch.Value(405)), draft.typeTime("6:45"))
        assertFalse(draft.timeInvalid)
        assertEquals(PatchPlansDaysByDayIdRequest(plannedTimeOfDayMin = Patch.Value(null)), draft.typeTime(""))
    }

    @Test
    fun aPlannedCardsFuelComesFromTheAthletesExpectationsElseTheServersEstimate() {
        val estimate = TimelineSessionEstimate(durationMin = 95.0, rpe = 8.0, source = TimelineSessionEstimate.Source.Sets, clamped = false)
        fun expected(durationMin: Double?, rpe: Double?) =
            computeSessionFuellingTarget(SessionFuellingTargetInput(durationMin = durationMin, rpe = rpe, bodyweightKg = 70.0))

        // The athlete's own numbers win.
        val own = assertNotNull(FuellingTarget.of(entry(45, 4, null).copy(sessionEstimate = estimate), 70.0))
        assertEquals(expected(45.0, 4.0).postCarbG, own.postCarbG)
        assertEquals(expected(45.0, 4.0).explanation, own.explanation)
        // Else the prescription's estimate: a long hard session wants carbs before.
        val estimated = assertNotNull(FuellingTarget.of(entry(null, null, null).copy(sessionEstimate = estimate), 70.0))
        assertEquals(expected(95.0, 8.0).preCarbG, estimated.preCarbG)
        assertTrue(estimated.hasPre && estimated.hasPost)
        // Neither: an hour at moderate effort, as the web assumes.
        val assumed = assertNotNull(FuellingTarget.of(entry(null, null, null), 70.0))
        assertEquals(expected(null, null).explanation, assumed.explanation)
    }

    @Test
    fun onlyAnUpcomingPlanDayGetsAFuelPlan() {
        assertNull(FuellingTarget.of(entry(60, 6, null).copy(status = TimelineEntry.Status.Completed), null))
        assertNull(FuellingTarget.of(entry(60, 6, null).copy(status = TimelineEntry.Status.Missed), null))
        assertNull(FuellingTarget.of(entry(60, 6, null).copy(planDayId = null), null))
        assertNotNull(FuellingTarget.of(entry(60, 6, null), null))
    }

    private fun entry(expectedDurationMin: Int?, expectedRpe: Int?, plannedTimeOfDayMin: Int?) = TimelineEntry(
        id = "plan-d1",
        date = "2026-11-12",
        type = TimelineEntry.Type.Planned,
        status = TimelineEntry.Status.Planned,
        focus = "Tempo",
        mainWorkout = "6 x 800 m",
        planDayId = "d1",
        expectedDurationMin = expectedDurationMin,
        expectedRpe = expectedRpe,
        plannedTimeOfDayMin = plannedTimeOfDayMin,
    )

    private fun estimate(durationMin: Double?, rpe: Double?) = GetNutritionPlannedSessionEstimateByPlanDayIdResponse(
        planDayId = "d1",
        durationMin = durationMin,
        rpe = rpe,
        source = GetNutritionPlannedSessionEstimateByPlanDayIdResponse.Source.Structure,
        refined = false,
    )

    private fun day(calories: Double, protein: Double, target: NutritionEffectiveTarget?, post: Boolean) =
        GetNutritionSummaryRangeResponse.DaysItem(
            date = "2026-11-12",
            totals = NutritionMacroTotals(calories = calories, protein = protein, carb = 0.0, fat = 0.0, fiber = 0.0),
            effectiveTarget = target,
            hasPostWorkoutFuel = post,
        )

    private fun target(calories: Double?, protein: Double?) = NutritionEffectiveTarget(
        calories = calories,
        proteinG = protein,
        carbDeltaG = 0.0,
        baseLoadDeltaG = 0.0,
        recoveryDeltaG = 0.0,
        preloadDeltaG = 0.0,
        proteinDeltaG = 0.0,
        utss = 0.0,
        scaled = false,
        reasonCodes = emptyList(),
        explanation = "",
    )
}
