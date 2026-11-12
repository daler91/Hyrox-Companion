package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.GetTimelineQuery
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStatusRequest
import com.fitai.coach.core.api.generated.PlanDayRecoveryPreview
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingOverviewSummary
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.api.generated.UpdateWorkoutRequest
import com.fitai.coach.core.dates.weekdayName
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    private val older = MutableStateFlow<String?>(null)

    /**
     * Where older history starts: the `before` cursor of the next page to
     * load, or null when everything is on the device (or nothing has loaded yet).
     */
    public val olderCursor: StateFlow<String?> = older.asStateFlow()

    init {
        // A day whose move or edit the server refused for good shows the server's version again.
        sync.handle(ApiEndpoints.PatchPlansDaysByDayId, RefreshOnRejection())
    }

    public val entries: Flow<List<TimelineEntry>> = dao.observeAll().map { rows ->
        rows.mapNotNull { decodeOrNull(TimelineEntry.serializer(), it.json) }
    }

    public val plans: Flow<List<TrainingPlan>?> = cache.observe(PLANS, PLAN_LIST)

    public val weekSummary: Flow<TrainingOverviewSummary?> = cache.observe(SUMMARY, TrainingOverviewSummary.serializer())

    /**
     * Fetches the timeline's first page (every entry from today on, plus the
     * latest past ones) and stores it in the server's order. Older pages
     * already loaded stay: pages never split a date, so the first page
     * replaces exactly the dates it covers.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun refresh() {
        val response = api.callWithHeaders(ApiEndpoints.GetTimeline)
        val cursor = response.headers[NEXT_CURSOR]
        db.writeTransaction {
            if (cursor == null) dao.clear() else dao.clearDates(from = cursor, before = null)
            dao.insertAll(response.body.toRows(firstPosition = 0))
        }
        older.value = cursor?.let { minOf(it, dao.oldestDate() ?: it) }
    }

    /**
     * Loads the next page of older history ("Load older workouts").
     *
     * @return the entries it added; none when the history was already all here.
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun loadOlder(): List<TimelineEntry> {
        val before = older.value ?: return emptyList()
        val response = api.callWithHeaders(ApiEndpoints.GetTimeline, query = GetTimelineQuery(before = before).toQueryParameters())
        val next = response.headers[NEXT_CURSOR]
        db.writeTransaction {
            if (next == null) dao.clearBefore(before) else dao.clearDates(from = next, before = before)
            dao.insertAll(response.body.toRows(firstPosition = (dao.lastPosition() ?: -1) + 1))
        }
        older.value = next
        return response.body
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

    /**
     * Moves a session to [newDate] (the card's "Move to…"). A logged workout
     * changes its date; a planned day its scheduled date. It shows at once
     * and goes through the outbox, so it works offline. [today] decides
     * whether a missed day moved forward is planned again.
     */
    public suspend fun move(entry: TimelineEntry, newDate: String, today: String) {
        if (entry.date == newDate) return
        val workoutLogId = entry.workoutLogId
        val planDayId = entry.planDayId
        require(workoutLogId != null || planDayId != null) { "${entry.id} has no plan day or workout to move" }
        db.writeTransaction {
            updateLocal(entry.id) { it.movedTo(newDate, today) }
            if (workoutLogId != null) {
                val body = encode(UpdateWorkoutRequest.serializer(), UpdateWorkoutRequest(date = newDate))
                // The workout's detail moves with it.
                db.workouts().get(workoutLogId)?.let { row -> db.workouts().upsert(row.copy(json = mergePatch(row.json, body))) }
                sync.enqueue(
                    ApiEndpoints.PatchWorkoutsById,
                    ApiEndpoints.PatchWorkoutsById.path(workoutLogId),
                    body,
                    target = workoutTarget(workoutLogId),
                )
            } else {
                val request = PatchPlansDaysByDayIdRequest(scheduledDate = Patch.of(newDate))
                sync.enqueue(
                    ApiEndpoints.PatchPlansDaysByDayId,
                    ApiEndpoints.PatchPlansDaysByDayId.path(checkNotNull(planDayId)),
                    encode(PatchPlansDaysByDayIdRequest.serializer(), request),
                )
            }
        }
        sync.requestSync()
    }

    /**
     * Changes a plan day's own fields: its title, text or priority. It shows
     * at once and goes through the outbox, so it works offline; a change the
     * server refuses for good shows its version again.
     */
    public suspend fun editPlanDay(entry: TimelineEntry, edit: PatchPlansDaysByDayIdRequest) {
        val planDayId = requireNotNull(entry.planDayId) { "${entry.id} is not a plan day" }
        db.writeTransaction {
            updateLocal(entry.id) { it.edited(edit) }
            sync.enqueue(
                ApiEndpoints.PatchPlansDaysByDayId,
                ApiEndpoints.PatchPlansDaysByDayId.path(planDayId),
                encode(PatchPlansDaysByDayIdRequest.serializer(), edit),
            )
        }
        sync.requestSync()
    }

    /**
     * Removes a plan day from its plan (a skipped session's Delete). Online:
     * the server keeps it in the recycle bin.
     *
     * @return the recycle-bin item that [restore] puts back.
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun deletePlanDay(planDayId: String): String {
        val response = api.call(ApiEndpoints.DeletePlansDaysByDayId, path = ApiEndpoints.DeletePlansDaysByDayId.path(planDayId))
        db.writeTransaction { removeLocal { it.planDayId == planDayId } }
        return response.recycleBinItemId
    }

    /** Takes a deleted workout off the timeline here, for older pages a refresh doesn't reach. */
    public suspend fun forgetWorkout(workoutLogId: String) {
        db.writeTransaction { removeLocal { it.workoutLogId == workoutLogId && it.planDayId == null } }
    }

    /**
     * Puts a deleted workout, plan day or plan back from the recycle bin
     * (an Undo), then refreshes the timeline.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun restore(recycleBinItemId: String) {
        api.call(ApiEndpoints.PostRecycleBinByIdRestore, path = ApiEndpoints.PostRecycleBinByIdRestore.path(recycleBinItemId))
        refresh()
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
        val entry = decodeOrNull(TimelineEntry.serializer(), row.json)?.let(transform) ?: return
        dao.insertAll(listOf(row.copy(date = entry.date, json = encode(TimelineEntry.serializer(), entry))))
    }

    private suspend fun removeLocal(matches: (TimelineEntry) -> Boolean) {
        val gone = dao.all().filter { row -> decodeOrNull(TimelineEntry.serializer(), row.json)?.let(matches) == true }
        if (gone.isNotEmpty()) dao.delete(gone.map { it.id })
    }

    private inner class RefreshOnRejection : OutboxHandler {
        override suspend fun onRejected(entry: OutboxEntity) {
            refresh()
        }
    }

    private companion object {
        const val NEXT_CURSOR = "x-next-cursor"
        const val PLANS = "plans"
        const val SUMMARY = "training-summary"
        val PLAN_LIST = ListSerializer(TrainingPlan.serializer())

        fun String?.presentOrAbsent(): Patch<String> = this?.takeIf { it.isNotBlank() }?.let { Patch.of(it) } ?: Patch.Absent

        fun List<TimelineEntry>.toRows(firstPosition: Int) = mapIndexed { index, entry ->
            TimelineEntryEntity(
                id = entry.id,
                date = entry.date,
                position = firstPosition + index,
                json = encode(TimelineEntry.serializer(), entry),
            )
        }
    }
}

/** The entry with a plan-day edit applied: what was sent changes, what wasn't stays. */
internal fun TimelineEntry.edited(edit: PatchPlansDaysByDayIdRequest): TimelineEntry = copy(
    focus = edit.focus ?: focus,
    mainWorkout = edit.mainWorkout ?: mainWorkout,
    accessory = edit.accessory.applyTo(accessory),
    notes = edit.notes.applyTo(notes),
    expectedDurationMin = edit.expectedDurationMin.applyTo(expectedDurationMin),
    expectedRpe = edit.expectedRpe.applyTo(expectedRpe),
    plannedTimeOfDayMin = edit.plannedTimeOfDayMin.applyTo(plannedTimeOfDayMin),
    priority = (edit.priority as? Patch.Value)?.value
        ?.let { sent -> TimelineEntry.Priority.entries.firstOrNull { it.wireValue == sent.wireValue } }
        ?: priority,
)

private fun <T : Any> Patch<T>.applyTo(current: T?): T? = when (this) {
    is Patch.Value -> value
    Patch.Absent -> current
}

/**
 * The entry as it reads once moved to [newDate] (useMoveTimelineEntry's
 * movedEntry): its weekday goes with it, and a missed plan day moved to
 * [today] or later is planned again, remembering the day it was missed, as
 * the server records it.
 */
internal fun TimelineEntry.movedTo(newDate: String, today: String): TimelineEntry {
    val moved = copy(date = newDate, dayName = dayName?.let { weekdayName(newDate) })
    if (status != TimelineEntry.Status.Missed || planDayId == null || newDate < today) return moved
    return moved.copy(status = TimelineEntry.Status.Planned, recovery = TimelineEntry.Recovery.Folded, missedOn = date, recoverable = null)
}
