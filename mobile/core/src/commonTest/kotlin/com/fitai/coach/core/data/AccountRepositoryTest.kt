package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.auth.Pkce
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AccountRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val account = AccountRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private fun connectable() {
        server.on("GET", "/api/v1/strava/auth", 200, """{"authUrl":"https://www.strava.com/oauth/mobile/authorize?state=s1"}""")
        server.on("POST", "/api/v1/strava/native/complete", 200, """{"success":true}""")
        server.on(
            "GET",
            "/api/v1/strava/status",
            200,
            """{"connected":true,"autoSync":{"enabled":true,"webhook":true,"intervalMinutes":60}}""",
        )
        server.on("GET", "/api/v1/garmin/status", 200, """{"connected":false}""")
    }

    @Test
    fun aStravaConnectionIsFinishedWithTheVerifierBehindItsChallenge() = runTest {
        connectable()
        assertEquals("https://www.strava.com/oauth/mobile/authorize?state=s1", account.startStravaConnect())

        account.finishStravaConnect(code = "c1", state = "s1", error = null)

        val completed = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/strava/native/complete").single().body!!).jsonObject
        assertEquals("c1", completed["code"]!!.jsonPrimitive.content)
        assertEquals("s1", completed["state"]!!.jsonPrimitive.content)
        val verifier = completed["verifier"]!!.jsonPrimitive.content
        val asked = server.requests.first { it.path == "/api/v1/strava/auth" }
        assertTrue(asked.query.contains("codeChallenge=${Pkce.fromVerifier(verifier).challenge}"))
    }

    @Test
    fun aReturnWithNoConnectStartedHereOrADeclinedOneSendsNothing() = runTest {
        connectable()
        assertFailsWith<StravaConnectException> { account.finishStravaConnect("c1", "s1", null) }

        account.startStravaConnect()
        assertFailsWith<StravaConnectException> { account.finishStravaConnect(null, "s1", "access_denied") }
        // The verifier went with the declined attempt, so a replayed return finds none.
        assertFailsWith<StravaConnectException> { account.finishStravaConnect("c1", "s1", null) }
        assertTrue(server.sentTo("POST", "/api/v1/strava/native/complete").isEmpty())
    }

    @Test
    fun theExportIsFetchedAsTextInTheChosenFormat() = runTest {
        server.on("GET", "/api/v1/export", 200, "date,type\n2026-11-08,run\n")
        assertEquals("date,type\n2026-11-08,run\n", account.exportData(ExportFormat.Csv))
        assertEquals("format=csv", server.sentTo("GET", "/api/v1/export").single().query)
    }
}
