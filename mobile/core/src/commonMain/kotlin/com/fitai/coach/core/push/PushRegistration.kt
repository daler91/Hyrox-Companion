package com.fitai.coach.core.push

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.DeletePushDevicesRequest
import com.fitai.coach.core.api.generated.PostPushDevicesRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** This install's push token (FCM on Android). */
public interface PushTokens {
    /** The current token, created if there is none. */
    public suspend fun current(): String

    /** Deletes the token, so nothing more is delivered to it. */
    public suspend fun delete()
}

/** Who turned push on on this device, kept on the device across launches. */
public interface PushPreference {
    public var enabledFor: String?
}

/**
 * Push on this device. Push is on for one user at a time, the one who turned
 * it on here: their install is registered with the server on every launch
 * and whenever the token rotates (which keeps last_seen_at fresh, as
 * server/routes/push.ts expects), and unregistered when they turn it off or
 * sign out.
 *
 * [tokens] is null in a build without push (no Firebase configuration).
 */
@Suppress("TooGenericExceptionCaught")
public class PushRegistration(
    private val api: ApiClient,
    private val tokens: PushTokens?,
    private val preference: PushPreference,
) {
    public val available: Boolean get() = tokens != null

    private val enabledUser = MutableStateFlow(preference.enabledFor)

    /** The user push is on for here, or null. */
    public val enabledFor: StateFlow<String?> = enabledUser.asStateFlow()

    /**
     * Turns push on for [userId]: registers this install's token.
     *
     * @throws com.fitai.coach.core.api.ApiException when the server refuses (404 when it has no push configured).
     */
    public suspend fun enable(userId: String) {
        val source = tokens ?: error("Push isn't available in this build")
        register(source.current())
        remember(userId)
    }

    /** Turns push off: unregisters and deletes the token. Best effort; push is off here either way. */
    public suspend fun disable() {
        val source = tokens
        remember(null)
        if (source == null) return
        bestEffort {
            val token = source.current()
            val body = ApiJson.encodeToString(DeletePushDevicesRequest.serializer(), DeletePushDevicesRequest(token))
            api.send(ApiEndpoints.DeletePushDevices, ApiEndpoints.DeletePushDevices.pathTemplate, body, idempotencyKey = null)
        }
        bestEffort { source.delete() }
    }

    /** At launch: re-registers when push is on for the signed-in [userId]. */
    public suspend fun refresh(userId: String) {
        val source = tokens ?: return
        if (enabledUser.value == userId) bestEffort { register(source.current()) }
    }

    /** FCM rotated the token: registers the new one when push is on for the signed-in [userId]. */
    public suspend fun onNewToken(token: String, userId: String?) {
        if (userId != null && enabledUser.value == userId) bestEffort { register(token) }
    }

    /** The account is gone (its tokens with it, on the server): forgets push here and deletes the token. */
    public suspend fun forget() {
        remember(null)
        tokens?.let { source -> bestEffort { source.delete() } }
    }

    private suspend fun register(token: String) {
        val body = ApiJson.encodeToString(
            PostPushDevicesRequest.serializer(),
            PostPushDevicesRequest(token = token, platform = PostPushDevicesRequest.Platform.Android),
        )
        api.send(ApiEndpoints.PostPushDevices, ApiEndpoints.PostPushDevices.pathTemplate, body, idempotencyKey = null)
    }

    private fun remember(userId: String?) {
        preference.enabledFor = userId
        enabledUser.value = userId
    }

    private suspend fun bestEffort(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Push is a convenience: the next launch or token rotation tries again.
        }
    }
}
