package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.time.Clock
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * Opens the signed-in user's [UserSession] and closes it when they go.
 *
 * - At sign-in, the user's own database opens, and any other user's database
 *   left on the device is deleted first: one athlete's queued writes can never
 *   be sent under another athlete's account.
 * - [signOut] deletes the user's database along with signing them out.
 * - A session that ends without [signOut] (the server refused the token)
 *   closes the database but keeps it, so the same user signing back in still
 *   has their unsent writes.
 */
public class SessionManager(
    private val auth: AuthGateway,
    private val databases: UserDatabaseStore,
    private val api: ApiClient,
    private val online: Flow<Boolean> = flowOf(true),
    private val now: () -> Long = { Clock.System.now().toEpochMilliseconds() },
    private val newKey: () -> String = ::newIdempotencyKey,
) {
    private val lock = Mutex()
    private val current = MutableStateFlow<UserSession?>(null)

    /** The signed-in user's session, or null while nobody is signed in. */
    public val session: StateFlow<UserSession?> = current.asStateFlow()

    /** Follows the auth state until [scope] is cancelled; sessions run in [scope]. */
    public fun start(scope: CoroutineScope): Job = scope.launch {
        auth.state.collect { state ->
            when (state) {
                is AuthState.SignedIn -> open(state.userId, scope)
                AuthState.SignedOut -> lock.withLock { closeLocked() }
                AuthState.Loading -> Unit
            }
        }
    }

    /**
     * Signs out and deletes the user's data from the device, unsent writes
     * included. If signing out fails, nothing is deleted.
     */
    public suspend fun signOut() {
        val userId = (auth.state.value as? AuthState.SignedIn)?.userId ?: current.value?.userId
        auth.signOut()
        lock.withLock {
            closeLocked()
            userId?.let { withContext(Dispatchers.IO) { databases.delete(it) } }
        }
    }

    /** Asks the open session to send its queued writes now (the app came to the foreground). */
    public fun syncNow() {
        current.value?.sync?.requestSync()
    }

    private suspend fun open(userId: String, scope: CoroutineScope) = lock.withLock {
        if (current.value?.userId == userId) return@withLock
        closeLocked()
        val database = withContext(Dispatchers.IO) {
            databases.deleteOthers(userId)
            databases.open(userId)
        }
        val session = UserSession(userId, database, api, now, newKey)
        session.start(scope, online)
        current.value = session
    }

    private suspend fun closeLocked() {
        val session = current.value ?: return
        current.value = null
        session.close()
    }
}

/** A random idempotency key (a v4 UUID), like the web's `crypto.randomUUID()`. */
@OptIn(ExperimentalUuidApi::class)
public fun newIdempotencyKey(): String = Uuid.random().toString()
