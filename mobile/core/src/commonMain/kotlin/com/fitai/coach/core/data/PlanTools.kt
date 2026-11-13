package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PatchPlansByIdGoalRequest
import com.fitai.coach.core.api.generated.PatchPlansByIdRequest
import com.fitai.coach.core.api.generated.PatchPlansByIdRetirementRequest
import com.fitai.coach.core.api.generated.PostPlansByPlanIdScheduleRequest

/**
 * What the athlete can do to a whole plan (PlanToolsMenu.tsx): rename it, set
 * its goal, schedule it from a new start date, archive or restore it, and
 * delete it (to the recycle bin, so it can come back). All online; each
 * refreshes the plans, and the timeline when the plan's days change.
 */
public class PlanTools(private val api: ApiClient, private val timeline: TimelineRepository) {
    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun rename(planId: String, name: String) {
        api.call(
            ApiEndpoints.PatchPlansById,
            PatchPlansByIdRequest(name = name.trim().take(MAX_NAME)),
            ApiEndpoints.PatchPlansById.path(planId),
        )
        timeline.refreshPlans()
    }

    /** Sets what the plan trains towards; null clears it. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun setGoal(planId: String, goal: String?) {
        val text = goal?.trim()?.take(MAX_GOAL)?.ifEmpty { null }
        api.call(ApiEndpoints.PatchPlansByIdGoal, PatchPlansByIdGoalRequest(goal = text), ApiEndpoints.PatchPlansByIdGoal.path(planId))
        timeline.refreshPlans()
    }

    /**
     * Lays the plan's sessions out from [startDate]; none lands before it.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response (its message says what to change).
     */
    public suspend fun schedule(planId: String, startDate: String) {
        api.call(
            ApiEndpoints.PostPlansByPlanIdSchedule,
            PostPlansByPlanIdScheduleRequest(startDate = startDate),
            ApiEndpoints.PostPlansByPlanIdSchedule.path(planId),
        )
        refreshAll()
    }

    /**
     * Archives the plan from [retiredOn] (the server holds it to the athlete's
     * own date), or restores it with null. Its remaining sessions leave or
     * rejoin adherence, so the timeline refreshes.
     *
     * @throws com.fitai.coach.core.api.ApiException 409 PLAN_OVERLAP when a
     *   restore would put two live plans over the same days.
     */
    public suspend fun setRetirement(planId: String, retiredOn: String?) {
        api.call(
            ApiEndpoints.PatchPlansByIdRetirement,
            PatchPlansByIdRetirementRequest(retiredOn = retiredOn),
            ApiEndpoints.PatchPlansByIdRetirement.path(planId),
        )
        refreshAll()
    }

    /**
     * Deletes the plan and its days to the recycle bin.
     *
     * @return the recycle-bin item that [restore] puts back.
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun delete(planId: String): String {
        val response = api.call(ApiEndpoints.DeletePlansById, path = ApiEndpoints.DeletePlansById.path(planId))
        refreshAll()
        return response.recycleBinItemId
    }

    /** Brings a deleted plan back, days and all (the Undo). @throws com.fitai.coach.core.api.ApiException */
    public suspend fun restore(recycleBinItemId: String) {
        timeline.restore(recycleBinItemId)
        timeline.refreshPlans()
    }

    private suspend fun refreshAll() {
        timeline.refreshPlans()
        timeline.refresh()
    }

    public companion object {
        /** The longest plan name the server takes. */
        public const val MAX_NAME: Int = 255

        /** The longest goal the server takes. */
        public const val MAX_GOAL: Int = 500
    }
}
