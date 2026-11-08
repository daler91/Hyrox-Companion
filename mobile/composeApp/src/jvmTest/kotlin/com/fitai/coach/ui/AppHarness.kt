package com.fitai.coach.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.runDesktopComposeUiTest
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiConfig
import com.fitai.coach.core.api.AppIdentity
import com.fitai.coach.core.api.createHttpClient
import com.fitai.coach.core.auth.AuthException
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.data.JvmUserDatabaseStore
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.health.HealthSync
import com.fitai.coach.core.health.HealthSyncScheduler
import com.fitai.coach.core.health.HealthSyncStore
import com.fitai.coach.core.push.PushPreference
import com.fitai.coach.core.push.PushRegistration
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import java.nio.file.Files
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/** Auth without Clerk: the email code "123456" signs in as [userId]. */
class FakeAuth(initial: AuthState, private val userId: String = "u1") : AuthGateway {
    override val state = MutableStateFlow(initial)
    val codesSentTo = CopyOnWriteArrayList<String>()

    override suspend fun sendEmailCode(email: String) {
        codesSentTo += email
    }

    override suspend fun verifyEmailCode(code: String) {
        if (code != "123456") throw AuthException("That code isn't right")
        state.value = AuthState.SignedIn(userId)
    }

    override suspend fun signInWithGoogle(): Unit = throw AuthException("Google sign-in isn't available in tests")

    override suspend fun signOut() {
        state.value = AuthState.SignedOut
    }
}

/** The server, faked: answers by method and path; 404 for anything else. Records every request. */
class FakeApi {
    data class Sent(val method: String, val path: String, val body: String?)

    val requests = CopyOnWriteArrayList<Sent>()
    private val routes = ConcurrentHashMap<String, Pair<Int, String>>()

    fun on(method: String, path: String, body: String = "{}", status: Int = 200) {
        routes["$method $path"] = status to body
    }

    fun sent(method: String, path: String): List<Sent> = requests.filter { it.method == method && it.path == path }

    val client: ApiClient = ApiClient(
        createHttpClient(
            MockEngine { request ->
                val sent = Sent(request.method.value, request.url.encodedPath, (request.body as? TextContent)?.text)
                requests += sent
                val (status, body) = routes["${sent.method} ${sent.path}"] ?: (404 to """{"error":"Not found","code":"NOT_FOUND"}""")
                respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, "application/json"))
            },
            ApiConfig("https://api.test", AppIdentity("android", "1.0")),
        ) { "test-token" },
    )

    /** The athlete already read the privacy notice. */
    fun privacyAcknowledged() = on(
        "GET",
        "/api/v1/consents",
        """{"consents":[{"consentType":"privacy_notice","granted":true,"consentedAt":"2026-11-01T00:00:00Z"}]}""",
    )

    fun preferences(onboarded: Boolean, weightUnit: String = "kg") = on(
        "GET",
        "/api/v1/preferences",
        """{"userTimezone":"UTC","onboardingCompleted":$onboarded,"weightUnit":"$weightUnit","distanceUnit":"km"}""",
    )

    /** An athlete who finished setup, with [timeline] entries (JSON objects) and one plan. */
    fun establishedAccount(vararg timeline: String) {
        privacyAcknowledged()
        preferences(onboarded = true)
        on("GET", "/api/v1/timeline", timeline.joinToString(",", "[", "]"))
        on("GET", "/api/v1/plans", """[{"id":"p1","userId":"u1","name":"Hyrox block","totalWeeks":8,"generationStatus":"ready"}]""")
    }

    companion object {
        val today: String get() = LocalDate.now(ZoneOffset.UTC).toString()

        fun plannedToday(focus: String) = listOf(
            """"id":"plan-d1","date":"$today","type":"planned","status":"planned"""",
            """"focus":"$focus","mainWorkout":"6 x 800 m","planDayId":"d1"""",
        ).joinToString(",", "{", "}")
    }
}

private class MemoryPush : PushPreference {
    override var enabledFor: String? = null
}

private class MemoryHealth : HealthSyncStore {
    override var enabledFor: String? = null

    override fun token(userId: String): String? = null

    override fun saveToken(userId: String, token: String?) = Unit
}

private object NoScheduler : HealthSyncScheduler {
    override fun schedule() = Unit

    override fun cancel() = Unit

    override fun syncNow() = Unit
}

/**
 * The app's dependencies as FitaiApplication wires them on Android, around a
 * fake auth gateway and server and a real SessionManager over a temporary
 * SQLite directory.
 */
class AppHarness(val auth: FakeAuth, val api: FakeApi) : AutoCloseable, ViewModelStoreOwner {
    private val directory = Files.createTempDirectory("fitai-ui").toFile()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val sessions = SessionManager(auth, JvmUserDatabaseStore(directory), api.client)
    val koin = startKoin {
        modules(
            module {
                single<AuthGateway> { auth }
                single { api.client }
                single { sessions }
                single { PushRegistration(api.client, null, MemoryPush()) }
                single { HealthSync(api.client, null, MemoryHealth()) }
                single<HealthSyncScheduler> { NoScheduler }
            },
            uiModule,
        )
    }.koin

    // Its own view models, so none (keyed by user) carry over from another test.
    override val viewModelStore = ViewModelStore()

    init {
        sessions.start(scope)
    }

    inline fun <reified T : Any> get(): T = koin.get()

    /**
     * After the UI is gone: stops the view models, then closes and deletes
     * the database before its directory, so nothing still reads it.
     */
    override fun close() {
        viewModelStore.clear()
        runBlocking { sessions.signOut() }
        scope.cancel()
        stopKoin()
        directory.deleteRecursively()
    }
}

/** Runs [block] against the whole app, rendered over a fresh [AppHarness] in a [width] x [height] px window. */
@OptIn(ExperimentalTestApi::class)
fun appTest(
    auth: FakeAuth,
    api: FakeApi,
    width: Int = 1024,
    height: Int = 768,
    block: suspend ComposeUiTest.(AppHarness) -> Unit,
) = AppHarness(auth, api).use { app ->
    runDesktopComposeUiTest(width, height) {
        setContent { CompositionLocalProvider(LocalViewModelStoreOwner provides app) { App() } }
        block(app)
    }
}

/** Waits (in real time: the server and database run on other threads) until a node matches. */
@OptIn(ExperimentalTestApi::class)
fun ComposeUiTest.awaitNode(matcher: SemanticsMatcher, timeoutMillis: Long = 10_000) =
    waitUntil(timeoutMillis = timeoutMillis) { onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
