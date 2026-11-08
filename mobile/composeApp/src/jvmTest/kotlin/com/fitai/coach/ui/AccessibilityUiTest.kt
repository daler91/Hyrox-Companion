package com.fitai.coach.ui

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.auth.AuthState
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Every control on the main screens, laid out in a phone-width window tall
 * enough that nothing scrolls out of view, has a touch target of at least 48 x 48 dp
 * (Material; WCAG 2.5.8) and a label a screen reader can announce (WCAG 4.1.2).
 */
@OptIn(ExperimentalTestApi::class)
class AccessibilityUiTest {
    @Test
    fun signInControlsAreLabelledAndLargeEnough() {
        appTest(FakeAuth(AuthState.SignedOut), FakeApi(), PHONE_WIDTH, TALL) {
            awaitNode(hasText("email me a code"))
            assertAccessible("sign-in")
        }
    }

    @Test
    fun setupControlsAreLabelledAndLargeEnough() {
        val api = FakeApi().apply {
            privacyAcknowledged()
            preferences(onboarded = false)
            on("GET", "/api/v1/plans", "[]")
            on("GET", "/api/v1/timeline", "[]")
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, PHONE_WIDTH, TALL) {
            awaitNode(hasContentDescription("leave setup"))
            assertAccessible("setup")
        }
    }

    @Test
    fun everyTabsControlsAreLabelledAndLargeEnough() {
        val api = FakeApi().apply { establishedAccount(FakeApi.plannedToday("Tempo intervals")) }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api, PHONE_WIDTH, TALL) {
            awaitNode(hasText("Tempo intervals"))
            assertAccessible("training")
            for (tab in listOf("Log Workout", "Nutrition", "Analytics", "Settings")) {
                onNodeWithContentDescription(tab).performClick()
                waitForIdle()
                assertAccessible(tab)
            }
        }
    }

    private companion object {
        // Pixels at the desktop test's density of 1.
        const val PHONE_WIDTH = 412
        const val TALL = 3000
    }

    private fun ComposeUiTest.assertAccessible(screen: String) {
        val minimum = with(density) { 48.dp.toPx() } - 0.5f
        val problems = onAllNodes(hasClickAction()).fetchSemanticsNodes().mapNotNull { node ->
            val name = node.label()
            val size = node.touchBoundsInRoot
            when {
                name == null -> "unlabelled control at ${node.boundsInRoot}"
                size.width < minimum || size.height < minimum ->
                    "\"$name\" touch target is ${with(density) { size.width.toDp() }} x ${with(density) { size.height.toDp() }}"
                else -> null
            }
        }
        assertTrue(problems.isEmpty(), "$screen:\n" + problems.joinToString("\n"))
    }

    private fun SemanticsNode.label(): String? {
        val config = config
        return config.getOrNull(SemanticsProperties.ContentDescription)?.firstOrNull()
            ?: config.getOrNull(SemanticsProperties.Text)?.firstOrNull()?.text
            ?: config.getOrNull(SemanticsProperties.EditableText)?.text?.takeIf { it.isNotEmpty() }
    }
}
