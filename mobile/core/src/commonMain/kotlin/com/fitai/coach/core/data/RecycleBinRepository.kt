package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetRecycleBinResponse
import com.fitai.coach.core.api.generated.PostRecycleBinByIdRestoreResponse
import com.fitai.coach.core.api.generated.RecycleBinItem
import kotlinx.coroutines.flow.Flow

/**
 * The recycle bin (/recycle-bin): deleted workouts, plan days and training
 * plans, kept 90 days. Restore puts a record back exactly, with the same id;
 * "delete forever" and "empty" are final. The list is cached so Settings
 * shows it offline, and each change the server accepts is applied to that copy.
 */
public class RecycleBinRepository(private val api: ApiClient, private val cache: CacheStore) {
    /** The bin as last fetched, or null until it has been once. */
    public val bin: Flow<GetRecycleBinResponse?> = cache.observe(KEY, GetRecycleBinResponse.serializer())

    /** @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refresh(): GetRecycleBinResponse =
        api.call(ApiEndpoints.GetRecycleBin).also { cache.put(KEY, GetRecycleBinResponse.serializer(), it) }

    /**
     * Puts [item] back. Refresh the timeline and plans afterwards, which it reappears on.
     *
     * @return what couldn't be put back exactly, in the server's words.
     * @throws com.fitai.coach.core.api.ApiException 404 for an expired item, 409 for an overlap or conflict.
     */
    public suspend fun restore(item: RecycleBinItem): PostRecycleBinByIdRestoreResponse =
        api.call(ApiEndpoints.PostRecycleBinByIdRestore, path = ApiEndpoints.PostRecycleBinByIdRestore.path(item.id)).also { drop(item) }

    /** Deletes [item] for good. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun purge(item: RecycleBinItem) {
        api.call(ApiEndpoints.DeleteRecycleBinById, path = ApiEndpoints.DeleteRecycleBinById.path(item.id))
        drop(item)
    }

    /** Deletes everything in the bin for good. @return how many items went. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun empty(): Long {
        val purged = api.call(ApiEndpoints.DeleteRecycleBin).purgedCount
        cache.put(KEY, GetRecycleBinResponse.serializer(), GetRecycleBinResponse(emptyList(), GetRecycleBinResponse.Counts(0, 0, 0, 0)))
        return purged
    }

    /** Takes [item] out of the cached bin, and out of its counts. */
    private suspend fun drop(item: RecycleBinItem) {
        val bin = cache.get(KEY, GetRecycleBinResponse.serializer()) ?: return
        val counts = bin.counts
        val less = { n: Long -> (n - 1).coerceAtLeast(0) }
        val updated = when (item.entityType) {
            RecycleBinItem.EntityType.WorkoutLog -> counts.copy(workoutLog = less(counts.workoutLog))
            RecycleBinItem.EntityType.PlanDay -> counts.copy(planDay = less(counts.planDay))
            RecycleBinItem.EntityType.TrainingPlan -> counts.copy(trainingPlan = less(counts.trainingPlan))
            RecycleBinItem.EntityType.Unknown -> counts
        }.copy(total = less(counts.total))
        cache.put(KEY, GetRecycleBinResponse.serializer(), bin.copy(items = bin.items.filterNot { it.id == item.id }, counts = updated))
    }

    private companion object {
        const val KEY = "recycle-bin"
    }
}
