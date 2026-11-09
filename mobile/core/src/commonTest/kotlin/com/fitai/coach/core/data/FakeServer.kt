package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiConfig
import com.fitai.coach.core.api.AppIdentity
import com.fitai.coach.core.api.IDEMPOTENCY_KEY_HEADER
import com.fitai.coach.core.api.createHttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent

/** A request the app sent. */
data class Sent(val method: String, val path: String, val body: String?, val idempotencyKey: String?, val query: String = "")

/** What the fake server does with a request: answer it, or drop it as if offline. */
sealed interface Reply {
    data class Respond(val status: Int, val body: String = "{}", val headers: Map<String, String> = emptyMap()) : Reply

    data object NoAnswer : Reply
}

class Offline : Exception("no network")

/**
 * The API, faked: answers each request with the first route that matches its
 * method and path, and records every request. Unmatched requests get a 404.
 */
class FakeServer {
    val requests = mutableListOf<Sent>()
    private val routes = mutableListOf<Triple<String, String, (Sent) -> Reply>>()

    fun on(method: String, path: String, reply: (Sent) -> Reply) {
        routes.add(0, Triple(method, path, reply))
    }

    fun on(method: String, path: String, status: Int, body: String = "{}") = on(method, path) { Reply.Respond(status, body) }

    fun sentTo(method: String, path: String): List<Sent> = requests.filter { it.method == method && it.path == path }

    val api: ApiClient by lazy {
        val engine = MockEngine { request ->
            val sent = Sent(
                method = request.method.value,
                path = request.url.encodedPath,
                body = (request.body as? TextContent)?.text,
                idempotencyKey = request.headers[IDEMPOTENCY_KEY_HEADER],
                query = request.url.encodedQuery,
            )
            requests += sent
            val route = routes.firstOrNull { (method, path) -> method == sent.method && path == sent.path }
            when (val reply = route?.third?.invoke(sent) ?: Reply.Respond(404, """{"error":"Not found","code":"NOT_FOUND"}""")) {
                Reply.NoAnswer -> throw Offline()
                is Reply.Respond -> respond(
                    content = reply.body,
                    status = HttpStatusCode.fromValue(reply.status),
                    headers = Headers.build {
                        append(HttpHeaders.ContentType, "application/json")
                        reply.headers.forEach { (name, value) -> append(name, value) }
                    },
                )
            }
        }
        ApiClient(createHttpClient(engine, ApiConfig("https://api.test", AppIdentity("android", "1.0.0"))) { "jwt" })
    }
}

/** A database store over a fresh temporary directory. */
interface TestDatabaseStore : UserDatabaseStore {
    fun exists(userId: String): Boolean
}

expect fun testDatabaseStore(): TestDatabaseStore

/** JSON the fake server answers with. */
object Samples {
    fun setRow(id: String, version: Long, reps: Int? = null, workoutId: String = "w1") =
        """{"id":"$id","workoutLogId":"$workoutId","exerciseName":"back_squat","category":"strength","setNumber":1""" +
            (reps?.let { ""","reps":$it""" } ?: "") + ""","version":$version}"""

    fun workout(id: String, vararg sets: String) =
        """{"id":"$id","userId":"u1","date":"2026-11-02","focus":"Strength","mainWorkout":"Squats",""" +
            """"countsAsTraining":true,"autoLinkRecordingOnly":false,"deviceActivity":null,""" +
            """"exerciseSets":[${sets.joinToString(",")}],"structureBlocks":[]}"""

    fun timelineEntry(id: String, date: String, status: String = "planned") =
        """{"id":"$id","date":"$date","type":"planned","status":"$status","focus":"Run","mainWorkout":"5 km easy"}"""
}
