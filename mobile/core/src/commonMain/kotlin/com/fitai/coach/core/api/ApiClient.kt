package com.fitai.coach.core.api

import com.fitai.coach.core.api.generated.ErrorResponse
import com.fitai.coach.core.auth.AuthTokenProvider
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import io.ktor.http.HttpMethod as KtorMethod

/** Which build is calling: sent as `X-App-Platform` / `X-App-Version` for the server's version gate. */
public data class AppIdentity(val platform: String, val version: String)

public data class ApiConfig(val baseUrl: String, val identity: AppIdentity)

/** Session-level outcomes the UI acts on, wherever the request came from. */
public sealed interface SessionEvent {
    /** The server rejected the session token (401): send the user to sign-in. */
    public data object SignedOut : SessionEvent

    /** This build is older than the server's minimum (426): prompt an update. */
    public data class UpdateRequired(val minimumVersion: String?) : SessionEvent
}

/**
 * A non-success response, with the server's error body
 * (`{ error, code, details }`, server/errors.ts) when it sent one.
 */
public class ApiException(
    public val status: Int,
    public val code: String?,
    message: String,
    public val details: Map<String, JsonElement?>? = null,
) : Exception(message)

/** Request headers for idempotent creates (the server's idempotency middleware). */
public const val IDEMPOTENCY_KEY_HEADER: String = "X-Idempotency-Key"

/**
 * Builds the HTTP client every API call goes through: the base URL, JSON with
 * [ApiJson], timeouts, and a plugin that adds the version headers and the
 * bearer token to each request.
 */
public fun createHttpClient(engine: HttpClientEngine, config: ApiConfig, tokens: AuthTokenProvider): HttpClient = HttpClient(engine) {
    expectSuccess = false
    defaultRequest { url(config.baseUrl) }
    install(HttpTimeout) {
        connectTimeoutMillis = CONNECT_TIMEOUT_MS
        requestTimeoutMillis = REQUEST_TIMEOUT_MS
    }
    install(
        createClientPlugin("FitaiSession") {
            onRequest { request, _ ->
                request.header(APP_PLATFORM_HEADER, config.identity.platform)
                request.header(APP_VERSION_HEADER, config.identity.version)
                tokens.token()?.let { request.bearerAuth(it) }
            }
        },
    )
}

/**
 * Calls the API through the generated endpoint catalogue (`ApiEndpoints`),
 * so a path, method or body type is never spelled by hand. 401 and 426 also
 * go out on [events].
 */
public class ApiClient(private val http: HttpClient) {
    private val sessionEvents = MutableSharedFlow<SessionEvent>(extraBufferCapacity = 8)

    public val events: SharedFlow<SessionEvent> = sessionEvents.asSharedFlow()

    /**
     * Sends [endpoint] and decodes its success body.
     *
     * @param path the endpoint's path, built with its generated `path(...)`
     *   when it has parameters.
     * @param body the JSON request body; required when the endpoint has one.
     * @param query query parameters, e.g. a generated `…Query.toQueryParameters()`.
     * @param idempotencyKey sent as [IDEMPOTENCY_KEY_HEADER], so replaying a
     *   create (the offline outbox) can't duplicate it.
     * @throws ApiException on a non-success status.
     */
    public suspend fun <Req, Res> call(
        endpoint: ApiEndpoint<Req, Res>,
        body: Req? = null,
        path: String = endpoint.pathTemplate,
        query: List<Pair<String, String>> = emptyList(),
        idempotencyKey: String? = null,
    ): Res {
        val response = http.request(path) {
            method = endpoint.method.toKtor()
            query.forEach { (name, value) -> parameter(name, value) }
            idempotencyKey?.let { header(IDEMPOTENCY_KEY_HEADER, it) }
            val serializer = endpoint.requestSerializer
            if (serializer != null) {
                requireNotNull(body) { "$endpoint needs a request body" }
                contentType(ContentType.Application.Json)
                setBody(ApiJson.encodeToString(serializer, body))
            }
        }
        if (response.status.value !in SUCCESS_RANGE) throw failure(response)
        return decode(endpoint, response)
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun <Res> decode(endpoint: ApiEndpoint<*, Res>, response: HttpResponse): Res = when (endpoint.responseKind) {
        ResponseKind.Json -> ApiJson.decodeFromString(requireNotNull(endpoint.responseSerializer), response.bodyAsText())
        ResponseKind.Raw -> response.bodyAsText() as Res
        ResponseKind.None -> Unit as Res
        ResponseKind.EventStream -> error("$endpoint streams Server-Sent Events; it has no single body to decode")
    }

    private suspend fun failure(response: HttpResponse): ApiException {
        val status = response.status.value
        val text = response.bodyAsText()
        val parsed = try {
            ApiJson.decodeFromString(ErrorResponse.serializer(), text)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
        when (status) {
            UNAUTHORIZED -> sessionEvents.tryEmit(SessionEvent.SignedOut)
            UPGRADE_REQUIRED -> sessionEvents.tryEmit(SessionEvent.UpdateRequired(minimumVersion(text)))
        }
        return ApiException(
            status = status,
            code = parsed?.code,
            message = parsed?.error ?: "HTTP $status",
            details = parsed?.details,
        )
    }

    private fun minimumVersion(body: String): String? = try {
        ApiJson.parseToJsonElement(body).jsonObject["minimumVersion"]?.jsonPrimitive?.contentOrNull
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}

private fun HttpMethod.toKtor(): KtorMethod = when (this) {
    HttpMethod.Get -> KtorMethod.Get
    HttpMethod.Post -> KtorMethod.Post
    HttpMethod.Put -> KtorMethod.Put
    HttpMethod.Patch -> KtorMethod.Patch
    HttpMethod.Delete -> KtorMethod.Delete
}

internal const val APP_PLATFORM_HEADER = "X-App-Platform"
internal const val APP_VERSION_HEADER = "X-App-Version"
private const val CONNECT_TIMEOUT_MS = 15_000L
private const val REQUEST_TIMEOUT_MS = 30_000L
private const val UNAUTHORIZED = 401
private const val UPGRADE_REQUIRED = 426
private val SUCCESS_RANGE = 200..299
