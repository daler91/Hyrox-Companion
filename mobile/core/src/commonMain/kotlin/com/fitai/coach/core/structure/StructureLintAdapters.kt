package com.fitai.coach.core.structure

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdStructureRequest
import com.fitai.coach.core.api.generated.UpdateWorkoutRequest

/*
 * The lint input read from the generated request models, so the app lints the
 * body it sends. A Patch left Absent and one sent as null both read as null,
 * the same as `== null` in the TS. A generated enum's Unknown reads as its wire
 * value "", which no rule matches.
 */

private fun <T : Any> Patch<T>.orNull(): T? = when (this) {
    is Patch.Value -> value
    Patch.Absent -> null
}

/** A workout-create exercise row as [lintWorkoutStructure] reads it. */
public fun CreateWorkoutRequest.ExercisesItem.toStructureLintExercise(): StructureLintExercise = StructureLintExercise(
    exerciseName = exerciseName,
    reps = reps.orNull()?.toLong(),
    repMode = repMode.orNull()?.wireValue,
    sets = sets.orNull()?.map { set ->
        StructureLintSet(
            reps = set.reps.orNull()?.toLong(),
            blockId = set.blockId.orNull(),
            stepNumber = set.stepNumber.orNull()?.toLong(),
        )
    },
)

/** A workout-update exercise row as [lintWorkoutStructure] reads it. */
public fun UpdateWorkoutRequest.ExercisesItem.toStructureLintExercise(): StructureLintExercise = StructureLintExercise(
    exerciseName = exerciseName,
    reps = reps.orNull()?.toLong(),
    repMode = repMode.orNull()?.wireValue,
    sets = sets.orNull()?.map { set ->
        StructureLintSet(
            reps = set.reps.orNull()?.toLong(),
            blockId = set.blockId.orNull(),
            stepNumber = set.stepNumber.orNull()?.toLong(),
        )
    },
)

/**
 * A request-side structure block as [lintWorkoutStructure] reads it. This
 * class is `structureBlockSchema`, the same schema POST and PATCH
 * /api/v1/workouts take for `structureBlocks`.
 */
public fun PatchPlansDaysByDayIdStructureRequest.StructureBlocksItem.toStructureLintBlock(): StructureLintBlock =
    StructureLintBlock(
        id = id,
        formatType = formatType.wireValue,
        durationMinutes = durationMinutes.orNull()?.toLong(),
        roundCount = roundCount.orNull()?.toLong(),
        timeCapMinutes = timeCapMinutes.orNull()?.toLong(),
        durationSeconds = durationSeconds.orNull()?.toLong(),
        rounds = rounds.orNull()?.toLong(),
        workSeconds = workSeconds.orNull()?.toLong(),
        restSeconds = restSeconds.orNull()?.toLong(),
        workIntervalSec = workIntervalSec.orNull()?.toLong(),
        restIntervalSec = restIntervalSec.orNull()?.toLong(),
        steps = steps.map { step ->
            StructureLintStep(
                stepNumber = step.stepNumber.toLong(),
                stepType = step.stepType?.wireValue,
                stepRole = step.stepRole.orNull(),
                targets = step.targets.orNull()?.let { targets ->
                    StructureLintTargets(
                        reps = targets.reps.orNull()?.toDouble(),
                        targetReps = targets.targetReps.orNull()?.toDouble(),
                        time = targets.time.orNull(),
                        targetTime = targets.targetTime.orNull(),
                        distance = targets.distance.orNull(),
                        targetDistance = targets.targetDistance.orNull(),
                    )
                },
            )
        },
    )
