package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiEndpoint
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.ApiEndpoints
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** What a repository does around the outbox entries it queues for one operation. */
public interface OutboxHandler {
    /** The body to send for [entry]: what was stored, plus anything known only at send time. */
    public suspend fun prepareBody(entry: OutboxEntity): String? = entry.body

    /** The server accepted [entry], which has left the outbox. Runs in a write transaction. */
    public suspend fun onSent(entry: OutboxEntity, response: String) {
        // Nothing by default: a write whose answer changes nothing in the cache.
    }

    /** The server refused [entry] for good (a conflict, or out of retries): restore the server's state. */
    public suspend fun onRejected(entry: OutboxEntity) {
        // Nothing by default: a write with no cached state to restore.
    }
}

/** Why a write was dropped from the outbox without the server taking it. */
public enum class DropReason {
    /** Refused 5 times, or answered with a plain 500 20 times. */
    MaxRetries,

    /** Queued more than 7 days ago. */
    MaxAge,

    /** Its endpoint is no longer in this build's API catalogue. */
    UnknownOperation,
}

/** What the outbox did, for the UI to announce. */
public sealed interface SyncEvent {
    /** A run sent [count] writes; cached reads may be out of date. */
    public data class Synced(val count: Int) : SyncEvent

    /** Another device changed [target] first: the queued edits to it were dropped and the server's version restored. */
    public data class Conflict(val target: String) : SyncEvent

    /** A write was given up on. */
    public data class Dropped(val operation: String, val reason: DropReason) : SyncEvent
}

/** The outcome of one [SyncEngine.sync] run. */
public data class SyncResult(val sent: Int, val dropped: Int, val conflicts: Int, val halted: Boolean)

/**
 * Sends the writes made on the device, in the order they were made.
 *
 * Repositories apply a change to the database and queue it with [enqueue] in
 * one transaction, then call [requestSync]. A run sends the oldest entry, and
 * the next only once that one is through, so writes reach the server in order.
 * The rules follow the web's offline queue (client/src/lib/offlineQueue.ts):
 *
 * - No answer (offline, a timeout), a 401, 408, 426, 429 or a 5xx other than
 *   500 stops the run with the entry kept as it was: they say nothing about
 *   the write. [start] retries with a growing delay, and at once when the
 *   network comes back.
 * - A plain 500 stops the run and counts towards [MAX_SERVER_ERRORS]; any
 *   other 4xx stops it and counts towards [MAX_ATTEMPTS]. An entry over either
 *   budget, or older than [MAX_AGE_MS], is dropped, and the run moves on.
 * - A 409 on a version-locked write (one with a [OutboxEntity.target]) is
 *   another device's edit: that entry and every edit queued behind it for the
 *   same record are dropped, never resent over the other device's write
 *   (client/src/lib/exerciseSetVersionLock.ts), and the handler restores the
 *   server's row.
 *
 * Every entry carries an idempotency key, sent on each attempt, so a write the
 * server committed before its answer was lost is not applied twice.
 */
public class SyncEngine(
    private val db: FitaiDatabase,
    private val api: ApiClient,
    private val now: () -> Long,
    private val newKey: () -> String,
) {
    private val outbox = db.outbox()
    private val handlers = mutableMapOf<String, OutboxHandler>()
    private val runLock = Mutex()
    private val triggers = Channel<Unit>(Channel.CONFLATED)
    private val resetBackoff = MutableStateFlow(false)
    private val syncEvents = MutableSharedFlow<SyncEvent>(extraBufferCapacity = EVENT_BUFFER)

    public val events: SharedFlow<SyncEvent> = syncEvents.asSharedFlow()

    /** How many writes are waiting to be sent. */
    public val pendingCount: Flow<Int> = outbox.observeCount()

    /** Registers what happens around [endpoint]'s writes. Call before [start]. */
    public fun handle(endpoint: ApiEndpoint<*, *>, handler: OutboxHandler) {
        handlers[operationName(endpoint)] = handler
    }

    /**
     * Queues a write to [endpoint]. Call it inside the transaction that makes
     * the change locally, and [requestSync] once that has committed.
     *
     * @return the write's idempotency key.
     */
    public suspend fun enqueue(
        endpoint: ApiEndpoint<*, *>,
        path: String,
        body: String?,
        target: String? = null,
        parentId: String? = null,
    ): String {
        val key = newKey()
        outbox.insert(entry(endpoint, path, body, key).copy(target = target, parentId = parentId))
        return key
    }

    /**
     * Queues a create under an idempotency key it was already sent with once:
     * a live request that got no answer is queued under its own key, so the
     * server applies it once whether or not the first attempt landed.
     */
    public suspend fun enqueueWithKey(endpoint: ApiEndpoint<*, *>, path: String, body: String?, key: String): String {
        outbox.insert(entry(endpoint, path, body, key))
        return key
    }

    private fun entry(endpoint: ApiEndpoint<*, *>, path: String, body: String?, key: String) = OutboxEntity(
        operation = operationName(endpoint),
        path = path,
        body = body,
        idempotencyKey = key,
        target = null,
        parentId = null,
        createdAt = now(),
    )

    /** Asks the running engine ([start]) for a run soon. */
    public fun requestSync() {
        triggers.trySend(Unit)
    }

    /** Sends what is queued now. Concurrent calls run one after another. */
    public suspend fun sync(): SyncResult = runLock.withLock { drain() }

    /**
     * Runs [sync] whenever one is requested, while [online] says there is a
     * network, until [scope] is cancelled. After a run that stopped on a
     * failure it tries again after [retryDelay].
     */
    public fun start(scope: CoroutineScope, online: Flow<Boolean> = flowOf(true)): Job = scope.launch {
        val connected = online.stateIn(this, SharingStarted.Eagerly, true)
        launch {
            // A new connection: send now, and start the backoff again from the base.
            connected.drop(1).filter { it }.collect {
                resetBackoff.value = true
                requestSync()
            }
        }
        val backoff = Backoff(this)
        requestSync()
        for (ignored in triggers) {
            if (resetBackoff.getAndUpdate { false }) backoff.reset()
            if (connected.value) backoff.after(sync())
        }
    }

    /** Schedules the retry after a run that stopped on a failure, waiting longer each time in a row. */
    private inner class Backoff(private val scope: CoroutineScope) {
        private var failedRuns = 0
        private var retry: Job? = null

        fun reset() {
            failedRuns = 0
            retry?.cancel()
        }

        fun after(result: SyncResult) {
            if (!result.halted) return reset()
            if (retry?.isActive != true) {
                val wait = retryDelay(failedRuns)
                retry = scope.launch {
                    delay(wait)
                    requestSync()
                }
            }
            failedRuns++
        }
    }

    private suspend fun drain(): SyncResult {
        var sent = 0
        var dropped = 0
        var conflicts = 0
        var halted = false
        while (!halted) {
            val entry = outbox.head() ?: break
            when (replay(entry)) {
                Outcome.Sent -> sent++
                Outcome.Dropped -> dropped++
                Outcome.Conflict -> conflicts++
                Outcome.Halted -> halted = true
            }
        }
        if (sent > 0) syncEvents.tryEmit(SyncEvent.Synced(sent))
        return SyncResult(sent = sent, dropped = dropped, conflicts = conflicts, halted = halted)
    }

    private suspend fun replay(entry: OutboxEntity): Outcome {
        val endpoint = ApiEndpoints.all[entry.operation]
        val dropReason = dropReasonFor(entry, endpoint, now())
        return if (endpoint == null || dropReason != null) {
            giveUp(entry, SyncEvent.Dropped(entry.operation, dropReason ?: DropReason.UnknownOperation))
            Outcome.Dropped
        } else {
            send(entry, endpoint)
        }
    }

    // Any other exception is a failure with no answer: Ktor and its engines
    // throw several unrelated types for offline, DNS and timeouts.
    @Suppress("TooGenericExceptionCaught")
    private suspend fun send(entry: OutboxEntity, endpoint: ApiEndpoint<*, *>): Outcome {
        val handler = handlers[entry.operation]
        return try {
            val body = if (handler != null) handler.prepareBody(entry) else entry.body
            val response = api.send(endpoint, entry.path, body, entry.idempotencyKey)
            // Removed before the handler runs, so a handler that fails can't have
            // the write sent again; the cache is then only stale until a refresh.
            outbox.delete(entry.seq)
            if (handler != null) whileCatching { db.writeTransaction { handler.onSent(entry, response) } }
            Outcome.Sent
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            rejected(entry, e)
        } catch (_: Exception) {
            Outcome.Halted
        }
    }

    private suspend fun rejected(entry: OutboxEntity, error: ApiException): Outcome {
        val retryable = error.code in RETRYABLE_CODES
        return when {
            retryable -> Outcome.Halted
            error.status == CONFLICT && entry.target != null -> {
                giveUp(entry, SyncEvent.Conflict(entry.target))
                Outcome.Conflict
            }
            isDefinitiveRejection(error.status) -> {
                outbox.updateCounts(entry.seq, entry.attempts + 1, entry.serverErrors)
                Outcome.Halted
            }
            error.status == SERVER_ERROR -> {
                outbox.updateCounts(entry.seq, entry.attempts, entry.serverErrors + 1)
                Outcome.Halted
            }
            else -> Outcome.Halted
        }
    }

    /**
     * Removes a write the server will never take (after a conflict, every
     * write queued for the same record) and has its handler restore the
     * server's state.
     */
    private suspend fun giveUp(entry: OutboxEntity, event: SyncEvent) {
        if (event is SyncEvent.Conflict) outbox.deleteFor(event.target) else outbox.delete(entry.seq)
        handlers[entry.operation]?.let { handler -> whileCatching { handler.onRejected(entry) } }
        syncEvents.tryEmit(event)
    }

    private enum class Outcome { Sent, Dropped, Conflict, Halted }

    public companion object {
        /** Definitive rejections an entry may get before it is dropped. */
        public const val MAX_ATTEMPTS: Int = 5

        /** Plain 500s an entry may get before it is dropped: about an hour of backed-off retries. */
        public const val MAX_SERVER_ERRORS: Int = 20

        /** How long a write may wait. The server keeps idempotency keys at least this long. */
        public const val MAX_AGE_MS: Long = 7L * 24 * 60 * 60 * 1000

        private const val RETRY_BASE_DELAY_MS = 5_000L
        private const val RETRY_MAX_DELAY_MS = 5L * 60 * 1000
        private const val EVENT_BUFFER = 64

        /** The wait before the next try after [failedRuns] runs in a row stopped on a failure: 5 s, doubling, up to 5 minutes. */
        public fun retryDelay(failedRuns: Int): Long {
            var delayMs = RETRY_BASE_DELAY_MS
            repeat(failedRuns) {
                delayMs = (delayMs * 2).coerceAtMost(RETRY_MAX_DELAY_MS)
            }
            return delayMs
        }
    }
}

private const val CONFLICT = 409
private const val SERVER_ERROR = 500
private const val CLIENT_ERRORS_END = 500
private const val CLIENT_ERRORS_START = 400

/** 4xx answers that say nothing about the write itself. */
private val NOT_ABOUT_THE_WRITE = setOf(401, 408, 426, 429)

/** Error codes that mean "try again shortly" whatever their status (server/middleware/idempotency.ts). */
private val RETRYABLE_CODES = setOf("IDEMPOTENT_REQUEST_IN_PROGRESS")

/** A client error retrying won't change. */
private fun isDefinitiveRejection(status: Int): Boolean =
    status in CLIENT_ERRORS_START until CLIENT_ERRORS_END && status !in NOT_ABOUT_THE_WRITE

/** Why [entry] should be dropped before sending, or null to send it. */
private fun dropReasonFor(entry: OutboxEntity, endpoint: ApiEndpoint<*, *>?, now: Long): DropReason? = when {
    endpoint == null -> DropReason.UnknownOperation
    now - entry.createdAt > SyncEngine.MAX_AGE_MS -> DropReason.MaxAge
    entry.attempts >= SyncEngine.MAX_ATTEMPTS || entry.serverErrors >= SyncEngine.MAX_SERVER_ERRORS -> DropReason.MaxRetries
    else -> null
}

// A handler only refreshes or rewrites the cache. Its failure (offline for a
// refetch, a row that no longer decodes) must not stop the writes queued
// behind; the next refresh puts the cache right.
@Suppress("TooGenericExceptionCaught", "SwallowedException")
private suspend fun whileCatching(block: suspend () -> Unit) {
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        // Deliberately ignored; see above.
    }
}

private val operationNames: Map<ApiEndpoint<*, *>, String> by lazy {
    ApiEndpoints.all.entries.associate { (name, endpoint) -> endpoint to name }
}

/**
 * The name the outbox stores for [endpoint]: its key in `ApiEndpoints.all`,
 * which, unlike a class name, survives R8 renaming between app versions.
 */
internal fun operationName(endpoint: ApiEndpoint<*, *>): String =
    requireNotNull(operationNames[endpoint]) { "$endpoint is not in ApiEndpoints.all" }
