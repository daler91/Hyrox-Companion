package com.fitai.coach.core.plans

import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.core.js.jsRound
import kotlin.math.ceil

/*
 * Where an athlete is inside a training block, ported from
 * shared/planPhase.ts: the week they are on and the periodisation phase that
 * puts them in, for "Week 6 of 12 · Build". The server feeds the same
 * functions into the coach's prompts, so the card and the coach agree.
 * Pinned by the `planPhase.*` golden fixtures; see docs/mobile-shared-logic.md.
 */

/** `TrainingPhase` (shared/nutritionTargets.ts): a periodisation phase, with the string the API uses for it. */
public enum class TrainingPhase(public val wireValue: String) {
    Early("early"),
    Build("build"),
    Peak("peak"),
    Taper("taper"),
    RaceWeek("race_week"),
}

/** `PLAN_PHASE_ORDER`: the phases in the order an athlete passes through them. */
public val PLAN_PHASE_ORDER: List<TrainingPhase> =
    listOf(TrainingPhase.Early, TrainingPhase.Build, TrainingPhase.Peak, TrainingPhase.Taper, TrainingPhase.RaceWeek)

/** `PlanPhase`: a week placed inside its block. */
public data class PlanPhase(
    val currentWeek: Int,
    val totalWeeks: Int,
    val phaseLabel: TrainingPhase,
    /** Progress through the block at the midpoint of [currentWeek], 0–100, rounded as `Math.round`. */
    val progressPct: Int,
    /** The phases after [phaseLabel], in order. */
    val remainingPhases: List<TrainingPhase>,
)

/**
 * `computeCurrentWeek`: which week of the block [today] falls in, 1-based.
 *
 * A plan that has not started yet, or has no start date (null or ""), reads
 * as week 1. Deliberately not clamped to [totalWeeks]: a block that ended
 * reports a week past its last, which [computePlanPhase] turns into null.
 * [totalWeeks] is not read; it stays to keep the TypeScript's signature.
 * Null (TS: NaN) when a non-empty [planStartDate], or [today], does not
 * parse.
 *
 * [today] is required where the TS defaults it to the UTC date: pass the
 * device's local calendar date as `YYYY-MM-DD`, as the web passes the
 * browser's (see "Whose today?" in docs/mobile-shared-logic.md). This
 * function never reads a clock.
 */
public fun computeCurrentWeek(planStartDate: String?, totalWeeks: Int, today: String): Int? {
    if (planStartDate.isNullOrEmpty()) return 1
    val days = dayDiff(planStartDate, today) ?: return null
    return maxOf(1, ceil((days + 1) / 7.0).toInt())
}

/**
 * `computePlanPhase`: the phase [currentWeek] puts a block of [totalWeeks] in,
 * or null (TS: undefined) for a week outside 1..[totalWeeks] or a block of no
 * weeks.
 *
 * Progress is measured at the midpoint of the week. The final week is always
 * race week, and in a block of 4 or more weeks the week before it is always
 * taper; otherwise taper from 85%, peak from 60%, build from 25%, else early.
 */
public fun computePlanPhase(totalWeeks: Int, currentWeek: Int): PlanPhase? {
    if (totalWeeks <= 0 || currentWeek <= 0) return null
    if (currentWeek > totalWeeks) return null
    val progressPct = jsRound(((currentWeek - 0.5) / totalWeeks) * 100).toInt()
    val phaseLabel = when {
        currentWeek >= totalWeeks -> TrainingPhase.RaceWeek
        totalWeeks >= 4 && currentWeek == totalWeeks - 1 -> TrainingPhase.Taper
        progressPct >= 85 -> TrainingPhase.Taper
        progressPct >= 60 -> TrainingPhase.Peak
        progressPct >= 25 -> TrainingPhase.Build
        else -> TrainingPhase.Early
    }
    val remainingPhases = PLAN_PHASE_ORDER.drop(PLAN_PHASE_ORDER.indexOf(phaseLabel) + 1)
    return PlanPhase(currentWeek, totalWeeks, phaseLabel, progressPct, remainingPhases)
}
