package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.ApiEndpoints
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private const val PLAN_DAY_ID = "planDayId"

/**
 * The ids the queued writes in [rows] are about: each id in their paths (the
 * `{...}` parts of the endpoint's template: a plan day, a workout, a set) and
 * the plan day a queued log completes. A timeline card whose plan day or
 * workout is among them has changes still to send (the web's "Pending sync").
 */
internal fun pendingIdsOf(rows: List<OutboxEntity>): Set<String> = buildSet {
    for (row in rows) {
        val template = ApiEndpoints.all[row.operation]?.pathTemplate?.split('/').orEmpty()
        row.path.split('/').zip(template).forEach { (segment, part) -> if (part.startsWith('{')) add(segment) }
        row.body?.let(::planDayIdIn)?.let(::add)
    }
}

/** The plan day a write's body names, as a log that completes it does. */
private fun planDayIdIn(body: String): String? = try {
    (ApiJson.parseToJsonElement(body) as? JsonObject)?.get(PLAN_DAY_ID)?.jsonPrimitive?.contentOrNull
} catch (_: SerializationException) {
    null
} catch (_: IllegalArgumentException) {
    null
}
