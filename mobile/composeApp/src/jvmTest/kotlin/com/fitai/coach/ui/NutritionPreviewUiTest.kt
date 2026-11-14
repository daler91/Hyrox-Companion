package com.fitai.coach.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import kotlin.test.Test

private const val EMPTY_MEALS =
    """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}"""

private const val TARGET =
    """"effectiveTarget":{"calories":2000,"proteinG":150,"carbG":250,"fatG":70,"carbDeltaG":0,"baseLoadDeltaG":0,"recoveryDeltaG":0,""" +
        """"preloadDeltaG":0,"proteinDeltaG":0,"utss":0,"scaled":false,"reasonCodes":[],"explanation":""}"""

private const val BANANA =
    """{"id":"f2","source":"usda","name":"Banana","caloriesPer100g":89,"proteinPer100g":1.1,"carbPer100g":22.8,"fatPer100g":0.3,""" +
        """"fiberPer100g":2.6,"isPublic":true,"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z""""

/** The log sheet's preview, and the first-meal prompt on an athlete's first visit (LogFoodDialog, FirstRunStarter). */
@OptIn(ExperimentalTestApi::class)
class NutritionPreviewUiTest {
    @Test
    fun theLogSheetPreviewsTheServingItsEffectOnTodaysGoalsAndItsNutrients() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/nutrition/summary",
                """{"logDate":"$today","totals":{"calories":1000,"protein":60,"carb":120,"fat":30,"fiber":10},$EMPTY_MEALS,$TARGET}""",
            )
            on("GET", "/api/v1/nutrition/favorites", "[]")
            on("GET", "/api/v1/nutrition/foods/recent", "[$BANANA,\"lastQuantityG\":120,\"lastMealType\":\"snack\"}]")
            // The detail fetch fills in the micros.
            on("GET", "/api/v1/nutrition/foods/f2", """{"food":$BANANA,"micros":{"potassium":358,"vitaminC":8.7}},"servings":[]}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasContentDescription("Add Banana"))
            onNodeWithContentDescription("Add Banana").performClick()

            // 120 g of banana: 107 kcal (1.3 g protein, 27.4 g carbs, 0.4 g fat), against 1000 of 2000 so far.
            awaitNode(hasContentDescription("Calorie breakdown: protein 4%, carbs 93%, fat 3%"))
            awaitNode(hasText("Effect on today's goals"))
            awaitNode(hasContentDescription("Calories: 50% to 55%, 1107 of 2000"))

            onNode(hasText("Nutrients") and hasClickAction()).performClick()
            awaitNode(hasText("Minerals"))
            awaitNode(hasContentDescription("Potassium: 429.6 of 4700 mg, 9% of daily intake"))
            awaitNode(hasText("Vitamins"))
        }
    }

    @Test
    fun aFirstVisitOffersToDescribeTheFirstMeal() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/nutrition/summary",
                """{"logDate":"$today","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},$EMPTY_MEALS}""",
            )
            on("GET", "/api/v1/nutrition/favorites", "[]")
            on("GET", "/api/v1/nutrition/foods/recent", "[]")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Log your first meal"))
            awaitNode(hasText("Set your targets"))
            onNode(hasText("Describe your last meal") and hasClickAction()).performClick()
            awaitNode(hasContentDescription("Describe your meal"))
        }
    }
}
