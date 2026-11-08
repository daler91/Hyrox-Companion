package com.fitai.coach.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer

/**
 * Whole API responses kept in the database, so a screen shows the last one
 * offline. A repository fetches, [put]s, and its screen [observe]s.
 */
public class CacheStore(db: FitaiDatabase, private val now: () -> Long) {
    private val dao = db.cache()

    /** The cached value of [key], or null while there is none (or it no longer decodes). */
    public fun <T> observe(key: String, serializer: KSerializer<T>): Flow<T?> =
        dao.observe(key).map { entry -> entry?.let { decodeOrNull(serializer, it.json) } }

    public suspend fun <T> get(key: String, serializer: KSerializer<T>): T? =
        dao.get(key)?.let { decodeOrNull(serializer, it.json) }

    public suspend fun <T> put(key: String, serializer: KSerializer<T>, value: T) {
        dao.upsert(CacheEntryEntity(key = key, json = encode(serializer, value), updatedAt = now()))
    }

    public suspend fun delete(key: String) {
        dao.delete(key)
    }

    /** Deletes every entry whose key starts with [prefix], e.g. every day of `nutrition:`. */
    public suspend fun deletePrefix(prefix: String) {
        dao.deletePrefix(prefix)
    }
}
