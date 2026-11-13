package com.fitai.coach.core.data

import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.auth.AuthException
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds

private class FakeAuth : AuthGateway {
    override val state = MutableStateFlow<AuthState>(AuthState.Loading)
    var failSignOut = false

    override suspend fun sendEmailCode(email: String) = Unit

    override suspend fun verifyEmailCode(code: String) = Unit

    override suspend fun signInWithGoogle() = Unit

    override suspend fun signOut() {
        if (failSignOut) throw AuthException("offline", null)
        state.value = AuthState.SignedOut
    }
}

class SessionManagerTest {
    private val auth = FakeAuth()
    private val store = testDatabaseStore()
    private val server = FakeServer().apply {
        on("GET", "/api/v1/timeline", 200, "[]")
        // Writes stay queued: the server never answers them.
        on("POST", "/api/v1/workouts") { Reply.NoAnswer }
    }

    private fun TestScope.manager() = SessionManager(auth, store, server.api).also { it.start(backgroundScope) }

    private suspend fun StateFlow<UserSession?>.awaitUser(userId: String): UserSession = first { it?.userId == userId }!!

    private suspend fun signIn(manager: SessionManager, userId: String): UserSession {
        auth.state.value = AuthState.SignedIn(userId)
        return manager.session.awaitUser(userId).also { it.sync.sync() }
    }

    private suspend fun UserSession.queueAWrite() {
        workouts.createWorkout(CreateWorkoutRequest(date = "2026-11-02", focus = "Run", mainWorkout = "5 km"))
    }

    @Test
    fun signingInOpensTheUsersOwnDatabase() = runTest {
        val manager = manager()

        signIn(manager, "user_a")

        assertTrue(store.exists("user_a"))
    }

    @Test
    fun signingOutDeletesTheUsersDatabaseUnsentWritesIncluded() = runTest {
        val manager = manager()
        signIn(manager, "user_a").queueAWrite()

        manager.signOut()

        assertNull(manager.session.value)
        assertFalse(store.exists("user_a"))
    }

    @Test
    fun aSignOutThatFailsDeletesNothing() = runTest {
        val manager = manager()
        signIn(manager, "user_a")
        auth.failSignOut = true

        assertFailsWith<AuthException> { manager.signOut() }

        assertTrue(store.exists("user_a"))
        assertEquals("user_a", manager.session.value?.userId)
    }

    @Test
    fun aDeletedAccountsDatabaseGoesEvenWhenSignOutFails() = runTest {
        val manager = manager()
        signIn(manager, "user_a").queueAWrite()
        auth.failSignOut = true

        manager.forgetDeletedAccount()

        assertFalse(store.exists("user_a"))
        assertNull(manager.session.value)
    }

    @Test
    fun aLostSessionKeepsTheUnsentWritesForTheSameUser() = runTest {
        val manager = manager()
        signIn(manager, "user_a").queueAWrite()

        auth.state.value = AuthState.SignedOut
        manager.session.first { it == null }
        val again = signIn(manager, "user_a")

        assertEquals(1, again.database.outbox().all().size)
    }

    @Test
    fun anotherUserSigningInDeletesTheDatabaseLeftBehindUnsent() = runTest {
        val manager = manager()
        signIn(manager, "user_a").queueAWrite()
        auth.state.value = AuthState.SignedOut
        manager.session.first { it == null }
        val leftBehind = server.sentTo("POST", "/api/v1/workouts").size

        val other = signIn(manager, "user_b")
        other.sync.sync()

        assertFalse(store.exists("user_a"))
        assertTrue(other.database.outbox().all().isEmpty())
        assertEquals(leftBehind, server.sentTo("POST", "/api/v1/workouts").size)
    }

    @Test
    fun comingBackToTheAppChecksTheTimezoneOnlyWhileTheSessionIsOpen() = runTest {
        // The server keeps a zone that is never the phone's, so every check sends one.
        val stale = """{"userTimezone":"Pacific/Kiritimati","onboardingCompleted":true}"""
        server.on("GET", PREFERENCES, 200, stale)
        server.on("PATCH", PREFERENCES, 200, stale)
        val manager = manager()
        val session = signIn(manager, "user_a")
        awaitPatches(1) // The session start's.

        session.resumed()
        awaitPatches(2)

        // Closed, its database is gone: a late resume touches nothing.
        manager.signOut()
        session.resumed()
        testScheduler.advanceUntilIdle()
        assertEquals(2, server.sentTo("PATCH", PREFERENCES).size)
    }

    private suspend fun awaitPatches(count: Int) = withContext(Dispatchers.Default) {
        withTimeout(10.seconds) {
            while (server.sentTo("PATCH", PREFERENCES).size < count) delay(10)
        }
    }
}

private const val PREFERENCES = "/api/v1/preferences"
