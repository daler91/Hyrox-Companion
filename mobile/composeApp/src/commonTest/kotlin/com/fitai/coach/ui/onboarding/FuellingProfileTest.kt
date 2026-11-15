package com.fitai.coach.ui.onboarding

import com.fitai.coach.core.nutrition.ActivityLevel
import com.fitai.coach.core.nutrition.BmrSex
import com.fitai.coach.core.nutrition.NutritionTargetInput
import com.fitai.coach.core.nutrition.WeightGoalDirection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FuellingProfileTest {
    private val metric = SetupProfile(gender = "female", age = "34")
    private val complete = FuellingFields(bodyweight = "80", heightCm = "180", activityLevel = ActivityLevel.Moderate)

    @Test
    fun aCompleteProfileIsATargetInput() {
        assertEquals(
            NutritionTargetInput(
                bodyweightKg = 80.0,
                heightCm = 180.0,
                ageYears = 34.0,
                sex = BmrSex.Female,
                activityLevel = ActivityLevel.Moderate,
                goalDirection = WeightGoalDirection.Maintain,
                goalRateKgPerWeek = 0.0,
            ),
            parseFuellingProfile(complete, metric),
        )
        val losing =
            parseFuellingProfile(complete.copy(goalDirection = WeightGoalDirection.Lose), metric.copy(gender = "prefer_not_to_say"))
        assertEquals(DEFAULT_GOAL_RATE_KG_PER_WEEK, losing?.goalRateKgPerWeek)
        assertNull(losing?.sex)
    }

    @Test
    fun aMissingOrImplausibleFieldSuggestsNothing() {
        assertNull(parseFuellingProfile(complete.copy(activityLevel = null), metric))
        assertNull(parseFuellingProfile(complete.copy(bodyweight = ""), metric))
        assertNull(parseFuellingProfile(complete.copy(bodyweight = "8"), metric))
        assertNull(parseFuellingProfile(complete.copy(heightCm = "18"), metric))
        assertNull(parseFuellingProfile(complete, metric.copy(age = "")))
        assertNull(parseFuellingProfile(complete, metric.copy(age = "12")))
    }

    @Test
    fun anAthleteWhoWeighsInPoundsTypesPoundsAndFeetAndInches() {
        val imperial = metric.copy(weightUnit = "lbs")
        val input =
            parseFuellingProfile(
                FuellingFields(bodyweight = "176", heightFt = "5", heightIn = "11", activityLevel = ActivityLevel.Light),
                imperial,
            )

        assertEquals(79.8, input?.bodyweightKg)
        assertEquals(180.3, input?.heightCm)
    }

    @Test
    fun anUntouchedProfileKeepsItsSavedKilosAndGoalRate() {
        val saved = SavedBody(
            bodyweightKg = 80.04,
            heightCm = 180.0,
            age = 34,
            activityLevel = ActivityLevel.Moderate,
            goalDirection = WeightGoalDirection.Lose,
            goalRateKgPerWeek = 0.5,
        )
        val fields = FuellingFields.from(saved, "kg", goalId = "functional")
        assertEquals("80", fields.bodyweight)

        val input = resolveFuellingProfile(fields, metric, saved)
        assertEquals(80.04, input?.bodyweightKg)
        assertEquals(0.5, input?.goalRateKgPerWeek)
        assertTrue(isSavedFuellingProfile(input!!, saved))

        val retyped = resolveFuellingProfile(fields.copy(bodyweight = "82"), metric, saved)
        assertEquals(82.0, retyped?.bodyweightKg)
        assertFalse(isSavedFuellingProfile(retyped!!, saved))
    }

    @Test
    fun losingWeightAsTheGoalStartsTheWeightGoalOnLose() {
        assertEquals(WeightGoalDirection.Lose, FuellingFields.from(SavedBody(), "kg", goalId = "weight_loss").goalDirection)
        assertEquals(WeightGoalDirection.Maintain, FuellingFields.from(SavedBody(), "kg", goalId = "functional").goalDirection)
        val savedGain = SavedBody(goalDirection = WeightGoalDirection.Gain)
        assertEquals(WeightGoalDirection.Gain, FuellingFields.from(savedGain, "kg", goalId = "weight_loss").goalDirection)
    }

    @Test
    fun switchingUnitsConvertsATypedWeight() {
        assertEquals("176.4", convertTypedWeight("80", "kg", "lbs"))
        assertEquals("80", convertTypedWeight("176.37", "lbs", "kg"))
        assertEquals("", convertTypedWeight("", "kg", "lbs"))
        assertEquals("abc", convertTypedWeight("abc", "kg", "lbs"))
    }
}
