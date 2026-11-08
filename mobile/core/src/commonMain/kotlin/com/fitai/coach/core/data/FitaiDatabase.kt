package com.fitai.coach.core.data

import androidx.room.ConstructedBy
import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.RoomDatabaseConstructor
import androidx.room.immediateTransaction
import androidx.room.useWriterConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.IO

/**
 * The on-device cache and outbox of one signed-in user. Each user has their
 * own file ([UserDatabaseStore]), deleted when they sign out.
 */
@Database(
    entities = [TimelineEntryEntity::class, WorkoutEntity::class, ExerciseSetEntity::class, OutboxEntity::class],
    version = 1,
    exportSchema = true,
)
@ConstructedBy(FitaiDatabaseConstructor::class)
public abstract class FitaiDatabase : RoomDatabase() {
    public abstract fun timeline(): TimelineDao

    public abstract fun workouts(): WorkoutDao

    public abstract fun outbox(): OutboxDao
}

/** Room generates the actual implementations of this for each target. */
@Suppress("KotlinNoActualForExpect")
public expect object FitaiDatabaseConstructor : RoomDatabaseConstructor<FitaiDatabase> {
    override fun initialize(): FitaiDatabase
}

/** The driver and query dispatcher every platform builds the database with. */
public fun RoomDatabase.Builder<FitaiDatabase>.configured(): RoomDatabase.Builder<FitaiDatabase> =
    setDriver(BundledSQLiteDriver()).setQueryCoroutineContext(Dispatchers.IO)

/** Runs [block] in one write transaction: its changes land together or not at all. */
public suspend fun <T> FitaiDatabase.writeTransaction(block: suspend () -> T): T =
    useWriterConnection { connection -> connection.immediateTransaction { block() } }
