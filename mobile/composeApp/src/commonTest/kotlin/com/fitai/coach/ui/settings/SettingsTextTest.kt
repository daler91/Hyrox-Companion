package com.fitai.coach.ui.settings

import kotlin.test.Test
import kotlin.test.assertEquals

class SettingsTextTest {
    @Test
    fun hoursArePaddedToTwoDigits() {
        assertEquals("07:00", hourLabel(7))
        assertEquals("00:00", hourLabel(0))
        assertEquals("23:00", hourLabel(23))
    }

    @Test
    fun stravaImportsCountActivities() {
        assertEquals("Imported 1 new activity from Strava", stravaImported(1))
        assertEquals("Imported 0 new activities from Strava", stravaImported(0))
        assertEquals("Imported 12 new activities from Strava", stravaImported(12))
    }

    @Test
    fun theSignOutWarningCountsUnsentChanges() {
        assertEquals("1 change hasn't reached the server yet. Signing out deletes them from this device.", unsyncedWarning(1))
        assertEquals("3 changes haven't reached the server yet. Signing out deletes them from this device.", unsyncedWarning(3))
    }

    @Test
    fun healthConnectSyncsCountWorkouts() {
        assertEquals("No new workouts to import.", healthImported(0))
        assertEquals("Imported 1 new workout.", healthImported(1))
        assertEquals("Imported 4 new workouts.", healthImported(4))
    }
}
