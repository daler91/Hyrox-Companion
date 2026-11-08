package com.fitai.coach.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.Until

internal const val PACKAGE = "com.fitai.coach"
private const val TIMEOUT_MS = 15_000L
private const val POLL_MS = 100L

// Flings start a fifth of the screen width in from each edge, clear of the system gesture areas.
private const val GESTURE_MARGIN_FRACTION = 5

private val SIGN_IN = By.text("email me a code")
private val SIGNED_IN = By.desc("Training")

/**
 * A Clerk development instance's test account: any address with a
 * `+clerk_test` subaddress signs in with the code 424242, no email sent.
 * Passed as instrumentation arguments; without one, journeys stop at sign-in.
 */
internal object TestAccount {
    private val arguments get() = InstrumentationRegistry.getArguments()
    val email: String? get() = arguments.getString("fitaiTestEmail")?.takeIf { it.isNotBlank() }
    val code: String get() = arguments.getString("fitaiTestCode") ?: "424242"
}

/**
 * Cold start to the first screen: sign-in on a new install, the timeline once
 * signed in (iterations keep the app's data).
 */
internal fun MacrobenchmarkScope.startApp() {
    pressHome()
    startActivityAndWait()
    waitForAny(SIGN_IN, SIGNED_IN)
}

/** Signs in with the test account if not already; false when there is none. */
internal fun MacrobenchmarkScope.signIn(): Boolean {
    val email = TestAccount.email
    if (!device.hasObject(SIGNED_IN) && email != null) {
        device.findObject(By.desc("email"))?.text = email
        device.findObject(SIGN_IN)?.click()
        device.wait(Until.hasObject(By.desc("code")), TIMEOUT_MS)
        device.findObject(By.desc("code"))?.text = TestAccount.code
        device.findObject(By.text("sign in"))?.click()
        device.wait(Until.hasObject(SIGNED_IN), TIMEOUT_MS)
    }
    return device.hasObject(SIGNED_IN)
}

/** The signed-in app's main paths: scrolling the timeline and visiting every tab. */
internal fun MacrobenchmarkScope.browseTabs() {
    scrollMainContent()
    for (tab in listOf("Log Workout", "Nutrition", "Analytics", "Settings", "Training")) {
        device.findObject(By.desc(tab))?.click()
        device.waitForIdle()
        scrollMainContent()
    }
}

private fun MacrobenchmarkScope.scrollMainContent() {
    val scrollable = device.findObject(By.scrollable(true)) ?: return
    scrollable.setGestureMargin(device.displayWidth / GESTURE_MARGIN_FRACTION)
    scrollable.fling(Direction.DOWN)
    scrollable.fling(Direction.UP)
}

private fun MacrobenchmarkScope.waitForAny(vararg selectors: BySelector) {
    val deadline = System.currentTimeMillis() + TIMEOUT_MS
    while (System.currentTimeMillis() < deadline && selectors.none { device.hasObject(it) }) {
        Thread.sleep(POLL_MS)
    }
}
