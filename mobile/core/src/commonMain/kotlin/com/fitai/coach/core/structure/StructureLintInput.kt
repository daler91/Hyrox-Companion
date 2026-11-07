package com.fitai.coach.core.structure

import kotlinx.serialization.Serializable

/*
 * What lintWorkoutStructure reads from a workout's structure blocks and
 * exercise rows (StructureBlockInput and ParsedExercise in shared/schema),
 * and nothing else.
 *
 * Its own types rather than generated API models, because no generated type
 * is the input the server lints:
 * - The workout write models (CreateWorkoutRequest, UpdateWorkoutRequest)
 *   have no structureBlocks field, although POST and PATCH /api/v1/workouts
 *   accept and lint one. The only request-side block model belongs to
 *   PATCH /api/v1/plans/days/{dayId}/structure.
 * - The rows the app sends are CreateWorkoutRequest.ExercisesItem or
 *   UpdateWorkoutRequest.ExercisesItem, two separate classes; ParsedExercise
 *   is the parser's response.
 * - Generated enums decode a value they do not know, wrong case included, as
 *   Unknown. The linter lowercases formatType, stepType and stepRole itself,
 *   so these keep the wire strings.
 *
 * StructureLintAdapters.kt converts the generated request models.
 * Serializable, so a request body can also be decoded straight into these with
 * `ignoreUnknownKeys`.
 */

/**
 * A structure block, as `lintWorkoutStructure` reads it. Absent and null are
 * the same here: every numeric field is only checked for presence, and 0
 * counts as present.
 */
@Serializable
public data class StructureLintBlock(
    /** The block's id. Null or empty counts as missing (the TS tests `!block.id`). */
    val id: String? = null,
    /**
     * The wire value, e.g. "amrap". The format rules lowercase it, but the link
     * rule compares it exactly, so "AMRAP" gets the AMRAP checks and no link check.
     */
    val formatType: String,
    val durationMinutes: Long? = null,
    val roundCount: Long? = null,
    val timeCapMinutes: Long? = null,
    val durationSeconds: Long? = null,
    /** Legacy alias of [roundCount]. */
    val rounds: Long? = null,
    val workSeconds: Long? = null,
    val restSeconds: Long? = null,
    /** Alias of [workSeconds]; only counts paired with [restIntervalSec]. */
    val workIntervalSec: Long? = null,
    /** Alias of [restSeconds]; only counts paired with [workIntervalSec]. */
    val restIntervalSec: Long? = null,
    val steps: List<StructureLintStep>,
)

/** One step of a [StructureLintBlock]. */
@Serializable
public data class StructureLintStep(
    val stepNumber: Long,
    /** "work", "rest" or "transition". Overridden by [stepRole] when that is set, even to "". */
    val stepType: String? = null,
    /** Free text; compared case-insensitively to "rest" and "work". */
    val stepRole: String? = null,
    val targets: StructureLintTargets? = null,
)

/**
 * The step targets a for_time step can satisfy. A weight target does not count,
 * so it is left out.
 */
@Serializable
public data class StructureLintTargets(
    val reps: Double? = null,
    val targetReps: Double? = null,
    val time: Double? = null,
    val targetTime: Double? = null,
    val distance: Double? = null,
    val targetDistance: Double? = null,
)

/** An exercise row, as `lintWorkoutStructure` reads it. */
@Serializable
public data class StructureLintExercise(
    /** Shown in the AMBIGUOUS_REPS_SCOPE message as is. */
    val exerciseName: String,
    /** Top-level reps; 0 counts as present. */
    val reps: Long? = null,
    /** "total" or "per_side"; only exactly "per_side" matters. */
    val repMode: String? = null,
    val sets: List<StructureLintSet>? = null,
)

/** One set of a [StructureLintExercise]. */
@Serializable
public data class StructureLintSet(
    val reps: Long? = null,
    /** With [stepNumber], links the set to a block step. Null or empty is no link. */
    val blockId: String? = null,
    /** Any non-null value links, 0 included. */
    val stepNumber: Long? = null,
)
