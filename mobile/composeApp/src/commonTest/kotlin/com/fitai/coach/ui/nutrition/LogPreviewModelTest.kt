package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.core.api.generated.NutritionMealType
import com.fitai.coach.core.data.Meal
import kotlin.test.Test
import kotlin.test.assertEquals

/** The log sheet's preview: macro split, micronutrients, and the effect on the day's goals (LogFoodDialog). */
class LogPreviewModelTest {
    private fun totals(calories: Double = 0.0, protein: Double = 0.0, carb: Double = 0.0, fat: Double = 0.0, fiber: Double = 0.0) =
        NutritionMacroTotals(calories, protein, carb, fat, fiber)

    @Test
    fun eachMacrosShareOfTheEnergyIsWorkedOutFromItsGrams() {
        val shares = macroEnergyShares(totals(protein = 20.0, carb = 30.0, fat = 10.0))

        assertEquals(290.0, shares.totalKcal)
        assertEquals(listOf(28, 41, 31), listOf(shares.protein.pct, shares.carb.pct, shares.fat.pct))
        assertEquals(90.0, shares.fat.kcal)
        assertEquals(listOf(0, 0, 0), macroEnergyShares(totals()).let { listOf(it.protein.pct, it.carb.pct, it.fat.pct) })
    }

    @Test
    fun microsScaleToTheServingAndOnlyWhatTheFoodHasShows() {
        val scaled = previewMicrosScaled(mapOf("iron" to 2.0, "sodium" to 100.0, "bad" to Double.NaN), 150.0)
        assertEquals(mapOf("iron" to 3.0, "sodium" to 150.0), scaled)
        assertEquals(emptyMap(), previewMicrosScaled(null, 150.0))
        assertEquals(emptyMap(), previewMicrosScaled(mapOf("iron" to 2.0), 0.0))

        val rows = buildPreviewMicroRows(mapOf("iron" to 3.04, "sodium" to 150.0, "unknown" to 5.0))
        // Display order, not the map's: sodium comes first.
        assertEquals(listOf("sodium", "iron"), rows.map { it.key })
        assertEquals(3.0, rows[1].amount)
        assertEquals(17L, rows[1].pctRdi)
        assertEquals(7L, rows[0].pctRdi)
    }

    @Test
    fun aGoalRowShowsWhereTheServingTakesTheDayAndSkipsUnsetGoals() {
        val goals = MacroGoals(calories = 2000.0, proteinG = 150.0, carbG = null, fatG = 0.0)
        val rows = projectGoalContribution(totals(calories = 1000.0, protein = 60.0), totals(calories = 500.0, protein = 30.0), goals)

        assertEquals(listOf(GoalMacro.Calories, GoalMacro.Protein), rows.map { it.macro })
        assertEquals(GoalContributionRow(GoalMacro.Calories, 1000.0, 500.0, 1500.0, 2000.0, 50, 75), rows[0])
        assertEquals(emptyList(), projectGoalContribution(totals(), totals(calories = 100.0), null))
    }

    @Test
    fun anUnchangedEditAddsNothing() {
        val saved = totals(calories = 600.0, protein = 40.0)
        val rows =
            projectGoalContribution(
                totals(calories = 1500.0, protein = 100.0),
                saved,
                MacroGoals(2000.0, 150.0, null, null),
                replacing = saved,
            )

        assertEquals(listOf(0.0, 0.0), rows.map { it.added })
        assertEquals(75, rows[0].projectedPct)
    }

    @Test
    fun theGoalBarStopsAtTheProjectedPointAndClampsAtFull() {
        fun row(current: Int, projected: Int) = GoalContributionRow(GoalMacro.Calories, 0.0, 0.0, 0.0, 1.0, current, projected)
        assertEquals(40 to 20, goalBarSegments(row(40, 60)))
        assertEquals(90 to 10, goalBarSegments(row(90, 130)))
        // An edit that shrinks the day: the fill stops where the day will be.
        assertEquals(30 to 0, goalBarSegments(row(50, 30)))
    }

    @Test
    fun anEditPreviewsFromTheEntrysOwnValuesAndReplacesItsSavedServing() {
        val food = NutritionFood(
            id = "f1",
            source = NutritionFood.Source.Usda,
            name = "Oats",
            caloriesPer100g = 999.0,
            isPublic = true,
            createdAt = "2026-11-01T00:00:00Z",
            updatedAt = "2026-11-01T00:00:00Z",
        )
        val entry = NutritionLogEntryWithNutrition(
            id = "e1",
            foodId = "f1",
            name = "Oats",
            loggedAt = "2026-11-10T08:00:00Z",
            logDate = "2026-11-10",
            quantityG = 80.0,
            mealType = NutritionMealType.Breakfast,
            entryMethod = NutritionLogEntryWithNutrition.EntryMethod.Manual,
            nutrition = totals(calories = 304.0),
            per100g = NutritionLogEntryWithNutrition.Per100g(caloriesPer100g = 380.0),
        )
        val editing = LogSheetState(food, emptyList(), portionUnits(food, emptyList()).first(), "80", Meal.Breakfast, editing = entry)

        assertEquals(380.0, editing.servingAt(100.0).calories)
        assertEquals(304.0, editing.replacedServing()?.calories)
        assertEquals(null, editing.copy(editing = null).replacedServing())
        assertEquals(999.0, editing.copy(editing = null).servingAt(100.0).calories)
    }
}
