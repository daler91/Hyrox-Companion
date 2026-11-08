package com.fitai.coach.ui.privacy

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiConfig
import com.fitai.coach.core.api.AppIdentity
import com.fitai.coach.core.api.createHttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockEngineConfig
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull

@OptIn(ExperimentalCoroutinesApi::class)
class PrivacyNoticeViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val posted = mutableListOf<String>()

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(consents: String = "[]", failPosts: Boolean = false, failGet: Boolean = false): PrivacyNoticeViewModel {
        // On the test dispatcher, so advanceUntilIdle() also runs the request.
        val config = MockEngineConfig()
        config.dispatcher = dispatcher
        config.addHandler { request: HttpRequestData ->
            when {
                request.method == HttpMethod.Get && failGet -> respondError(HttpStatusCode.ServiceUnavailable)
                request.method == HttpMethod.Get -> respond("""{"consents":$consents}""", HttpStatusCode.OK, json)
                failPosts -> respondError(HttpStatusCode.InternalServerError)
                else -> {
                    posted += (request.body as TextContent).text
                    respond("""{"success":true}""", HttpStatusCode.OK, json)
                }
            }
        }
        val engine = MockEngine(config)
        val api = ApiClient(createHttpClient(engine, ApiConfig("https://api.test", AppIdentity("android", "1.0.0"))) { "jwt" })
        return PrivacyNoticeViewModel(api)
    }

    @Test
    fun showsTheNoticeWhenItWasNeverAcknowledged() = runTest(dispatcher) {
        val vm = viewModel(consents = "[]")
        advanceUntilIdle()

        assertIs<PrivacyNoticeState.Needed>(vm.state.value)
    }

    @Test
    fun skipsTheNoticeOnceTheServerHasItsAcknowledgement() = runTest(dispatcher) {
        val vm = viewModel(
            consents = """[{"consentType":"privacy_notice","granted":true,"consentedAt":"2026-11-01T10:00:00.000Z"}]""",
        )
        advanceUntilIdle()

        assertEquals(PrivacyNoticeState.Acknowledged, vm.state.value)
    }

    @Test
    fun doesNotBlockTheAppWhenTheCheckFails() = runTest(dispatcher) {
        val vm = viewModel(failGet = true)
        advanceUntilIdle()

        assertEquals(PrivacyNoticeState.Acknowledged, vm.state.value)
    }

    @Test
    fun acceptRecordsTheAnalyticsChoiceAndTheNotice() = runTest(dispatcher) {
        val vm = viewModel()
        advanceUntilIdle()

        vm.acknowledge(errorReporting = true)
        advanceUntilIdle()

        assertEquals(
            listOf(
                """{"consentType":"error_reporting","granted":true}""",
                """{"consentType":"privacy_notice","granted":true}""",
            ),
            posted,
        )
        assertEquals(PrivacyNoticeState.Acknowledged, vm.state.value)
    }

    @Test
    fun declineRecordsErrorReportingAsNotGranted() = runTest(dispatcher) {
        val vm = viewModel()
        advanceUntilIdle()

        vm.acknowledge(errorReporting = false)
        advanceUntilIdle()

        assertEquals("""{"consentType":"error_reporting","granted":false}""", posted.first())
    }

    @Test
    fun keepsTheNoticeWithAnErrorWhenSavingFails() = runTest(dispatcher) {
        val vm = viewModel(failPosts = true)
        advanceUntilIdle()

        vm.acknowledge(errorReporting = true)
        advanceUntilIdle()

        val state = assertIs<PrivacyNoticeState.Needed>(vm.state.value)
        assertNotNull(state.error)
    }
}
