package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryQuery
import com.fitai.coach.core.api.generated.GetExercisesByExerciseNameHistoryResponseItem
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdSetsRequest
import com.fitai.coach.core.api.generated.SessionGrade
import com.fitai.coach.core.api.generated.UpdateWorkoutRequest
import com.fitai.coach.core.api.generated.WorkoutLogDetail
import com.fitai.coach.core.api.generated.WorkoutLogWithSets
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.serialization.json.JsonPrimitive

/**
 * Logged workouts and their exercise sets. Edits apply to the database at
 * once, so the screen shows them offline, and go to the server through the
 * outbox.
 *
 * Set edits carry the optimistic lock (client/src/lib/exerciseSetVersionLock.ts):
 * each PATCH sends the version the server last reported for the set as
 * `expectedVersion`. The outbox sends one write at a time, so a second edit
 * to the same set waits for the first answer and sends the version that
 * answer reported. A 409 means another device changed the set first: the
 * edits queued for it are dropped and the server's row is fetched, never
 * written over.
 */
/** What became of a logged workout. */
public sealed interface LogResult {
    /** The server has it; [workout] is its answer, when that decodes. */
    public data class Saved(val workout: WorkoutLogWithSets?) : LogResult

    /** No answer: it waits in the outbox and is sent when the network is back. */
    public data object Queued : LogResult
}

public class WorkoutRepository(
    private val db: FitaiDatabase,
    private val api: ApiClient,
    private val sync: SyncEngine,
    private val newKey: () -> String,
) {
    private val dao = db.workouts()
    private val outbox = db.outbox()

    init {
        sync.handle(ApiEndpoints.PatchWorkoutsByIdSetsBySetId, SetPatchHandler())
        sync.handle(ApiEndpoints.PatchWorkoutsById, WorkoutPatchHandler())
    }

    /** The workout with its sets as the device has them, or null until it is fetched. */
    public fun workout(id: String): Flow<WorkoutLogDetail?> = combine(dao.observe(id), dao.observeSets(id)) { workout, sets ->
        workout?.let { decodeOrNull(WorkoutLogDetail.serializer(), it.json) }
            ?.copy(exerciseSets = sets.mapNotNull { it.toRow() })
    }

    /**
     * Fetches the workout and its sets. A set with an edit still waiting in the
     * outbox keeps the device's version of it, and the version that edit was
     * made against: taking the server's newer version would let the edit
     * overwrite whatever changed it.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun refresh(id: String) {
        val detail = api.call(ApiEndpoints.GetWorkoutsById, path = ApiEndpoints.GetWorkoutsById.path(id))
        db.writeTransaction {
            val pending = outbox.pendingTargets().toSet()
            val stale = dao.sets(id).filter { setTarget(it.id) !in pending }.map { it.id }
            dao.deleteSets(stale)
            // An edit to the workout's own fields still queued keeps the device's version.
            if (workoutTarget(id) !in pending) {
                dao.upsert(
                    WorkoutEntity(id = detail.id, json = encode(WorkoutLogDetail.serializer(), detail.copy(exerciseSets = emptyList()))),
                )
            }
            dao.upsertSets(
                detail.exerciseSets.mapIndexedNotNull { index, set ->
                    if (setTarget(set.id) in pending) null else set.toEntity(workoutId = id, position = index)
                },
            )
        }
    }

    /**
     * Changes a set: at once on the device, then on the server. The patch's
     * `expectedVersion` is ignored; the outbox fills it in when it sends.
     */
    public suspend fun updateSet(workoutId: String, setId: String, patch: PatchWorkoutsByIdSetsBySetIdRequest) {
        val body = encode(PatchWorkoutsByIdSetsBySetIdRequest.serializer(), patch.copy(expectedVersion = null))
        db.writeTransaction {
            dao.set(setId)?.let { row -> dao.upsertSets(listOf(row.copy(json = mergePatch(row.json, body)))) }
            sync.enqueue(
                ApiEndpoints.PatchWorkoutsByIdSetsBySetId,
                path = ApiEndpoints.PatchWorkoutsByIdSetsBySetId.path(setId = setId, id = workoutId),
                body = body,
                target = setTarget(setId),
                parentId = workoutId,
            )
        }
        sync.requestSync()
    }

    /**
     * Changes the workout's own fields (title, effort, duration, notes…): at
     * once on the device, then on the server through the outbox, so it works
     * offline. The timeline catches up after the write is sent.
     */
    public suspend fun updateWorkout(id: String, patch: UpdateWorkoutRequest) {
        val body = encode(UpdateWorkoutRequest.serializer(), patch)
        db.writeTransaction {
            dao.get(id)?.let { row -> dao.upsert(row.copy(json = mergePatch(row.json, body))) }
            sync.enqueue(
                ApiEndpoints.PatchWorkoutsById,
                path = ApiEndpoints.PatchWorkoutsById.path(id),
                body = body,
                target = workoutTarget(id),
            )
        }
        sync.requestSync()
    }

    /**
     * Deletes the workout. Online: the server keeps it in the recycle bin for
     * 90 days and answers with the item that [restore] puts back.
     *
     * @return the recycle-bin item id, for undo.
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun deleteWorkout(id: String): String {
        val response = api.call(ApiEndpoints.DeleteWorkoutsById, path = ApiEndpoints.DeleteWorkoutsById.path(id))
        db.writeTransaction {
            dao.deleteSetsOf(id)
            dao.delete(id)
        }
        return response.recycleBinItemId
    }

    /**
     * Puts a deleted workout, plan day or plan back from the recycle bin.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun restore(recycleBinItemId: String) {
        api.call(ApiEndpoints.PostRecycleBinByIdRestore, path = ApiEndpoints.PostRecycleBinByIdRestore.path(recycleBinItemId))
    }

    /**
     * Appends a set (online: the server gives it its id). It shows at once
     * once the server answers.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun addSet(workoutId: String, request: PostWorkoutsByIdSetsRequest): ExerciseSetRow {
        val row = api.call(ApiEndpoints.PostWorkoutsByIdSets, request, ApiEndpoints.PostWorkoutsByIdSets.path(workoutId))
        db.writeTransaction {
            val position = (dao.sets(workoutId).maxOfOrNull { it.position } ?: -1) + 1
            dao.upsertSets(listOf(row.toEntity(workoutId = workoutId, position = position)))
        }
        return row
    }

    /**
     * Removes a set (online, like adding one). One the server no longer has
     * is gone already, so it is removed here too; edits to it still queued
     * are dropped.
     *
     * @throws com.fitai.coach.core.api.ApiException on any other error response.
     */
    public suspend fun deleteSet(workoutId: String, setId: String) {
        try {
            api.call(
                ApiEndpoints.DeleteWorkoutsByIdSetsBySetId,
                path = ApiEndpoints.DeleteWorkoutsByIdSetsBySetId.path(setId = setId, id = workoutId),
            )
        } catch (e: ApiException) {
            if (e.status != NOT_FOUND) throw e
        }
        db.writeTransaction {
            outbox.deleteFor(setTarget(setId))
            dao.deleteSets(listOf(setId))
        }
    }

    /**
     * The athlete's recent logged sets of one exercise, newest session first,
     * for the "last time" and "next target" rows. Online only.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun exerciseHistory(
        exerciseName: String,
        sessions: Int = HISTORY_SESSIONS,
    ): List<GetExercisesByExerciseNameHistoryResponseItem> =
        api.call(
            ApiEndpoints.GetExercisesByExerciseNameHistory,
            path = ApiEndpoints.GetExercisesByExerciseNameHistory.path(exerciseName),
            query = GetExercisesByExerciseNameHistoryQuery(sessions = sessions).toQueryParameters(),
        )

    /**
     * Whether the session did its job, for a plan-linked run; null when it
     * isn't graded. Online only.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun sessionGrade(workoutId: String): SessionGrade? =
        api.call(ApiEndpoints.GetWorkoutsByIdSessionGrade, path = ApiEndpoints.GetWorkoutsByIdSessionGrade.path(workoutId)).grade

    /**
     * Logs a workout. It is sent through the outbox, under an idempotency key,
     * so a replay after a lost answer can't log it twice; the timeline shows
     * it once the server has it.
     *
     * @return the write's idempotency key.
     */
    public suspend fun createWorkout(request: CreateWorkoutRequest): String {
        val key = db.writeTransaction {
            sync.enqueue(
                ApiEndpoints.PostWorkouts,
                path = ApiEndpoints.PostWorkouts.pathTemplate,
                body = encode(CreateWorkoutRequest.serializer(), request),
            )
        }
        sync.requestSync()
        return key
    }

    /**
     * Logs a workout the way the web's runWithOfflineFallback does: the
     * request goes out at once, so the server's validation answers while the
     * athlete is still on the screen; only when it gets no answer (offline, a
     * timeout) is it queued, under the same idempotency key, so a request that
     * did reach the server isn't applied twice.
     *
     * @throws com.fitai.coach.core.api.ApiException when the server refuses it.
     */
    public suspend fun logWorkout(request: CreateWorkoutRequest): LogResult {
        val key = newKey()
        return try {
            val body = encode(CreateWorkoutRequest.serializer(), request)
            val response = api.send(ApiEndpoints.PostWorkouts, ApiEndpoints.PostWorkouts.pathTemplate, body, idempotencyKey = key)
            // Saved even if the answer doesn't decode: queueing it would log it twice.
            LogResult.Saved(decodeOrNull(WorkoutLogWithSets.serializer(), response))
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            throw e
        } catch (@Suppress("TooGenericExceptionCaught") _: Exception) {
            db.writeTransaction {
                sync.enqueueWithKey(
                    ApiEndpoints.PostWorkouts,
                    ApiEndpoints.PostWorkouts.pathTemplate,
                    encode(CreateWorkoutRequest.serializer(), request),
                    key,
                )
            }
            sync.requestSync()
            LogResult.Queued
        }
    }

    private inner class SetPatchHandler : OutboxHandler {
        override suspend fun prepareBody(entry: OutboxEntity): String? {
            val version = entry.target?.let { dao.set(setIdOf(it)) }?.version ?: return entry.body
            return withField(entry.body, EXPECTED_VERSION, JsonPrimitive(version))
        }

        override suspend fun onSent(entry: OutboxEntity, response: String) {
            val row = decodeOrNull(ExerciseSetRow.serializer(), response) ?: return
            val local = dao.set(row.id) ?: return
            // Another edit to this set is still queued: keep showing it, but
            // take the version, which that edit must now send.
            val stillEditing = outbox.countFor(setTarget(row.id)) > 0
            val updated = if (stillEditing) {
                local.copy(version = row.version)
            } else {
                local.copy(version = row.version, json = encode(ExerciseSetRow.serializer(), row))
            }
            dao.upsertSets(listOf(updated))
        }

        override suspend fun onRejected(entry: OutboxEntity) {
            entry.parentId?.let { refresh(it) }
        }
    }

    /** A refused edit to the workout's own fields: show the server's version again. */
    private inner class WorkoutPatchHandler : OutboxHandler {
        override suspend fun onRejected(entry: OutboxEntity) {
            entry.target?.let { refresh(it.removePrefix(WORKOUT_TARGET_PREFIX)) }
        }
    }

    private companion object {
        const val EXPECTED_VERSION = "expectedVersion"
        const val SET_TARGET_PREFIX = "set:"
        const val WORKOUT_TARGET_PREFIX = "workout:"
        const val NOT_FOUND = 404

        /** Three sessions: the last one, the one before it (for the missed-twice deload) and this one. */
        const val HISTORY_SESSIONS = 3

        fun workoutTarget(workoutId: String): String = WORKOUT_TARGET_PREFIX + workoutId

        fun setTarget(setId: String): String = SET_TARGET_PREFIX + setId

        fun setIdOf(target: String): String = target.removePrefix(SET_TARGET_PREFIX)

        fun ExerciseSetRow.toEntity(workoutId: String, position: Int) = ExerciseSetEntity(
            id = id,
            workoutId = workoutId,
            position = position,
            version = version,
            json = encode(ExerciseSetRow.serializer(), this),
        )

        fun ExerciseSetEntity.toRow(): ExerciseSetRow? =
            decodeOrNull(ExerciseSetRow.serializer(), json)?.let { row -> version?.let { row.copy(version = it) } ?: row }
    }
}
