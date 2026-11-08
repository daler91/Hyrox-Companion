package com.fitai.coach.core.api

import com.fitai.coach.core.api.generated.ErrorResponse
import com.fitai.coach.core.auth.AuthTokenProvider
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.timeout
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.prepareRequest
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.utils.io.readLine
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
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

/** A decoded body with the response's headers (names lower-cased). */
public data class ApiResponse<T>(val body: T, val headers: Map<String, String>)

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
    ): Res = decode(endpoint, execute(endpoint, path, query, encodeBody(endpoint, body), idempotencyKey))

    /**
     * [call], also returning the response headers, for endpoints that page
     * through one (`X-Next-Cursor` on the timeline and the chat history).
     * Header names are lower-cased.
     */
    public suspend fun <Req, Res> callWithHeaders(
        endpoint: ApiEndpoint<Req, Res>,
        body: Req? = null,
        path: String = endpoint.pathTemplate,
        query: List<Pair<String, String>> = emptyList(),
    ): ApiResponse<Res> {
        val response = execute(endpoint, path, query, encodeBody(endpoint, body), idempotencyKey = null)
        val headers = response.headers.entries().associate { (name, values) -> name.lowercase() to values.first() }
        return ApiResponse(decode(endpoint, response), headers)
    }

    /**
     * Sends an endpoint that answers with Server-Sent Events (the coach's
     * replies) and emits each event's `data:` JSON, decoded, as it arrives.
     * The flow completes when the server closes the stream; cancelling the
     * collector aborts the request. A line that is not an event, or does not
     * decode, is skipped, as the web's parser does.
     *
     * @throws ApiException when the server refuses the request before streaming.
     */
    public fun <Req, Res> stream(endpoint: ApiEndpoint<Req, Res>, body: Req? = null, path: String = endpoint.pathTemplate): Flow<Res> =
        channelFlow {
            require(endpoint.responseKind == ResponseKind.EventStream) { "$endpoint does not stream" }
            val serializer = requireNotNull(endpoint.responseSerializer)
            val json = encodeBody(endpoint, body)
            http.prepareRequest(path) {
                method = endpoint.method.toKtor()
                header(HttpHeaders.Accept, EVENT_STREAM)
                timeout {
                    requestTimeoutMillis = STREAM_TIMEOUT_MS
                    socketTimeoutMillis = STREAM_IDLE_TIMEOUT_MS
                }
                if (json != null) {
                    contentType(ContentType.Application.Json)
                    setBody(json)
                }
            }.execute { response ->
                if (response.status.value !in SUCCESS_RANGE) throw failure(response)
                val channel = response.bodyAsChannel()
                var line = channel.readLine()
                while (line != null) {
                    eventData(line)?.let { payload -> decodeOrNull(serializer, payload)?.let { send(it) } }
                    line = channel.readLine()
                }
            }
        }

    private fun <Req> encodeBody(endpoint: ApiEndpoint<Req, *>, body: Req?): String? {
        val serializer = endpoint.requestSerializer ?: return null
        requireNotNull(body) { "$endpoint needs a request body" }
        return ApiJson.encodeToString(serializer, body)
    }

    /**
     * Sends [endpoint] with a body that is already JSON, and returns the success
     * body as text: how the offline outbox replays a write it stored earlier.
     *
     * @throws ApiException on a non-success status.
     */
    public suspend fun send(endpoint: ApiEndpoint<*, *>, path: String, body: String?, idempotencyKey: String?): String =
        execute(endpoint, path, emptyList(), body, idempotencyKey).bodyAsText()

    /** A GET whose body the app keeps as text, undecoded: a file the server generates (the data export). */
    public suspend fun text(endpoint: ApiEndpoint<Unit, *>, query: List<Pair<String, String>> = emptyList()): String =
        execute(endpoint, endpoint.pathTemplate, query, null, null).bodyAsText()

    private suspend fun execute(
        endpoint: ApiEndpoint<*, *>,
        path: String,
        query: List<Pair<String, String>>,
        json: String?,
        idempotencyKey: String?,
    ): HttpResponse {
        val response = http.request(path) {
            method = endpoint.method.toKtor()
            query.forEach { (name, value) -> parameter(name, value) }
            idempotencyKey?.let { header(IDEMPOTENCY_KEY_HEADER, it) }
            if (json != null) {
                contentType(ContentType.Application.Json)
                setBody(json)
            }
        }
        if (response.status.value !in SUCCESS_RANGE) throw failure(response)
        return response
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun <Res> decode(endpoint: ApiEndpoint<*, Res>, response: HttpResponse): Res = when (endpoint.responseKind) {
        ResponseKind.Json -> ApiJson.decodeFromString(requireNotNull(endpoint.responseSerializer), response.bodyAsText())
        ResponseKind.Raw -> response.bodyAsText() as Res
        ResponseKind.None -> Unit as Res
        ResponseKind.EventStream -> error("$endpoint streams Server-Sent Events: use stream()")
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
            code = parsed?.code ?: stringField(text, "code"),
            // Some refusals ({undone:false, reason, message}) carry `message`, not `error`.
            message = parsed?.error ?: stringField(text, "message") ?: "HTTP $status",
            details = parsed?.details,
        )
    }

    private fun minimumVersion(body: String): String? = stringField(body, "minimumVersion")

    private fun stringField(body: String, name: String): String? = try {
        (ApiJson.parseToJsonElement(body) as? JsonObject)?.get(name)?.let { it as? JsonPrimitive }?.contentOrNull
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}

/** The payload of an SSE `data:` line, or null for any other line (comments, `event:`, blank separators). */
internal fun eventData(line: String): String? {
    if (!line.startsWith(DATA_PREFIX)) return null
    return line.removePrefix(DATA_PREFIX).trim().takeIf { it.isNotEmpty() }
}

private fun <T> decodeOrNull(serializer: kotlinx.serialization.KSerializer<T>, json: String): T? = try {
    ApiJson.decodeFromString(serializer, json)
} catch (_: SerializationException) {
    null
} catch (_: IllegalArgumentException) {
    null
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

// The server caps a coach reply at 5 minutes and sends no heartbeats, so a
// long silent step (drafting a plan change) must not trip an idle timeout
// before the server's own cap does.
private const val STREAM_TIMEOUT_MS = 6L * 60 * 1000
private const val STREAM_IDLE_TIMEOUT_MS = STREAM_TIMEOUT_MS
private const val EVENT_STREAM = "text/event-stream"
private const val DATA_PREFIX = "data:"
private const val UNAUTHORIZED = 401
private const val UPGRADE_REQUIRED = 426
private val SUCCESS_RANGE = 200..299
