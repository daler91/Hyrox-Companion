package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.PostPlansGenerateRequest
import com.fitai.coach.core.dates.isoDateToUtcMillis
import com.fitai.coach.core.dates.utcMillisToIsoDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OnboardingRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val cache = CacheStore(db) { 0L }
    private val sync = SyncEngine(db, server.api, now = { 0L }, newKey = { "key" })
    private val timeline = TimelineRepository(db, server.api, sync, cache)
    private val onboarding = OnboardingRepository(server.api, cache, PreferencesRepository(server.api, cache), timeline)

    @AfterTest
    fun closeDatabase() = db.close()

    private fun prefs(onboarded: Boolean) = """{"userTimezone":"Europe/London","onboardingCompleted":$onboarded}"""

    private val plan = """{"id":"p1","userId":"u1","name":"Plan","totalWeeks":8,"generationStatus":"ready","days":[]}"""

    private fun newAccount() {
        server.on("GET", "/api/v1/preferences", 200, prefs(onboarded = false))
        server.on("GET", "/api/v1/plans", 200, "[]")
        server.on("GET", "/api/v1/timeline", 200, "[]")
    }

    @Test
    fun setupOpensForANewAccountWithNothingInIt() = runTest {
        newAccount()
        assertTrue(onboarding.shouldStart())
    }

    @Test
    fun setupStaysShutForAnAthleteWhoFinishedItOrHasAPlan() = runTest {
        newAccount()
        server.on("GET", "/api/v1/plans", 200, "[$plan]")
        assertFalse(onboarding.shouldStart())

        server.on("GET", "/api/v1/preferences", 200, prefs(onboarded = true))
        server.on("GET", "/api/v1/plans", 200, "[]")
        assertFalse(onboarding.shouldStart())
    }

    @Test
    fun aCompletionTheServerMissedIsSentOnTheNextCheck() = runTest {
        newAccount()
        server.on("PATCH", "/api/v1/preferences") { Reply.NoAnswer }
        onboarding.complete()

        server.on("PATCH", "/api/v1/preferences", 200, prefs(onboarded = true))
        assertFalse(onboarding.shouldStart())
        val sent = server.sentTo("PATCH", "/api/v1/preferences").map { ApiJson.parseToJsonElement(it.body!!).jsonObject }
        assertEquals(2, sent.size)
        assertTrue(sent.all { it["onboardingCompleted"]!!.jsonPrimitive.boolean })
    }

    @Test
    fun aTemplatePlanIsCreatedThenScheduled() = runTest {
        server.on("POST", "/api/v1/plans/sample", 201, plan)
        server.on("POST", "/api/v1/plans/p1/schedule", 200, """{"success":true}""")
        server.on("GET", "/api/v1/plans", 200, "[$plan]")
        server.on("GET", "/api/v1/timeline", 200, "[]")

        val id = onboarding.createTemplatePlan("Complete HYROX Open", raceDate = null)
        onboarding.schedule(id, "2026-11-09")

        assertEquals("p1", id)
        val body = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/plans/sample").single().body!!).jsonObject
        assertEquals("Complete HYROX Open", body["goal"]!!.jsonPrimitive.content)
        assertNull(body["raceDate"])
        assertEquals(1, timeline.plans.first()?.size)
    }

    @Test
    fun aGenerationIsWatchedUntilReady() = runTest {
        var reads = 0
        server.on("GET", "/api/v1/plans/p1/generation-status") {
            reads++
            Reply.Respond(200, """{"planId":"p1","generationStatus":"${if (reads < 3) "generating" else "ready"}"}""")
        }
        server.on("GET", "/api/v1/plans", 200, "[$plan]")
        server.on("GET", "/api/v1/timeline", 200, "[]")

        assertEquals(GenerationOutcome.Ready, onboarding.awaitGeneration("p1", testScheduler.timeSource))
        assertEquals(3, reads)
        assertEquals(1, timeline.plans.first()?.size)
    }

    @Test
    fun aFailedGenerationCarriesTheServersReason() = runTest {
        server.on(
            "GET",
            "/api/v1/plans/p1/generation-status",
            200,
            """{"planId":"p1","generationStatus":"failed","error":"AI unavailable"}""",
        )
        val outcome = onboarding.awaitGeneration("p1", testScheduler.timeSource)
        assertIs<GenerationOutcome.Failed>(outcome)
        assertEquals("AI unavailable", outcome.error)
    }

    @Test
    fun theWatchEndsWhenStatusReadsKeepFailingOrItRunsTooLong() = runTest {
        server.on("GET", "/api/v1/plans/p1/generation-status") { Reply.NoAnswer }
        assertEquals(GenerationOutcome.Unreachable, onboarding.awaitGeneration("p1", testScheduler.timeSource))

        server.on("GET", "/api/v1/plans/p1/generation-status", 200, """{"planId":"p1","generationStatus":"generating"}""")
        assertEquals(GenerationOutcome.TimedOut, onboarding.awaitGeneration("p1", testScheduler.timeSource))
    }

    @Test
    fun aGenerationRequestSaysWhetherTheEndDateIsRaceDay() = runTest {
        server.on("POST", "/api/v1/plans/generate", 202, plan)
        val request = PostPlansGenerateRequest(
            goal = "Race",
            experienceLevel = PostPlansGenerateRequest.ExperienceLevel.Intermediate,
            startDate = "2026-11-09",
            endDate = "2027-01-04",
            endDateIsRaceDate = false,
        )
        assertEquals("p1", onboarding.generate(request))
        val body = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/plans/generate").single().body!!).jsonObject
        assertFalse(body["endDateIsRaceDate"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun datesRoundTripThroughPickerMillis() {
        assertEquals(1_762_646_400_000L, isoDateToUtcMillis("2025-11-09"))
        assertEquals("2025-11-09", utcMillisToIsoDate(1_762_646_400_000L + 3_600_000L))
        assertNull(isoDateToUtcMillis("not a date"))
    }
}
