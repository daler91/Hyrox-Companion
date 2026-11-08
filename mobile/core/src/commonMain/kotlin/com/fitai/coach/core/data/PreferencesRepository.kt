package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import kotlinx.coroutines.flow.Flow

/**
 * The athlete's preferences: units, timezone, notifications, onboarding state.
 * Read from the cache, so units and the onboarding gate work offline; changes
 * go to the server at once (they are not queued), and the answer is cached.
 */
public class PreferencesRepository(private val api: ApiClient, private val cache: CacheStore) {
    public val preferences: Flow<PreferencesResponse?> = cache.observe(KEY, PreferencesResponse.serializer())

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refresh(): PreferencesResponse = store(api.call(ApiEndpoints.GetPreferences))

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
