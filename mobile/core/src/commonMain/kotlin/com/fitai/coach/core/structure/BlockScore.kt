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
            val notes = (fields["notes"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            return when ((fields["type"] as? JsonPrimitive)?.content) {
                "emom" -> Emom(
                    (fields["completed"] as? JsonPrimitive)?.booleanOrNull ?: false,
                    int("completedMinutes"),
                    int("missedReps"),
                    notes,
                )
                "amrap" -> Amrap(int("rounds") ?: 0, int("reps"), notes)
                "rounds" -> Rounds(int("completedRounds") ?: 0, int("elapsedSeconds"), notes)
                else -> null
            }
        }
    }
}

/** The score as the server takes it; [score] null clears it. */
public fun blockScoreJson(score: BlockScore?): JsonElement = when (score) {
    null -> JsonNull
    is BlockScore.Emom -> buildJsonObject {
        put("type", "emom")
        put("completed", score.completed)
        put("completedMinutes", score.completedMinutes)
        put("missedReps", score.missedReps)
        put("notes", score.notes)
    }
    is BlockScore.Amrap -> buildJsonObject {
        put("type", "amrap")
        put("rounds", score.rounds)
        put("reps", score.reps)
        put("notes", score.notes)
    }
    is BlockScore.Rounds -> buildJsonObject {
        put("type", "rounds")
        put("completedRounds", score.completedRounds)
        put("elapsedSeconds", score.elapsedSeconds)
        put("notes", score.notes)
    }
}
