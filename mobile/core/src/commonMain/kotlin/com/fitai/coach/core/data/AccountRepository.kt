package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.ConsentType
import com.fitai.coach.core.api.generated.GetGarminStatusResponse
import com.fitai.coach.core.api.generated.GetStravaStatusResponse
import com.fitai.coach.core.api.generated.PostConsentsRequest
import com.fitai.coach.core.api.generated.PostGarminConnectRequest
import com.fitai.coach.core.api.generated.PostGarminSyncResponse
import com.fitai.coach.core.api.generated.PostStravaSyncResponse
import com.fitai.coach.core.api.generated.User
import kotlinx.coroutines.flow.Flow

/**
 * The account behind Settings: who is signed in, the device integrations,
 * error-reporting consent and account deletion. The user and the
 * integration statuses are cached, so Settings shows them offline.
 */
public class AccountRepository(private val api: ApiClient, private val cache: CacheStore) {
    public val user: Flow<User?> = cache.observe(USER, User.serializer())
    public val strava: Flow<GetStravaStatusResponse?> = cache.observe(STRAVA, GetStravaStatusResponse.serializer())
    public val garmin: Flow<GetGarminStatusResponse?> = cache.observe(GARMIN, GetGarminStatusResponse.serializer())

    public suspend fun refreshUser() {
        cache.put(USER, User.serializer(), api.call(ApiEndpoints.GetAuthUser))
    }

    public suspend fun refreshIntegrations() {
        cache.put(STRAVA, GetStravaStatusResponse.serializer(), api.call(ApiEndpoints.GetStravaStatus))
        cache.put(GARMIN, GetGarminStatusResponse.serializer(), api.call(ApiEndpoints.GetGarminStatus))
    }

    public suspend fun syncStrava(): PostStravaSyncResponse = api.call(ApiEndpoints.PostStravaSync).also { refreshIntegrations() }

    public suspend fun disconnectStrava() {
        api.call(ApiEndpoints.DeleteStravaDisconnect)
        refreshIntegrations()
    }

    /** Connects Garmin with the athlete's Garmin login (Garmin offers no OAuth); the server stores it encrypted. */
    public suspend fun connectGarmin(email: String, password: String) {
        api.call(ApiEndpoints.PostGarminConnect, PostGarminConnectRequest(email = email.trim(), password = password))
        refreshIntegrations()
    }

    public suspend fun syncGarmin(): PostGarminSyncResponse = api.call(ApiEndpoints.PostGarminSync).also { refreshIntegrations() }

    public suspend fun disconnectGarmin() {
        api.call(ApiEndpoints.DeleteGarminDisconnect)
        refreshIntegrations()
    }

    /** The athlete's latest error-reporting choice; null when they never made one. */
    public suspend fun errorReporting(): Boolean? =
        api.call(ApiEndpoints.GetConsents).consents.firstOrNull { it.consentType == ConsentType.ErrorReporting }?.granted

    public suspend fun setErrorReporting(granted: Boolean) {
        val request = PostConsentsRequest(consentType = PostConsentsRequest.ConsentType.ErrorReporting, granted = granted)
        api.call(ApiEndpoints.PostConsents, request)
    }

    /** Deletes the account and everything in it on the server. Irreversible. */
    public suspend fun deleteAccount() {
        api.call(ApiEndpoints.DeleteAccount)
    }

    private companion object {
        const val USER = "auth-user"
        const val STRAVA = "strava-status"
        const val GARMIN = "garmin-status"
    }
}
