package com.fitai.coach.core.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
public interface TimelineDao {
    @Query("SELECT * FROM timeline_entries ORDER BY position")
    public fun observeAll(): Flow<List<TimelineEntryEntity>>

    @Query("DELETE FROM timeline_entries")
    public suspend fun clear()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun insertAll(rows: List<TimelineEntryEntity>)
}

@Dao
public interface WorkoutDao {
    @Query("SELECT * FROM workouts WHERE id = :id")
    public fun observe(id: String): Flow<WorkoutEntity?>

    @Query("SELECT * FROM exercise_sets WHERE workoutId = :workoutId ORDER BY position")
    public fun observeSets(workoutId: String): Flow<List<ExerciseSetEntity>>

    @Query("SELECT * FROM exercise_sets WHERE workoutId = :workoutId")
    public suspend fun sets(workoutId: String): List<ExerciseSetEntity>

    @Query("SELECT * FROM exercise_sets WHERE id = :id")
    public suspend fun set(id: String): ExerciseSetEntity?

    @Upsert
    public suspend fun upsert(workout: WorkoutEntity)

    @Upsert
    public suspend fun upsertSets(rows: List<ExerciseSetEntity>)

    @Query("DELETE FROM exercise_sets WHERE id IN (:ids)")
    public suspend fun deleteSets(ids: List<String>)
}

@Dao
public interface OutboxDao {
    @Insert
    public suspend fun insert(entry: OutboxEntity): Long

    @Query("SELECT * FROM outbox ORDER BY seq LIMIT 1")
    public suspend fun head(): OutboxEntity?

    @Query("SELECT * FROM outbox ORDER BY seq")
    public suspend fun all(): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM outbox")
    public fun observeCount(): Flow<Int>

    @Query("SELECT target FROM outbox WHERE target IS NOT NULL")
    public suspend fun pendingTargets(): List<String>

    @Query("SELECT COUNT(*) FROM outbox WHERE target = :target")
    public suspend fun countFor(target: String): Int

    @Query("DELETE FROM outbox WHERE seq = :seq")
    public suspend fun delete(seq: Long)

    @Query("DELETE FROM outbox WHERE target = :target")
    public suspend fun deleteFor(target: String): Int

    @Query("UPDATE outbox SET attempts = :attempts, serverErrors = :serverErrors WHERE seq = :seq")
    public suspend fun updateCounts(seq: Long, attempts: Int, serverErrors: Int)
}
