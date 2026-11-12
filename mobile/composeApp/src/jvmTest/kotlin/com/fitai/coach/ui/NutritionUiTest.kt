package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The nutrition screen end to end: logging, quick add, custom foods and portions, against the fake API. */
@OptIn(ExperimentalTestApi::class)
class NutritionUiTest {
    @Test
    fun aDescribedMealIsReviewedThenLoggedInOneBatchAfterTurningOnTheAi() {
        val today = FakeApi.today
        val summary = """{"logDate":"$today","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},"meals":{"breakfast":[],""" +
            """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""
        val egg = """{"id":"f1","source":"usda","name":"Egg, scrambled","caloriesPer100g":150,"proteinPer100g":10,"carbPer100g":2,""" +
            """"fatPer100g":11,"isPublic":true,"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
        val parsed = """{"items":[{"name":"scrambled eggs","quantityG":120.4,"displayAmount":"2 scrambled eggs","mealType":"breakfast",""" +
            """"confidence":0.9,"foodId":"f1","food":$egg},{"name":"mystery sauce","quantityG":30,"displayAmount":"a splash of sauce",""" +
            """"confidence":0.3}],"warnings":["Portions are estimates."],"rawInput":"2 scrambled eggs and a splash of sauce"}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", summary)
            on("POST", "/api/v1/nutrition/parse/text", parsed)
            on(
                "PATCH",
                "/api/v1/preferences",
                """{"userTimezone":"UTC","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km","aiCoachEnabled":true}""",
            )
            on("POST", "/api/v1/nutrition/logs/batch", """{"created":1,"logDate":"$today"}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            // The day's totals, then the Log food button below them.
            awaitNode(hasText("Set targets"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log food"))
            onNodeWithText("Log food").performClick()
            awaitNode(hasText("Describe a meal"))
            onNodeWithText("Describe a meal").performClick()
            awaitNode(hasContentDescription("Describe your meal"))
            onNode(
                hasSetTextAction() and hasContentDescription("Describe your meal"),
            ).performTextInput("2 scrambled eggs and a splash of sauce")
            onNodeWithText("Review foods").performClick()

            // The AI isn't on yet: consent first, then the same description is read.
            awaitNode(hasText("Not now"))
            onNode(hasText("Enable AI Coach") and hasClickAction()).performClick()
            awaitNode(hasText("Review parsed foods"))
            assertEquals("""{"aiCoachEnabled":true}""", api.sent("PATCH", "/api/v1/preferences").single().body)
            onNodeWithText("Portions are estimates.").assertExists()
            onNodeWithText("No match — choose a food to log this.").assertExists()
            onNodeWithText("1 item needs a match and won't be logged.").assertExists()

            onNodeWithText("Log 1 item").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/logs/batch").isNotEmpty() }
            val batch = api.sent("POST", "/api/v1/nutrition/logs/batch").single().body.orEmpty()
            assertTrue(""""entryMethod":"nl"""" in batch, batch)
            assertTrue(""""items":[{"foodId":"f1","quantityG":120.0,"mealType":"breakfast","parseConfidence":0.9}]""" in batch, batch)
            awaitNode(hasText("Logged 1 item"))
        }
    }

    @Test
    fun aFavouriteLogsInOneTapAndARecentFoodOpensOnItsUsualPortion() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", daySummary(today))
            on("GET", "/api/v1/nutrition/favorites", "[${quickAddFood("f1", "Oats", 80, "breakfast")}]")
            on("GET", "/api/v1/nutrition/foods/recent", "[${quickAddFood("f2", "Banana", 120, "snack")}]")
            on("POST", "/api/v1/nutrition/logs", newLogEntry("e1", today), status = 201)
            on("DELETE", "/api/v1/nutrition/logs/e1", """{"success":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())

            // A favourite with a known portion logs at once, and the toast can take it back.
            awaitNode(hasContentDescription("Quick log Oats"))
            onNodeWithContentDescription("Quick log Oats").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/logs").isNotEmpty() }
            val logged = api.sent("POST", "/api/v1/nutrition/logs").single().body.orEmpty()
            assertTrue(""""foodId":"f1"""" in logged && """"quantityG":80.0""" in logged && """"mealType":"breakfast"""" in logged, logged)
            awaitNode(hasText("Logged Oats · 80 g · Breakfast"))
            onNodeWithText("Undo").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("DELETE", "/api/v1/nutrition/logs/e1").isNotEmpty() }

            // A recent food opens the log sheet on the grams and meal it was last logged in.
            onNodeWithContentDescription("Add Banana").performClick()
            awaitNode(hasSetTextAction() and hasContentDescription("Amount"))
            onNode(hasSetTextAction() and hasContentDescription("Amount")).assert(hasText("120"))
            onNode(hasText("Snack") and isSelected()).assertExists()
        }
    }

    @Test
    fun anEntryIsStarredAndLoggedAgainAndAnEmptyDayRepeatsTheOneBefore() {
        val today = FakeApi.today
        val yesterday = LocalDate.parse(today).minusDays(1).toString()
        val oats = """{"id":"e1","foodId":"f1","name":"Oats","loggedAt":"${today}T08:00:00Z","logDate":"$today","quantityG":80,""" +
            """"mealType":"breakfast","entryMethod":"manual","nutrition":{"calories":304,"protein":10,"carb":54,"fat":5,"fiber":8},""" +
            """"per100g":{"caloriesPer100g":380}}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", daySummary(today, breakfast = oats))
            on("GET", "/api/v1/nutrition/favorites", "[]")
            on("GET", "/api/v1/nutrition/foods/recent", "[${quickAddFood("f1", "Oats", 80, "breakfast")}]")
            on("POST", "/api/v1/nutrition/favorites", """{"success":true}""", status = 201)
            on("POST", "/api/v1/nutrition/logs", newLogEntry("e2", today), status = 201)
            on("POST", "/api/v1/nutrition/logs/repeat", """{"created":2,"logDate":"$yesterday"}""", status = 201)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasContentDescription("Add Oats to favourites"))
            onNodeWithContentDescription("Add Oats to favourites").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/favorites").isNotEmpty() }
            assertEquals("""{"foodId":"f1"}""", api.sent("POST", "/api/v1/nutrition/favorites").single().body)

            onNodeWithContentDescription("log Oats again today").performClick()
            awaitNode(hasText("Logged Oats · 80 g · Breakfast"))
            assertTrue(""""quantityG":80.0""" in api.sent("POST", "/api/v1/nutrition/logs").single().body.orEmpty())

            // The day before has nothing logged: it can repeat its own day before.
            api.on("GET", "/api/v1/nutrition/summary", daySummary(yesterday))
            onNodeWithContentDescription("previous day").performClick()
            awaitNode(hasText("Repeat previous day"))
            onNodeWithText("Repeat previous day").performClick()
            awaitNode(hasText("Repeated 2 items"))
            val repeat = api.sent("POST", "/api/v1/nutrition/logs/repeat").single().body.orEmpty()
            val dayBefore = LocalDate.parse(yesterday).minusDays(1).toString()
            assertTrue(""""sourceDate":"$dayBefore"""" in repeat && """"targetDate":"$yesterday"""" in repeat, repeat)
        }
    }

    @Test
    fun aCustomFoodIsMadeThenSharedThenDeleted() {
        val today = FakeApi.today
        val granola = { shared: Boolean ->
            """{"id":"c1","source":"custom","name":"Granola","caloriesPer100g":450,"createdByUserId":"u1","isPublic":$shared,""" +
                """"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
        }
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", daySummary(today))
            on("GET", "/api/v1/nutrition/foods/custom", "[]")
            on("POST", "/api/v1/nutrition/foods", granola(false), status = 201)
            on("PATCH", "/api/v1/nutrition/foods/c1", granola(true))
            on("DELETE", "/api/v1/nutrition/foods/c1", """{"success":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Set targets"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log food"))
            onNodeWithText("Log food").performClick()
            awaitNode(hasText("Custom food"))
            onNodeWithText("Custom food").performClick()
            awaitNode(hasText("New custom food"))
            onNode(hasSetTextAction() and hasContentDescription("Name")).performTextInput("Granola")
            onNode(hasSetTextAction() and hasContentDescription("Calories")).performTextInput("450")
            api.on("GET", "/api/v1/nutrition/foods/custom", "[${granola(false)}]")
            onNodeWithText("Save food").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/foods").isNotEmpty() }
            val created = api.sent("POST", "/api/v1/nutrition/foods").single().body.orEmpty()
            assertTrue(""""name":"Granola"""" in created && """"caloriesPer100g":450.0""" in created, created)
            awaitNode(hasText("Custom food saved"))

            // It's listed with the athlete's own foods, to edit or delete.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("My foods & recipes"))
            onNodeWithContentDescription("Edit Granola").performClick()
            awaitNode(hasText("Edit custom food"))
            onNodeWithText("Share publicly").performScrollTo().performClick()
            onNodeWithText("Save").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/nutrition/foods/c1").isNotEmpty() }
            assertTrue(""""isPublic":true""" in api.sent("PATCH", "/api/v1/nutrition/foods/c1").single().body.orEmpty())
            awaitNode(hasText("Custom food updated"))

            // The toast sits over the bottom of the page, so the row is clicked by its action rather than a tap there.
            onNodeWithContentDescription("Delete Granola").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Delete custom food?"))
            onNodeWithText("Delete").performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("DELETE", "/api/v1/nutrition/foods/c1").isNotEmpty() }
        }
    }

    @Test
    fun aPortionIsAddedWhileLoggingAndRemovedAgain() {
        val today = FakeApi.today
        val bread = """{"id":"f1","source":"usda","name":"Sourdough bread","caloriesPer100g":270,"isPublic":true,""" +
            """"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", daySummary(today))
            on("GET", "/api/v1/nutrition/foods/search", """{"results":[$bread],"apiDegraded":false}""")
            on("GET", "/api/v1/nutrition/foods/f1", """{"food":$bread,"servings":[]}""")
            on(
                "POST",
                "/api/v1/nutrition/foods/f1/servings",
                """{"id":"s1","foodId":"f1","label":"1 slice","grams":35,"createdByUserId":"u1"}""",
                status = 201,
            )
            on("DELETE", "/api/v1/nutrition/foods/f1/servings/s1", """{"success":true}""")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Set targets"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log food"))
            onNodeWithText("Log food").performClick()
            awaitNode(hasText("Search foods"))
            onNodeWithText("Search foods").performClick()
            awaitNode(hasSetTextAction() and hasContentDescription("Search foods"))
            onNode(hasSetTextAction() and hasContentDescription("Search foods")).performTextInput("sourdough")
            awaitNode(hasText("Sourdough bread"))
            onNodeWithText("Sourdough bread").performClick()

            awaitNode(hasText("Add portion"))
            onNodeWithText("Add portion").performScrollTo().performClick()
            onNode(hasSetTextAction() and hasContentDescription("Portion label")).performTextInput("1 slice")
            onNode(hasSetTextAction() and hasContentDescription("Grams")).performTextInput("35")
            onNodeWithText("Add").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/foods/f1/servings").isNotEmpty() }
            assertEquals("""{"label":"1 slice","grams":35.0}""", api.sent("POST", "/api/v1/nutrition/foods/f1/servings").single().body)
            // The new portion is picked, one of it.
            waitUntil(timeoutMillis = 10_000) { onAllNodes(hasText("1 slice (35 g)") and isSelected()).fetchSemanticsNodes().isNotEmpty() }
            onNode(hasSetTextAction() and hasContentDescription("Amount")).assert(hasText("1"))

            onNodeWithContentDescription("Remove 1 slice").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("DELETE", "/api/v1/nutrition/foods/f1/servings/s1").isNotEmpty() }
            // Back to grams, carrying the 35 g.
            onNode(hasSetTextAction() and hasContentDescription("Amount")).assert(hasText("35"))
        }
    }

    @Test
    fun aRecipeIsBuiltThenEditedAndAMealIsSavedAsOne() {
        val today = FakeApi.today
        val oats = """{"id":"f1","source":"usda","name":"Rolled oats","servingSizeG":40,"caloriesPer100g":380,"isPublic":true,""" +
            """"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
        val recipe = """{"id":"r1","name":"Overnight oats","servings":2,"foodId":"rf1","totalGrams":80,""" +
            """"perServing":{"calories":152,"protein":0,"carb":0,"fat":0,"fiber":0},"ingredients":[{"id":"i1","foodId":"f1",""" +
            """"name":"Rolled oats","quantityG":80,"position":0,"nutrition":{"calories":304,"protein":0,"carb":0,"fat":0,"fiber":0}}]}"""
        fun entry(id: String, foodId: String, name: String, grams: Int, calories: Int) =
            """{"id":"$id","foodId":"$foodId","name":"$name","loggedAt":"${today}T08:00:00Z","logDate":"$today","quantityG":$grams,""" +
                """"mealType":"breakfast","entryMethod":"manual",""" +
                """"nutrition":{"calories":$calories,"protein":0,"carb":0,"fat":0,"fiber":0},"per100g":{}}"""
        val breakfast = entry("e1", "f1", "Rolled oats", 40, 152) + "," + entry("e2", "f2", "Milk", 200, 128)
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/nutrition/summary", daySummary(today, breakfast = breakfast))
            on("GET", "/api/v1/nutrition/foods/search", """{"results":[$oats],"apiDegraded":false}""")
            on("GET", "/api/v1/nutrition/recipes", "[]")
            on("POST", "/api/v1/nutrition/recipes", recipe, status = 201)
            on("GET", "/api/v1/nutrition/recipes/r1", recipe)
            on("PATCH", "/api/v1/nutrition/recipes/r1", recipe)
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Set targets"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log food"))
            onNodeWithText("Log food").performClick()
            awaitNode(hasText("Recipe"))
            onNodeWithText("Recipe").performClick()
            awaitNode(hasText("New recipe"))
            onNode(hasSetTextAction() and hasContentDescription("Recipe name")).performTextInput("Overnight oats")
            onNode(hasSetTextAction() and hasContentDescription("Servings")).performTextReplacement("2")
            onNode(hasSetTextAction() and hasContentDescription("Add an ingredient")).performTextInput("oats")
            // Breakfast already has Rolled oats on the page behind; the result is the sheet's, the last.
            waitUntil(timeoutMillis = 10_000) { onAllNodesWithText("Rolled oats").fetchSemanticsNodes().size == 2 }
            onAllNodesWithText("Rolled oats").onLast().performScrollTo().performClick()
            // One serving of it to start, and the recipe's serving previewed: 152 kcal over 2.
            awaitNode(hasSetTextAction() and hasContentDescription("Grams of Rolled oats"))
            onNode(hasSetTextAction() and hasContentDescription("Grams of Rolled oats")).assert(hasText("40"))
            onNode(hasText("76 kcal", substring = true)).assertExists()
            api.on("GET", "/api/v1/nutrition/recipes", """[{"id":"r1","name":"Overnight oats","servings":2,"foodId":"rf1"}]""")
            onNodeWithText("Create recipe").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("POST", "/api/v1/nutrition/recipes").isNotEmpty() }
            assertEquals(
                """{"name":"Overnight oats","servings":2.0,"ingredients":[{"foodId":"f1","quantityG":40.0}]}""",
                api.sent("POST", "/api/v1/nutrition/recipes").single().body,
            )
            awaitNode(hasText("Recipe saved"))

            // Edited from My foods: it opens on what was saved.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("My foods & recipes"))
            onNodeWithContentDescription("Edit Overnight oats").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Edit recipe"))
            awaitNode(hasSetTextAction() and hasContentDescription("Grams of Rolled oats"))
            onNode(hasSetTextAction() and hasContentDescription("Grams of Rolled oats")).assert(hasText("80"))
            onNode(hasSetTextAction() and hasContentDescription("Servings")).performTextReplacement("4")
            onNodeWithText("Save").performScrollTo().performClick()
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/nutrition/recipes/r1").isNotEmpty() }
            assertTrue(""""servings":4.0""" in api.sent("PATCH", "/api/v1/nutrition/recipes/r1").single().body.orEmpty())
            awaitNode(hasText("Recipe updated"))

            // Breakfast's two entries seed a new one.
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasContentDescription("Save breakfast as a recipe"))
            onNodeWithContentDescription("Save breakfast as a recipe").performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("New recipe"))
            onNode(hasSetTextAction() and hasContentDescription("Recipe name")).assert(hasText("Breakfast"))
            onNode(hasSetTextAction() and hasContentDescription("Grams of Milk")).assert(hasText("200"))
        }
    }
}

/** A day's summary with nothing logged, or [breakfast] (an entry's JSON) for breakfast. */
private fun daySummary(day: String, breakfast: String? = null) =
    """{"logDate":"$day","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},"meals":{"breakfast":[${breakfast.orEmpty()}],""" +
        """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

/** A recent or favourite food, last logged as [grams] g at [meal]. */
private fun quickAddFood(id: String, name: String, grams: Int, meal: String) =
    """{"id":"$id","source":"usda","name":"$name","caloriesPer100g":100,"isPublic":true,"createdAt":"2026-11-01T00:00:00Z",""" +
        """"updatedAt":"2026-11-01T00:00:00Z","lastQuantityG":$grams,"lastMealType":"$meal"}"""

/** POST /nutrition/logs's answer: the new entry. */
private fun newLogEntry(id: String, day: String) =
    """{"id":"$id","userId":"u1","foodId":"f1","loggedAt":"${day}T08:00:00Z","logDate":"$day","quantityG":80,"mealType":"breakfast",""" +
        """"entryMethod":"manual","pendingReview":false,"createdAt":"${day}T08:00:00Z","updatedAt":"${day}T08:00:00Z"}"""
