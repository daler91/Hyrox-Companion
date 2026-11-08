package com.fitai.coach.core.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/*
 * Cached rows keep the server's JSON as it arrived, plus the few columns the
 * app queries or orders by. Decoding goes through the generated models with
 * ApiJson, which ignores fields it does not know, so a server that adds a
 * field never needs a migration here.
 */

/**
 * A cached API response kept whole: the user's preferences, a plan, a day's
 * nutrition, an analytics summary. [key] names the request (`preferences`,
 * `plan:<id>`); screens read it offline and a refresh replaces it.
 */
@Entity(tableName = "cache_entries")
public data class CacheEntryEntity(
    @PrimaryKey val key: String,
    val json: String,
    val updatedAt: Long,
)

/** One `GET /api/v1/timeline` entry. [position] is its place in the server's order. */
@Entity(tableName = "timeline_entries", indices = [Index("date")])
public data class TimelineEntryEntity(
    @PrimaryKey val id: String,
    val date: String,
    val position: Int,
    val json: String,
)

/** A workout's detail (`GET /api/v1/workouts/{id}`), stored without its sets: those are [ExerciseSetEntity] rows. */
@Entity(tableName = "workouts")
public data class WorkoutEntity(
    @PrimaryKey val id: String,
    val json: String,
)

/**
 * One exercise set of a workout, as the app shows it: edits are applied here
 * at once and sent through the outbox. [version] is the last version the
 * server reported for the set, the `expectedVersion` its next PATCH sends.
 */
@Entity(tableName = "exercise_sets", indices = [Index("workoutId")])
public data class ExerciseSetEntity(
    @PrimaryKey val id: String,
    val workoutId: String,
    val position: Int,
    val version: Long?,
    val json: String,
)

/**
 * A write made on the device, waiting to be sent. Entries are sent one at a
 * time in [seq] order.
 *
 * @property operation the `ApiEndpoints` name of the endpoint, e.g. `PostWorkouts`.
 * @property idempotencyKey sent as `X-Idempotency-Key` on every attempt, so the
 *   server applies the write once however often it is replayed.
 * @property target the record a version-locked write changes (`set:<id>`): a
 *   409 drops every entry queued for it.
 * @property parentId the record whose cache is refetched when the server
 *   refuses the write for good (the workout of a set).
 * @property attempts definitive rejections so far (4xx other than a conflict).
 * @property serverErrors plain 500s so far.
 */
@Entity(tableName = "outbox", indices = [Index("target")])
public data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,
    val operation: String,
    val path: String,
    val body: String?,
    val idempotencyKey: String,
    val target: String?,
    val parentId: String?,
    val createdAt: Long,
    val attempts: Int = 0,
    val serverErrors: Int = 0,
)
