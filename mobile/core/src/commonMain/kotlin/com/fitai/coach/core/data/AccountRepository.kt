package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.ConsentType
import com.fitai.coach.core.api.generated.GetGarminStatusResponse
import com.fitai.coach.core.api.generated.GetStravaAuthQuery
import com.fitai.coach.core.api.generated.GetStravaStatusResponse
import com.fitai.coach.core.api.generated.PostConsentsRequest
import com.fitai.coach.core.api.generated.PostGarminConnectRequest
import com.fitai.coach.core.api.generated.PostGarminSyncResponse
import com.fitai.coach.core.api.generated.PostStravaNativeCompleteRequest
import com.fitai.coach.core.api.generated.PostStravaSyncResponse
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.auth.Pkce
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.serializer

/** The data export's formats, with the file each is shared as. */
public enum class ExportFormat(public val wireValue: String, public val fileName: String, public val mimeType: String) {
    Csv("csv", "fitai-training-data.csv", "text/csv"),
    Json("json", "fitai-training-data.json", "application/json"),
}

/** Why a native Strava connection didn't finish, in words for the athlete. */
public class StravaConnectException(message: String) : Exception(message)

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

    /**
     * Sends a test push to every device and browser the athlete registered.
     * Returns how many accepted it; 0 means none, this phone included, got it.
     *
     * @throws com.fitai.coach.core.api.ApiException
     */
    public suspend fun sendTestPush(): Long = api.call(ApiEndpoints.PostPushTest).sent

    public suspend fun syncStrava(): PostStravaSyncResponse = api.call(ApiEndpoints.PostStravaSync).also { refreshIntegrations() }

    /**
     * Starts connecting Strava natively (the Phase 1 flow): keeps a fresh
     * PKCE verifier on the device and returns Strava's consent URL, whose
     * state carries the challenge. Strava sends the athlete back through the
     * /strava/mobile-callback App Link to [finishStravaConnect].
     */
    public suspend fun startStravaConnect(): String {
        val pkce = Pkce.create()
        cache.put(STRAVA_VERIFIER, String.serializer(), pkce.verifier)
        val query = GetStravaAuthQuery(codeChallenge = pkce.challenge).toQueryParameters()
        return api.call(ApiEndpoints.GetStravaAuth, query = query).authUrl
    }

    /**
     * Finishes the connection Strava sent back: proves the flow is this
     * device's with the verifier, then refreshes the status. The verifier is
     * used once, whatever the outcome.
     *
     * @throws StravaConnectException when no connection was started here, or the athlete declined.
     * @throws com.fitai.coach.core.api.ApiException when the server refuses it.
     */
    public suspend fun finishStravaConnect(code: String?, state: String?, error: String?) {
        val verifier = cache.get(STRAVA_VERIFIER, String.serializer())
            ?: throw StravaConnectException("No Strava connection was started on this device. Try Connect Strava again.")
        cache.delete(STRAVA_VERIFIER)
        if (error != null || code.isNullOrEmpty() || state.isNullOrEmpty()) {
            throw StravaConnectException("Strava wasn't connected. You can try again anytime.")
        }
        api.call(ApiEndpoints.PostStravaNativeComplete, PostStravaNativeCompleteRequest(code = code, state = state, verifier = verifier))
        refreshIntegrations()
    }

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

    /** All the athlete's training data, as the server exports it (GET /export, as on the web's Settings). */
    public suspend fun exportData(format: ExportFormat): String = api.text(ApiEndpoints.GetExport, listOf("format" to format.wireValue))

    /** Deletes the account and everything in it on the server. Irreversible. */
    public suspend fun deleteAccount() {
        api.call(ApiEndpoints.DeleteAccount)
    }

    private companion object {
        const val USER = "auth-user"
        const val STRAVA = "strava-status"
        const val GARMIN = "garmin-status"
        const val STRAVA_VERIFIER = "strava-connect-verifier"
    }
}
