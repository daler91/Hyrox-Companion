package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetPlansByIdGenerationStatusResponse.GenerationStatus
import com.fitai.coach.core.api.generated.PostPlansByPlanIdScheduleRequest
import com.fitai.coach.core.api.generated.PostPlansGenerateRequest
import com.fitai.coach.core.api.generated.PostPlansSampleRequest
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource

/** How a watched AI plan generation ended (usePlanGeneration.ts). */
public sealed interface GenerationOutcome {
    public data object Ready : GenerationOutcome

    /** The server gave up on the plan; [error] is its client-safe reason, when it gave one. */
    public data class Failed(val error: String?) : GenerationOutcome

    /** Still not settled after [MAX_GENERATION_WAIT]: it may yet appear in the plan list. */
    public data object TimedOut : GenerationOutcome

    /** Status reads kept failing for [MAX_STATUS_OUTAGE]. */
    public data object Unreachable : GenerationOutcome
}

/** How often a generating plan's status is read. */
public val STATUS_POLL_INTERVAL: Duration = 3.seconds

/**
 * How long one generation is watched. Plans take 1–2 minutes, but a job a
 * worker crash stranded never settles (the server fails it after an hour).
 */
public val MAX_GENERATION_WAIT: Duration = 20.minutes

/** How long status reads may keep failing before the watch ends. */
public val MAX_STATUS_OUTAGE: Duration = 30.seconds

/**
 * First-run setup: whether to show it, the athlete's first plan (the 8-week
 * template or an AI plan) and marking it done, as the web's
 * useOnboarding, useOnboardingWizard and usePlanGeneration do.
 */
@Suppress("TooGenericExceptionCaught")
public class OnboardingRepository(
    private val api: ApiClient,
    private val cache: CacheStore,
    private val preferences: PreferencesRepository,
    private val timeline: TimelineRepository,
) {
    /**
     * Whether setup should open by itself: only for an athlete the server says
     * has not finished it, with no plan and nothing on the timeline. Every
     * answer must come from the server; one that fails (offline) means no, so
     * a returning athlete is never shown it on a guess. A completion this
     * device recorded but could not send is sent now instead.
     *
     * @throws com.fitai.coach.core.api.ApiException when the server can't be read.
     */
    public suspend fun shouldStart(): Boolean {
        val prefs = preferences.refresh()
        val doneHereOnly = !prefs.onboardingCompleted && cache.get(LOCAL_DONE, Boolean.serializer()) == true
        if (doneHereOnly) preferences.update(UpdateUserPreferences(onboardingCompleted = true))
        if (prefs.onboardingCompleted || doneHereOnly) return false
        timeline.refreshPlans()
        timeline.refresh()
        return timeline.plans.first().isNullOrEmpty() && timeline.entries.first().isEmpty()
    }

    /**
     * Marks setup done: on this device at once, so it never reopens here, and
     * on the server when it can be reached ([shouldStart] retries it).
     */
    public suspend fun complete() {
        cache.put(LOCAL_DONE, Boolean.serializer(), true)
        try {
            preferences.update(UpdateUserPreferences(onboardingCompleted = true))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Kept locally; shouldStart sends it next time.
        }
    }

    /** Creates the 8-week template plan, unscheduled, and returns its id. */
    public suspend fun createTemplatePlan(goal: String, raceDate: String?): String {
        val body = ApiJson.encodeToString(PostPlansSampleRequest.serializer(), PostPlansSampleRequest(goal = goal, raceDate = raceDate))
        return planId(api.send(ApiEndpoints.PostPlansSample, ApiEndpoints.PostPlansSample.pathTemplate, body, idempotencyKey = null))
    }

    /** Places a plan's days on the calendar from [startDate], then refreshes the timeline. */
    public suspend fun schedule(planId: String, startDate: String) {
        val body = ApiJson.encodeToString(PostPlansByPlanIdScheduleRequest.serializer(), PostPlansByPlanIdScheduleRequest(startDate))
        api.send(ApiEndpoints.PostPlansByPlanIdSchedule, ApiEndpoints.PostPlansByPlanIdSchedule.path(planId), body, idempotencyKey = null)
        refreshAfterNewPlan()
    }

    /** Best effort: a template whose schedule failed, abandoned for another way out. */
    public suspend fun discard(planId: String) {
        try {
            api.send(ApiEndpoints.DeletePlansById, ApiEndpoints.DeletePlansById.path(planId), null, idempotencyKey = null)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // It stays in the plan list, where it can be deleted.
        }
    }

    /** Starts an AI plan generation and returns the plan's id; watch it with [awaitGeneration]. */
    public suspend fun generate(request: PostPlansGenerateRequest): String {
        val body = ApiJson.encodeToString(PostPlansGenerateRequest.serializer(), request)
        return planId(api.send(ApiEndpoints.PostPlansGenerate, ApiEndpoints.PostPlansGenerate.pathTemplate, body, idempotencyKey = null))
    }

    /**
     * Reads the plan's generation status every [STATUS_POLL_INTERVAL] until
     * the server settles it or the watch is given up on, then, when ready,
     * refreshes the plans and the timeline.
     */
    public suspend fun awaitGeneration(planId: String, time: TimeSource = TimeSource.Monotonic): GenerationOutcome {
        val started = time.markNow()
        var lastGoodRead = started
        var outcome: GenerationOutcome? = null
        while (outcome == null) {
            val status = try {
                api.call(ApiEndpoints.GetPlansByIdGenerationStatus, path = ApiEndpoints.GetPlansByIdGenerationStatus.path(planId))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            if (status != null) lastGoodRead = time.markNow()
            outcome = when {
                status?.generationStatus == GenerationStatus.Ready -> GenerationOutcome.Ready
                status?.generationStatus == GenerationStatus.Failed -> GenerationOutcome.Failed(status.error)
                status == null && lastGoodRead.elapsedNow() >= MAX_STATUS_OUTAGE -> GenerationOutcome.Unreachable
                started.elapsedNow() >= MAX_GENERATION_WAIT -> GenerationOutcome.TimedOut
                else -> null
            }
            if (outcome == null) delay(STATUS_POLL_INTERVAL)
        }
        if (outcome == GenerationOutcome.Ready) refreshAfterNewPlan()
        return outcome
    }

    private suspend fun refreshAfterNewPlan() {
        try {
            timeline.refreshPlans()
            timeline.refresh()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The plan exists; the next refresh shows it.
        }
    }

    private fun planId(response: String): String = ApiJson.parseToJsonElement(response).jsonObject.getValue("id").jsonPrimitive.content

    private companion object {
        const val LOCAL_DONE = "onboarding-done"
    }
}
