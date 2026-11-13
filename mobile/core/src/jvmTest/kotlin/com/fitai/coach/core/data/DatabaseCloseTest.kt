package com.fitai.coach.core.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Closing a user's database while another thread is still inside SQLite
 * (a cancelled screen's query, a sign-out mid-sync) must wait for it: Room
 * closes the connections at once, and SQLite then crashes the process.
 */
class DatabaseCloseTest {
    @Test
    fun closingWaitsForAStatementStillRunning(): Unit = runBlocking {
        val db = testDatabaseStore().open("u1")
        val inside = CompletableDeferred<Unit>()
        val returned = AtomicBoolean(false)
        val query = launch(Dispatchers.Default) {
            db.writeTransaction {
                inside.complete(Unit)
                // A statement SQLite is still running: cancelling can't stop it.
                Thread.sleep(STATEMENT_MS)
                returned.set(true)
            }
        }
        inside.await()

        db.closeWhenIdle()

        assertTrue(returned.get(), "the connections closed under a running statement")
        query.join()
    }

    @Test
    fun aQueryAfterClosingIsCancelledNotRunOnAClosedDatabase(): Unit = runBlocking {
        val db = testDatabaseStore().open("u1")
        db.closeWhenIdle()

        assertFailsWith<kotlinx.coroutines.CancellationException> { db.outbox().all() }
    }
}

private const val STATEMENT_MS = 300L
