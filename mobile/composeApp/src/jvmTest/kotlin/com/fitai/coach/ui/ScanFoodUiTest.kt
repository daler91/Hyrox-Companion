package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Finding a food by its barcode, end to end: the number typed (this desktop has no scanner), then logging it. */
@OptIn(ExperimentalTestApi::class)
class ScanFoodUiTest {
    @Test
    fun aTypedBarcodeFindsItsFoodAndAnUnknownOneSaysSo() {
        val today = FakeApi.today
        val api = FakeApi().apply {
            establishedAccount()
            on(
                "GET",
                "/api/v1/nutrition/summary",
                """{"logDate":"$today","totals":{"calories":0,"protein":0,"carb":0,"fat":0,"fiber":0},"meals":{"breakfast":[],""" +
                    """"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}""",
            )
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) { app ->
            awaitNode(hasText("training"))
            app.get<DeepLinks>().open(DeepLink.Nutrition())
            awaitNode(hasText("Set targets"))
            onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("Log food"))
            onNode(hasText("Log food") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Scan a barcode"))
            onNode(hasText("Scan a barcode") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)

            // No scanner on this machine: the number is typed.
            val field = hasSetTextAction() and hasContentDescription("Barcode number")
            awaitNode(field)
            onNodeWithText("Enter the number printed under the barcode.").assertExists()
            onNode(field).performTextInput("1234 5678")
            onNode(hasText("Look up") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
            awaitNode(hasText("Barcode not recognized", substring = true))
            assertEquals("""{"code":"12345678"}""", api.sent("POST", "/api/v1/nutrition/foods/barcode").single().body)

            api.on("POST", "/api/v1/nutrition/foods/barcode", NUTELLA)
            onNode(field).performTextClearance()
            onNode(field).performTextInput("3017620422003")
            onNode(hasText("Look up") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)

            // The sheet closes on the food, ready to log to a meal.
            awaitNode(hasText("Nutella"))
            awaitNode(hasText("Meal"))
            assertTrue(onAllNodes(field).fetchSemanticsNodes().isEmpty())
            assertEquals(2, api.sent("POST", "/api/v1/nutrition/foods/barcode").size)
            assertTrue(onAllNodes(isSelected()).fetchSemanticsNodes().isNotEmpty())
        }
    }
}

private const val NUTELLA =
    """{"id":"f1","source":"off","name":"Nutella","caloriesPer100g":539,"proteinPer100g":6.3,"carbPer100g":57.5,"fatPer100g":30.9,""" +
        """"isPublic":true,"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""
