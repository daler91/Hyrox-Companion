package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PostWorkoutsBulkDeleteRequest
import com.fitai.coach.core.api.generated.PostWorkoutsCombineRequest
import com.fitai.coach.core.api.generated.TimelineEntry

/** Most workouts and plan days one bulk delete takes (MAX_BULK_DELETE_TARGETS). */
public const val MAX_BULK_DELETE: Int = 100

/** What a bulk delete took away, and the batch one Undo puts back. */
public data class BulkDeleteResult(val deletedCount: Int, val batchId: String)

/** What a bulk delete sends for some timeline entries (buildBulkDeleteWorkoutTargets). */
public data class BulkDeleteTargets(val workoutLogIds: List<String>, val planDayIds: List<String>) {
    val size: Int get() = workoutLogIds.size + planDayIds.size
}

/**
 * A logged entry deletes its workout, as a single delete does: a completed
 * plan day goes back to planned, or missed, instead of leaving the workout
 * behind unplanned. Only an entry with no workout deletes its plan day.
 */
public fun bulkDeleteTargets(entries: Collection<TimelineEntry>): BulkDeleteTargets {
    val logs = linkedSetOf<String>()
    val days = linkedSetOf<String>()
    entries.forEach { entry ->
        val log = entry.workoutLogId
        val day = entry.planDayId
        if (log != null) {
            logs += log
        } else if (day != null) {
            days += day
        }
    }
    return BulkDeleteTargets(logs.toList(), days.toList())
}

/** A workout being combined: its id, and the plan day it completed, if any. */
public data class CombineSource(val workoutLogId: String, val planDayId: String? = null)

/** The workout two or more are combined into; the sources' sets move onto it. */
public data class CombinedWorkout(
    val date: String,
    val focus: String,
    val mainWorkout: String,
    val duration: Int? = null,
    val calories: Int? = null,
    val notes: String? = null,
)

/**
 * Changes to several workouts at once: deleting a selection with one undo,
 * and combining workouts into one. Online; the timeline and the workouts kept
 * on the device follow each answer.
 */
public class WorkoutBatchRepository(
    private val db: FitaiDatabase,
    private val api: ApiClient,
    private val timeline: TimelineRepository,
) {
    private val workouts = db.workouts()

    /**
     * Deletes [entries] together, all or nothing: they go to the recycle bin
     * as one batch, which [restoreBatch] puts back.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun deleteAll(entries: Collection<TimelineEntry>): BulkDeleteResult {
        val targets = bulkDeleteTargets(entries)
        val response = api.call(
            ApiEndpoints.PostWorkoutsBulkDelete,
            PostWorkoutsBulkDeleteRequest(
                workoutLogIds = targets.workoutLogIds.ifEmpty { null },
                planDayIds = targets.planDayIds.ifEmpty { null },
            ),
        )
        forgetWorkouts(response.deletedWorkoutLogIds)
        timeline.forgetDeleted(response.deletedWorkoutLogIds, response.deletedPlanDayIds)
        return BulkDeleteResult(response.deletedCount.toInt(), response.batchId)
    }

    /**
     * Puts back everything one bulk delete removed (its Undo), then refreshes
     * the timeline.
     *
     * @return what couldn't be put back exactly, to tell the athlete.
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun restoreBatch(batchId: String): List<String> {
        val response = api.call(
            ApiEndpoints.PostRecycleBinBatchesByBatchIdRestore,
            path = ApiEndpoints.PostRecycleBinBatchesByBatchIdRestore.path(batchId),
        )
        timeline.refresh()
        return response.warnings
    }

    /**
     * Combines [sources] into [workout]: their sets move onto it and they are
     * deleted. The first source that completed a plan day hands that day to
     * the combined workout, so it stays completed; any other plan day is
     * skipped.
     *
     * @return the combined workout's id.
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun combine(sources: List<CombineSource>, workout: CombinedWorkout): String {
        val keptPlanDayId = sources.firstNotNullOfOrNull { it.planDayId }
        val skipped = sources.mapNotNull { it.planDayId }.filter { it != keptPlanDayId }.distinct()
        val created = api.call(
            ApiEndpoints.PostWorkoutsCombine,
            PostWorkoutsCombineRequest(
                newWorkout = PostWorkoutsCombineRequest.NewWorkout(
                    date = workout.date,
                    focus = workout.focus,
                    mainWorkout = workout.mainWorkout,
                    notes = workout.notes?.let { Patch.of(it) } ?: Patch.Absent,
                    duration = workout.duration?.let { Patch.of(it) } ?: Patch.Absent,
                    calories = workout.calories?.let { Patch.of(it) } ?: Patch.Absent,
                    planDayId = keptPlanDayId?.let { Patch.of(it) } ?: Patch.Absent,
                ),
                deleteWorkoutIds = sources.map { it.workoutLogId },
                skipPlanDayIds = skipped.ifEmpty { null },
            ),
        )
        val gone = sources.map { it.workoutLogId }
        forgetWorkouts(gone)
        timeline.forgetDeleted(gone, emptyList())
        return created.id
    }

    private suspend fun forgetWorkouts(ids: List<String>) {
        db.writeTransaction {
            ids.forEach { id ->
                workouts.deleteSetsOf(id)
                workouts.delete(id)
            }
        }
    }
}
