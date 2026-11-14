package com.fitai.coach.core.structure

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * The athlete's result for an EMOM, AMRAP or rounds block
 * (structureBlockScoreSchema). Its type always matches the block's format;
 * the generated block model carries it as raw JSON.
 */
public sealed interface BlockScore {
    public val notes: String?

    /** Every minute on the minute: finished, how many minutes, reps missed. */
    public data class Emom(
        val completed: Boolean,
        val completedMinutes: Int? = null,
        val missedReps: Int? = null,
        override val notes: String? = null,
    ) : BlockScore

    /** As many rounds as possible: full rounds, then the reps of the last one. */
    public data class Amrap(val rounds: Int, val reps: Int? = null, override val notes: String? = null) : BlockScore

    /** Fixed rounds: how many were done, and the time it took. */
    public data class Rounds(
        val completedRounds: Int,
        val elapsedSeconds: Int? = null,
        override val notes: String? = null,
    ) : BlockScore

    public companion object {
        /** The score a block carries; null for none, or one this build can't read. */
        public fun of(json: JsonElement?): BlockScore? {
            val fields = json as? JsonObject ?: return null
            fun int(name: String) = (fields[name] as? JsonPrimitive)?.intOrNull
            val notes = (fields[NOTES] as? JsonPrimitive)?.takeIf { it.isString }?.content
            return when ((fields[TYPE] as? JsonPrimitive)?.content) {
                TYPE_EMOM -> Emom(
                    (fields[COMPLETED] as? JsonPrimitive)?.booleanOrNull ?: false,
                    int(COMPLETED_MINUTES),
                    int(MISSED_REPS),
                    notes,
                )
                TYPE_AMRAP -> Amrap(int(ROUNDS) ?: 0, int(REPS), notes)
                TYPE_ROUNDS -> Rounds(int(COMPLETED_ROUNDS) ?: 0, int(ELAPSED_SECONDS), notes)
                else -> null
            }
        }
    }
}

/** The score as the server takes it; [score] null clears it. */
public fun blockScoreJson(score: BlockScore?): JsonElement = when (score) {
    null -> JsonNull
    is BlockScore.Emom -> buildJsonObject {
        put(TYPE, TYPE_EMOM)
        put(COMPLETED, score.completed)
        put(COMPLETED_MINUTES, score.completedMinutes)
        put(MISSED_REPS, score.missedReps)
        put(NOTES, score.notes)
    }
    is BlockScore.Amrap -> buildJsonObject {
        put(TYPE, TYPE_AMRAP)
        put(ROUNDS, score.rounds)
        put(REPS, score.reps)
        put(NOTES, score.notes)
    }
    is BlockScore.Rounds -> buildJsonObject {
        put(TYPE, TYPE_ROUNDS)
        put(COMPLETED_ROUNDS, score.completedRounds)
        put(ELAPSED_SECONDS, score.elapsedSeconds)
        put(NOTES, score.notes)
    }
}

// The score's wire names, shared by the reader and the writer.
private const val TYPE = "type"
private const val NOTES = "notes"
private const val TYPE_EMOM = "emom"
private const val TYPE_AMRAP = "amrap"
private const val TYPE_ROUNDS = "rounds"
private const val COMPLETED = "completed"
private const val COMPLETED_MINUTES = "completedMinutes"
private const val MISSED_REPS = "missedReps"
private const val ROUNDS = "rounds"
private const val REPS = "reps"
private const val COMPLETED_ROUNDS = "completedRounds"
private const val ELAPSED_SECONDS = "elapsedSeconds"
