package com.fitai.coach.core.structure

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Port of shared/schema/structureLint.ts. The server answers a workout save
 * whose lint has schemaErrors with a 400, so the app lints before it queues a
 * save (docs/mobile-shared-logic.md). Pinned by the
 * `structureLint.lintWorkoutStructure` fixture suite.
 */

/** `StructureLintSeverity` in structureLint.ts. */
@Serializable
public enum class StructureLintSeverity {
    @SerialName("error")
    Error,

    @SerialName("warning")
    Warning,

    @SerialName("info")
    Info,
}

/** The `code` values structureLint.ts emits. Serialized as the TS strings. */
@Serializable
public enum class StructureLintCode {
    @SerialName("AMBIGUOUS_REPS_SCOPE")
    AmbiguousRepsScope,

    @SerialName("INCOMPATIBLE_FORMAT_PARAMS")
    IncompatibleFormatParams,

    @SerialName("MISSING_REQUIRED_TARGET_BY_FORMAT")
    MissingRequiredTargetByFormat,

    @SerialName("REST_SCOPE_CONFLICT")
    RestScopeConflict,

    @SerialName("MISSING_STEP_TARGET")
    MissingStepTarget,

    @SerialName("MISSING_BLOCK_ID")
    MissingBlockId,

    @SerialName("MISSING_LINKED_EXERCISE_ROW")
    MissingLinkedExerciseRow,
}

/** `StructureLintIssue` in structureLint.ts. The message and guidance are the server's English copy. */
@Serializable
public data class StructureLintIssue(
    val severity: StructureLintSeverity,
    val code: StructureLintCode,
    val message: String,
    val fixGuidance: String,
)

/** `StructureLintResult` in structureLint.ts. */
@Serializable
public data class StructureLintResult(
    /** Every issue, in the order the TS finds them. */
    val issues: List<StructureLintIssue>,
    /** The errors. The server rejects the save if there is any. */
    val schemaErrors: List<StructureLintIssue>,
    val warnings: List<StructureLintIssue>,
    val infos: List<StructureLintIssue>,
    /** 100 minus 30 per error, 10 per warning and 3 per info, clamped to 0..100; 100 for empty input. */
    val structureCompletenessScore: Int,
)

/**
 * Port of `lintWorkoutStructure` (shared/schema/structureLint.ts): the server's
 * structural checks on a workout save, in the same order and with the same
 * copy. Null lists count as empty.
 *
 * Issues, in order:
 * 1. Each exercise with `repMode` "per_side", top-level reps and set reps:
 *    AMBIGUOUS_REPS_SCOPE (warning).
 * 2. Per block, in order: the format rules (errors), REST_SCOPE_CONFLICT
 *    (warning), then one MISSING_STEP_TARGET (info) per untargeted for_time step.
 * 3. Only when there are exercises, per emom, amrap or rounds block:
 *    MISSING_BLOCK_ID, or MISSING_LINKED_EXERCISE_ROW per work step that no
 *    set links to (errors).
 */
public fun lintWorkoutStructure(
    structureBlocks: List<StructureLintBlock>? = null,
    exercises: List<StructureLintExercise>? = null,
): StructureLintResult {
    val blocks = structureBlocks.orEmpty()
    val exList = exercises.orEmpty()
    val issues = exerciseIssues(exList) + blocks.flatMap(::blockIssues) + blockLinkIssues(blocks, exList)
    return buildLintResult(issues, blocks.size + exList.size)
}

// The TS map also aliases weight to targetWeight, which no rule asks for.
private val TARGET_ALIAS: Map<String, String> = mapOf(
    "reps" to "targetReps",
    "time" to "targetTime",
    "distance" to "targetDistance",
)

private fun StructureLintTargets.valueOf(key: String): Double? = when (key) {
    "reps" -> reps
    "targetReps" -> targetReps
    "time" -> time
    "targetTime" -> targetTime
    "distance" -> distance
    "targetDistance" -> targetDistance
    else -> null
}

private fun hasTarget(step: StructureLintStep, key: String): Boolean {
    val targets = step.targets ?: return false
    val aliasKey = TARGET_ALIAS[key]
    return targets.valueOf(key) != null || (aliasKey != null && targets.valueOf(aliasKey) != null)
}

private fun structureIssue(
    severity: StructureLintSeverity,
    code: StructureLintCode,
    message: String,
    fixGuidance: String,
): StructureLintIssue = StructureLintIssue(severity, code, message, fixGuidance)

private fun hasPerSetReps(exercise: StructureLintExercise): Boolean =
    exercise.sets?.any { it.reps != null } ?: false

private fun exerciseIssues(exercises: List<StructureLintExercise>): List<StructureLintIssue> {
    val issues = mutableListOf<StructureLintIssue>()
    for (exercise in exercises) {
        if (exercise.repMode != "per_side" || exercise.reps == null || !hasPerSetReps(exercise)) continue
        issues += structureIssue(
            StructureLintSeverity.Warning,
            StructureLintCode.AmbiguousRepsScope,
            "${exercise.exerciseName} has both top-level reps and set reps while repMode is per_side.",
            "Keep either total reps or per-set reps, then align repMode to match.",
        )
    }
    return issues
}

private fun blockFormatIssues(block: StructureLintBlock, format: String): List<StructureLintIssue> {
    val issues = mutableListOf<StructureLintIssue>()
    if (format == "amrap" && block.rounds != null) {
        issues += structureIssue(
            StructureLintSeverity.Error,
            StructureLintCode.IncompatibleFormatParams,
            "AMRAP cannot include fixed rounds.",
            "Remove rounds or change format type.",
        )
    }
    if (format == "amrap" && block.durationSeconds == null && block.durationMinutes == null && block.timeCapMinutes == null) {
        issues += structureIssue(
            StructureLintSeverity.Error,
            StructureLintCode.MissingRequiredTargetByFormat,
            "AMRAP blocks require a time cap or duration.",
            "Set a time cap or duration on the block.",
        )
    }
    if (format == "rounds" && block.roundCount == null && block.rounds == null) {
        issues += structureIssue(
            StructureLintSeverity.Error,
            StructureLintCode.MissingRequiredTargetByFormat,
            "Rounds blocks require a round count.",
            "Set the number of prescribed rounds.",
        )
    }
    if (format == "for_time" && block.durationSeconds == null && block.timeCapMinutes == null) {
        issues += structureIssue(
            StructureLintSeverity.Error,
            StructureLintCode.MissingRequiredTargetByFormat,
            "for_time blocks require durationSeconds cap.",
            "Set a duration cap in seconds.",
        )
    }
    if (
        format == "interval" &&
        (block.workSeconds == null || block.restSeconds == null) &&
        (block.workIntervalSec == null || block.restIntervalSec == null)
    ) {
        issues += structureIssue(
            StructureLintSeverity.Error,
            StructureLintCode.MissingRequiredTargetByFormat,
            "interval blocks require both workSeconds and restSeconds.",
            "Provide work and rest seconds on the block.",
        )
    }
    return issues
}

// `??` in the TS, which, like `?:`, falls through on null only: a stepRole of "" wins.
private fun isRestStep(step: StructureLintStep): Boolean =
    (step.stepRole ?: step.stepType ?: "").lowercase() == "rest"

private fun restScopeIssues(block: StructureLintBlock): List<StructureLintIssue> {
    val hasRestStep = block.steps.any(::isRestStep)
    if (!hasRestStep || block.restSeconds == null) return emptyList()
    return listOf(
        structureIssue(
            StructureLintSeverity.Warning,
            StructureLintCode.RestScopeConflict,
            "Block has restSeconds and explicit rest steps; rest scope may be duplicated.",
            "Use block-level rest OR rest steps, not both.",
        ),
    )
}

private fun isMissingForTimeTarget(step: StructureLintStep): Boolean =
    !hasTarget(step, "distance") && !hasTarget(step, "reps") && !hasTarget(step, "time")

private fun stepTargetIssues(block: StructureLintBlock, format: String): List<StructureLintIssue> {
    if (format != "for_time") return emptyList()
    val issues = mutableListOf<StructureLintIssue>()
    for (step in block.steps) {
        if (!isMissingForTimeTarget(step)) continue
        issues += structureIssue(
            StructureLintSeverity.Info,
            StructureLintCode.MissingStepTarget,
            // stepNumber is a whole number, which Kotlin and JS print alike.
            "Step ${step.stepNumber} has no explicit target.",
            "Add a reps, distance, or time target for clearer execution.",
        )
    }
    return issues
}

private fun blockIssues(block: StructureLintBlock): List<StructureLintIssue> {
    val format = block.formatType.lowercase()
    return blockFormatIssues(block, format) + restScopeIssues(block) + stepTargetIssues(block, format)
}

// Exact comparison, unlike the lowercased format rules.
private fun isComplexBlock(block: StructureLintBlock): Boolean =
    block.formatType == "emom" || block.formatType == "amrap" || block.formatType == "rounds"

private fun requiresLinkedExerciseRow(step: StructureLintStep): Boolean {
    val role = (step.stepRole ?: step.stepType ?: "work").lowercase()
    return role == "work"
}

private fun linkedExerciseStepKeys(exercises: List<StructureLintExercise>): Set<String> {
    val keys = mutableSetOf<String>()
    for (exercise in exercises) {
        for (set in exercise.sets.orEmpty()) {
            if (set.blockId.isNullOrEmpty() || set.stepNumber == null) continue
            keys += "${set.blockId}:${set.stepNumber}"
        }
    }
    return keys
}

private fun blockLinkIssues(
    blocks: List<StructureLintBlock>,
    exercises: List<StructureLintExercise>,
): List<StructureLintIssue> {
    if (exercises.isEmpty()) return emptyList()
    val linkedKeys = linkedExerciseStepKeys(exercises)
    val issues = mutableListOf<StructureLintIssue>()
    for (block in blocks) {
        if (!isComplexBlock(block)) continue
        if (block.id.isNullOrEmpty()) {
            issues += structureIssue(
                StructureLintSeverity.Error,
                StructureLintCode.MissingBlockId,
                "${block.formatType.uppercase()} blocks require a stable id for exercise row links.",
                "Save the block with an id and link exercise rows to its steps.",
            )
            continue
        }
        for (step in block.steps) {
            if (!requiresLinkedExerciseRow(step)) continue
            val key = "${block.id}:${step.stepNumber}"
            if (key in linkedKeys) continue
            issues += structureIssue(
                StructureLintSeverity.Error,
                StructureLintCode.MissingLinkedExerciseRow,
                "${block.formatType.uppercase()} step ${step.stepNumber} must be linked to an exercise row.",
                "Assign an exercise table row to this block step.",
            )
        }
    }
    return issues
}

private fun buildLintResult(issues: List<StructureLintIssue>, total: Int): StructureLintResult {
    val schemaErrors = issues.filter { it.severity == StructureLintSeverity.Error }
    val warnings = issues.filter { it.severity == StructureLintSeverity.Warning }
    val infos = issues.filter { it.severity == StructureLintSeverity.Info }
    val penalty = schemaErrors.size * 30 + warnings.size * 10 + infos.size * 3
    val base = if (total == 0) 100 else 100 - penalty
    return StructureLintResult(
        issues = issues,
        schemaErrors = schemaErrors,
        warnings = warnings,
        infos = infos,
        structureCompletenessScore = maxOf(0, minOf(100, base)),
    )
}
