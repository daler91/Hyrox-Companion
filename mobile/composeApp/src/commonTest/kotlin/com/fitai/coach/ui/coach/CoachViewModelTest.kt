package com.fitai.coach.ui.coach

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiConfig
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.AppIdentity
import com.fitai.coach.core.api.createHttpClient
import com.fitai.coach.core.data.ChatFocus
import com.fitai.coach.core.data.CoachRepository
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class Offline : Exception("no network")

@OptIn(ExperimentalCoroutinesApi::class)
class CoachViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    /** path → (status, body); a null status means no answer. */
    private val routes = mutableMapOf<String, Pair<Int?, String>>()

    /** path → extra response headers. */
    private val routeHeaders = mutableMapOf<String, Map<String, String>>()
    private val sent = mutableListOf<Pair<String, JsonObject?>>()
    private val queries = mutableMapOf<String, String>()
    private var planChanges = 0
    private var ids = 0

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.viewModel(focus: ChatFocus? = null): CoachViewModel {
        val engine = MockEngine(
            MockEngineConfig().apply {
                this.dispatcher = this@CoachViewModelTest.dispatcher
                addHandler { request ->
                    val key = "${request.method.value} ${request.url.encodedPath}"
                    val body = (request.body as? TextContent)?.text?.let { ApiJson.parseToJsonElement(it).jsonObject }
                    sent += key to body
                    queries[key] = request.url.encodedQuery
                    val (status, reply) = routes[key] ?: (404 to """{"error":"Not found"}""")
                    if (status == null) throw Offline()
                    val headers = mapOf(HttpHeaders.ContentType to listOf("application/json")) +
                        routeHeaders[key].orEmpty().mapValues { listOf(it.value) }
                    respond(reply, HttpStatusCode.fromValue(status), headersOf(*headers.toList().toTypedArray()))
                }
            },
        )
        val api = ApiClient(createHttpClient(engine, ApiConfig("https://api.test", AppIdentity("android", "1.0"))) { "jwt" })
        return CoachViewModel(
            coach = CoachRepository(api),
            aiEnabled = MutableStateFlow(true),
            enableAi = {},
            onPlanChanged = { planChanges++ },
            newId = { "id-${++ids}" },
            focus = focus,
        ).also { advanceUntilIdle() }
    }

    private fun stream(vararg events: String) = events.joinToString("") { "data: $it\n\n" }

    private val proposal =
        """{"id":"pp1","planId":"p1","status":"pending","summaryMessage":"Swap two days","createdAt":"2026-11-08T10:00:00Z",""" +
            """"changes":[""" + change("d1") + "," + change("d2") + "]}"

    private fun change(day: String) =
        """{"planDayId":"$day","updatedFields":{"focus":"Easy run"},"rationale":"recover","kind":"workout_update",""" +
            """"dayLabel":"Tue","baseline":{"focus":"Tempo","mainWorkout":"8 km","status":"planned"},""" +
            """"structured":false,"hasStructureBlocks":false}"""

    @Test
    fun aStreamedReplyBuildsUpAndEndsRateable() = runTest(dispatcher) {
        routes["POST /api/v1/chat/stream"] = 200 to stream(
            """{"status":"looking_up_workouts"}""",
            """{"text":"Solid "}""",
            """{"text":"week."}""",
            """{"planProposal":$proposal}""",
            """{"done":true}""",
        )
        val vm = viewModel()

        vm.send("how was my week?")
        advanceUntilIdle()

        val reply = vm.state.value.items.last()
        assertEquals("Solid week.", reply.content)
        assertEquals(ChatKind.Proposal, reply.kind)
        assertEquals("pp1", reply.proposal?.id)
        assertTrue(reply.rateable)
        assertFalse(vm.state.value.sending)
        assertNull(vm.state.value.progress)
        val body = sent.single { it.first == "POST /api/v1/chat/stream" }.second!!
        assertEquals("id-1", body["userMessageId"]!!.jsonPrimitive.content)
        assertEquals("id-2", body["assistantMessageId"]!!.jsonPrimitive.content)
    }

    @Test
    fun aBudgetRefusalUsesTheWebsCopyWithoutRetry() = runTest(dispatcher) {
        routes["POST /api/v1/chat/stream"] = 429 to """{"error":"Budget exceeded","code":"AI_BUDGET_EXCEEDED"}"""
        val vm = viewModel()

        vm.send("hi")
        advanceUntilIdle()

        val failure = vm.state.value.items.last().failure!!
        assertEquals("You've reached your daily AI usage limit. Please try again later.", failure.message)
        assertFalse(failure.retryable)
    }

    @Test
    fun aDroppedConnectionIsRetriedInPlace() = runTest(dispatcher) {
        routes["POST /api/v1/chat/stream"] = null to ""
        val vm = viewModel()
        vm.send("hi")
        advanceUntilIdle()
        assertTrue(vm.state.value.items.last().failure!!.retryable)

        routes["POST /api/v1/chat/stream"] = 200 to stream("""{"text":"Hello!"}""", """{"done":true}""")
        vm.retry(vm.state.value.items.last().id)
        advanceUntilIdle()

        val retry = sent.filter { it.first == "POST /api/v1/chat/stream" }.last().second!!
        assertEquals("id-1", retry["userMessageId"]!!.jsonPrimitive.content)
        assertEquals("id-2", retry["replaceAssistantId"]!!.jsonPrimitive.content)
        assertEquals("id-3", retry["assistantMessageId"]!!.jsonPrimitive.content)
        assertEquals(listOf("hi", "Hello!"), vm.state.value.items.drop(1).map { it.content })
    }

    @Test
    fun applyingAProposalSaysSoSavesItAndRefreshesThePlan() = runTest(dispatcher) {
        routes["POST /api/v1/plan-proposals/pp1/apply"] = 200 to """{"applied":true,"changeCount":2}"""
        routes["POST /api/v1/chat/message"] = 200 to """{"id":"m1","role":"assistant","content":"x"}"""
        routes["GET /api/v1/plan-proposals/pp1"] = 200 to """{"proposal":${proposal.replace("\"pending\"", "\"applied\"")}}"""
        val vm = viewModel()

        vm.applyProposal(ApiJson.decodeFromString(com.fitai.coach.core.api.generated.PlanProposal.serializer(), proposal), null)
        advanceUntilIdle()

        assertEquals("Done — I've updated 2 days in your plan.", vm.state.value.items.last().content)
        assertEquals(
            "Done — I've updated 2 days in your plan.",
            sent.single { it.first == "POST /api/v1/chat/message" }.second!!["content"]!!.jsonPrimitive.content,
        )
        assertEquals(1, planChanges)
        assertNull(sent.single { it.first == "POST /api/v1/plan-proposals/pp1/apply" }.second!!["planDayIds"])
    }

    @Test
    fun aWorkoutThreadKeepsToItsOwnHistory() = runTest(dispatcher) {
        routes["GET /api/v1/chat/history"] = 200 to
            """[{"id":"m1","userId":"u1","role":"user","content":"Was that too fast?","kind":"text"}]"""
        routes["POST /api/v1/chat/stream"] = 200 to stream("""{"text":"A touch."}""", """{"done":true}""")
        routes["POST /api/v1/chat/message"] = 200 to """{"id":"m9","role":"assistant","content":"x"}"""
        val vm = viewModel(ChatFocus(planDayId = "d1", workoutLogId = "w1"))

        assertEquals(listOf(THREAD_WELCOME, "Was that too fast?"), vm.state.value.items.map { it.content })
        assertTrue(vm.state.value.quickActions.isEmpty())
        assertTrue(sent.none { it.first == "GET /api/v1/chat/welcome" })
        val query = queries.getValue("GET /api/v1/chat/history")
        assertTrue("focusWorkoutLogId=w1" in query && "focusPlanDayId=d1" in query, query)

        vm.send("and the pacing?")
        advanceUntilIdle()

        val body = sent.single { it.first == "POST /api/v1/chat/stream" }.second!!
        assertEquals("w1", body["focusWorkoutLogId"]!!.jsonPrimitive.content)
        assertEquals("d1", body["focusPlanDayId"]!!.jsonPrimitive.content)
    }

    @Test
    fun failureCopyFollowsTheWeb() {
        assertEquals("Your connection dropped. Check your internet and try again.", chatFailure(Offline()).message)
        assertEquals(
            ChatFailure("The response took too long and was stopped.", true),
            ChatItem("a", ChatRole.Assistant, "").apply(
                ApiJson.decodeFromString(
                    com.fitai.coach.core.api.generated.ChatStreamEvent.serializer(),
                    """{"error":"timeout","reason":"The response took too long and was stopped."}""",
                ),
            ).failure,
        )
        assertEquals("Checking your plan...", statusLabel(com.fitai.coach.core.api.generated.ChatStreamEvent.Status.DraftingPlan))
    }

    private fun suggestion(day: String, field: String = "mainWorkout") =
        """{"workoutId":"$day","date":"2026-11-17","focus":"Tempo run","targetField":"$field","action":"replace",""" +
            """"recommendation":"6 x 1 km at threshold","rationale":"Builds race pace","priority":"high"}"""

    private fun TestScope.suggestionsPanel(): CoachViewModel {
        routes["GET /api/v1/chat/welcome"] = 200 to
            """{"greeting":"Hi","quickActions":[{"id":"suggestions","label":"Get workout suggestions"}]}"""
        routes["POST /api/v1/chat/message"] = 200 to """{"id":"m1","role":"assistant","content":"x"}"""
        return viewModel()
    }

    @Test
    fun workoutSuggestionsArriveUnderTheReplyForApplyOrDismiss() = runTest(dispatcher) {
        routes["POST /api/v1/timeline/ai-suggestions"] = 200 to
            """{"suggestions":[${suggestion("d1")},${suggestion("d2", "notes")}],"ragInfo":{"source":"rag","chunkCount":2}}"""
        routes["POST /api/v1/timeline/ai-suggestions/apply"] = 200 to """{"applied":true,"structured":false}"""
        val vm = suggestionsPanel()

        vm.quickAction(vm.state.value.quickActions.single())
        advanceUntilIdle()

        // The chip asks for suggestions rather than chatting, and both turns are saved.
        assertTrue(sent.none { it.first == "POST /api/v1/chat/stream" })
        val saved = sent.filter { it.first == "POST /api/v1/chat/message" }.map { it.second!!["role"]!!.jsonPrimitive.content }
        assertEquals(listOf("user", "assistant"), saved)
        assertEquals(
            listOf("Get workout suggestions", suggestionsReply(2, null)),
            vm.state.value.items.takeLast(2).map { it.content },
        )
        assertEquals(2, vm.state.value.suggestions.size)

        vm.applySuggestion(vm.state.value.suggestions.first())
        advanceUntilIdle()
        val applied = sent.single { it.first == "POST /api/v1/timeline/ai-suggestions/apply" }.second!!
        assertEquals("d1", applied["workoutId"]!!.jsonPrimitive.content)
        assertEquals("rag", applied["aiSource"]!!.jsonPrimitive.content)
        assertEquals("Builds race pace", applied["rationale"]!!.jsonPrimitive.content)
        assertEquals(
            "Applied suggestion to Tempo run (2026-11-17). The main workout has been updated.",
            vm.state.value.items.last().content,
        )
        assertEquals(1, planChanges)

        vm.dismissSuggestion(vm.state.value.suggestions.single())
        advanceUntilIdle()
        assertTrue(vm.state.value.suggestions.isEmpty())
    }

    @Test
    fun aSuggestionThatCantBeAppliedSaysWhyAndStays() = runTest(dispatcher) {
        routes["POST /api/v1/timeline/ai-suggestions"] = 200 to """{"suggestions":[${suggestion("d1")}]}"""
        routes["POST /api/v1/timeline/ai-suggestions/apply"] = 404 to """{"error":"Plan day not found","code":"NOT_FOUND"}"""
        val vm = suggestionsPanel()
        vm.quickAction(vm.state.value.quickActions.single())
        advanceUntilIdle()

        vm.applySuggestion(vm.state.value.suggestions.single())
        advanceUntilIdle()
        assertEquals(
            "Could not find the workout for Tempo run (2026-11-17). It may have been removed from your plan.",
            vm.state.value.items.last().content,
        )

        routes["POST /api/v1/timeline/ai-suggestions/apply"] = 200 to
            """{"applied":false,"structured":false,"reason":"structured_parse_failed","message":"Couldn't turn that into sets."}"""
        vm.applySuggestion(vm.state.value.suggestions.single())
        advanceUntilIdle()
        assertEquals("Couldn't turn that into sets.", vm.state.value.items.last().content)
        assertEquals(1, vm.state.value.suggestions.size)
        assertEquals(0, planChanges)
    }

    @Test
    fun noSuggestionsGivesTheServersReasonAndAFailureIsNotSaved() = runTest(dispatcher) {
        routes["POST /api/v1/timeline/ai-suggestions"] = 200 to
            """{"suggestions":[],"message":"Your plan has finished. Generate the next one to get suggestions."}"""
        val vm = suggestionsPanel()
        vm.quickAction(vm.state.value.quickActions.single())
        advanceUntilIdle()
        assertEquals("Your plan has finished. Generate the next one to get suggestions.", vm.state.value.items.last().content)

        routes["POST /api/v1/timeline/ai-suggestions"] = 429 to """{"error":"Budget","code":"AI_BUDGET_EXCEEDED"}"""
        vm.quickAction(vm.state.value.quickActions.single())
        advanceUntilIdle()
        assertEquals("You've reached your daily AI usage limit. Please try again later.", vm.state.value.items.last().content)
        // Two asks and one answer saved: the failure is said, not kept.
        assertEquals(3, sent.count { it.first == "POST /api/v1/chat/message" })
        assertFalse(vm.state.value.busy)
    }

    @Test
    fun theBudgetWarningIsSaidOncePerPanel() = runTest(dispatcher) {
        routes["POST /api/v1/chat/stream"] = 200 to stream("""{"text":"Sure."}""", """{"done":true}""")
        routeHeaders["POST /api/v1/chat/stream"] = mapOf("X-AI-Budget-Warning" to "true")
        val vm = viewModel()
        val said = mutableListOf<String>()
        backgroundScope.launch { vm.messages.collect { said += it } }

        vm.send("hi")
        advanceUntilIdle()
        vm.send("and again")
        advanceUntilIdle()

        assertEquals(listOf(BUDGET_WARNING), said)
        assertEquals("Sure.", vm.state.value.items.last().content)
    }

    @Test
    fun theStyleBadgeNamesTheCoachingStyle() {
        assertEquals("MAF Method", trainingStyleLabel("maf_method"))
        assertEquals("Balanced", trainingStyleLabel(null))
        assertEquals("Balanced", trainingStyleLabel("balanced"))
    }
}
