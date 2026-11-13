package com.fitai.coach.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.dates.deviceTimeZone
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The phone's timezone becomes the athlete's when the saved one keeps
 * different time (the web's useDetectTimezone): sent once, even though the
 * session start and the app's first resume both check.
 */
@OptIn(ExperimentalTestApi::class)
class TimezoneSyncUiTest {
    @Test
    fun aStaleSavedTimezoneIsReplacedByThePhonesOnce() {
        val phone = deviceTimeZone()!!
        val api = FakeApi().apply {
            establishedAccount()
            on("GET", "/api/v1/preferences", PREFS.format("Pacific/Kiritimati"))
            on("PATCH", "/api/v1/preferences", PREFS.format(phone))
        }
        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasContentDescription("Settings"))
            waitUntil(timeoutMillis = 10_000) { api.sent("PATCH", "/api/v1/preferences").isNotEmpty() }
            waitForIdle()
            assertEquals(listOf("""{"userTimezone":"$phone"}"""), api.sent("PATCH", "/api/v1/preferences").map { it.body })
        }
    }
}

private const val PREFS = """{"userTimezone":"%s","onboardingCompleted":true,"weightUnit":"kg","distanceUnit":"km"}"""
