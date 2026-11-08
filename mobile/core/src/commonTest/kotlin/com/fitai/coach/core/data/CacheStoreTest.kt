package com.fitai.coach.core.data

import com.fitai.coach.core.api.generated.PreferencesResponse
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CacheStoreTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val cache = CacheStore(db) { 0L }
    private val preferences = PreferencesRepository(server.api, cache)

    @AfterTest
    fun closeDatabase() = db.close()

    private fun prefs(weightUnit: String, onboarded: Boolean) =
        """{"weightUnit":"$weightUnit","userTimezone":"Europe/London","onboardingCompleted":$onboarded}"""

    @Test
    fun preferencesAreReadFromTheCacheOnceFetched() = runTest {
        assertNull(preferences.preferences.first())
        server.on("GET", "/api/v1/preferences", 200, prefs("kg", onboarded = false))

        preferences.refresh()

        val cached = preferences.preferences.first()!!
        assertEquals("kg", cached.weightUnit)
        assertEquals(false, cached.onboardingCompleted)
    }

    @Test
    fun anUpdateCachesTheServersAnswer() = runTest {
        server.on("PATCH", "/api/v1/preferences", 200, prefs("lbs", onboarded = true))

        preferences.update(com.fitai.coach.core.api.generated.UpdateUserPreferences())

        assertEquals("lbs", preferences.preferences.first()!!.weightUnit)
    }

    @Test
    fun deletePrefixClearsOnlyThatFamily() = runTest {
        val serializer = PreferencesResponse.serializer()
        val value = PreferencesResponse(userTimezone = "UTC", onboardingCompleted = true)
        cache.put("nutrition:2026-11-07", serializer, value)
        cache.put("nutrition:2026-11-08", serializer, value)
        cache.put("preferences", serializer, value)

        cache.deletePrefix("nutrition:")

        assertNull(cache.get("nutrition:2026-11-07", serializer))
        assertEquals(value, cache.get("preferences", serializer))
    }
}
