package com.fitai.coach.ui

import android.app.Application
import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.NexusMark
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of the design system in light and dark, at font scales 1.0,
 * 1.5 and 2.0 (200%, the largest Android offers). A render that differs from
 * the committed reference fails `verifyRoborazziAndroidHostTest` in CI;
 * `recordRoborazziAndroidHostTest` rewrites the references after an intended
 * change. Colour contrast is checked separately, on the tokens (ContrastTest).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w400dp-h900dp-xhdpi")
class DesignSystemScreenshotTest(private val dark: Boolean, private val fontScale: Float) {
    companion object {
        private const val SPINNER_FRAME_MS = 500L

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "dark={0} fontScale={1}")
        fun parameters(): List<Array<Any>> = listOf(false, true).flatMap { dark ->
            listOf(1.0f, 1.5f, 2.0f).map { scale -> arrayOf<Any>(dark, scale) }
        }
    }

    @Test
    fun typography() = capture("typography") {
        val type = FitaiTheme.typography
        Text("fitai.coach", style = type.h1)
        Text("this week", style = type.h2)
        Text("tempo run", style = type.h3)
        Text("you ran 5.2 km at 5:14/km. steady.", style = type.body)
        Text("last synced 2 min ago", style = type.bodySm, color = FitaiTheme.colors.textMuted)
        Text("WEEKLY VOLUME", style = type.label, color = FitaiTheme.colors.textMuted)
        Text("28.4 km", style = type.metric)
        Text("142 bpm · 06:42", style = type.mono)
    }

    @Test
    fun buttons() = capture("buttons") {
        ButtonVariant.entries.forEach { variant ->
            FitaiButton(text = variant.name.lowercase(), onClick = {}, variant = variant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            FitaiButton(text = "small", onClick = {}, size = ButtonSize.Sm)
            FitaiButton(text = "large", onClick = {}, size = ButtonSize.Lg)
        }
        FitaiButton(text = "saving", onClick = {}, loading = true)
        FitaiButton(text = "disabled", onClick = {}, enabled = false)
    }

    @Test
    fun inputs() = capture("inputs") {
        FitaiTextField(value = "", onValueChange = {}, label = "email", placeholder = "you@example.com")
        FitaiTextField(value = "you@example.com", onValueChange = {}, label = "email", supportingText = "we'll send a sign-in code")
        FitaiTextField(value = "you@", onValueChange = {}, label = "email", error = "enter a full email address")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            FitaiChip(label = "run", selected = true, onClick = {})
            FitaiChip(label = "strength", selected = false, onClick = {})
            FitaiChip(label = "hyrox", selected = false, onClick = {})
        }
    }

    @Test
    fun cards() = capture("cards") {
        FitaiCard(Modifier.fillMaxWidth()) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiBadge("planned")
                FitaiBadge("today", tone = BadgeTone.Accent)
                FitaiBadge("done", tone = BadgeTone.Success)
            }
            Text("tempo run", style = FitaiTheme.typography.h3, modifier = Modifier.padding(top = Spacing.Md))
            Text("8 km · 4:50/km", style = FitaiTheme.typography.mono, color = FitaiTheme.colors.textMuted)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            FitaiBadge("missed", tone = BadgeTone.Danger)
            FitaiBadge("recovery", tone = BadgeTone.Warning)
        }
        NexusMark()
    }

    @Test
    fun states() = capture("states") {
        LoadingState(message = "loading your week")
        EmptyState(
            title = "no workouts yet",
            message = "that's ok — rest is training.",
            actionLabel = "log a workout",
            onAction = {},
        )
        ErrorState(message = "we lost connection. retry, or keep logging offline.", onRetry = {})
    }

    /**
     * Renders [content] with the test clock stopped, so infinite animations
     * (spinners) hold their first frame instead of keeping the UI from ever
     * going idle, and captures it.
     */
    private fun capture(name: String, content: @Composable () -> Unit) {
        val theme = if (dark) "dark" else "light"
        registerTestActivity()
        runComposeUiTest {
            mainClock.autoAdvance = false
            setContent {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                    FitaiTheme(darkTheme = dark) {
                        Surface(color = FitaiTheme.colors.background) {
                            Column(
                                modifier = Modifier.fillMaxWidth().padding(Spacing.Lg),
                                verticalArrangement = Arrangement.spacedBy(Spacing.Md),
                            ) { content() }
                        }
                    }
                }
            }
            // A fixed point into the spinners' cycle, so they read as spinners.
            mainClock.advanceTimeBy(SPINNER_FRAME_MS)
            onRoot().captureRoboImage("src/androidHostTest/snapshots/${name}_${theme}_${fontScale}x.png")
        }
    }

    /** The test hosts the UI in a ComponentActivity, which no manifest of this library declares. */
    private fun registerTestActivity() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
    }
}
