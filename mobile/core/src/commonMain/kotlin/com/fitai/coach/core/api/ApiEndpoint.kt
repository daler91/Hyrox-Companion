package com.fitai.coach.core.api

import kotlinx.serialization.KSerializer

public enum class HttpMethod { Get, Post, Put, Patch, Delete }

/** How an endpoint's success body arrives. */
public enum class ResponseKind {
    /** A JSON body, decoded with [ApiEndpoint.responseSerializer]. */
    Json,

    /** Server-Sent Events: `data: <json>` lines, each decoded with [ApiEndpoint.responseSerializer]. */
    EventStream,

    /** A body that is not JSON (a CSV download); [ApiEndpoint.responseSerializer] is null. */
    Raw,

    /** No documented body. */
    None,
}

/**
 * One API operation, as generated into `ApiEndpoints` from docs/openapi.json:
 * its method, path template, and the serializers for its JSON request body
 * and success response. The HTTP client (Phase 3) is written against this,
 * so it never spells a path or a body type by hand.
 */
public abstract class ApiEndpoint<Req, Res>(
    public val method: HttpMethod,
    public val pathTemplate: String,
    public val requestSerializer: KSerializer<Req>?,
    public val responseSerializer: KSerializer<Res>?,
    public val responseKind: ResponseKind,
    public val successStatus: Int,
) {
    /** Fill the `{name}` placeholders of [pathTemplate], percent-encoding each value. */
    protected fun buildPath(vararg params: Pair<String, String>): String {
        var path = pathTemplate
        for ((name, value) in params) {
            val placeholder = "{$name}"
            require(placeholder in path) { "$pathTemplate has no {$name}" }
            path = path.replace(placeholder, encodePathSegment(value))
        }
        require('{' !in path) { "Unfilled path parameter in $path" }
        return path
    }

    override fun toString(): String = "${method.name.uppercase()} $pathTemplate"
}

/** RFC 3986 percent-encoding of one path segment: everything but the unreserved characters. */
internal fun encodePathSegment(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
        val c = byte.toInt() and 0xFF
        val ch = c.toChar()
        if (ch.isLetterOrDigit() && c < 0x80 || ch == '-' || ch == '.' || ch == '_' || ch == '~') {
            append(ch)
        } else {
            append('%')
            append("0123456789ABCDEF"[c shr 4])
            append("0123456789ABCDEF"[c and 0x0F])
        }
    }
}
