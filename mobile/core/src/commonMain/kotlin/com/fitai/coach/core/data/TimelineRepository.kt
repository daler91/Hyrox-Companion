package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest
import com.fitai.coach.core.api.generated.PlanDayRecoveryPreview
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingOverviewSummary
import com.fitai.coach.core.api.generated.TrainingPlan
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** What to do with a missed plan day (`POST /api/v1/plans/days/{id}/recovery`). */
public sealed interface RecoveryAction {
    /** Fit the session into [targetDate], alongside what is already there. */
    public data class Fold(val targetDate: String) : RecoveryAction

    /** Move a shortened version of it to [targetDate]. */
    public data class Shorten(val targetDate: String) : RecoveryAction

    /** Drop it; the plan carries on. */
    public data object LetGo : RecoveryAction

    /** Undo an earlier fold, shorten or let go, so the day is missed and undecided again. */
    public data object Reopen : RecoveryAction
}

/**
 * The training timeline: planned days and logged workouts, newest first, with
 * the athlete's plans and this week's summary. Screens read the database, so
 * all of it shows offline.
 *
 * Marking a day done or skipped changes the timeline on the device at once
 * and goes to the server through the outbox, so it works offline too; the
 * next refresh after the outbox sends it shows the server's version.
 */
public class TimelineRepository(
    private val db: FitaiDatabase,
    private val api: ApiClient,
    private val sync: SyncEngine,
    private val cache: CacheStore,
) {
    private val dao = db.timeline()

    public val entries: Flow<List<TimelineEntry>> = dao.observeAll().map { rows ->
        rows.mapNotNull { decodeOrNull(TimelineEntry.serializer(), it.json) }
    }

    public val plans: Flow<List<TrainingPlan>?> = cache.observe(PLANS, PLAN_LIST)

    public val weekSummary: Flow<TrainingOverviewSummary?> = cache.observe(SUMMARY, TrainingOverviewSummary.serializer())

    /**
     * Fetches the timeline's first page (every entry from today on, plus the
     * latest past ones) and stores it in the server's order.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun refresh() {
        val entries = api.call(ApiEndpoints.GetTimeline)
        val rows = entries.mapIndexed { index, entry ->
            TimelineEntryEntity(id = entry.id, date = entry.date, position = index, json = encode(TimelineEntry.serializer(), entry))
        }
        db.writeTransaction {
            dao.clear()
            dao.insertAll(rows)
        }
    }

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refreshPlans() {
        cache.put(PLANS, PLAN_LIST, api.call(ApiEndpoints.GetPlans))
    }

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refreshSummary() {
        cache.put(SUMMARY, TrainingOverviewSummary.serializer(), api.call(ApiEndpoints.GetTrainingOverviewSummary))
    }

    /**
     * Logs a planned day as done. The server copies the day's prescribed sets
     * into the new workout and marks the day completed.
     *
     * @return the write's idempotency key.
     */
    public suspend fun markDone(entry: TimelineEntry, rpe: Int? = null, notes: String? = null): String {
        val planDayId = requireNotNull(entry.planDayId) { "${entry.id} is not a plan day" }
        val request = CreateWorkoutRequest(
            date = entry.date,
            focus = entry.focus,
            mainWorkout = entry.mainWorkout,
            accessory = entry.accessory.presentOrAbsent(),
            notes = (notes ?: entry.notes).presentOrAbsent(),
            rpe = rpe?.let { Patch.of(it) } ?: Patch.Absent,
            planDayId = Patch.of(planDayId),
        )
        val key = db.writeTransaction {
            updateLocal(entry.id) { it.copy(status = TimelineEntry.Status.Completed, rpe = rpe ?: it.rpe) }
            sync.enqueue(
                ApiEndpoints.PostWorkouts,
                ApiEndpoints.PostWorkouts.pathTemplate,
                encode(CreateWorkoutRequest.serializer(), request),
            )
        }
        sync.requestSync()
        return key
    }

    /** Skips a planned day, with the athlete's reason when they gave one. */
    public suspend fun skip(entry: TimelineEntry, reason: PatchPlansDaysByDayIdStatusRequest.SkipReason?) {
        setStatus(entry, PatchPlansDaysByDayIdStatusRequest.Status.Skipped, reason)
    }

    /**
     * Puts a day back to planned: undoes a skip, or reopens a completed day
     * (the server deletes the workout that completed it).
     */
    public suspend fun reopen(entry: TimelineEntry) {
        setStatus(entry, PatchPlansDaysByDayIdStatusRequest.Status.Planned, reason = null)
    }

    /** What each way of recovering a missed day would do to the plan. Online only. */
    public suspend fun recoveryPreview(planDayId: String): PlanDayRecoveryPreview =
        api.call(ApiEndpoints.GetPlansDaysByDayIdRecovery, path = ApiEndpoints.GetPlansDaysByDayIdRecovery.path(planDayId))

    /**
     * Applies [action] to a missed day, then refreshes the timeline. Online
     * only: the server works out what the move does to the rest of the plan.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response (404 or 409 when the day changed elsewhere).
     */
    public suspend fun recover(planDayId: String, action: RecoveryAction) {
        val body = buildJsonObject {
            when (action) {
                is RecoveryAction.Fold -> {
                    put("action", JsonPrimitive("fold"))
                    put("targetDate", JsonPrimitive(action.targetDate))
                }
                is RecoveryAction.Shorten -> {
                    put("action", JsonPrimitive("shorten"))
                    put("targetDate", JsonPrimitive(action.targetDate))
                }
                RecoveryAction.LetGo -> put("action", JsonPrimitive("let_go"))
                RecoveryAction.Reopen -> put("action", JsonPrimitive("reopen"))
            }
        }
        // The answer (the moved day) isn't read: the refresh below shows the whole result.
        api.send(
            ApiEndpoints.PostPlansDaysByDayIdRecovery,
            ApiEndpoints.PostPlansDaysByDayIdRecovery.path(planDayId),
            body.toString(),
            idempotencyKey = null,
        )
        refresh()
    }

    private suspend fun setStatus(
        entry: TimelineEntry,
        status: PatchPlansDaysByDayIdStatusRequest.Status,
        reason: PatchPlansDaysByDayIdStatusRequest.SkipReason?,
    ) {
        val planDayId = requireNotNull(entry.planDayId) { "${entry.id} is not a plan day" }
        val request = PatchPlansDaysByDayIdStatusRequest(status = status, skipReason = reason?.let { Patch.of(it) } ?: Patch.Absent)
        db.writeTransaction {
            updateLocal(entry.id) { current ->
                when (status) {
                    PatchPlansDaysByDayIdStatusRequest.Status.Skipped -> current.copy(
                        status = TimelineEntry.Status.Skipped,
                        skipReason = reason?.let { TimelineEntry.SkipReason.entries.firstOrNull { s -> s.wireValue == it.wireValue } },
                    )
                    else -> current.copy(status = TimelineEntry.Status.Planned, skipReason = null, workoutLogId = null)
                }
            }
            sync.enqueue(
                ApiEndpoints.PatchPlansDaysByDayIdStatus,
                ApiEndpoints.PatchPlansDaysByDayIdStatus.path(planDayId),
                encode(PatchPlansDaysByDayIdStatusRequest.serializer(), request),
            )
        }
        sync.requestSync()
    }

    private suspend fun updateLocal(entryId: String, transform: (TimelineEntry) -> TimelineEntry) {
        val row = dao.get(entryId) ?: return
        val entry = decodeOrNull(TimelineEntry.serializer(), row.json) ?: return
        dao.insertAll(listOf(row.copy(json = encode(TimelineEntry.serializer(), transform(entry)))))
    }

    private companion object {
        const val PLANS = "plans"
        const val SUMMARY = "training-summary"
        val PLAN_LIST = ListSerializer(TrainingPlan.serializer())

        fun String?.presentOrAbsent(): Patch<String> = this?.takeIf { it.isNotBlank() }?.let { Patch.of(it) } ?: Patch.Absent
    }
}
