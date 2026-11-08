package com.fitai.coach.core.api

import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PostConsentsRequest
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApiClientTest {
    private val identity = AppIdentity(platform = "android", version = "1.2.3")
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val consent = PostConsentsRequest(consentType = PostConsentsRequest.ConsentType.PrivacyNotice, granted = true)

    private fun client(
        token: String? = "jwt-abc",
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): Pair<ApiClient, MutableList<HttpRequestData>> {
        val seen = mutableListOf<HttpRequestData>()
        val engine = MockEngine { request ->
            seen += request
            handler(request)
        }
        val http = createHttpClient(engine, ApiConfig("https://api.test", identity)) { token }
        return ApiClient(http) to seen
    }

    @Test
    fun sendsTheBearerTokenAndVersionHeaders() = runTest {
        val (api, seen) = client { respond("""{"success":true}""", HttpStatusCode.OK, json) }

        api.call(ApiEndpoints.PostConsents, consent)

        val request = seen.single()
        assertEquals("Bearer jwt-abc", request.headers[HttpHeaders.Authorization])
        assertEquals("android", request.headers["X-App-Platform"])
        assertEquals("1.2.3", request.headers["X-App-Version"])
        assertEquals("https://api.test/api/v1/consents", request.url.toString())
    }

    @Test
    fun sendsNoAuthorizationHeaderWhenSignedOut() = runTest {
        val (api, seen) = client(token = null) { respond("""{"success":true}""", HttpStatusCode.OK, json) }

        api.call(ApiEndpoints.PostConsents, consent)

        assertNull(seen.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun encodesTheBodyWithApiJson() = runTest {
        val (api, seen) = client { respond("""{"success":true}""", HttpStatusCode.OK, json) }

        api.call(ApiEndpoints.PostConsents, consent)

        val body = seen.single().body as TextContent
        assertEquals("""{"consentType":"privacy_notice","granted":true}""", body.text)
    }

    @Test
    fun fillsPathParametersAndQuery() = runTest {
        val (api, seen) = client { respond("[]", HttpStatusCode.OK, json) }

        api.call(ApiEndpoints.GetTimeline, query = listOf("from" to "2026-11-01", "to" to "2026-11-07"))

        assertEquals("https://api.test/api/v1/timeline?from=2026-11-01&to=2026-11-07", seen.single().url.toString())
    }

    @Test
    fun sendsAnIdempotencyKeyWhenGiven() = runTest {
        val (api, seen) = client { respond("""{"success":true}""", HttpStatusCode.OK, json) }

        api.call(ApiEndpoints.PostConsents, consent, idempotencyKey = "k-1")

        assertEquals("k-1", seen.single().headers[IDEMPOTENCY_KEY_HEADER])
    }

    @Test
    fun throwsTheServerErrorBody() = runTest {
        val (api, _) = client {
            respond("""{"error":"Workout not found","code":"NOT_FOUND"}""", HttpStatusCode.NotFound, json)
        }

        val error = assertFailsWith<ApiException> { api.call(ApiEndpoints.GetTimeline) }

        assertEquals(404, error.status)
        assertEquals("NOT_FOUND", error.code)
        assertEquals("Workout not found", error.message)
    }

    @Test
    fun survivesANonJsonErrorBody() = runTest {
        val (api, _) = client { respond("<html>bad gateway</html>", HttpStatusCode.BadGateway) }

        val error = assertFailsWith<ApiException> { api.call(ApiEndpoints.GetTimeline) }

        assertEquals(502, error.status)
        assertNull(error.code)
    }

    @Test
    fun announcesSignOutOn401() = runTest {
        val (api, _) = client {
            respond("""{"error":"Unauthorized","code":"UNAUTHORIZED"}""", HttpStatusCode.Unauthorized, json)
        }
        val event = async { api.events.first() }

        assertFailsWith<ApiException> { api.call(ApiEndpoints.GetTimeline) }

        assertEquals(SessionEvent.SignedOut, event.await())
    }

    @Test
    fun announcesUpdateRequiredOn426WithTheMinimumVersion() = runTest {
        val (api, _) = client {
            respond(
                """{"error":"Update the app","code":"APP_UPDATE_REQUIRED","minimumVersion":"2.0.0"}""",
                HttpStatusCode.UpgradeRequired,
                json,
            )
        }
        val event = async { api.events.first() }

        val error = assertFailsWith<ApiException> { api.call(ApiEndpoints.GetTimeline) }

        assertEquals(SessionEvent.UpdateRequired("2.0.0"), event.await())
        assertEquals("APP_UPDATE_REQUIRED", error.code)
        assertTrue(error.message!!.isNotEmpty())
    }
}
