package com.fitai.coach.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.dates.deviceTimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * The phone's timezone becomes the athlete's when the saved one keeps
 * different time (the web's useDetectTimezone): sent once, even though the
 * session start and the app's first resume both check.
 */
@OptIn(ExperimentalTestApi::class)
class TimezoneSyncUiTest {
    @Test
    fun aStaleSavedTimezoneIsReplacedByThePhonesOnce() {
        val phone = assertNotNull(deviceTimeZone())
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", PREFERENCES, PREFS.format("Pacific/Kiritimati"))
            on("PATCH", PREFERENCES, PREFS.format(phone))
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Settings"))
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", PREFERENCES).isNotEmpty() }
            waitForIdle()
            assertEquals(listOf("""{"userTimezone":"$phone"}"""), api.sent("PATCH", PREFERENCES).map { it.body })
        }
    }
}

private const val PREFERENCES = "/api/v1/preferences"
private const val PREFS = """{"userTimezone":"%s","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km"}"""
