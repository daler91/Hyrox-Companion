package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.RacePrediction
import com.fitai.coach.core.api.generated.RacePredictionConfidence
import com.fitai.coach.core.api.generated.SessionGradeRollupCounts
import com.fitai.coach.core.api.generated.SessionGradeRunPurpose
import com.fitai.coach.core.api.generated.SessionGradeTrainingPhase
import com.fitai.coach.core.api.generated.SessionGradesResponse
import com.fitai.coach.ui.components.BadgeTone
import kotlin.math.roundToInt

private const val SECONDS_PER_MINUTE = 60
private const val SECONDS_PER_HOUR = 3600
private const val PERCENT = 100

// --- Race predictor (RacePredictorTab.tsx) ---

/** "1:23:05": a whole race (formatSecondsToClock). */
fun formatFinishTime(seconds: Double): String {
    val total = seconds.coerceAtLeast(0.0).roundToInt()
    val minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    return "${total / SECONDS_PER_HOUR}:${minutes.pad2()}:${(total % SECONDS_PER_MINUTE).pad2()}"
}

/** "4:05": one split (formatSecondsToMmSs). */
fun formatSplit(seconds: Double): String {
    val total = seconds.coerceAtLeast(0.0).roundToInt()
    return "${total / SECONDS_PER_MINUTE}:${(total % SECONDS_PER_MINUTE).pad2()}"
}

private fun Int.pad2() = toString().padStart(2, '0')

/** "High confidence", in the colour the web gives it. */
fun confidenceBadge(confidence: RacePredictionConfidence): Pair<String, BadgeTone> = when (confidence) {
    RacePredictionConfidence.High -> "High confidence" to BadgeTone.Success
    RacePredictionConfidence.Medium -> "Medium confidence" to BadgeTone.Warning
    RacePredictionConfidence.Low, RacePredictionConfidence.Unknown -> "Low confidence" to BadgeTone.Neutral
}

/** "From your logs · 6": where a split came from, and from how many sessions. */
fun segmentBasis(segment: RacePrediction.SegmentsItem): String {
    val basis = when (segment.basis) {
        RacePrediction.SegmentsItem.Basis.Logged -> "From your logs"
        RacePrediction.SegmentsItem.Basis.Benchmark -> "Benchmark"
        RacePrediction.SegmentsItem.Basis.Blended -> "Blended"
        RacePrediction.SegmentsItem.Basis.Unknown -> "Estimate"
    }
    return if (segment.sampleSize > 0) "$basis · ${segment.sampleSize}" else basis
}

/** "Open · Men · 30-34 · 6/8 stations logged": who the prediction is for, and what it rests on. */
fun predictionSubtitle(prediction: RacePrediction): String {
    val division = if (prediction.division == RacePrediction.Division.Pro) "Pro" else "Open"
    val gender = when (prediction.gender) {
        RacePrediction.Gender.Male -> "Men"
        RacePrediction.Gender.Female -> "Women"
        else -> "Unspecified"
    }
    val data = prediction.dataCompleteness
    return listOfNotNull(division, gender, prediction.ageGroup, "${data.stationsWithData}/${data.totalStations} stations logged")
        .joinToString(" · ")
}

/** "Faster than 62% of men 30-34 · 1,204 athletes"; null with no cohort to compare against. */
fun percentileLine(prediction: RacePrediction): String? = prediction.percentile?.let {
    "Faster than ${formatPercent(it.fasterThanPct)}% of ${it.cohortLabel} · ${groupThousands(it.cohortSize)} athletes"
}

private fun formatPercent(value: Double): String = if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()

private const val DIGITS_PER_GROUP = 3

/** "12,045", as toLocaleString writes a cohort size. */
private fun groupThousands(value: Long): String = value.toString().reversed().chunked(DIGITS_PER_GROUP).joinToString(",").reversed()

/** Nothing logged at all: no prediction worth showing. */
fun hasNoRaceData(prediction: RacePrediction): Boolean =
    prediction.dataCompleteness.stationsWithData == 0L && !prediction.dataCompleteness.hasRunData

/** Why there's no AI in this prediction (aiUnavailableCopy). */
fun aiNotice(reason: RacePrediction.AiUnavailableReason?): String = when (reason) {
    RacePrediction.AiUnavailableReason.AiConsentOff ->
        "This is a baseline estimate from your logged data. Enable the AI Coach in Settings for a sharper, fatigue-aware prediction."
    RacePrediction.AiUnavailableReason.AiBudgetExceeded ->
        "You've reached today's AI usage limit, so this is a baseline estimate from your logged data. " +
            "Try again tomorrow for an AI-refined prediction."
    RacePrediction.AiUnavailableReason.AiDisabled ->
        "AI features are temporarily unavailable, so this is a baseline estimate from your logged data."
    RacePrediction.AiUnavailableReason.AiError ->
        "The AI coach couldn't be reached just now, so this is a baseline estimate from your logged data."
    else -> "This is a baseline estimate from your logged data."
}

/** The readiness status's word and colour (READINESS_STYLES). */
fun readinessBadge(status: RacePrediction.RaceReadiness.Status): Pair<String, BadgeTone> = when (status) {
    RacePrediction.RaceReadiness.Status.Peaked -> "Peaked" to BadgeTone.Success
    RacePrediction.RaceReadiness.Status.Fresh -> "Fresh" to BadgeTone.Success
    RacePrediction.RaceReadiness.Status.Neutral -> "Race-ready" to BadgeTone.Accent
    RacePrediction.RaceReadiness.Status.Fatigued -> "Fatigued" to BadgeTone.Warning
    RacePrediction.RaceReadiness.Status.VeryFatigued -> "Very fatigued" to BadgeTone.Danger
    RacePrediction.RaceReadiness.Status.InsufficientData, RacePrediction.RaceReadiness.Status.Unknown ->
        "Not enough data" to BadgeTone.Neutral
}

/** "+12", "-8": training form (TSB), signed. */
fun formatTsb(tsb: Double): String {
    val whole = tsb.roundToInt()
    return if (whole > 0) "+$whole" else whole.toString()
}

/** "Last updated Nov 10, 2026 at 9:30 AM." with a note when newer activity makes it stale (LastUpdatedNote). */
fun lastUpdatedNote(label: String?, stale: Boolean?): String? =
    label?.let { "Last updated $it." + if (stale == true) " New activity since — refresh to update." else "" }

// --- Session quality (SessionGradesTab.tsx) ---

/** How many easy (or threshold) runs got a definite verdict, and how many of those did their job. */
data class Share(val onTarget: Long, val graded: Long)

fun easyShare(counts: SessionGradeRollupCounts): Share = with(counts.easy) {
    Share(onTarget, onTarget + creptUp + tooHard + driftedHarder + under)
}

fun thresholdShare(counts: SessionGradeRollupCounts): Share = with(counts.threshold) {
    Share(onTarget, onTarget + creptUp + tooHard + driftedHarder + under)
}

/** "75%", or "—" with nothing graded (formatShare). */
fun formatShare(share: Share): String =
    if (share.graded > 0) "${(share.onTarget * PERCENT.toDouble() / share.graded).roundToInt()}%" else "—"

/** "3 of 4 (75%)", or "—" (BlockGradesTable shareCell). */
fun shareCell(share: Share): String = if (share.graded > 0) "${share.onTarget} of ${share.graded} (${formatShare(share)})" else "—"

/** "Race week", "Build" (phaseLabel); null for none. */
fun phaseLabel(phase: SessionGradeTrainingPhase?): String? = when (phase) {
    null, SessionGradeTrainingPhase.Unknown -> null
    SessionGradeTrainingPhase.RaceWeek -> "Race week"
    else -> phase.wireValue.replaceFirstChar { it.uppercase() }
}

/** "Easy run", "Race effort" (runPurposeLabel). */
fun purposeLabel(purpose: SessionGradeRunPurpose): String = when (purpose) {
    SessionGradeRunPurpose.Easy -> "Easy run"
    SessionGradeRunPurpose.Recovery -> "Recovery run"
    SessionGradeRunPurpose.Long -> "Long run"
    SessionGradeRunPurpose.Threshold -> "Threshold run"
    SessionGradeRunPurpose.Intervals -> "Intervals"
    SessionGradeRunPurpose.Steady -> "Steady run"
    SessionGradeRunPurpose.Race -> "Race effort"
    SessionGradeRunPurpose.Unknown -> "Run"
}

/** "Weeks 1–4 · deload": a block's span. */
fun blockSpan(block: SessionGradesResponse.BlocksItem): String {
    val weeks = if (block.firstWeek == block.lastWeek) "Week ${block.firstWeek}" else "Weeks ${block.firstWeek}–${block.lastWeek}"
    return if (block.includesDeload) "$weeks · deload" else weeks
}

/**
 * One plan week's runs in the chart's four stacks (toGradeChartRow): did its
 * job, crept up or under, too hard or drifted harder, and can't tell.
 */
data class GradeStack(val onTarget: Long, val partial: Long, val missed: Long, val unclear: Long) {
    val total: Long get() = onTarget + partial + missed + unclear
}

fun gradeStack(counts: SessionGradeRollupCounts): GradeStack {
    val easy = counts.easy
    val threshold = counts.threshold
    return GradeStack(
        onTarget = easy.onTarget + threshold.onTarget,
        partial = easy.creptUp + threshold.under,
        missed = easy.tooHard + threshold.driftedHarder,
        unclear = easy.inconclusive + threshold.inconclusive + easy.ungradeable + threshold.ungradeable,
    )
}

/** The newest graded runs the tab lists (RECENT_SESSION_COUNT). */
const val RECENT_GRADED_RUNS = 8

// --- AI failures (describeAiError) ---

private const val TOO_MANY_REQUESTS = 429
private const val FORBIDDEN = 403

/**
 * What to say when an AI analysis fails: the coach being off, the daily
 * budget, asking too often, or a generic [fallback]. [activity] reads "You're
 * [activity] too quickly".
 */
fun describeAiFailure(error: Throwable, activity: String, fallback: String): String = when {
    error !is ApiException -> fallback
    error.status == FORBIDDEN && error.code == "AI_COACH_DISABLED" ->
        "The AI Coach is turned off. Enable it in Settings to use this feature."
    error.code == "AI_BUDGET_EXCEEDED" -> "You've reached your daily AI usage limit. Please try again later."
    error.status == TOO_MANY_REQUESTS -> "You're $activity too quickly. Please wait a moment and try again."
    else -> fallback
}
