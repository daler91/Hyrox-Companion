package com.fitai.coach.core.api

import kotlinx.serialization.json.Json

/**
 * The JSON configuration for every request and response the app exchanges
 * with the API. Generated models (package `generated`) assume it.
 *
 * - `ignoreUnknownKeys`: the server may add response fields at any time (an
 *   additive change, which the OpenAPI breaking-change gate allows), and an
 *   installed build must keep decoding.
 * - `encodeDefaults = false`: a request property left at its default (null,
 *   or [Patch.Absent]) is omitted, so "not sent" stays distinct from "sent
 *   as null".
 * - `explicitNulls = true`: a property set to null on purpose is sent as null.
 */
public val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    explicitNulls = true
}
