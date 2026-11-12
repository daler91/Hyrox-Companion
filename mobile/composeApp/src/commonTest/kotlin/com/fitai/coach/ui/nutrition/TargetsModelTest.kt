package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionMealFuelTarget
import com.fitai.coach.core.api.generated.NutritionTarget
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.data.MacroTargets
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.nutrition.BmrSex
import com.fitai.coach.core.nutrition.MealFuelOverride
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TargetsModelTest {
    private val profile = PreferencesResponse(
        userTimezone = "Europe/London",
        onboardingCompleted = true,
        gender = "female",
        age = 34,
        bodyweightKg = 62.0,
        heightCm = 168.0,
        activityLevel = "active",
        weightGoalDirection = "lose",
    )

    private fun saved(periodized: Boolean = false, recovery: Boolean = false, phase: Boolean = false) = NutritionTarget(
        id = "t1",
        userId = "u1",
        calories = 2400.0,
        proteinG = 112.5,
        carbG = 300.0,
        fatG = null,
        periodizationEnabled = periodized,
        recoveryEnabled = recovery,
        phaseAware = phase,
        effectiveFrom = "2026-10-01",
    )

    private fun mealTarget(
        override: NutritionMealFuelTarget.Override? = null,
        role: NutritionMealFuelTarget.Role = NutritionMealFuelTarget.Role.Standard,
    ) = NutritionMealFuelTarget(
        calories = 760.0,
        proteinG = 40.0,
        carbG = 90.0,
        fatG = 20.0,
        role = role,
        reasonCodes = if (override != null) listOf("user_override") else emptyList(),
        rationale = "",
        override = override,
        suggested = override?.let { NutritionMealFuelTarget.Suggested(calories = 700.0, proteinG = 35.0, carbG = 90.0, fatG = 20.0) },
    )

    @Test
    fun goalsNeedOneNumberAndNoBadOnes() {
        assertNull(MacroFields().parsed())
        assertNull(MacroFields(calories = "abc").parsed())
        assertNull(MacroFields(calories = "-5").parsed())
        assertEquals(MacroTargets(2400.0, null, 300.0, null), MacroFields(calories = "2400", carb = " 300 ").parsed())
        // Blank is fine where a goal isn't required, as when checking for a carb goal.
        assertEquals(MacroTargets(null, null, null, null), MacroFields().parsed(requireOne = false))
    }

    @Test
    fun theProfileFeedsTheCalculatorOnceItIsComplete() {
        val input = profile.targetInput()!!
        assertEquals(BmrSex.Female, input.sex)
        assertEquals(34.0, input.ageYears)
        // A lose goal with no rate set takes onboarding's 0.25 kg a week, not maintenance.
        assertEquals(0.25, input.goalRateKgPerWeek)
        assertEquals(0.5, profile.copy(weightGoalRateKgPerWeek = 0.5).targetInput()!!.goalRateKgPerWeek)
        assertEquals(0.0, profile.copy(weightGoalDirection = "maintain", weightGoalRateKgPerWeek = 0.5).targetInput()!!.goalRateKgPerWeek)
        assertNull(profile.copy(gender = "prefer_not_to_say").targetInput()!!.sex)

        assertNull(profile.copy(heightCm = null).targetInput())
        assertNull(profile.copy(age = null).targetInput())
        assertNull(profile.copy(activityLevel = null).targetInput())
        assertNull(profile.copy(weightGoalDirection = null).targetInput())
    }

    @Test
    fun theSheetOpensOnTheSavedVersion() {
        val sheet = targetsSheet(saved(periodized = true, recovery = false, phase = true), profile, typicalLoad = 32.0)
        assertEquals(MacroFields(calories = "2400", protein = "112.5", carb = "300", fat = ""), sheet.fields)
        assertTrue(sheet.periodize)
        assertTrue(sheet.adaptive)
        assertFalse(sheet.loading)

        assertFalse(targetsSheet(saved(), profile, null).adaptive)
        // A first target gets the full adaptive model.
        val first = targetsSheet(null, null, null)
        assertTrue(first.adaptive)
        assertFalse(first.periodize)
        assertNull(first.profile)
    }

    @Test
    fun loadScalingNeedsACarbGoalAndSaysWhenItsReferenceIsAssumed() {
        val sheet = targetsSheet(saved(), profile, typicalLoad = 0.0)
        assertTrue(sheet.canPeriodize)
        assertFalse(sheet.copy(fields = sheet.fields.copy(carb = "")).canPeriodize)

        assertFalse(sheet.referenceAssumed)
        assertTrue(sheet.copy(periodize = true).referenceAssumed)
        assertTrue(sheet.copy(periodize = true, typicalLoad = null).referenceAssumed)
        assertFalse(sheet.copy(periodize = true, typicalLoad = 28.4).referenceAssumed)
    }

    @Test
    fun aMealSheetStartsFromItsPinsAndFollowsTheSplitElsewhere() {
        val fresh = mealTargetSheet(Meal.Lunch, mealTarget())
        assertFalse(fresh.overridden)
        assertEquals(MacroFields(), fresh.fields)
        assertEquals(MacroFields("760", "40", "90", "20"), fresh.preview().placeholders())

        val pinned = mealTargetSheet(Meal.Lunch, mealTarget(NutritionMealFuelTarget.Override(proteinG = 40.0)))
        assertTrue(pinned.overridden)
        assertEquals(MacroFields(protein = "40"), pinned.fields)
        // A blank field follows the split the pins replaced, not the shown target.
        assertEquals(90.0, pinned.preview().carbG)
        assertEquals(MealFuelOverride(proteinG = 40.0), pinned.pins())
    }

    @Test
    fun threePinnedMacrosSetTheCalories() {
        // A calorie pin saved beside three macro pins is overruled by them, so it isn't seeded.
        val legacy = mealTargetSheet(
            Meal.Dinner,
            mealTarget(NutritionMealFuelTarget.Override(calories = 900.0, proteinG = 50.0, carbG = 100.0, fatG = 25.0)),
        )
        assertEquals("", legacy.fields.calories)
        assertTrue(legacy.caloriesLocked)
        assertEquals(825.0, legacy.preview().calories)

        val two = legacy.copy(fields = legacy.fields.copy(fat = ""))
        assertFalse(two.caloriesLocked)
        assertNull(legacy.copy(fields = legacy.fields.copy(fat = "x")).pins())
    }

    @Test
    fun aMealIsCaptionedByItsRoleOrAsCustom() {
        assertNull(mealTarget().caption())
        assertEquals("Pre-workout fuel", mealTarget(role = NutritionMealFuelTarget.Role.PreWorkoutFastCarbs).caption())
        assertEquals("Post-workout refuel", mealTarget(role = NutritionMealFuelTarget.Role.PostWorkoutRecovery).caption())
        assertEquals("Flexible", mealTarget(role = NutritionMealFuelTarget.Role.FlexRemainder).caption())
        assertEquals("Custom", mealTarget(NutritionMealFuelTarget.Override(fatG = 10.0)).caption())
    }
}
