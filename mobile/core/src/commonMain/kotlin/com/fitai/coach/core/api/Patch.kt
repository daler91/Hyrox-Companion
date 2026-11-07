package com.fitai.coach.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A request field that is optional AND nullable, where leaving it out and
 * sending null mean different things: on `PATCH /api/v1/preferences`, an
 * absent `age` keeps the stored age while `"age": null` clears it. A plain
 * `Int? = null` cannot say both, so generated request models use this.
 *
 * [Absent] is the default and is omitted from the JSON ([ApiJson] does not
 * encode defaults); [Value] is sent as its value, null included.
 */
@Serializable(with = PatchSerializer::class)
public sealed interface Patch<out T : Any> {
    public data object Absent : Patch<Nothing>

    public data class Value<out T : Any>(val value: T?) : Patch<T>

    public companion object {
        /** Send [value]; null clears the field. */
        public fun <T : Any> of(value: T?): Patch<T> = Value(value)

        /** Send null: clear the field. */
        public fun <T : Any> clear(): Patch<T> = Value(null)
    }
}

public class PatchSerializer<T : Any>(dataSerializer: KSerializer<T>) : KSerializer<Patch<T>> {
    private val valueSerializer = dataSerializer.nullable
    override val descriptor: SerialDescriptor = valueSerializer.descriptor

    override fun serialize(encoder: Encoder, value: Patch<T>) {
        when (value) {
            // Only reachable when a Patch is encoded outside a class property,
            // where there is no key to leave out.
            Patch.Absent -> throw SerializationException("Patch.Absent has no JSON form; leave the property at its default")
            is Patch.Value -> valueSerializer.serialize(encoder, value.value)
        }
    }

    override fun deserialize(decoder: Decoder): Patch<T> = Patch.Value(valueSerializer.deserialize(decoder))
}
