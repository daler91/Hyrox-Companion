package com.fitai.coach.core.data

import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.auth.AuthException
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

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
}
