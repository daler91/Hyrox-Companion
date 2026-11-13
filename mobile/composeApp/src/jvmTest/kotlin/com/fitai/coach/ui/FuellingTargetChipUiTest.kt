package com.fitai.coach.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.ui.fuelling.FuellingTarget
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * A planned session's card carries its fuel plan (FuellingTargetChip.tsx),
 * worked out from the duration and effort the server estimates from its
 * prescription.
 */
@OptIn(ExperimentalTestApi::class)
class FuellingTargetChipUiTest {
    @Test
    fun aLongHardPlannedSessionShowsItsFuelPlanOnTheCard() {
        val planned = FakeApi.plannedToday("Long run").removeSuffix("}") +
            ""","sessionEstimate":{"durationMin":100,"rpe":8,"source":"sets","clamped":false}}"""
        val target = assertNotNull(FuellingTarget.of(ApiJson.decodeFromString(TimelineEntry.serializer(), planned), null))
        assertTrue(target.hasPre, "a 100-minute hard session wants carbs before")
        val api = FakeApi().apply { establishedAccount(planned) }

        appTest(FakeAuth(AuthState.SignedIn("u1")), api) {
            awaitNode(hasText("Long run"))
            // The chip reads out how its targets were worked out.
            awaitNode(hasContentDescription(target.explanation))
        }
    }
}
