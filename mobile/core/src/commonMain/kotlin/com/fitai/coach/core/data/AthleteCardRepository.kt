package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.AthleteFact

/** The athlete card (/athlete-facts): what the coach treats as true every week, and every plan is written around. */
public class AthleteCardRepository(private val api: ApiClient) {
    /** The facts still in force; retired ones are left out. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun activeFacts(): List<AthleteFact> = api.call(ApiEndpoints.GetAthleteFacts).filter { it.active }
}
