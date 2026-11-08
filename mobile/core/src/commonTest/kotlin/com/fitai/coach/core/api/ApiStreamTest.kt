package com.fitai.coach.core.api

import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PostChatStreamRequest
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApiStreamTest {
    private fun client(status: HttpStatusCode, body: String): ApiClient {
        val engine = MockEngine {
            respond(body, status, headersOf(HttpHeaders.ContentType, "text/event-stream"))
        }
        return ApiClient(createHttpClient(engine, ApiConfig("https://api.test", AppIdentity("android", "1.0"))) { "jwt" })
    }

    private val message = PostChatStreamRequest(message = "how was my week?")

    @Test
    fun emitsEachDataLineDecodedAndSkipsEverythingElse() = runTest {
        val body = listOf(
            ": keep-alive",
            "data: {\"status\":\"thinking\"}",
            "",
            "data: {\"text\":\"Solid \"}",
            "",
            "data: not json",
            "event: ignored",
            "data: {\"text\":\"week.\"}",
            "",
            "data: {\"done\":true}",
            "",
        ).joinToString("\n")

        val events = client(HttpStatusCode.OK, body).stream(ApiEndpoints.PostChatStream, message).toList()

        assertEquals(listOf(null, "Solid ", "week.", null), events.map { it.text })
        assertEquals(true, events.last().done)
        assertNull(events.first().text)
    }

    @Test
    fun aRefusedStreamThrowsTheServersError() = runTest {
        val api = client(HttpStatusCode.TooManyRequests, """{"error":"Slow down","code":"RATE_LIMITED"}""")

        val error = assertFailsWith<ApiException> { api.stream(ApiEndpoints.PostChatStream, message).toList() }

        assertEquals(429, error.status)
        assertEquals("RATE_LIMITED", error.code)
    }

    @Test
    fun eventDataReadsOnlyDataLines() {
        assertEquals("{}", eventData("data: {}"))
        assertEquals("{}", eventData("data:{}"))
        assertNull(eventData("data:   "))
        assertNull(eventData(": comment"))
        assertTrue(eventData("event: x") == null)
    }
}
