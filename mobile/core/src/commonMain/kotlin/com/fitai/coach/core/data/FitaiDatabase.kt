package com.fitai.coach.core.data

import androidx.room.AutoMigration
import androidx.room.ConstructedBy
import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.RoomDatabaseConstructor
import androidx.room.immediateTransaction
import androidx.room.useWriterConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin

/**
 * The on-device cache and outbox of one signed-in user. Each user has their
 * own file ([UserDatabaseStore]), deleted when they sign out.
 */
@Database(
    entities = [
        TimelineEntryEntity::class,
        WorkoutEntity::class,
        ExerciseSetEntity::class,
        OutboxEntity::class,
        CacheEntryEntity::class,
    ],
    version = 2,
    exportSchema = true,
    // Each version's schema is in core/schemas/. 2 added cache_entries.
    autoMigrations = [AutoMigration(from = 1, to = 2)],
)
@ConstructedBy(FitaiDatabaseConstructor::class)
public abstract class FitaiDatabase : RoomDatabase() {
    public abstract fun timeline(): TimelineDao

    public abstract fun workouts(): WorkoutDao

    public abstract fun outbox(): OutboxDao

    public abstract fun cache(): CacheDao

    // The parent of every query Room runs on this database; see buildConfigured.
    internal var queries: Job? = null
}

/** Room generates the actual implementations of this for each target. */
@Suppress("KotlinNoActualForExpect")
public expect object FitaiDatabaseConstructor : RoomDatabaseConstructor<FitaiDatabase> {
    override fun initialize(): FitaiDatabase
}

/**
 * Builds the database with the driver and query dispatcher every platform
 * uses. Room runs each query as a child of the job in that context, so
 * [closeWhenIdle] can wait for the ones still running.
 */
public fun RoomDatabase.Builder<FitaiDatabase>.buildConfigured(): FitaiDatabase {
    val queries = Job()
    return setDriver(BundledSQLiteDriver())
        .setQueryCoroutineContext(Dispatchers.IO + queries)
        .build()
        .also { it.queries = queries }
}

/**
 * Closes the database once no query is running on it. Room's own close shuts
 * the connections at once, even under a statement another thread is still
 * running (a screen's, say, that was just cancelled), and SQLite then
 * crashes the process. The queries are cancelled first; a statement already
 * in SQLite finishes, and only then do the connections close.
 */
public suspend fun FitaiDatabase.closeWhenIdle() {
    queries?.cancelAndJoin()
    close()
}

/** Runs [block] in one write transaction: its changes land together or not at all. */
public suspend fun <T> FitaiDatabase.writeTransaction(block: suspend () -> T): T =
    useWriterConnection { connection -> connection.immediateTransaction { block() } }
