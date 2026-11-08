package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.WorkoutLogDetail
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
public class WorkoutRepository(
    private val db: FitaiDatabase,
    private val api: ApiClient,
    private val sync: SyncEngine,
) {
    private val dao = db.workouts()
    private val outbox = db.outbox()

    init {
        sync.handle(ApiEndpoints.PatchWorkoutsByIdSetsBySetId, SetPatchHandler())
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
            dao.upsert(WorkoutEntity(id = detail.id, json = encode(WorkoutLogDetail.serializer(), detail.copy(exerciseSets = emptyList()))))
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

    private companion object {
        const val EXPECTED_VERSION = "expectedVersion"
        const val SET_TARGET_PREFIX = "set:"

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
