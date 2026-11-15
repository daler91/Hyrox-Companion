package com.fitai.coach.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.InternalComposeUiApi
import androidx.compose.ui.LocalSystemTheme
import androidx.compose.ui.SystemTheme
import androidx.compose.ui.graphics.toAwtImage
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.DesktopComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.compose.ui.unit.Density
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import com.fitai.coach.core.auth.AuthState
import java.io.File
import javax.imageio.ImageIO
import kotlin.test.Test

/**
 * Draws the app's main screens to PNG files, over a real server's data, to
 * compare with the web app at phone width. It only runs when asked:
 *
 *     FITAI_GALLERY_UPSTREAM=http://localhost:5000 ./gradlew :composeApp:jvmTest --rerun --tests '*LayoutGalleryTest*'
 *
 * (`--rerun` because Gradle can't see the server's data change, and would
 * call a second run up to date.)
 *
 * The server is a local one with ALLOW_DEV_AUTH_BYPASS=true (the Cypress
 * workflow starts one the same way), so it answers as its dev user, seeded by
 * script/mobile-gallery/seed.sh. The images land in composeApp/build/gallery
 * (FITAI_GALLERY_OUT moves them), 391 x 868 dp at 2x: a mid-size phone. The
 * theme is dark unless FITAI_GALLERY_THEME=light. mobile/README.md has the steps.
 */
@OptIn(ExperimentalTestApi::class, InternalComposeUiApi::class)
class LayoutGalleryTest {
    @Test
    fun drawsTheMainScreensOverALocalServersData() {
        val upstream = System.getenv("FITAI_GALLERY_UPSTREAM")?.takeIf { it.isNotBlank() } ?: return
        val out = File(System.getenv("FITAI_GALLERY_OUT") ?: "build/gallery").apply { mkdirs() }
        val theme = if (System.getenv("FITAI_GALLERY_THEME") == "light") SystemTheme.Light else SystemTheme.Dark
        val api = FakeApi(upstream).apply { privacyAcknowledged() }
        AppHarness(FakeAuth(AuthState.SignedIn("dev-user")), api).use { app ->
            runDesktopComposeUiTest(WIDTH_DP * SCALE, HEIGHT_DP * SCALE) {
                setContent {
                    CompositionLocalProvider(
                        LocalViewModelStoreOwner provides app,
                        LocalDensity provides Density(SCALE.toFloat()),
                        LocalSystemTheme provides theme,
                    ) { App() }
                }
                val gallery = Gallery(this, out)
                // A step that never shows still leaves a picture of what did.
                runCatching { gallery.draw() }.onFailure { gallery.shot("stuck") }.getOrThrow()
            }
        }
    }

    private class Gallery(private val ui: DesktopComposeUiTest, private val out: File) {
        fun draw() {
            ui.awaitNode(hasText("Training"))
            settle()
            scrollTo(hasText(MISSED_DAY))
            shot("timeline")
            scrollTo(hasText(RUN_NOTES, substring = true))
            shot("timeline-recording")

            tap(hasText(RUN_NOTES, substring = true))
            ui.awaitNode(hasText("Ask coach"))
            shot("workout-detail")
            tap(hasContentDescription("back"))

            tap(hasContentDescription("open coach"))
            ui.awaitNode(hasContentDescription("close coach panel"))
            shot("coach")
            tap(hasContentDescription("close coach panel"))

            tap(hasContentDescription("Settings"))
            ui.awaitNode(hasText("Weight unit"))
            shot("settings")
        }

        /** Lets the first fetches land and the list lay out before a picture is taken. */
        private fun settle() {
            Thread.sleep(SETTLE_MS)
            ui.waitForIdle()
        }

        fun shot(name: String) {
            settle()
            ImageIO.write(ui.captureToImage().toAwtImage(), "png", File(out, "app-$name.png"))
        }

        private fun tap(matcher: SemanticsMatcher) {
            ui.waitUntil(timeoutMillis = WAIT_MS) { ui.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
            ui.onAllNodes(matcher).onFirst().performSemanticsAction(SemanticsActions.OnClick)
            settle()
        }

        private fun scrollTo(matcher: SemanticsMatcher) {
            ui.waitUntil(timeoutMillis = WAIT_MS) { ui.onAllNodes(hasScrollAction()).fetchSemanticsNodes().isNotEmpty() }
            runCatching { ui.onAllNodes(hasScrollAction()).onFirst().performScrollToNode(matcher) }
        }
    }

    private companion object {
        const val WIDTH_DP = 391
        const val HEIGHT_DP = 868
        const val SCALE = 2
        const val SETTLE_MS = 1_500L
        const val WAIT_MS = 30_000L

        // What script/mobile-gallery/seed.sh puts there; without them the first screen is still drawn.
        const val MISSED_DAY = "Yesterday"
        const val RUN_NOTES = "Morning Run"
    }
}
