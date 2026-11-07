package com.fitai.coach.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** A generated enum constant and the string the API uses for it. */
public interface WireEnum {
    public val wireValue: String
}

/**
 * Serializer for generated enums. A value this build does not know decodes
 * as [unknown] instead of failing, so a server that adds an enum value (which
 * the breaking-change gate reports only as a warning) cannot crash an older
 * app. Sending [unknown] is a programming error and throws.
 */
public abstract class WireEnumSerializer<E>(
    serialName: String,
    private val values: List<E>,
    private val unknown: E,
) : KSerializer<E> where E : Enum<E>, E : WireEnum {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(serialName, PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: E) {
        if (value == unknown) throw SerializationException("$value cannot be sent: it stands for a value this build does not know")
        encoder.encodeString(value.wireValue)
    }

    override fun deserialize(decoder: Decoder): E {
        val wire = decoder.decodeString()
        return values.firstOrNull { it != unknown && it.wireValue == wire } ?: unknown
    }
}
