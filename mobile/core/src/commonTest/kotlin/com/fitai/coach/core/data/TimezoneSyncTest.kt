package com.fitai.coach.core.data

import com.fitai.coach.core.dates.deviceTimeZone
import com.fitai.coach.core.dates.sameTimeZone
import com.fitai.coach.core.dates.zoneName
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The athlete's saved timezone follows the phone's, and only when the two keep different time. */
class TimezoneSyncTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val preferences = PreferencesRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private fun prefs(zone: String) = """{"userTimezone":"$zone","onboardingCompleted":true}"""

    @Test
    fun aDifferentZoneIsSavedOnceAndTheSameOneNever() = runTest {
        // Nothing loaded yet: nothing to compare against, nothing sent.
        assertFalse(preferences.syncTimezone("Europe/London"))

        server.on("GET", PREFERENCES, 200, prefs("UTC"))
        preferences.refresh()
        assertFalse(preferences.syncTimezone("Etc/UTC"), "UTC under another name is the same time")
        assertFalse(preferences.syncTimezone(null))
        assertTrue(server.sentTo("PATCH", PREFERENCES).isEmpty())

        server.on("PATCH", PREFERENCES, 200, prefs("Europe/London"))
        assertTrue(preferences.syncTimezone("Europe/London"))
        assertEquals("""{"userTimezone":"Europe/London"}""", server.sentTo("PATCH", PREFERENCES).single().body)
        // Saved: asking again sends nothing.
        assertFalse(preferences.syncTimezone("Europe/London"))
        assertEquals(1, server.sentTo("PATCH", PREFERENCES).size)
    }

    @Test
    fun zonesAreComparedByTheTimeTheyKeep() {
        assertTrue(sameTimeZone("UTC", "Etc/UTC"))
        assertTrue(sameTimeZone("Z", "GMT"))
        assertTrue(sameTimeZone("Europe/London", "Europe/London"))
        assertFalse(sameTimeZone("Europe/London", "America/New_York"))
        assertFalse(sameTimeZone("Not/AZone", "UTC"))
        assertNotNull(deviceTimeZone())
    }

    @Test
    fun thePhonesZoneIsSentByNameAndABareOffsetNotAtAll() {
        assertEquals("Europe/London", zoneName("Europe/London"))
        assertEquals("Etc/GMT+2", zoneName("Etc/GMT+2"))
        assertEquals("UTC", zoneName("Z"))
        assertEquals("UTC", zoneName("Etc/UTC"))
        assertNull(zoneName("+02:00"))
        assertNull(zoneName("GMT+02:00"))
        assertNull(zoneName("UTC-5"))
        assertNull(zoneName(" "))
        assertNull(zoneName(null))
    }
}

private const val PREFERENCES = "/api/v1/preferences"
