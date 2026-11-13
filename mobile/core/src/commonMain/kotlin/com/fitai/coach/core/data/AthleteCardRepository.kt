package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.AthleteFact
import com.fitai.coach.core.api.generated.PatchAthleteFactsByIdRequest
import com.fitai.coach.core.api.generated.PostAthleteFactsImportResponse
import com.fitai.coach.core.api.generated.PostAthleteFactsRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer

/**
 * The athlete card (/athlete-facts): what the coach treats as true every
 * week, and every plan is written around. The whole card, retired facts
 * included, is cached so Settings shows it offline; each change the server
 * accepts is written into that copy from the server's answer.
 */
public class AthleteCardRepository(private val api: ApiClient, private val cache: CacheStore) {
    /** Every fact, retired ones included, oldest first; null until the card has been fetched once. */
    public val facts: Flow<List<AthleteFact>?> = cache.observe(FACTS, SERIALIZER)

    /** Fetches the card and keeps it. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refresh(): List<AthleteFact> = api.call(ApiEndpoints.GetAthleteFacts).also { cache.put(FACTS, SERIALIZER, it) }

    /** The facts still in force; retired ones are left out. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun activeFacts(): List<AthleteFact> = refresh().filter { it.active }

    /**
     * Adds a fact; one the card already holds (same words, give or take case
     * and a full stop) is re-confirmed instead, so it comes back with its id.
     *
     * @throws com.fitai.coach.core.api.ApiException e.g. when the card is full.
     */
    public suspend fun add(fact: String, category: PostAthleteFactsRequest.Category): AthleteFact =
        api.call(ApiEndpoints.PostAthleteFacts, PostAthleteFactsRequest(fact = fact, category = category)).also { keep(it) }

    /** Rewords, recategorises, retires, restores or confirms a fact. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun update(id: String, changes: PatchAthleteFactsByIdRequest): AthleteFact =
        api.call(ApiEndpoints.PatchAthleteFactsById, changes, path = ApiEndpoints.PatchAthleteFactsById.path(id)).also { keep(it) }

    /** Deletes a fact for good. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun delete(id: String) {
        api.call(ApiEndpoints.DeleteAthleteFactsById, path = ApiEndpoints.DeleteAthleteFactsById.path(id))
        cache.get(FACTS, SERIALIZER)?.let { card -> cache.put(FACTS, SERIALIZER, card.filterNot { it.id == id }) }
    }

    /**
     * Moves the older free-text injuries note onto the card, a fact per
     * sentence; the server drops the note only once all of it fits. Refetch
     * the card (and the user, whose note it is) afterwards.
     *
     * @throws com.fitai.coach.core.api.ApiException
     */
    public suspend fun importNote(): PostAthleteFactsImportResponse = api.call(ApiEndpoints.PostAthleteFactsImport)

    /** Puts the server's version of [fact] into the cached card, in place or at the end. */
    private suspend fun keep(fact: AthleteFact) {
        val card = cache.get(FACTS, SERIALIZER) ?: return
        val updated = if (card.any { it.id == fact.id }) card.map { if (it.id == fact.id) fact else it } else card + fact
        cache.put(FACTS, SERIALIZER, updated)
    }

    private companion object {
        const val FACTS = "athlete-facts"
        val SERIALIZER = ListSerializer(AthleteFact.serializer())
    }
}
