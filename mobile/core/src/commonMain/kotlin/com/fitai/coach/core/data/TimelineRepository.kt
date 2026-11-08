package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.TimelineEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The training timeline: planned days and logged workouts, newest first.
 * Screens read [entries], which the database serves offline; [refresh]
 * replaces them with the server's.
 */
public class TimelineRepository(private val db: FitaiDatabase, private val api: ApiClient) {
    private val dao = db.timeline()

    public val entries: Flow<List<TimelineEntry>> = dao.observeAll().map { rows ->
        rows.mapNotNull { decodeOrNull(TimelineEntry.serializer(), it.json) }
    }

    /**
     * Fetches the timeline's first page (every entry from today on, plus the
     * latest past ones) and stores it in the server's order. Older pages
     * arrive with the timeline screen (Phase 4).
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun refresh() {
        val entries = api.call(ApiEndpoints.GetTimeline)
        val rows = entries.mapIndexed { index, entry ->
            TimelineEntryEntity(id = entry.id, date = entry.date, position = index, json = encode(TimelineEntry.serializer(), entry))
        }
        db.writeTransaction {
            dao.clear()
            dao.insertAll(rows)
        }
    }
}
