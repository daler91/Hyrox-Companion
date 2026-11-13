package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.dates.sameTimeZone
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The athlete's preferences: units, timezone, notifications, onboarding state.
 * Read from the cache, so units and the onboarding gate work offline; changes
 * go to the server at once (they are not queued), and the answer is cached.
 */
public class PreferencesRepository(private val api: ApiClient, private val cache: CacheStore) {
    public val preferences: Flow<PreferencesResponse?> = cache.observe(KEY, PreferencesResponse.serializer())
    private val timezoneSync = Mutex()

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refresh(): PreferencesResponse = store(api.call(ApiEndpoints.GetPreferences))

    /**
     * Saves [deviceZone] as the athlete's timezone when it keeps different
     * time from the stored one (the web's useDetectTimezone): the server
     * dates their days and schedules their emails in it, so after a flight
     * they would otherwise land on the wrong day. Nothing is sent while the
     * preferences have never loaded or the zone is unknown.
     *
     * @return whether it was saved.
     * @throws com.fitai.coach.core.api.ApiException when the server refuses it.
     */
    public suspend fun syncTimezone(deviceZone: String?): Boolean = timezoneSync.withLock {
        // One at a time: the session start and the app's first resume both
        // ask, and the second must see what the first saved.
        val stored = cache.get(KEY, PreferencesResponse.serializer())?.userTimezone
        val changed = deviceZone != null && stored != null && !sameTimeZone(deviceZone, stored)
        if (changed) update(UpdateUserPreferences(userTimezone = deviceZone))
        changed
    }

    /** Saves [patch] (only the fields it sets). @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun update(patch: UpdateUserPreferences): PreferencesResponse = store(api.call(ApiEndpoints.PatchPreferences, patch))

    private suspend fun store(value: PreferencesResponse): PreferencesResponse {
        cache.put(KEY, PreferencesResponse.serializer(), value)
        return value
    }

    private companion object {
        const val KEY = "preferences"
    }
}
